import { NextResponse } from 'next/server'
import { getStockData } from '../../../../lib/stock-data'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const data = await getStockData(id)
    if (!data) {
      return NextResponse.json({ error: 'Stock not found' }, { status: 404 })
    }
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching stock data:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
