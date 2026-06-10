import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '7')

  try {
    // 取得最新日期
    const { data: latestDate } = await supabase
      .from('strong_stock_matrix')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single()

    if (!latestDate) {
      return NextResponse.json({ stocks: [], latestDate: null })
    }

    // 取得今日強勢股
    const { data: strongStocks, error } = await supabase
      .from('strong_stock_matrix')
      .select('stock_id, stock_name')
      .eq('date', latestDate.date)
      .eq('is_strong', true)

    if (error) throw error

    // 取得這些股票的詳細資料
    const stockIds = strongStocks?.map(s => s.stock_id) || []

    const { data: stockDetails } = await supabase
      .from('daily_stocks')
      .select('*')
      .eq('date', latestDate.date)
      .in('stock_id', stockIds)

    // 計算近 N 日強勢次數
    const { data: strongCounts } = await supabase
      .from('strong_stock_matrix')
      .select('stock_id, is_strong, date')
      .in('stock_id', stockIds)
      .eq('is_strong', true)
      .gte('date', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0])

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
      latestDate: latestDate.date,
      totalCount: result.length
    })

  } catch (error) {
    console.error('Error fetching strong stocks:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
