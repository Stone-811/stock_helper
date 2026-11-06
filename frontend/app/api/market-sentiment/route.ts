import { NextResponse } from 'next/server'
import { getMarketSentiment } from '../../../lib/firebase-admin'
import type { SentimentResponse } from '../../../lib/sentiment'

/**
 * 市場溫度 API：/api/market-sentiment?days=N（預設 400 個日曆天，夠畫 1 年）
 *   首頁送 ?days=400（市場溫度頁 2026-11-06 拿掉後只剩首頁在用）；400 個日曆天不會被春節等長假切成空的。
 *
 * 四個系列各 1 次 Firestore 讀取（market_sentiment/{daytrade|margin|taivix|vix}）。
 * 資料每天在台灣 17:00／22:00 那兩班才會變，HTTP 快取 10 分鐘、背景更新 30 分鐘。
 * ⚠️ 任一系列沒有文件就回空陣列，不是 500：每張卡要能各自顯示「暫無資料」，不能把整頁拖垮。
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const raw = Number(searchParams.get('days') ?? 400)
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 2000) : 400
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

  try {
    const [daytrade, margin, taivix, vix] = await Promise.all([
      getMarketSentiment('daytrade'),
      getMarketSentiment('margin'),
      getMarketSentiment('taivix'),
      getMarketSentiment('vix'),
    ])
    const trim = <T extends { date: string }>(rows: T[]) => rows.filter((r) => r.date >= cutoff)
    const body: SentimentResponse = {
      daytrade: trim(daytrade),
      margin: trim(margin),
      taivix: trim(taivix),
      vix: trim(vix),
      // trim 前的第一筆：「本站自 X 起統計」要用這個，不是窗內第一筆（審查 F4）。
      // 只有臺指VIX 需要（免費歷史只從 2026-03-02 起，不到一年）；其他三組畫面不讀，不送。
      first: { taivix: taivix.length ? taivix[0].date : null },
    }
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1800' },
    })
  } catch (error) {
    console.error('Error fetching market sentiment:', error)
    return NextResponse.json({ error: 'Failed to fetch market sentiment' }, { status: 500 })
  }
}
