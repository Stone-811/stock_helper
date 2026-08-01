import { NextResponse } from 'next/server'
import { getLatestDate, getStocksByDate } from '../../../lib/firebase-admin'

/**
 * 批次報價：一次讀當日 Firestore 聚合，回多股最新報價。
 * 取代自選股頁逐股呼叫 /api/stock/[id]（N+1）。
 * GET /api/quotes?ids=2330,2317,2454
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ids = (searchParams.get('ids') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!ids.length) {
    return NextResponse.json({ quotes: {} })
  }

  try {
    const latestDate = await getLatestDate()
    const dayStocks = latestDate ? await getStocksByDate(latestDate) : []
    const idSet = new Set(ids)
    const quotes: Record<string, { stock_id: string; stock_name: string; open: number; close: number; volume: number }> = {}

    for (const s of dayStocks as Array<{ stock_id: string; stock_name: string; open: number; close: number; volume: number }>) {
      if (idSet.has(s.stock_id)) {
        quotes[s.stock_id] = {
          stock_id: s.stock_id,
          stock_name: s.stock_name,
          open: s.open,
          close: s.close,
          volume: s.volume,
        }
      }
    }

    return NextResponse.json(
      { quotes, date: latestDate },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    )
  } catch (error) {
    console.error('Error fetching quotes:', error)
    return NextResponse.json({ quotes: {} }, { status: 500 })
  }
}
