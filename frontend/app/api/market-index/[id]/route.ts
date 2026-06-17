import { NextResponse } from 'next/server'
import { supabase } from '../../../../lib/supabase'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 取得指數歷史資料
    const { data: indexData, error } = await supabase
      .from('market_index_daily')
      .select('*')
      .eq('index_id', id)
      .order('date', { ascending: true })

    if (error) throw error

    if (!indexData || indexData.length === 0) {
      return NextResponse.json({ error: 'Index not found' }, { status: 404 })
    }

    const latestData = indexData[indexData.length - 1]

    // 計算漲跌幅
    let change = 0
    let changePercent = 0
    if (indexData.length > 1) {
      const prevClose = indexData[indexData.length - 2].close
      change = latestData.close - prevClose
      changePercent = (change / prevClose) * 100
    }

    return NextResponse.json({
      index_id: id,
      index_name: latestData.index_name,
      latest: latestData,
      history: indexData,
      change,
      changePercent
    })

  } catch (error) {
    console.error('Error fetching index data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
