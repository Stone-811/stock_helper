import { NextResponse } from 'next/server'
import { getLatestDate, getStocksByDate } from '../../../lib/firebase-admin'

export async function GET() {
  try {
    // 從 Firestore 取得最新日期
    const latestDate = await getLatestDate()

    if (!latestDate) {
      return NextResponse.json({ stocks: [], count: 0 })
    }

    // 從聚合集合取得所有股票
    const stocks = await getStocksByDate(latestDate)

    return NextResponse.json({
      stocks: stocks.map(s => ({
        stock_id: s.stock_id,
        stock_name: s.stock_name
      })),
      count: stocks.length
    }, {
      headers: {
        // 快取 5 分鐘，背景更新可延長至 10 分鐘
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    })

  } catch (error) {
    console.error('Error fetching stocks:', error)
    return NextResponse.json({ error: 'Failed to fetch stocks' }, { status: 500 })
  }
}
