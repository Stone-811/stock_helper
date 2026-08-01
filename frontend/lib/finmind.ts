/**
 * FinMind REST API（server-only）
 *
 * 取單一股票完整歷史 K 線，取代掃全市場的 getStockHistory。
 * 認證用 FINMIND_API_TOKEN（App Hosting secret）。
 *
 * FinMind 欄位對應：max→high、min→low、Trading_Volume(股)→volume(張，÷1000)
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
      volume: Math.round(d.Trading_Volume / 1000), // 股 → 張
    }))
    .filter((c) => c.close > 0)
}
