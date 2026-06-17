'use client'

import { useEffect, useState } from 'react'
import IndexChart from '../components/IndexChart'
import { MarketIndex } from '../lib/supabase'

interface IndexResponse {
  index_id: string
  index_name: string
  latest: MarketIndex
  history: MarketIndex[]
  change: number
  changePercent: number
}

export default function Home() {
  const [txData, setTxData] = useState<IndexResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/market-index/TX')
        if (!res.ok) {
          throw new Error('無法取得指數資料')
        }
        const json = await res.json()
        setTxData(json)
      } catch (err) {
        console.error('Failed to fetch:', err)
        setError('尚無指數資料，請先執行資料收集')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-500">載入中...</div>
      </div>
    )
  }

  if (error || !txData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-xl font-bold text-gray-800 pl-12 md:pl-0">台股指數分析</h1>
          </div>
        </header>
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <div className="text-gray-500 mb-4">{error || '尚無指數資料'}</div>
            <div className="text-sm text-gray-400">
              <p>請執行以下指令收集台指期資料：</p>
              <code className="block mt-2 p-2 bg-gray-100 rounded">
                python3 -m stock_collector.index_collector --days 365
              </code>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const isPositive = txData.change >= 0

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-800 pl-12 md:pl-0">台股指數分析</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 指數資訊卡片 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">
                {txData.index_name}
              </h2>
              <p className="text-sm text-gray-500">
                資料日期：{txData.latest.date}
              </p>
            </div>
            <div className="text-right">
              <div className={`text-3xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                {txData.latest.close.toLocaleString()}
              </div>
              <div className={`text-lg ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
                {isPositive ? '+' : ''}{txData.change.toFixed(2)} ({isPositive ? '+' : ''}{txData.changePercent.toFixed(2)}%)
              </div>
            </div>
          </div>

          {/* 詳細資訊 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div>
              <span className="text-sm text-gray-500">開盤</span>
              <div className="font-medium">{txData.latest.open.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-sm text-gray-500">最高</span>
              <div className="font-medium text-red-600">{txData.latest.high.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-sm text-gray-500">最低</span>
              <div className="font-medium text-green-600">{txData.latest.low.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-sm text-gray-500">成交量</span>
              <div className="font-medium">{txData.latest.volume.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-sm text-gray-500">未平倉量</span>
              <div className="font-medium">{(txData.latest.open_interest || 0).toLocaleString()}</div>
            </div>
          </div>
        </div>

        {/* 圖表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <IndexChart data={txData.history} height={600} />
        </div>
      </div>
    </div>
  )
}
