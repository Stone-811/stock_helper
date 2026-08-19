import { NextResponse } from 'next/server'
import { getLatestDate, getStocksByDate, getPrevCloseMap } from '../../../lib/firebase-admin'

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
    const prevClose = latestDate ? await getPrevCloseMap(latestDate) : {}
    const idSet = new Set(ids)
    const quotes: Record<string, {
      stock_id: string; stock_name: string; open: number; close: number; volume: number; prev_close?: number
      macd_status?: string; foreign_streak?: number; trust_streak?: number; foreign_buy?: number
    }> = {}

    // daily_data 聚合本就含這些欄位，多帶出來供「自選訊號」用（不需額外查詢）
    for (const s of dayStocks as Array<Record<string, unknown>>) {
      const id = String(s.stock_id ?? '')
      if (idSet.has(id)) {
        quotes[id] = {
          stock_id: id,
          stock_name: String(s.stock_name ?? ''),
          open: Number(s.open ?? 0),
          close: Number(s.close ?? 0),
          volume: Number(s.volume ?? 0),
          prev_close: prevClose[id],
          macd_status: s.macd_status ? String(s.macd_status) : undefined,
          foreign_streak: Number(s.foreign_streak ?? 0),
          trust_streak: Number(s.trust_streak ?? 0),
          foreign_buy: Number(s.foreign_buy ?? 0),
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
