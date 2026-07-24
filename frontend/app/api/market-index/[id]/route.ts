import { NextResponse } from 'next/server'
import { getMarketIndex } from '../../../../lib/firebase-admin'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 從 Firestore 取得指數歷史資料
    const indexData = await getMarketIndex(id)

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
    }, {
      headers: {
        // 快取 5 分鐘，背景更新可延長至 10 分鐘
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
      }
    })

  } catch (error) {
    console.error('Error fetching index data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
