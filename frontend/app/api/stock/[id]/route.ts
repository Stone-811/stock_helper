import { NextResponse } from 'next/server'
import { getLatestDate, getStocksByDate, getStockStrongHistory } from '../../../../lib/firebase-admin'
import { fetchStockKline } from '../../../../lib/finmind'
import { calculateMACDValues } from '../../../../lib/indicators'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // K 線歷史改用 FinMind（單一股票查詢，完整且快，取代掃全市場的 getStockHistory）
    // 取約 2.5 年，足夠 2Y 圖 + 指標暖身
    const start = new Date(Date.now() - 900 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const history = await fetchStockKline(id, start)

    if (!history.length) {
      return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    }

    // 最新法人資訊：從 Firestore 當日資料取（1 天，快），不再掃全歷史
    const latestDate = await getLatestDate()
    const dayStocks = latestDate ? await getStocksByDate(latestDate) : []
    const fsLatest = dayStocks.find((s: { stock_id: string }) => s.stock_id === id) as
      | Record<string, unknown>
      | undefined

    // MACD 狀態：用 FinMind K 線自算（解決生產環境 macd_status 空白）
    const macdVals = calculateMACDValues(history)
    const lastMacd = macdVals[macdVals.length - 1]
    const macd_status = lastMacd ? (lastMacd.histogram >= 0 ? '多' : '空') : ''

    const klineLast = history[history.length - 1]
    const latest = {
      ...klineLast,
      stock_name: (fsLatest?.stock_name as string) || id,
      macd_status,
      foreign_buy: (fsLatest?.foreign_buy as number) ?? 0,
      trust_buy: (fsLatest?.trust_buy as number) ?? 0,
      dealer_buy: (fsLatest?.dealer_buy as number) ?? 0,
      foreign_hold_ratio: (fsLatest?.foreign_hold_ratio as number) ?? 0,
      foreign_remain_ratio: (fsLatest?.foreign_remain_ratio as number) ?? 0,
      foreign_limit_ratio: (fsLatest?.foreign_limit_ratio as number) ?? 0,
      day_trading_volume: (fsLatest?.day_trading_volume as number) ?? 0,
    }

    // 近 7 日強勢次數（只掃近 10 個交易日）
    const strongHistory = await getStockStrongHistory(id, 10)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentStrongDays = strongHistory.filter(
      (item) => new Date(item.date) >= sevenDaysAgo
    ).length

    return NextResponse.json({
      stock_id: id,
      stock_name: latest.stock_name,
      latest,
      history,
      recentStrongDays,
    })
  } catch (error) {
    console.error('Error fetching stock data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
