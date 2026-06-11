'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import StockChart from '../../../components/StockChart'
import StockSearch from '../../../components/StockSearch'
import { DailyStock } from '../../../lib/supabase'

interface StockData {
  stock_id: string
  stock_name: string
  latest: DailyStock
  history: DailyStock[]
  recentStrongDays: number
}

export default function StockDetail() {
  const params = useParams()
  const stockId = params.id as string

  const [data, setData] = useState<StockData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/stock/${stockId}`)
        if (!res.ok) {
          throw new Error('Stock not found')
        }
        const json = await res.json()
        setData(json)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch')
      } finally {
        setLoading(false)
      }
    }
    if (stockId) {
      fetchData()
    }
  }, [stockId])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-500">載入中...</div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="text-xl text-red-500">{error || '找不到股票資料'}</div>
        <Link href="/" className="text-blue-500 hover:underline">
          返回首頁
        </Link>
      </div>
    )
  }

  const { latest, history } = data
  const isPositive = latest.close >= latest.open
  const priceChange = latest.close - latest.open
  const priceChangePct = ((priceChange / latest.open) * 100).toFixed(2)

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-500 hover:text-gray-700">
                ← 返回
              </Link>
              <h1 className="text-xl font-bold text-gray-800">
                {data.stock_id} {data.stock_name}
              </h1>
            </div>
            <StockSearch />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 股票資訊卡片 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            {/* 價格 */}
            <div className="col-span-2">
              <div className="text-gray-900 text-base font-medium">收盤價</div>
              <div className={`text-3xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                ${latest.close.toFixed(2)}
              </div>
              <div className={`text-base ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
                {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePct}%)
              </div>
            </div>

            {/* MACD 狀態 */}
            <div>
              <div className="text-gray-900 text-base font-medium">MACD</div>
              <div className={`text-xl font-bold ${latest.macd_status === '多' ? 'text-red-600' : 'text-green-600'}`}>
                {latest.macd_status === '多' ? '多頭' : '空頭'}
              </div>
            </div>

            {/* 成交量 */}
            <div>
              <div className="text-gray-900 text-base font-medium">成交量</div>
              <div className="text-xl font-bold text-gray-900">{latest.volume.toLocaleString()}</div>
              <div className="text-sm text-gray-700">張</div>
            </div>

            {/* 強勢次數 */}
            <div>
              <div className="text-gray-900 text-base font-medium">近7日強勢</div>
              <div className="text-xl font-bold text-orange-500">{data.recentStrongDays}</div>
              <div className="text-sm text-gray-700">天</div>
            </div>

            {/* 資料日期 */}
            <div>
              <div className="text-gray-900 text-base font-medium">資料日期</div>
              <div className="text-lg font-medium text-gray-900">{latest.date}</div>
            </div>
          </div>

          {/* 三大法人 */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="text-gray-900 text-base font-medium mb-3">三大法人買賣超（張）</div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
              <div>
                <div className="text-gray-800 text-sm font-medium">外資</div>
                <div className={`text-lg font-bold ${latest.foreign_buy >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {latest.foreign_buy >= 0 ? '+' : ''}{latest.foreign_buy.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-gray-800 text-sm font-medium">投信</div>
                <div className={`text-lg font-bold ${latest.trust_buy >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {latest.trust_buy >= 0 ? '+' : ''}{latest.trust_buy.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-gray-800 text-sm font-medium">自營商</div>
                <div className={`text-lg font-bold ${latest.dealer_buy >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {latest.dealer_buy >= 0 ? '+' : ''}{latest.dealer_buy.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-gray-800 text-sm font-medium">外資持股比例</div>
                <div className="text-lg font-medium text-gray-900">{latest.foreign_hold_ratio.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-gray-800 text-sm font-medium">外資尚可投資</div>
                <div className="text-lg font-medium text-gray-900">{latest.foreign_remain_ratio.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-gray-800 text-sm font-medium">外資投資上限</div>
                <div className="text-lg font-medium text-gray-900">{latest.foreign_limit_ratio.toFixed(2)}%</div>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* 技術分析圖表 - 全幅 */}
      <div className="w-full px-2 mb-6">
        <StockChart data={history} height={600} />
      </div>
    </main>
  )
}
