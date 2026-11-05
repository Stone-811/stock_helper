import { NextResponse } from 'next/server'
import { getMarketSentiment } from '../../../lib/firebase-admin'
import type { SentimentResponse } from '../../../lib/sentiment'

/**
 * 市場溫度 API：/api/market-sentiment?days=N（預設 400 個日曆天，夠畫 1 年）
 *   或 ?last=N：每個系列只回最後 N 筆（首頁用：用日曆天切會在春節等 ≥10 天休市時切成空的，審查 F2）
 *
 * 四個系列各 1 次 Firestore 讀取（market_sentiment/{daytrade|margin|taivix|vix}）。
 * 資料每天在台灣 17:00／22:00 那兩班才會變，HTTP 快取 10 分鐘、背景更新 30 分鐘。
 * ⚠️ 任一系列沒有文件就回空陣列，不是 500：首頁那兩行要能各自顯示「暫無資料」，不能把整頁拖垮。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const raw = Number(searchParams.get('days') ?? 400)
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2000) : 400
  const lastRaw = Number(searchParams.get('last'))
  const last = Number.isFinite(lastRaw) && lastRaw > 0 ? Math.min(Math.floor(lastRaw), 100) : null
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  try {
    const [daytrade, margin, taivix, vix] = await Promise.all([
      getMarketSentiment('daytrade'),
      getMarketSentiment('margin'),
      getMarketSentiment('taivix'),
      getMarketSentiment('vix'),
    ])
    const trim = <T extends { date: string }>(rows: T[]) => (last ? rows.slice(-last) : rows.filter((r) => r.date >= cutoff))
    const lastDate = (rows: { date: string }[]) => (rows.length ? rows[rows.length - 1].date : null)
    const firstDate = (rows: { date: string }[]) => (rows.length ? rows[0].date : null)
    const body: SentimentResponse = {
      daytrade: trim(daytrade),
      margin: trim(margin),
      taivix: trim(taivix),
      vix: trim(vix),
      latest: { daytrade: lastDate(daytrade), margin: lastDate(margin), taivix: lastDate(taivix), vix: lastDate(vix) },
      // trim 前的第一筆：「本站自 X 起統計」要用這個，不是窗內第一筆（審查 F4）
      first: { daytrade: firstDate(daytrade), margin: firstDate(margin), taivix: firstDate(taivix), vix: firstDate(vix) },
      generatedAt: new Date().toISOString(),
    }
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' },
    })
  } catch (error) {
    console.error('Error fetching market sentiment:', error)
    return NextResponse.json({ error: 'Failed to fetch market sentiment' }, { status: 500 })
  }
}
