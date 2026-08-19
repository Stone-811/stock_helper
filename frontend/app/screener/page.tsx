'use client'

import { useEffect, useState } from 'react'
import StockCard from '../../components/StockCard'
import { StrongStock } from '../../lib/firebase'
import { PageHeader, CardGridSkeleton, EmptyState, ErrorState } from '../../components/states'

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

// 快速策略：一鍵帶入現有條件（突破/爆量等需個股 history，暫以成交量/連買近似）
const QUICK_STRATEGIES = [
  { icon: '📈', label: '趨勢多頭', macd: '多', foreignStreakMin: 0, trustStreakMin: 0, foreignBuy: false, volumeMin: 1000, sort: 'volume' },
  { icon: '💰', label: '法人佈局', macd: '', foreignStreakMin: 3, trustStreakMin: 2, foreignBuy: false, volumeMin: 1000, sort: 'foreign_streak' },
  { icon: '🚀', label: '爆量', macd: '', foreignStreakMin: 0, trustStreakMin: 0, foreignBuy: false, volumeMin: 10000, sort: 'volume' },
  { icon: '💎', label: '技術+法人雙多', macd: '多', foreignStreakMin: 0, trustStreakMin: 0, foreignBuy: true, volumeMin: 1000, sort: 'foreign_buy' },
] as const

