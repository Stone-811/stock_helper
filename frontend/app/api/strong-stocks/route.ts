import { NextResponse } from 'next/server'
import { getStrongStocksByDate, getStocksByDate } from '../../../lib/firebase-admin'
import { resolveTradingDay, withStrongCountAndPrevClose } from '../../../lib/strong-enrich'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  // ?days=abc 會讓 parseInt 回 NaN → getAvailableDates(NaN) 切出空陣列 → 強勢天數全變成假的 0。擋掉、退回 7。
  const daysRaw = parseInt(searchParams.get('days') || '7')
  const days = Number.isFinite(daysRaw) ? daysRaw : 7
  const selectedDate = searchParams.get('date')

  try {
    // 使用指定日期，否則以權威 latest_date 為預設（規則在 lib/strong-enrich.ts，與 /api/screener 共用），
    // 避免各頁「最新日」不一致
    const day = await resolveTradingDay(selectedDate)

    if (!day) {
      return NextResponse.json({ stocks: [], latestDate: null, availableDates: [] })
    }
    const { dates: uniqueDates, targetDate } = day

    // 從聚合集合取得該日強勢股
    const strongStocks = await getStrongStocksByDate(targetDate)

    const stockIds = strongStocks.map((s: { stock_id: string }) => s.stock_id)

    if (stockIds.length === 0) {
      return NextResponse.json({
        stocks: [],
        latestDate: targetDate,
        availableDates: uniqueDates,
        totalCount: 0
      })
    }

    // 使用優化函數取得該日所有股票詳細資料
    const allStocksOnDate = await getStocksByDate(targetDate)

    // 過濾出強勢股的詳細資料
    const stockDetailsMap = new Map<string, Record<string, unknown>>(
      allStocksOnDate.map((s: { stock_id: string }) => [s.stock_id, s])
    )
    const stockDetails = stockIds
      .map((id: string) => stockDetailsMap.get(id))
      .filter((s): s is Record<string, unknown> => s !== undefined)

    // 補近 N 日強勢次數（讀取失敗是 null，畫面「—」，不是 0）與前一交易日收盤（台股漲跌幅基準）
    const result = await withStrongCountAndPrevClose(stockDetails, targetDate, days)

    // 按強勢次數排序
    result.sort((a: { strong_count: number | null }, b: { strong_count: number | null }) => (b.strong_count ?? -1) - (a.strong_count ?? -1))

    return NextResponse.json({
      stocks: result,
      latestDate: targetDate,
      availableDates: uniqueDates,
      totalCount: result.length,
      // B3: 有強勢股清單但當日明細（daily_data）缺失時標記，讓前端區分「無資料」與「無強勢股」
      dataMissing: result.length === 0 && strongStocks.length > 0
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300'
      }
    })

  } catch (error) {
    console.error('Error fetching strong stocks:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
