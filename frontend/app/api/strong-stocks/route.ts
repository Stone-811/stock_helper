import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '7')
  const selectedDate = searchParams.get('date')

  try {
    // 新架構：strong_stock_matrix 只存強勢股，所以不需要 is_strong 條件
    // 使用 DISTINCT 在資料庫端取得不重複日期（更高效）
    const { data: dateData } = await supabase
      .from('strong_stock_matrix')
      .select('date')
      .order('date', { ascending: false })
      .limit(5000)  // 取最近的記錄

    // 在 JS 端去重（Supabase 不支援 DISTINCT）
    const uniqueDates = [...new Set(dateData?.map(d => d.date) || [])]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 60)

    if (uniqueDates.length === 0) {
      return NextResponse.json({ stocks: [], latestDate: null, availableDates: [] })
    }

    // 使用指定日期或最新日期
    const targetDate = selectedDate && uniqueDates.includes(selectedDate)
      ? selectedDate
      : uniqueDates[0]

    // 取得該日強勢股（新架構：存在即強勢，不需要 is_strong 條件）
    const { data: strongStocks, error } = await supabase
      .from('strong_stock_matrix')
      .select('stock_id, stock_name')
      .eq('date', targetDate)

    if (error) throw error

    // 取得這些股票的詳細資料
    const stockIds = strongStocks?.map(s => s.stock_id) || []

    if (stockIds.length === 0) {
      return NextResponse.json({
        stocks: [],
        latestDate: targetDate,
        availableDates: uniqueDates,
        totalCount: 0
      })
    }

    const { data: stockDetails } = await supabase
      .from('daily_stocks')
      .select('*')
      .eq('date', targetDate)
      .in('stock_id', stockIds)

    // 計算近 N 日強勢次數（新架構：存在即強勢）
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const { data: strongCounts } = await supabase
      .from('strong_stock_matrix')
      .select('stock_id, date')
      .in('stock_id', stockIds)
      .gte('date', startDate)

    // 統計每檔股票的強勢次數
    const countMap: Record<string, number> = {}
    strongCounts?.forEach(item => {
      countMap[item.stock_id] = (countMap[item.stock_id] || 0) + 1
    })

    // 合併資料
    const result = stockDetails?.map(stock => ({
      ...stock,
      strong_count: countMap[stock.stock_id] || 0
    })) || []

    // 按強勢次數排序
    result.sort((a, b) => b.strong_count - a.strong_count)

    return NextResponse.json({
      stocks: result,
      latestDate: targetDate,
      availableDates: uniqueDates,
      totalCount: result.length
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300'
      }
    })

  } catch (error) {
    console.error('Error fetching strong stocks:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
