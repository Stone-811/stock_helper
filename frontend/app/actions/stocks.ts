'use server'

import { getLatestDate, getStocksByDate } from '../../lib/firebase-admin'

export interface StockSearchResult {
  stock_id: string
  stock_name: string
}

/**
 * 搜尋股票（Server Action）
 * 從 Firestore 取得當日股票，在伺服器端進行篩選
 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (!query || query.trim().length === 0) {
    return []
  }

  const q = query.trim().toLowerCase()

  try {
    // 取得最新日期
    const latestDate = await getLatestDate()
    if (!latestDate) return []

    // 取得當日所有股票
    const stocks = await getStocksByDate(latestDate)

    // 在伺服器端篩選
    const filtered = stocks
      .filter((s: { stock_id: string; stock_name: string }) =>
        s.stock_id.toLowerCase().includes(q) ||
        s.stock_name.toLowerCase().includes(q)
      )
      .slice(0, 20)
      .map((s: { stock_id: string; stock_name: string }) => ({
        stock_id: s.stock_id,
        stock_name: s.stock_name
      }))

    return filtered
  } catch (error) {
    console.error('Failed to search stocks:', error)
    return []
  }
}
