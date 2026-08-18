'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import IndexChart from '../components/IndexChart'
import StockCard from '../components/StockCard'
import {
  MarketIndex,
  StrongStock,
  WatchlistItem,
  getWatchlist,
  onAuthChange,
  signInWithGoogle,
} from '../lib/firebase'
import { PageHeader, ChartSkeleton, CardGridSkeleton, ErrorState, EmptyState } from '../components/states'
import { computeSignals } from '../lib/signals'

interface IndexResponse {
  index_id: string
  index_name: string
  latest: MarketIndex
  history: MarketIndex[]
  change: number
  changePercent: number
}

interface Breadth {
  available: boolean
  date?: string
  up?: number
  down?: number
  unchanged?: number
  limitUp?: number
  limitDown?: number
}

interface Quote {
  stock_id: string
  stock_name: string
  open: number
  close: number
  volume: number
  macd_status?: string
  foreign_streak?: number
  trust_streak?: number
}
interface WatchRow extends WatchlistItem {
  q?: Quote
}

// 指數詳情卡片（指數走勢區塊用）
function IndexCard({ data, showOpenInterest = false }: { data: IndexResponse; showOpenInterest?: boolean }) {
  const isPositive = data.change >= 0
  const color = isPositive ? 'text-red-600' : 'text-green-600'
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 md:gap-4">
        <div>
          <h3 className="text-lg md:text-xl font-bold text-gray-800">{data.index_name}</h3>
          <p className="text-sm text-gray-500">資料日期：{data.latest.date}</p>
        </div>
        <div className="text-right">
          <div className={`text-2xl md:text-3xl font-bold tabular-nums ${color}`}>{data.latest.close.toLocaleString()}</div>
          <div className={`text-base md:text-lg tabular-nums ${color}`}>
            {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{data.change.toFixed(2)} ({isPositive ? '+' : ''}{data.changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>
      <div className={`grid ${showOpenInterest ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-2 md:grid-cols-4'} gap-x-4 gap-y-2 md:gap-4 mt-3 md:mt-4 pt-3 md:pt-4 border-t border-gray-100`}>
        <div><span className="text-sm text-gray-500">開盤</span><div className="font-medium text-gray-900 tabular-nums">{data.latest.open.toLocaleString()}</div></div>
        <div><span className="text-sm text-gray-500">最高</span><div className="font-medium text-red-600 tabular-nums">{data.latest.high.toLocaleString()}</div></div>
        <div><span className="text-sm text-gray-500">最低</span><div className="font-medium text-green-600 tabular-nums">{data.latest.low.toLocaleString()}</div></div>
        <div><span className="text-sm text-gray-500">成交量</span><div className="font-medium text-gray-900 tabular-nums">{data.latest.volume.toLocaleString()}</div></div>
        {showOpenInterest && (
          <div><span className="text-sm text-gray-500">未平倉量</span><div className="font-medium text-gray-900 tabular-nums">{(data.latest.open_interest || 0).toLocaleString()}</div></div>
        )}
      </div>
    </div>
  )
}

// 漲跌家數磚
function BreadthTile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone: 'up' | 'down' | 'flat' }) {
  const color = tone === 'up' ? 'text-red-600' : tone === 'down' ? 'text-green-600' : 'text-gray-700'
  return (
    <div className="text-center md:text-right">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      {sub && <div className="text-xs text-gray-400 tabular-nums">{sub}</div>}
    </div>
  )
}

