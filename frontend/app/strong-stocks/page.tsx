'use client'

import { useEffect, useState } from 'react'
import StockCard from '../../components/StockCard'
import StockSearchOptimized from '../../components/StockSearchOptimized'
import { TodayStrongStock } from '../../lib/supabase'

interface StrongStocksResponse {
  stocks: TodayStrongStock[]
  latestDate: string
  availableDates: string[]
  totalCount: number
}

export default function StrongStocksPage() {
  const [data, setData] = useState<StrongStocksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [filter, setFilter] = useState({
    macd: 'all',
    minVolume: 0,
    industry: 'all',
  })

  // 取得所有產業類別
  const industries = data?.stocks
    ? Array.from(new Set(data.stocks.map(s => s.industry).filter(Boolean))).sort()
    : []

  // 載入資料
  const fetchData = async (date?: string) => {
    setLoading(true)
    try {
      const url = date
        ? `/api/strong-stocks?days=7&date=${date}`
        : '/api/strong-stocks?days=7'
      const res = await fetch(url)
      const json = await res.json()
      setData(json)
      if (!date && json.latestDate) {
        setSelectedDate(json.latestDate)
      }
    } catch (error) {
      console.error('Failed to fetch:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  // 切換日期
  const handleDateChange = (date: string) => {
    setSelectedDate(date)
    fetchData(date)
  }

  // 篩選股票
  const filteredStocks = data?.stocks.filter(stock => {
    if (filter.macd !== 'all' && stock.macd_status !== filter.macd) return false
    if (filter.minVolume > 0 && stock.volume < filter.minVolume) return false
    if (filter.industry !== 'all' && stock.industry !== filter.industry) return false
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* 標題列 + 搜尋 */}
          <div className="flex flex-wrap items-center justify-between gap-4 pl-12 md:pl-0">
            <h1 className="text-xl font-bold text-gray-800">強勢股列表</h1>
            <StockSearchOptimized />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 日期資訊卡片 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <span className="text-sm text-gray-500">當前日期</span>
              <div className="text-2xl font-bold text-gray-800">{selectedDate}</div>
            </div>
            <div className="border-l border-gray-200 pl-4">
              <span className="text-sm text-gray-500">可選範圍</span>
              <div className="text-sm text-gray-700">
                {data?.availableDates && data.availableDates.length > 0 && (
                  <>
                    {data.availableDates[data.availableDates.length - 1]} ~ {data.availableDates[0]}
                    <span className="text-gray-400 ml-2">({data.availableDates.length} 個交易日)</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 日期選擇與篩選條件 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-4 items-center justify-between">
            {/* 左側：日期 + 篩選 */}
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">切換日期</span>
                <select
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {data?.availableDates?.map((date) => (
                    <option key={date} value={date}>
                      {date}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">MACD</span>
                <select
                  value={filter.macd}
                  onChange={(e) => setFilter({ ...filter, macd: e.target.value })}
                  className="border rounded px-2 py-1.5 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="多">多頭</option>
                  <option value="空">空頭</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">成交量</span>
                <select
                  value={filter.minVolume}
                  onChange={(e) => setFilter({ ...filter, minVolume: parseInt(e.target.value) })}
                  className="border rounded px-2 py-1.5 text-sm"
                >
                  <option value="0">不限</option>
                  <option value="1000">1000張+</option>
                  <option value="5000">5000張+</option>
                  <option value="10000">1萬張+</option>
                </select>
              </div>
              {industries.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-sm">產業</span>
                  <select
                    value={filter.industry}
                    onChange={(e) => setFilter({ ...filter, industry: e.target.value })}
                    className="border rounded px-2 py-1.5 text-sm max-w-[150px]"
                  >
                    <option value="all">全部產業</option>
                    {industries.map((ind) => (
                      <option key={ind} value={ind}>
                        {ind}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            {/* 右側：統計 */}
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">
                篩選：<span className="font-medium text-gray-700">{filteredStocks.length}</span> 檔
              </span>
              <span className="text-gray-500">
                當日：<span className="font-bold text-orange-500">{data?.totalCount || 0}</span> 檔
              </span>
            </div>
          </div>
        </div>

        {/* 股票列表 */}
        {filteredStocks.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
            沒有符合條件的股票
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {filteredStocks.map((stock) => (
              <StockCard key={stock.stock_id} stock={stock} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
