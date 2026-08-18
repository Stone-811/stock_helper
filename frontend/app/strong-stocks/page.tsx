'use client'

import { useEffect, useState } from 'react'
import StockCard from '../../components/StockCard'
import { StrongStock as TodayStrongStock } from '../../lib/firebase'
import { PageHeader, CardGridSkeleton, EmptyState, ErrorState } from '../../components/states'

interface StrongStocksResponse {
  stocks: TodayStrongStock[]
  latestDate: string
  availableDates: string[]
  totalCount: number
  dataMissing?: boolean
}

// 快速篩選（突破/爆量需個股 history，暫以成交量近似）
const QUICK_FILTERS = [
  { key: 'all', label: '全部', macd: 'all', minVolume: 0, foreignBuy: false },
  { key: 'tech', label: '技術多頭', macd: '多', minVolume: 0, foreignBuy: false },
  { key: 'foreign', label: '法人買超', macd: 'all', minVolume: 0, foreignBuy: true },
  { key: 'volume', label: '爆量', macd: 'all', minVolume: 10000, foreignBuy: false },
] as const

export default function StrongStocksPage() {
  const [data, setData] = useState<StrongStocksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [filter, setFilter] = useState({
    macd: 'all',
    minVolume: 0,
    industry: 'all',
    foreignBuy: false,
  })

  // 取得所有產業類別
  const industries = data?.stocks
    ? Array.from(new Set(data.stocks.map(s => s.industry).filter(Boolean))).sort()
    : []

  // 載入資料
  const fetchData = async (date?: string) => {
    setLoading(true)
    setError(false)
    try {
      const url = date
        ? `/api/strong-stocks?days=7&date=${date}`
        : '/api/strong-stocks?days=7'
      const res = await fetch(url)
      if (!res.ok) throw new Error('http')
      const json = await res.json()
      setData(json)
      if (!date && json.latestDate) {
        setSelectedDate(json.latestDate)
      }
    } catch (e) {
      console.error('Failed to fetch:', e)
      setError(true)
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
    if (filter.foreignBuy && !(stock.foreign_buy > 0)) return false
    return true
  }) || []

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="強勢股列表" />
        <div className="max-w-7xl mx-auto px-4 py-6"><CardGridSkeleton /></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="強勢股列表" />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <ErrorState message="無法取得強勢股資料" onRetry={() => fetchData(selectedDate || undefined)} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="強勢股列表" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 快速篩選 */}
        <div className="flex flex-wrap gap-2 mb-4">
          {QUICK_FILTERS.map((q) => {
            const active = filter.macd === q.macd && filter.minVolume === q.minVolume && filter.foreignBuy === q.foreignBuy
            return (
              <button
                key={q.key}
                onClick={() => setFilter((f) => ({ ...f, macd: q.macd, minVolume: q.minVolume, foreignBuy: q.foreignBuy }))}
                className={`px-3 min-h-[40px] rounded-full text-sm border transition-colors ${active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}
              >
                {q.label}
              </button>
            )
          })}
        </div>

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
          <EmptyState
            icon={data?.dataMissing ? '📅' : '🔍'}
            title={data?.dataMissing ? '這一天沒有明細資料' : '沒有符合條件的股票'}
            description={data?.dataMissing ? '請改選其他交易日' : '試著放寬 MACD／成交量／產業等條件'}
          />
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
