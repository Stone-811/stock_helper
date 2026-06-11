import { NextResponse } from 'next/server'
import { supabase } from '../../../lib/supabase'

export async function GET() {
  try {
    // 取得最新日期
    const { data: latestDate } = await supabase
      .from('daily_stocks')
      .select('date')
      .order('date', { ascending: false })
      .limit(1)
      .single()

    if (!latestDate) {
      return NextResponse.json({ stocks: [], count: 0 })
    }

    // 分批取得所有股票（每批 1000 筆）
    const allStocks: { stock_id: string; stock_name: string }[] = []
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

    return NextResponse.json({
      stocks: allStocks,
      count: allStocks.length
    })

  } catch (error) {
    console.error('Error fetching stocks:', error)
    return NextResponse.json({ error: 'Failed to fetch stocks' }, { status: 500 })
  }
}
