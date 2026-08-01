import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getStockData } from '../../../lib/stock-data'
import StockDetailClient from './StockDetailClient'

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params
  const data = await getStockData(id)
  if (!data) {
    return { title: '找不到股票 | 選股小幫手' }
  }
  const l = data.latest
  const trend = l.macd_status === '多' ? '多頭' : '空頭'
  return {
    title: `${id} ${data.stock_name} 技術分析 K線圖 | 選股小幫手`,
    description: `${data.stock_name}(${id}) 最新收盤 ${l.close}，MACD ${trend}，外資 ${l.foreign_buy >= 0 ? '+' : ''}${l.foreign_buy} 張；提供 K 線、均線、布林通道、MACD/KD/RSI 技術分析。`,
    alternates: { canonical: `/stock/${id}` },
    openGraph: {
      title: `${id} ${data.stock_name} 技術分析`,
      description: `最新收盤 ${l.close}，MACD ${trend}`,
      type: 'website',
    },
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getStockData(id)
  if (!data) notFound()
  return <StockDetailClient data={data} />
}
