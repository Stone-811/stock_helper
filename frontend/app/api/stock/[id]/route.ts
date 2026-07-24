import { NextResponse } from 'next/server'
import { getStockHistory, getStockStrongHistory } from '../../../../lib/firebase-admin'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 從 Firestore 取得股票歷史資料（支援新舊架構）
    const stockData = await getStockHistory(id)

    if (!stockData || stockData.length === 0) {
      return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    }

    // 使用優化函數取得強勢股歷史
    const strongHistory = await getStockStrongHistory(id)

    // 計算近 7 日強勢次數
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentStrongDays = strongHistory.filter(item => {
      const itemDate = new Date(item.date)
      return itemDate >= sevenDaysAgo
    }).length

    const latestData = stockData[stockData.length - 1]

    return NextResponse.json({
      stock_id: id,
      stock_name: latestData.stock_name,
      latest: latestData,
      history: stockData,
      strongHistory,
      recentStrongDays
    })

  } catch (error) {
    console.error('Error fetching stock data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
