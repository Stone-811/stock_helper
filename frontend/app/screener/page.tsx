'use client'

import { useEffect, useState } from 'react'
import StockCard from '../../components/StockCard'
import StockSearchOptimized from '../../components/StockSearchOptimized'
import { StrongStock } from '../../lib/firebase'

interface ScreenerResponse {
  stocks: StrongStock[]
  count: number
  returned: number
  totalCount: number
  latestDate: string
  availableDates: string[]
  industries: string[]
}

const SELECT = 'border border-gray-300 rounded px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function ScreenerPage() {
  const [data, setData] = useState<ScreenerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')
  const [macd, setMacd] = useState('')
  const [foreignStreakMin, setForeignStreakMin] = useState(0)
  const [trustStreakMin, setTrustStreakMin] = useState(0)
  const [foreignBuy, setForeignBuy] = useState(false)
  const [volumeMin, setVolumeMin] = useState(0)
  const [industry, setIndustry] = useState('')
  const [sort, setSort] = useState('foreign_buy')

  useEffect(() => {
    const params = new URLSearchParams()
    if (date) params.set('date', date)
    if (macd) params.set('macd', macd)
    if (foreignStreakMin) params.set('foreignStreakMin', String(foreignStreakMin))
    if (trustStreakMin) params.set('trustStreakMin', String(trustStreakMin))
    if (foreignBuy) params.set('foreignBuy', '1')
    if (volumeMin) params.set('volumeMin', String(volumeMin))
    if (industry) params.set('industry', industry)
    if (sort) params.set('sort', sort)

    setLoading(true)
    fetch(`/api/screener?${params.toString()}`)
      .then((r) => r.json())
      .then((d: ScreenerResponse) => {
        setData(d)
        if (!date && d.latestDate) setDate(d.latestDate)
      })
      .catch((e) => console.error('Screener fetch failed:', e))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, macd, foreignStreakMin, trustStreakMin, foreignBuy, volumeMin, industry, sort])

  const stocks = data?.stocks || []
  const industries = data?.industries || []
  const availableDates = data?.availableDates || []

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pl-12 md:pl-0">
            <h1 className="text-xl font-bold text-gray-800">自訂選股</h1>
            <StockSearchOptimized />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 條件卡 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-x-4 gap-y-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">日期</span>
              <select value={date} onChange={(e) => setDate(e.target.value)} className={SELECT}>
                {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">MACD</span>
              <select value={macd} onChange={(e) => setMacd(e.target.value)} className={SELECT}>
                <option value="">全部</option>
                <option value="多">多頭</option>
                <option value="空">空頭</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">外資連買</span>
              <select value={foreignStreakMin} onChange={(e) => setForeignStreakMin(parseInt(e.target.value))} className={SELECT}>
                <option value="0">不限</option>
                <option value="1">≥1 天</option>
                <option value="3">≥3 天</option>
                <option value="5">≥5 天</option>
                <option value="10">≥10 天</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">投信連買</span>
              <select value={trustStreakMin} onChange={(e) => setTrustStreakMin(parseInt(e.target.value))} className={SELECT}>
                <option value="0">不限</option>
                <option value="1">≥1 天</option>
                <option value="3">≥3 天</option>
                <option value="5">≥5 天</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-sm">成交量</span>
              <select value={volumeMin} onChange={(e) => setVolumeMin(parseInt(e.target.value))} className={SELECT}>
                <option value="0">不限</option>
                <option value="1000">1000張+</option>
                <option value="5000">5000張+</option>
                <option value="10000">1萬張+</option>
              </select>
            </div>
            {industries.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-sm">產業</span>
                <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={`${SELECT} max-w-[150px]`}>
                  <option value="">全部產業</option>
                  {industries.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
                </select>
              </div>
            )}
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={foreignBuy} onChange={(e) => setForeignBuy(e.target.checked)} className="rounded" />
              僅外資買超
            </label>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-gray-500 text-sm">排序</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)} className={SELECT}>
                <option value="foreign_buy">外資買超</option>
                <option value="trust_buy">投信買超</option>
                <option value="volume">成交量</option>
                <option value="foreign_streak">外資連買天數</option>
              </select>
            </div>
          </div>
          {/* 統計 */}
          <div className="flex items-center gap-4 text-sm mt-3 pt-3 border-t border-gray-100">
            <span className="text-gray-500">
              符合：<span className="font-bold text-orange-500">{data?.count ?? 0}</span> 檔
              {data && data.returned < data.count && <span className="text-gray-400 ml-1">（顯示前 {data.returned}）</span>}
            </span>
            <span className="text-gray-500">當日：<span className="font-medium text-gray-700">{data?.totalCount ?? 0}</span> 檔</span>
          </div>
        </div>

        {/* 結果 */}
        {loading ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">載入中...</div>
        ) : stocks.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">沒有符合條件的股票，試著放寬條件</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {stocks.map((stock) => <StockCard key={stock.stock_id} stock={stock} />)}
          </div>
        )}
      </div>
    </div>
  )
}
