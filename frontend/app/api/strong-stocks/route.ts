import { NextResponse } from 'next/server'
import {
  getAvailableDates,
  getStrongStocksByDate,
  getStocksByDate,
  getStrongCountForStocks
} from '../../../lib/firebase-admin'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '7')
  const selectedDate = searchParams.get('date')

  try {
    // 從 Firestore 取得可用日期列表
    const uniqueDates = await getAvailableDates(20)

    if (uniqueDates.length === 0) {
      return NextResponse.json({ stocks: [], latestDate: null, availableDates: [] })
    }

    // 使用指定日期或最新日期
    const targetDate = selectedDate && uniqueDates.includes(selectedDate)
      ? selectedDate
      : uniqueDates[0]

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

    // 使用優化函數計算近 N 日強勢次數
    const countMap = await getStrongCountForStocks(stockIds, days)

    // 合併資料
    const result = stockDetails.map((stock) => ({
      ...stock,
      strong_count: countMap[stock.stock_id as string] || 0
    }))

    // 按強勢次數排序
    result.sort((a: { strong_count: number }, b: { strong_count: number }) => b.strong_count - a.strong_count)

    return NextResponse.json({
      stocks: result,
      latestDate: targetDate,
      availableDates: uniqueDates,
      totalCount: result.length
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
