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

// 指數資訊卡片元件
function IndexCard({ data, showOpenInterest = false }: { data: IndexResponse; showOpenInterest?: boolean }) {
  const isPositive = data.change >= 0

  return (
    <div className="bg-white rounded-lg shadow-sm p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{data.index_name}</h2>
          <p className="text-sm text-gray-500">資料日期：{data.latest.date}</p>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
            {data.latest.close.toLocaleString()}
          </div>
          <div className={`text-lg ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
            {isPositive ? '+' : ''}{data.change.toFixed(2)} ({isPositive ? '+' : ''}{data.changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div className={`grid ${showOpenInterest ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'} gap-4 mt-4 pt-4 border-t border-gray-100`}>
        <div>
          <span className="text-sm text-gray-500">開盤</span>
          <div className="font-medium">{data.latest.open.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-sm text-gray-500">最高</span>
          <div className="font-medium text-red-600">{data.latest.high.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-sm text-gray-500">最低</span>
          <div className="font-medium text-green-600">{data.latest.low.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-sm text-gray-500">成交量</span>
          <div className="font-medium">{data.latest.volume.toLocaleString()}</div>
        </div>
        {showOpenInterest && (
          <div>
            <span className="text-sm text-gray-500">未平倉量</span>
            <div className="font-medium">{(data.latest.open_interest || 0).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function Home() {
  const [taiexData, setTaiexData] = useState<IndexResponse | null>(null)
  const [txData, setTxData] = useState<IndexResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'TAIEX' | 'TX'>('TAIEX')

  useEffect(() => {
    async function fetchData() {
      try {
        // 同時取得加權指數和台指期資料
        const [taiexRes, txRes] = await Promise.all([
          fetch('/api/market-index/TAIEX'),
          fetch('/api/market-index/TX')
        ])

        if (taiexRes.ok) {
          const taiexJson = await taiexRes.json()
          setTaiexData(taiexJson)
        }

        if (txRes.ok) {
          const txJson = await txRes.json()
          setTxData(txJson)
        }

        if (!taiexRes.ok && !txRes.ok) {
          throw new Error('無法取得指數資料')
        }
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

  if (error || (!taiexData && !txData)) {
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
              <p>請執行以下指令收集指數資料：</p>
              <code className="block mt-2 p-2 bg-gray-100 rounded">
                python3 -m stock_collector.index_collector --days 365
              </code>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const activeData = activeTab === 'TAIEX' ? taiexData : txData

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-800 pl-12 md:pl-0">台股指數分析</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 指數資訊卡片區 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {taiexData && <IndexCard data={taiexData} />}
          {txData && <IndexCard data={txData} showOpenInterest />}
        </div>

        {/* 圖表切換標籤 */}
        <div className="flex gap-2 mb-4">
          {taiexData && (
            <button
              onClick={() => setActiveTab('TAIEX')}
              className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                activeTab === 'TAIEX'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
              }`}
            >
              加權指數
            </button>
          )}
          {txData && (
            <button
              onClick={() => setActiveTab('TX')}
              className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                activeTab === 'TX'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'
              }`}
            >
              台指期
            </button>
          )}
        </div>

        {/* 圖表 */}
        {activeData && (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <IndexChart data={activeData.history} height={600} />
          </div>
        )}
      </div>
    </div>
  )
}
