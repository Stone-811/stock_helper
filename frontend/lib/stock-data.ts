import { cache } from 'react'
import { getLatestDate, getStocksByDate, getStockStrongHistory } from './firebase-admin'
import { fetchStockKline } from './finmind'
import { calculateMACDValues, Candle } from './indicators'

export interface StockLatest {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  stock_name: string
  macd_status: string
  foreign_buy: number
  trust_buy: number
  dealer_buy: number
  foreign_hold_ratio: number
  foreign_remain_ratio: number
  foreign_limit_ratio: number
  day_trading_volume: number
}

export interface StockDetailData {
  stock_id: string
  stock_name: string
  latest: StockLatest
  history: Candle[]
  recentStrongDays: number
}

/**
 * 取個股詳情（K 線用 FinMind、法人用 Firestore 當日、MACD 自算）
 * 用 React cache() 包裝：同一 request 內 generateMetadata 與頁面共用結果，不重複查詢。
 */
export const getStockData = cache(async (id: string): Promise<StockDetailData | null> => {
  // 約 2.5 年，足夠 2Y 圖 + 指標暖身
  const start = new Date(Date.now() - 900 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const history = await fetchStockKline(id, start)
  if (!history.length) return null

  // 最新法人資訊：Firestore 當日資料（1 天，快）
  const latestDate = await getLatestDate()
  const dayStocks = latestDate ? await getStocksByDate(latestDate) : []
  const fsLatest = dayStocks.find((s: { stock_id: string }) => s.stock_id === id) as
    | Record<string, unknown>
    | undefined

  // MACD 狀態用 K 線自算
  const macdVals = calculateMACDValues(history)
  const lastMacd = macdVals[macdVals.length - 1]
  const macd_status = lastMacd ? (lastMacd.histogram >= 0 ? '多' : '空') : ''

  const klineLast = history[history.length - 1]
  const latest: StockLatest = {
    date: klineLast.date,
    open: klineLast.open,
    high: klineLast.high,
    low: klineLast.low,
    close: klineLast.close,
    volume: klineLast.volume,
    stock_name: (fsLatest?.stock_name as string) || id,
    macd_status,
    foreign_buy: (fsLatest?.foreign_buy as number) ?? 0,
    trust_buy: (fsLatest?.trust_buy as number) ?? 0,
    dealer_buy: (fsLatest?.dealer_buy as number) ?? 0,
    foreign_hold_ratio: (fsLatest?.foreign_hold_ratio as number) ?? 0,
    foreign_remain_ratio: (fsLatest?.foreign_remain_ratio as number) ?? 0,
    foreign_limit_ratio: (fsLatest?.foreign_limit_ratio as number) ?? 0,
    day_trading_volume: (fsLatest?.day_trading_volume as number) ?? 0,
  }

  const strongHistory = await getStockStrongHistory(id, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const recentStrongDays = strongHistory.filter((item) => new Date(item.date) >= sevenDaysAgo).length

  return {
    stock_id: id,
    stock_name: latest.stock_name,
    latest,
    history,
    recentStrongDays,
  }
})
