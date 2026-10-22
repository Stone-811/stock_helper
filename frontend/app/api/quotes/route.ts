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
          // ⚠️ 缺值保留「沒有」，不可 ?? 0：連買天數 0 是「今天沒連買」的有效值，
          //    自選股的「今日訊號」要靠這個分辨「確定沒有訊號」與「資料不足、無法判斷」。
          foreign_streak: s.foreign_streak == null ? undefined : Number(s.foreign_streak),
          trust_streak: s.trust_streak == null ? undefined : Number(s.trust_streak),
          foreign_buy: s.foreign_buy == null ? undefined : Number(s.foreign_buy),
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
