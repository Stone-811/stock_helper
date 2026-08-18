'use client'

import { useEffect, useState, useCallback } from 'react'
import IndexChart from '../components/IndexChart'
import { MarketIndex } from '../lib/firebase'
import { PageHeader, ChartSkeleton, ErrorState } from '../components/states'

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
    <div className="bg-white rounded-lg shadow-sm p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-gray-800">{data.index_name}</h2>
          <p className="text-sm text-gray-800">資料日期：{data.latest.date}</p>
        </div>
        <div className="text-right">
          <div className={`text-2xl md:text-3xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
            {data.latest.close.toLocaleString()}
          </div>
          <div className={`text-base md:text-lg ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
            {isPositive ? '+' : ''}{data.change.toFixed(2)} ({isPositive ? '+' : ''}{data.changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>

      <div className={`grid ${showOpenInterest ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'} gap-x-4 gap-y-2 md:gap-4 mt-3 md:mt-4 pt-3 md:pt-4 border-t border-gray-100`}>
        <div>
          <span className="text-sm text-gray-800">開盤</span>
          <div className="font-medium text-gray-900">{data.latest.open.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-sm text-gray-800">最高</span>
          <div className="font-medium text-red-600">{data.latest.high.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-sm text-gray-800">最低</span>
          <div className="font-medium text-green-600">{data.latest.low.toLocaleString()}</div>
        </div>
        <div>
          <span className="text-sm text-gray-800">成交量</span>
          <div className="font-medium text-gray-900">{data.latest.volume.toLocaleString()}</div>
        </div>
        {showOpenInterest && (
          <div>
            <span className="text-sm text-gray-800">未平倉量</span>
            <div className="font-medium text-gray-900">{(data.latest.open_interest || 0).toLocaleString()}</div>
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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 同時取得加權指數和台指期資料
      const [taiexRes, txRes] = await Promise.all([
        fetch('/api/market-index/TAIEX'),
        fetch('/api/market-index/TX'),
      ])
      if (taiexRes.ok) setTaiexData(await taiexRes.json())
      if (txRes.ok) setTxData(await txRes.json())
      if (!taiexRes.ok && !txRes.ok) throw new Error('無法取得指數資料')
    } catch (err) {
      console.error('Failed to fetch:', err)
      setError('尚無指數資料，請先執行資料收集')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="台股指數分析" />
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-40 bg-white rounded-lg shadow-sm animate-pulse" />
            <div className="h-40 bg-white rounded-lg shadow-sm animate-pulse" />
          </div>
          <ChartSkeleton height={600} />
        </div>
      </div>
    )
  }

  if (error || (!taiexData && !txData)) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="台股指數分析" />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <ErrorState message={error || '指數資料正在準備，請稍候片刻後重新載入。'} onRetry={load} />
        </div>
      </div>
    )
  }

  const activeData = activeTab === 'TAIEX' ? taiexData : txData

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="台股指數分析" />

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
            <IndexChart data={activeData.history} indexId={activeData.index_id} height={600} />
          </div>
        )}
      </div>
    </div>
  )
}
