import { NextResponse } from 'next/server'
import { getMarketIndex } from '../../../../lib/firebase-admin'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  // ?last=N：history 只回最後 N 筆（首頁美股三格只要最新與前一筆）；漲跌仍用完整資料的最後兩筆算
  const lastRaw = Number(new URL(request.url).searchParams.get('last'))
  const last = Number.isFinite(lastRaw) && lastRaw > 0 ? Math.min(Math.floor(lastRaw), 5000) : null

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

    // market_index history 項目未帶 index_name → 用代號補中文名，避免前端卡片顯示空白
    const indexNameMap: Record<string, string> = { TAIEX: '加權指數', TX: '台指期', SOX: '費城半導體', SPX: 'S&P 500', DJI: '道瓊工業' }

    return NextResponse.json({
      index_id: id,
      index_name: latestData.index_name || indexNameMap[id] || id,
      latest: latestData,
      history: last ? indexData.slice(-last) : indexData,
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
