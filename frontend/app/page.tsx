'use client'

import { useEffect, useState } from 'react'
import StockCard from '../components/StockCard'
import StockSearch from '../components/StockSearch'
import { TodayStrongStock } from '../lib/supabase'

interface StrongStocksResponse {
  stocks: TodayStrongStock[]
  latestDate: string
  totalCount: number
}

export default function Home() {
  const [data, setData] = useState<StrongStocksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({
    macd: 'all',
    minVolume: 0,
  })

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/strong-stocks?days=7')
        const json = await res.json()
        setData(json)
      } catch (error) {
        console.error('Failed to fetch:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // 篩選股票
  const filteredStocks = data?.stocks.filter(stock => {
    if (filter.macd !== 'all' && stock.macd_status !== filter.macd) return false
    if (filter.minVolume > 0 && stock.volume < filter.minVolume) return false
    return true
  }) || []

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-500">載入中...</div>
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <h1 className="text-xl font-bold text-gray-800">台灣強勢股分析系統</h1>
            <StockSearch />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 統計資訊 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            <div>
              <span className="text-gray-500">資料日期：</span>
              <span className="font-medium">{data?.latestDate || '-'}</span>
            </div>
            <div>
              <span className="text-gray-500">今日強勢股：</span>
              <span className="font-bold text-orange-500">{data?.totalCount || 0}</span>
              <span className="text-gray-500"> 檔</span>
            </div>
          </div>
        </div>

        {/* 篩選條件 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center">
            <div>
              <label className="text-sm text-gray-500 mr-2">MACD</label>
              <select
                value={filter.macd}
                onChange={(e) => setFilter({ ...filter, macd: e.target.value })}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="all">全部</option>
                <option value="多">多頭</option>
                <option value="空">空頭</option>
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-500 mr-2">成交量</label>
              <select
                value={filter.minVolume}
                onChange={(e) => setFilter({ ...filter, minVolume: parseInt(e.target.value) })}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="0">不限</option>
                <option value="1000">1000張以上</option>
                <option value="5000">5000張以上</option>
                <option value="10000">10000張以上</option>
              </select>
            </div>
            <div className="text-sm text-gray-500">
              篩選結果：<span className="font-medium">{filteredStocks.length}</span> 檔
            </div>
          </div>
        </div>

        {/* 股票列表 */}
        {filteredStocks.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
            沒有符合條件的股票
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredStocks.map((stock) => (
              <StockCard key={stock.stock_id} stock={stock} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
