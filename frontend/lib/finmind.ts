/**
 * FinMind REST API（server-only）
 *
 * 取單一股票完整歷史 K 線，取代掃全市場的 getStockHistory。
 * 認證用 FINMIND_API_TOKEN（App Hosting secret）。
 *
 * FinMind 欄位對應：max→high、min→low、Trading_Volume(股)→volume(張，÷1000 向零取整）
 * ⚠️ 單位換算一律用 Math.trunc，比照收集器 (x/1000).astype(int)；用 Math.round 會與 Firestore 差 1 張
 */

import { Candle } from './indicators'

const FINMIND_API = 'https://api.finmindtrade.com/api/v4/data'

interface FinMindPriceRow {
  date: string
  stock_id: string
  Trading_Volume: number
  open: number
  max: number
  min: number
  close: number
}

/**
 * 取單一股票的歷史 K 線（日線）
 * @param stockId 股票代號，如 "2330"
 * @param startDate 起始日 YYYY-MM-DD
 */
export async function fetchStockKline(stockId: string, startDate: string): Promise<Candle[]> {
  const token = process.env.FINMIND_API_TOKEN || ''
  const params = new URLSearchParams({
    dataset: 'TaiwanStockPrice',
    data_id: stockId,
    start_date: startDate,
  })

  const res = await fetch(`${FINMIND_API}?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // Next.js data cache：5 分鐘內同一股票不重複打 FinMind，避免撞免費版限額
    next: { revalidate: 300 },
  })

  if (!res.ok) {
    throw new Error(`FinMind HTTP ${res.status}`)
  }

  const json = await res.json()
  if (json.status !== 200 || !Array.isArray(json.data)) {
    return []
  }

  return (json.data as FinMindPriceRow[])
    .map((d) => ({
      date: d.date,
      open: d.open,
      high: d.max,
      low: d.min,
      close: d.close,
      volume: Math.trunc(d.Trading_Volume / 1000), // 股 → 張（用 trunc 對齊收集器 (v/1000).astype(int)）
    }))
    .filter((c) => c.close > 0)
}

interface FinMindDayTradingRow {
  date: string
  stock_id: string
  Volume: number // 當沖成交量（股）
}

/**
 * 取單一股票的當沖量歷史（張）
 * FinMind dataset：TaiwanStockDayTrading（Volume 為股數，÷1000 轉張，向零取整同收集器）
 * @returns [{ date, day_trading_volume }]，失敗回空陣列
 */
export async function fetchStockDayTrading(
  stockId: string,
  startDate: string
): Promise<{ date: string; day_trading_volume: number }[]> {
  const token = process.env.FINMIND_API_TOKEN || ''
  const params = new URLSearchParams({
    dataset: 'TaiwanStockDayTrading',
    data_id: stockId,
    start_date: startDate,
  })

  const res = await fetch(`${FINMIND_API}?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    next: { revalidate: 300 },
  })

  if (!res.ok) return []

  const json = await res.json()
  if (json.status !== 200 || !Array.isArray(json.data)) return []

  return (json.data as FinMindDayTradingRow[]).map((d) => ({
    date: d.date,
    day_trading_volume: Math.trunc(d.Volume / 1000), // 股 → 張（用 trunc 對齊收集器）
  }))
}

interface FinMindInstitutionalRow {
  date: string
  stock_id: string
  buy: number // 股
  sell: number // 股
  name: string // Foreign_Investor / Investment_Trust / Dealer_self / Dealer_Hedging ...
}

export interface InstitutionalDay {
  date: string
  foreign: number // 外資買賣超（張）
  trust: number // 投信買賣超（張）
  dealer: number // 自營商買賣超（張，自行+避險）
}

/**
 * 取單一股票的三大法人買賣超歷史（張）
 *
 * FinMind dataset：TaiwanStockInstitutionalInvestorsBuySell（每日每法人一列 buy/sell）
 * 買賣超 =（buy − sell）÷1000，並比照收集器定義彙整：
 *   外資 = Foreign_Investor、投信 = Investment_Trust、自營 = Dealer_self + Dealer_Hedging
 * （見 stock_collector.py _process_institutional_data，確保與個股頁法人數字卡片一致）
 * @returns 依日期排序的每日彙整；失敗回空陣列
 */
export async function fetchInstitutionalHistory(
  stockId: string,
  startDate: string
): Promise<InstitutionalDay[]> {
  const token = process.env.FINMIND_API_TOKEN || ''
  const params = new URLSearchParams({
    dataset: 'TaiwanStockInstitutionalInvestorsBuySell',
    data_id: stockId,
    start_date: startDate,
  })

  const res = await fetch(`${FINMIND_API}?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    next: { revalidate: 300 },
  })

  if (!res.ok) return []

  const json = await res.json()
  if (json.status !== 200 || !Array.isArray(json.data)) return []

  // 先累加「股數」淨額，最後才 ÷1000 並向零取整（Math.trunc），
  // 比照收集器 (net/1000).astype(int)，使最新一天與個股頁三大法人數字卡片完全一致
  const byDate = new Map<string, { foreign: number; trust: number; dealer: number }>()
  for (const row of json.data as FinMindInstitutionalRow[]) {
    const net = row.buy - row.sell // 股
    const day = byDate.get(row.date) ?? { foreign: 0, trust: 0, dealer: 0 }
    if (row.name === 'Foreign_Investor') day.foreign += net
    else if (row.name === 'Investment_Trust') day.trust += net
    else if (row.name === 'Dealer_self' || row.name === 'Dealer_Hedging') day.dealer += net
    byDate.set(row.date, day)
  }

  return Array.from(byDate.entries())
    .map(([date, d]) => ({
      date,
      foreign: Math.trunc(d.foreign / 1000),
      trust: Math.trunc(d.trust / 1000),
      dealer: Math.trunc(d.dealer / 1000),
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

interface FinMindShareholdingRow {
  date: string
  stock_id: string
  ForeignInvestmentShares: number // 外資實際持股股數
  ForeignInvestmentSharesRatio: number // 外資持股比例（%）
}

export interface ForeignHoldingDay {
  date: string
  shares: number // 外資持股張數（真實持有量，非買賣超累加）
  ratio: number // 外資持股比例 %
}

/**
 * 取單一股票的「外資實際持股」歷史（張、比例）
 *
 * FinMind dataset：TaiwanStockShareholding（每日申報的絕對持股，非買賣超推估）。
 * 只有外資有逐檔官方持股；投信/自營無此資料。
 * shares = ForeignInvestmentShares ÷ 1000（股 → 張）。失敗回空陣列。
 */
export async function fetchForeignShareholding(
  stockId: string,
  startDate: string
): Promise<ForeignHoldingDay[]> {
  const token = process.env.FINMIND_API_TOKEN || ''
  const params = new URLSearchParams({
    dataset: 'TaiwanStockShareholding',
    data_id: stockId,
    start_date: startDate,
  })

  const res = await fetch(`${FINMIND_API}?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    next: { revalidate: 300 },
  })

  if (!res.ok) return []

  const json = await res.json()
  if (json.status !== 200 || !Array.isArray(json.data)) return []

  return (json.data as FinMindShareholdingRow[])
    .map((d) => ({
      date: d.date,
      shares: Math.trunc(d.ForeignInvestmentShares / 1000),
      ratio: d.ForeignInvestmentSharesRatio,
    }))
    .filter((d) => d.shares > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}
