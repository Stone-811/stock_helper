import { cache } from 'react'
import { getStocksByDate, getStockStrongHistory } from './firebase-admin'
import { fetchStockKline, fetchStockDayTrading } from './finmind'
import { calculateMACDValues, Candle } from './indicators'

// K 線多帶當日當沖量（張），供技術圖「當沖比例」指標使用
export type StockCandle = Candle & { day_trading_volume?: number }

export interface StockLatest {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  stock_name: string
  macd_status: string
  institutionalDate: string | null // 法人資料日期（可能與 K 線日不同；null = 當日無資料）
  foreign_buy: number | null
  trust_buy: number | null
  dealer_buy: number | null
  foreign_hold_ratio: number | null
  foreign_remain_ratio: number | null
  foreign_limit_ratio: number | null
  day_trading_volume: number | null
  foreign_streak: number | null // 外資連續買賣天數（連買 +N、連賣 -N）
  trust_streak: number | null   // 投信連續買賣天數（連買 +N、連賣 -N）
}

export interface StockDetailData {
  stock_id: string
  stock_name: string
  latest: StockLatest
  history: StockCandle[]
  recentStrongDays: number
}

/**
 * 取個股詳情（K 線用 FinMind、法人用 Firestore 當日、MACD 自算）
 * 用 React cache() 包裝：同一 request 內 generateMetadata 與頁面共用結果，不重複查詢。
 */
export const getStockData = cache(async (id: string): Promise<StockDetailData | null> => {
  // 抓 5 年：2Y 圖 + 指標暖身，且月K 的 MACD（需 ≥34 個月）與長均線才有足夠資料
  const start = new Date(Date.now() - 1825 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const history = await fetchStockKline(id, start)
  if (!history.length) return null

  const klineLast = history[history.length - 1]

  // B1: 法人資訊抓「與 K 線最後一根同一天」的 Firestore 資料，避免收盤價與法人分屬不同日
  // 同時（平行）抓個股當沖歷史，併入 K 線供技術圖「當沖比例」指標使用；失敗不影響頁面
  const [dayStocks, dayTrading] = await Promise.all([
    getStocksByDate(klineLast.date),
    fetchStockDayTrading(id, start).catch(() => []),
  ])
  const dtMap = new Map(dayTrading.map((d) => [d.date, d.day_trading_volume]))
  const historyWithDayTrading: StockCandle[] = history.map((c) => ({
    ...c,
    day_trading_volume: dtMap.get(c.date),
  }))
  const fsLatest = dayStocks.find((s: { stock_id: string }) => s.stock_id === id) as
    | Record<string, unknown>
    | undefined
  // B2: 區分「0」與「無資料」——當日 Firestore 查無這檔時，法人欄位回 null（前端顯示「—」）
  const hasInst = !!fsLatest
  const num = (v: unknown): number | null => (hasInst ? ((v as number) ?? 0) : null)

  // MACD 狀態用 K 線自算
  const macdVals = calculateMACDValues(history)
  const lastMacd = macdVals[macdVals.length - 1]
  const macd_status = lastMacd ? (lastMacd.histogram >= 0 ? '多' : '空') : ''

  const latest: StockLatest = {
    date: klineLast.date,
    open: klineLast.open,
    high: klineLast.high,
    low: klineLast.low,
    close: klineLast.close,
    volume: klineLast.volume,
    stock_name: (fsLatest?.stock_name as string) || id,
    macd_status,
    institutionalDate: (fsLatest?.date as string) ?? null,
    foreign_buy: num(fsLatest?.foreign_buy),
    trust_buy: num(fsLatest?.trust_buy),
    dealer_buy: num(fsLatest?.dealer_buy),
    foreign_hold_ratio: num(fsLatest?.foreign_hold_ratio),
    foreign_remain_ratio: num(fsLatest?.foreign_remain_ratio),
    foreign_limit_ratio: num(fsLatest?.foreign_limit_ratio),
    day_trading_volume: num(fsLatest?.day_trading_volume),
    foreign_streak: num(fsLatest?.foreign_streak),
    trust_streak: num(fsLatest?.trust_streak),
  }

  const strongHistory = await getStockStrongHistory(id, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentStrongDays = strongHistory.filter((item) => new Date(item.date) >= sevenDaysAgo).length

  return {
    stock_id: id,
    stock_name: latest.stock_name,
    latest,
    history: historyWithDayTrading,
    recentStrongDays,
  }
})
