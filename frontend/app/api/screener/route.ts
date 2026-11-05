import { NextResponse } from 'next/server'
import { getStocksByDate } from '../../../lib/firebase-admin'
import { resolveTradingDay, withStrongCountAndPrevClose } from '../../../lib/strong-enrich'

/**
 * 自訂多條件選股：server 端讀當日全市場明細（getStocksByDate）後過濾，
 * 只把符合的股票回給前端（避免把 3000+ 檔完整明細全丟到瀏覽器再過濾）。
 *
 * Query 條件（皆選填，未帶則不套用該條件）：
 *   date              指定日期，預設權威 latest_date
 *   macd              '多' | '空'
 *   foreignStreakMin  外資連買 ≥ N 天（foreign_streak >= N）
 *   trustStreakMin    投信連買 ≥ N 天（trust_streak >= N）
 *   foreignBuy=1      外資買超 > 0
 *   volumeMin         成交量 ≥ N（張）
 *   industry          產業別
 *   sort              排序欄位：foreign_buy | trust_buy | volume | foreign_streak（預設 foreign_buy）
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const dateParam = searchParams.get('date')
  const macd = searchParams.get('macd') || ''
  const foreignStreakMin = parseInt(searchParams.get('foreignStreakMin') || '0', 10)
  const trustStreakMin = parseInt(searchParams.get('trustStreakMin') || '0', 10)
  const foreignBuy = searchParams.get('foreignBuy') === '1'
  const volumeMin = parseInt(searchParams.get('volumeMin') || '0', 10)
  const industry = searchParams.get('industry') || ''
  const sort = searchParams.get('sort') || 'foreign_buy'

  try {
    // 日期規則（指定日期 → 權威 latest_date → 清單第一天）與 /api/strong-stocks 共用，見 lib/strong-enrich.ts
    const day = await resolveTradingDay(dateParam)
    if (!day) {
      return NextResponse.json({ stocks: [], count: 0, totalCount: 0, latestDate: null, availableDates: [], industries: [] })
    }
    const { dates, targetDate } = day

    const all = await getStocksByDate(targetDate)
    const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

    const filtered = all.filter((s: Record<string, unknown>) => {
      if (macd && s.macd_status !== macd) return false
      if (foreignStreakMin > 0 && num(s.foreign_streak) < foreignStreakMin) return false
      if (trustStreakMin > 0 && num(s.trust_streak) < trustStreakMin) return false
      if (foreignBuy && num(s.foreign_buy) <= 0) return false
      if (volumeMin > 0 && num(s.volume) < volumeMin) return false
      if (industry && s.industry !== industry) return false
      return true
    })

    const sortKey = ['foreign_buy', 'trust_buy', 'volume', 'foreign_streak'].includes(sort) ? sort : 'foreign_buy'
    filtered.sort((a: Record<string, unknown>, b: Record<string, unknown>) => num(b[sortKey]) - num(a[sortKey]))

    // 只回排序後前 200 檔（選股通常看前段），並補近 7 日強勢次數（讓卡片「強勢 N 日」有意義）與前一交易日收盤。
    // 讀取失敗（null）時強勢天數是「—」，不是 0；0 檔時不讀任何資料（lib/strong-enrich.ts）
    const top = filtered.slice(0, 200)
    const stocks = await withStrongCountAndPrevClose(top, targetDate, 7)

    // 產業下拉選項：從當日全市場實際出現的產業抽出
    const industries = Array.from(
      new Set(all.map((s: Record<string, unknown>) => s.industry).filter((x): x is string => typeof x === 'string' && x.length > 0))
    ).sort()

    return NextResponse.json(
      {
        stocks,
        count: filtered.length,
        returned: stocks.length,
        totalCount: all.length,
        latestDate: targetDate,
        availableDates: dates,
        industries,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' } }
    )
  } catch (error) {
    console.error('Screener error:', error)
    return NextResponse.json({ error: 'Failed to screen stocks' }, { status: 500 })
  }
}
