import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '365')

  try {
    // 計算日期範圍
    const endDate = new Date()
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    // 取得股票歷史資料
    const { data: stockData, error } = await supabase
      .from('daily_stocks')
      .select('*')
      .eq('stock_id', id)
      .gte('date', startDate.toISOString().split('T')[0])
      .lte('date', endDate.toISOString().split('T')[0])
      .order('date', { ascending: true })

    if (error) throw error

    if (!stockData || stockData.length === 0) {
      return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    }

    // 取得強勢股歷史
    const { data: strongHistory } = await supabase
      .from('strong_stock_matrix')
      .select('date, is_strong')
      .eq('stock_id', id)
      .gte('date', startDate.toISOString().split('T')[0])
      .order('date', { ascending: true })

    // 計算近 7 日強勢次數
    const recentStrongDays = strongHistory?.filter(item => {
      const itemDate = new Date(item.date)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      return itemDate >= sevenDaysAgo && item.is_strong
    }).length || 0

    const latestData = stockData[stockData.length - 1]

    return NextResponse.json({
      stock_id: id,
      stock_name: latestData.stock_name,
      latest: latestData,
      history: stockData,
      strongHistory: strongHistory || [],
      recentStrongDays
    })

  } catch (error) {
    console.error('Error fetching stock data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