export default function Home() {
  const [taiexData, setTaiexData] = useState<IndexResponse | null>(null)
  const [txData, setTxData] = useState<IndexResponse | null>(null)
  const [breadth, setBreadth] = useState<Breadth | null>(null)
  const [strong, setStrong] = useState<StrongStock[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'TAIEX' | 'TX'>('TAIEX')

  // 自選（登入才有）
  const [isAuth, setIsAuth] = useState(false)
  const [watch, setWatch] = useState<WatchRow[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [taiexRes, txRes, strongRes] = await Promise.all([
        fetch('/api/market-index/TAIEX'),
        fetch('/api/market-index/TX'),
        fetch('/api/strong-stocks?days=7'),
      ])
      let taiex: IndexResponse | null = null
      if (taiexRes.ok) { taiex = await taiexRes.json(); setTaiexData(taiex) }
      if (txRes.ok) setTxData(await txRes.json())
      if (strongRes.ok) {
        const sj = await strongRes.json()
        const list: StrongStock[] = (sj.stocks || []).slice()
        list.sort((a, b) => (b.open ? (b.close - b.open) / b.open : 0) - (a.open ? (a.close - a.open) / a.open : 0))
        setStrong(list)
      }
      if (!taiexRes.ok && !txRes.ok) throw new Error('無法取得指數資料')
      // 漲跌家數（帶大盤最新日；TWSE 不通不影響其他區塊）
      if (taiex?.latest?.date) {
        fetch(`/api/market-breadth?date=${taiex.latest.date}`).then((r) => r.json()).then(setBreadth).catch(() => {})
      }
    } catch (err) {
      console.error('Failed to fetch:', err)
      setError('尚無指數資料，請先執行資料收集')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 自選股（auth）
  useEffect(() => {
    const unsub = onAuthChange(async (user) => {
      setIsAuth(!!user)
      if (!user) { setWatch([]); return }
      const wl = await getWatchlist()
      if (!wl.length) { setWatch([]); return }
      try {
        const res = await fetch(`/api/quotes?ids=${wl.map((w) => w.stock_id).join(',')}`)
        const { quotes } = await res.json()
        setWatch(wl.map((w) => ({ ...w, q: quotes[w.stock_id] })))
      } catch {
        setWatch(wl.map((w) => ({ ...w })))
      }
    })
    return () => unsub()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="今日市場" />
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <div className="h-32 bg-white rounded-lg shadow-sm animate-pulse" />
          <CardGridSkeleton count={6} />
        </div>
      </div>
    )
  }

  if (error || (!taiexData && !txData)) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="今日市場" />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <ErrorState message={error || '指數資料正在準備，請稍候片刻後重新載入。'} onRetry={load} />
        </div>
      </div>
    )
  }

  const activeData = activeTab === 'TAIEX' ? taiexData : txData
  const taiexUp = (taiexData?.change ?? 0) >= 0

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="今日市場" />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* 市場摘要：加權指數 + 漲跌家數 */}
        {taiexData && (
          <section className="bg-white rounded-lg shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-sm text-gray-500">加權指數 · {taiexData.latest.date}</div>
                <div className={`text-3xl md:text-4xl font-bold tabular-nums ${taiexUp ? 'text-red-600' : 'text-green-600'}`}>
                  {taiexData.latest.close.toLocaleString()}
                </div>
                <div className={`text-base font-semibold tabular-nums ${taiexUp ? 'text-red-600' : 'text-green-600'}`}>
                  {taiexUp ? '▲' : '▼'} {taiexUp ? '+' : ''}{taiexData.change.toFixed(2)} ({taiexUp ? '+' : ''}{taiexData.changePercent.toFixed(2)}%)
                </div>
              </div>
              {breadth?.available ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-5 gap-y-3 md:gap-6">
                  <BreadthTile label="上漲" value={breadth.up || 0} tone="up" />
                  <BreadthTile label="下跌" value={breadth.down || 0} tone="down" />
                  <BreadthTile label="漲停" value={breadth.limitUp || 0} tone="up" />
                  <BreadthTile label="跌停" value={breadth.limitDown || 0} tone="down" />
                </div>
              ) : (
                <div className="text-sm text-gray-400 self-center">漲跌家數暫無資料</div>
              )}
            </div>
          </section>
        )}

        {/* 今日強勢股 */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">🔥 今日強勢股</h2>
            <Link href="/strong-stocks" className="text-sm font-medium text-blue-600 hover:text-blue-700">查看更多 →</Link>
          </div>
          {strong.length === 0 ? (
            <EmptyState icon="🔥" title="今日尚無強勢股" description="資料更新後即可查看" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {strong.slice(0, 6).map((s) => <StockCard key={s.stock_id} stock={s} />)}
            </div>
          )}
        </section>

        {/* 我的自選 */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900">⭐ 我的自選</h2>
            {isAuth && watch.length > 0 && (
              <Link href="/watchlist" className="text-sm font-medium text-blue-600 hover:text-blue-700">管理 →</Link>
            )}
          </div>
          {!isAuth ? (
            <EmptyState
              icon="⭐"
              title="登入以使用自選股"
              description="加入關注的股票，每天快速掌握技術與法人變化"
              action={
                <button onClick={() => signInWithGoogle()} className="inline-flex items-center min-h-[44px] px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
                  Google 登入
                </button>
              }
            />
          ) : watch.length === 0 ? (
            <EmptyState
              icon="⭐"
              title="尚未加入自選股"
              description="到個股頁點右上角「☆ 加入自選」"
              action={<Link href="/strong-stocks" className="inline-flex items-center min-h-[44px] px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">瀏覽強勢股</Link>}
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {watch.slice(0, 8).map((w) => {
                const q = w.q
                const chg = q ? q.close - q.open : 0
                const pct = q && q.open > 0 ? (chg / q.open) * 100 : 0
                const up = chg >= 0
                return (
                  <Link key={w.stock_id} href={`/stock/${w.stock_id}`} className="bg-white rounded-lg shadow-sm p-3 hover:shadow-md transition-shadow">
                    <div className="font-bold text-gray-900">{w.stock_id}</div>
                    <div className="text-xs text-gray-500 truncate">{w.stock_name}</div>
                    <div className={`mt-1 text-lg font-bold tabular-nums ${up ? 'text-red-600' : 'text-green-600'}`}>{q ? q.close.toFixed(2) : '—'}</div>
                    <div className={`text-xs tabular-nums ${up ? 'text-red-500' : 'text-green-500'}`}>{q ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(2)}%` : ''}</div>
                    {(() => {
                      const sigs = computeSignals(q)
                      return sigs.length ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {sigs.slice(0, 2).map((s, i) => (
                            <span key={i} className="text-[10px] px-1 py-0.5 rounded bg-orange-50 text-orange-600">{s.icon}{s.text}</span>
                          ))}
                        </div>
                      ) : null
                    })()}
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* 指數走勢 */}
        <section>
          <h2 className="text-lg font-bold text-gray-900 mb-3">指數走勢</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
            {taiexData && <IndexCard data={taiexData} />}
            {txData && <IndexCard data={txData} showOpenInterest />}
          </div>
          <div className="flex gap-2 mb-4">
            {taiexData && (
              <button onClick={() => setActiveTab('TAIEX')} className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${activeTab === 'TAIEX' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`}>加權指數</button>
            )}
            {txData && (
              <button onClick={() => setActiveTab('TX')} className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${activeTab === 'TX' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`}>台指期</button>
            )}
          </div>
          {activeData && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <IndexChart data={activeData.history} indexId={activeData.index_id} height={600} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