export default function ScreenerPage() {
  const [data, setData] = useState<ScreenerResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [ready, setReady] = useState(false) // 還原完成前不抓，避免用預設條件多抓一次
  const [date, setDate] = useState('')
  const [macd, setMacd] = useState('')
  const [foreignStreakMin, setForeignStreakMin] = useState(0)
  const [trustStreakMin, setTrustStreakMin] = useState(0)
  const [foreignBuy, setForeignBuy] = useState(false)
  const [volumeMin, setVolumeMin] = useState(0)
  const [industry, setIndustry] = useState('')
  const [sort, setSort] = useState('foreign_buy')

  // 還原上次篩選（sessionStorage）→ 從個股頁返回時條件保留
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('screener-filters')
      if (saved) {
        const f = JSON.parse(saved)
        if (typeof f.date === 'string') setDate(f.date)
        if (typeof f.macd === 'string') setMacd(f.macd)
        if (typeof f.foreignStreakMin === 'number') setForeignStreakMin(f.foreignStreakMin)
        if (typeof f.trustStreakMin === 'number') setTrustStreakMin(f.trustStreakMin)
        if (typeof f.foreignBuy === 'boolean') setForeignBuy(f.foreignBuy)
        if (typeof f.volumeMin === 'number') setVolumeMin(f.volumeMin)
        if (typeof f.industry === 'string') setIndustry(f.industry)
        if (typeof f.sort === 'string') setSort(f.sort)
      }
    } catch {}
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      sessionStorage.setItem('screener-filters', JSON.stringify({ date, macd, foreignStreakMin, trustStreakMin, foreignBuy, volumeMin, industry, sort }))
    } catch {}

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
    setError(false)
    fetch(`/api/screener?${params.toString()}`)
      .then((r) => { if (!r.ok) throw new Error('http'); return r.json() })
      .then((d: ScreenerResponse) => {
        setData(d)
        if (!date && d.latestDate) setDate(d.latestDate)
      })
      .catch((e) => { console.error('Screener fetch failed:', e); setError(true) })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, date, macd, foreignStreakMin, trustStreakMin, foreignBuy, volumeMin, industry, sort, reloadNonce])

  const stocks = data?.stocks || []
  const industries = data?.industries || []
  const availableDates = data?.availableDates || []

  const applyPreset = (s: typeof QUICK_STRATEGIES[number]) => {
    setMacd(s.macd)
    setForeignStreakMin(s.foreignStreakMin)
    setTrustStreakMin(s.trustStreakMin)
    setForeignBuy(s.foreignBuy)
    setVolumeMin(s.volumeMin)
    setSort(s.sort)
    setIndustry('')
  }
  const clearAll = () => {
    setMacd(''); setForeignStreakMin(0); setTrustStreakMin(0); setForeignBuy(false); setVolumeMin(0); setIndustry('')
  }
  // 已套用條件 → 可單獨移除的 chips
  const chips: { key: string; label: string; clear: () => void }[] = []
  if (macd) chips.push({ key: 'macd', label: `MACD ${macd === '多' ? '多頭' : '空頭'}`, clear: () => setMacd('') })
  if (foreignStreakMin > 0) chips.push({ key: 'fs', label: `外資連買≥${foreignStreakMin}日`, clear: () => setForeignStreakMin(0) })
  if (trustStreakMin > 0) chips.push({ key: 'ts', label: `投信連買≥${trustStreakMin}日`, clear: () => setTrustStreakMin(0) })
  if (foreignBuy) chips.push({ key: 'fb', label: '外資買超', clear: () => setForeignBuy(false) })
  if (volumeMin > 0) chips.push({ key: 'vol', label: `量≥${volumeMin.toLocaleString()}張`, clear: () => setVolumeMin(0) })
  if (industry) chips.push({ key: 'ind', label: `產業:${industry}`, clear: () => setIndustry('') })

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="自訂選股" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 快速策略 */}
        <div className="mb-4">
          <div className="text-sm text-gray-700 mb-2">快速策略</div>
          <div className="flex flex-wrap gap-2">
            {QUICK_STRATEGIES.map((s) => (
              <button
                key={s.label}
                onClick={() => applyPreset(s)}
                className="inline-flex items-center gap-1 px-3 min-h-[40px] rounded-full border border-gray-300 bg-white text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors"
              >
                <span aria-hidden="true">{s.icon}</span> {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 條件卡 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <div className="flex flex-wrap gap-x-4 gap-y-3 items-center">
            <div className="flex items-center gap-2">
              <span className="text-gray-700 text-sm">日期</span>
              <select value={date} onChange={(e) => setDate(e.target.value)} className={SELECT}>
                {availableDates.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-700 text-sm">MACD</span>
              <select value={macd} onChange={(e) => setMacd(e.target.value)} className={SELECT}>
                <option value="">全部</option>
                <option value="多">多頭</option>
                <option value="空">空頭</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-700 text-sm">外資連買</span>
              <select value={foreignStreakMin} onChange={(e) => setForeignStreakMin(parseInt(e.target.value))} className={SELECT}>
                <option value="0">不限</option>
                <option value="1">≥1 天</option>
                <option value="3">≥3 天</option>
                <option value="5">≥5 天</option>
                <option value="10">≥10 天</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-700 text-sm">投信連買</span>
              <select value={trustStreakMin} onChange={(e) => setTrustStreakMin(parseInt(e.target.value))} className={SELECT}>
                <option value="0">不限</option>
                <option value="1">≥1 天</option>
                <option value="2">≥2 天</option>
                <option value="3">≥3 天</option>
                <option value="5">≥5 天</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-700 text-sm">成交量</span>
              <select value={volumeMin} onChange={(e) => setVolumeMin(parseInt(e.target.value))} className={SELECT}>
                <option value="0">不限</option>
                <option value="1000">1000張+</option>
                <option value="5000">5000張+</option>
                <option value="10000">1萬張+</option>
              </select>
            </div>
            {industries.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-gray-700 text-sm">產業</span>
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
              <span className="text-gray-700 text-sm">排序</span>
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
            <span className="text-gray-700">
              符合：<span className="font-bold text-orange-500">{data?.count ?? 0}</span> 檔
              {data && data.returned < data.count && <span className="text-gray-600 ml-1">（顯示前 {data.returned}）</span>}
            </span>
            <span className="text-gray-700">當日：<span className="font-medium text-gray-700">{data?.totalCount ?? 0}</span> 檔</span>
          </div>
        </div>

        {/* 已套用條件 chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {chips.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-full bg-blue-50 text-blue-700 text-sm border border-blue-200">
                {c.label}
                <button onClick={c.clear} className="flex items-center justify-center w-6 h-6 text-blue-400 hover:text-blue-700" aria-label={`移除 ${c.label}`}>✕</button>
              </span>
            ))}
            <button onClick={clearAll} className="text-sm text-gray-700 hover:text-gray-700 underline">清除全部</button>
          </div>
        )}

        {/* 結果 */}
        {loading ? (
          <CardGridSkeleton />
        ) : error ? (
          <ErrorState message="選股資料載入失敗" onRetry={() => setReloadNonce((n) => n + 1)} />
        ) : stocks.length === 0 ? (
          <EmptyState icon="🔍" title="沒有符合條件的股票" description="試著放寬條件，或移除部分篩選" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
            {stocks.map((stock) => <StockCard key={stock.stock_id} stock={stock} />)}
          </div>
        )}
      </div>
    </div>
  )
}
