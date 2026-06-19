'use server'

import { supabase } from '../../lib/supabase'

export interface StockSearchResult {
  stock_id: string
  stock_name: string
}

/**
 * 搜尋股票（Server Action）
 * 使用 PostgreSQL 的 ILIKE 進行模糊搜尋，比載入全部股票再在前端篩選更高效
 */
export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  if (!query || query.trim().length === 0) {
    return []
  }

  const q = query.trim()

  try {
    // 取得最新日期
    const { data: latestDate } = await supabase
      .from('daily_stocks')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single()

    if (!latestDate) {
      return []
    }

    // 使用 PostgreSQL 的 OR 搜尋
    const { data, error } = await supabase
      .from('daily_stocks')
      .select('stock_id, stock_name')
      .eq('date', latestDate.date)
      .or(`stock_id.ilike.%${q}%,stock_name.ilike.%${q}%`)
      .order('stock_id', { ascending: true })
      .limit(20)

    if (error) {
      console.error('Search error:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Failed to search stocks:', error)
    return []
  }
}

/**
 * 取得熱門股票（用於預設顯示）
 */
export async function getPopularStocks(): Promise<StockSearchResult[]> {
  try {
    // 取得最新日期的成交量前 10 名
    const { data: latestDate } = await supabase
      .from('daily_stocks')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single()

    if (!latestDate) {
      return []
    }

    const { data, error } = await supabase
      .from('daily_stocks')
      .select('stock_id, stock_name')
      .eq('date', latestDate.date)
      .order('volume', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Popular stocks error:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Failed to get popular stocks:', error)
    return []
  }
}

/**
 * 取得所有股票清單（快取版本）
 * 使用 React 的 cache 機制，避免重複查詢
 */
export async function getAllStocks(): Promise<StockSearchResult[]> {
  try {
    // 取得最新日期
    const { data: latestDate } = await supabase
      .from('daily_stocks')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single()

    if (!latestDate) {
      return []
    }

    // 分批取得所有股票
    const allStocks: StockSearchResult[] = []
    let from = 0
    const batchSize = 1000

    while (true) {
      const { data, error } = await supabase
        .from('daily_stocks')
        .select('stock_id, stock_name')
        .eq('date', latestDate.date)
        .order('stock_id', { ascending: true })
        .range(from, from + batchSize - 1)

      if (error) throw error
      if (!data || data.length === 0) break

      allStocks.push(...data)

      if (data.length < batchSize) break
      from += batchSize
    }

    return allStocks
  } catch (error) {
    console.error('Failed to get all stocks:', error)
    return []
  }
}
