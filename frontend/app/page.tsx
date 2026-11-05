'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import IndexChart from '../components/IndexChart'
import { DaytradeStats, VixStats } from '../components/MoodStats'
import {
  MarketIndex,
  WatchlistItem,
  getWatchlist,
  onAuthChange,
  signInWithGoogle,
} from '../lib/firebase'
import { PageHeader, ErrorState, EmptyState } from '../components/states'
import { computeSignals } from '../lib/signals'
import InfoTip from '../components/InfoTip'
import { DASH } from '../lib/format'
import { statOf, type SentimentResponse } from '../lib/sentiment'

interface IndexResponse {
  index_id: string
  index_name: string
  latest: MarketIndex
  history: MarketIndex[]
  change: number
  changePercent: number
}

interface Quote {
  stock_id: string
  stock_name: string
  open: number
  close: number
  volume: number
  prev_close?: number
  macd_status?: string
  foreign_streak?: number
  trust_streak?: number
}
interface WatchRow extends WatchlistItem {
  q?: Quote
}

/**
 * 美股三大指數（2026-11-05 業主要的）：加權指數卡右側三個小格。
 * 各自獨立 fetch /api/market-index/{SOX|SPX|DJI}（跟 TAIEX 同一支 API、同一個 market_index collection）。
 * 日期是美東交易日：台灣晚上看到的最新是「前一晚」，所以每格都標「美股 M/D 收盤」。
 * 漲跌跟美股前一個交易日收盤比（API 已算好 change／changePercent），紅漲綠跌（台股慣例）。
 * ⚠️ 自己 fetch、自己失敗：三格任一抓不到只顯示「—」，不可併進 load() 的 Promise.all。
 */
const US_INDICES: { id: 'SOX' | 'SPX' | 'DJI'; label: string }[] = [
  { id: 'SOX', label: '費半' },
  { id: 'SPX', label: 'S&P 500' },
  { id: 'DJI', label: '道瓊' },
]
function UsIndexCells() {
  const [data, setData] = useState<Record<string, IndexResponse | null>>({})
  useEffect(() => {
    let alive = true
    US_INDICES.forEach(({ id }) => {
      fetch(`/api/market-index/${id}?last=2`)  // 只需要最新與前一筆；完整歷史不必傳
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive) setData((d) => ({ ...d, [id]: j })) })
        .catch(() => { if (alive) setData((d) => ({ ...d, [id]: null })) })
    })
    return () => { alive = false }
  }, [])
  const fmtUs = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
  // 三個指數通常同一天；不同天（例如其中一個還沒更新）才在各自那格寫日期
  const dates = [...new Set(US_INDICES.map(({ id }) => data[id]?.latest.date).filter((d): d is string => !!d))]
  const sameDay = dates.length === 1
  return (
    // 依「這一塊自己的寬度」排版（container query）：夠寬（≥26rem）三格並排；手機與窄平板改成三列，名稱在左、數字在右。
    // 2026-11-05 量過：390px 三格並排時道瓊數字頂到框邊、▲ 自己掉到一行，所以窄的時候不並排。
    <div className="@container w-full xl:w-[28rem]" aria-label="美股三大指數">
      <div className="text-sm text-gray-700 mb-1.5">
        美股三大指數{sameDay && <> · 美股 {fmtUs(dates[0])} 收盤</>}
      </div>
      <div className="grid grid-cols-1 gap-2 @min-[26rem]:grid-cols-3">
        {US_INDICES.map(({ id, label }) => {
          const d = data[id]
          const loaded = id in data
          const up = (d?.change ?? 0) >= 0
          const cls = !d ? 'text-gray-600' : up ? 'text-red-600' : 'text-green-700'
          return (
            <div key={id} className="rounded-lg bg-gray-50 px-3 py-2 min-w-0 flex items-center justify-between gap-3 @min-[26rem]:block">
              <div className="text-base text-gray-800 font-medium whitespace-nowrap">{label}</div>
              {d ? (
                <div className="text-right @min-[26rem]:text-left min-w-0">
                  <div className={`text-lg @min-[26rem]:text-xl font-bold tabular-nums leading-tight ${cls}`}>{d.latest.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className={`text-sm font-semibold tabular-nums ${cls}`}>
                    <span className="whitespace-nowrap"><span aria-hidden="true">{up ? '▲' : '▼'} </span>{up ? '+' : ''}{d.change.toFixed(2)}</span>{' '}
                    <span className="whitespace-nowrap">({up ? '+' : ''}{d.changePercent.toFixed(2)}%)</span>
                  </div>
                  {!sameDay && <div className="text-xs text-gray-700">美股 {fmtUs(d.latest.date)} 收盤</div>}
                </div>
              ) : (
                <div className="text-lg font-bold text-gray-600">
                  <span aria-hidden="true">{loaded ? DASH : '…'}</span>
                  <span className="sr-only">{loaded ? '無資料' : '載入中'}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 首頁「市場溫度」展開版（2026-11-05 業主：「首頁不要放今日強勢股，把大盤當沖比、恐慌指數展開放上」
 * 「補上美國恐慌指數」）：上市／上櫃當沖比、台股／美股恐慌指數四張大卡，跟 /market-mood 同一組卡（MoodStats）。
 * 融資融券與走勢圖留在 /market-mood，標題列右邊有連結過去。
 * 用 ?days=400：卡片要算「近一年最高最低」（365 天）；400 個日曆天也不會被春節切成空的。
 * ⚠️ 自己 fetch、自己失敗：絕不可併進 load() 的 Promise.all（任一 reject 會把整個首頁變錯誤畫面）。
 *    抓不到時四張卡各自顯示「暫無資料」，不顯示 0。
 */
function MoodSection() {
  const [data, setData] = useState<SentimentResponse | null | undefined>(undefined) // undefined=載入中、null=失敗
  useEffect(() => {
    let alive = true
    fetch('/api/market-sentiment?days=400')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setData(j) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [])
  const s = useMemo(() => ({
    dtTwse: data ? statOf(data.daytrade, (r) => r.twse_buy_pct) : null,
    dtTpex: data ? statOf(data.daytrade, (r) => r.tpex_buy_pct) : null,
    taivix: data ? statOf(data.taivix, (r) => r.close) : null,
    vix: data ? statOf(data.vix, (r) => r.close) : null,
  }), [data])

  return (
    <section aria-labelledby="mood-h" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <h2 id="mood-h" className="text-lg font-bold text-gray-900">🌡️ 市場溫度</h2>
        <Link href="/market-mood" className="inline-flex items-center min-h-[44px] text-base font-medium text-blue-700 hover:text-blue-800">
          走勢圖、融資融券 →
        </Link>
      </div>
      {data === undefined ? (
        <div className="space-y-3" role="status" aria-label="市場溫度載入中">
          <div className="h-36 bg-white rounded-lg shadow-sm animate-pulse" />
          <div className="h-36 bg-white rounded-lg shadow-sm animate-pulse" />
        </div>
      ) : (
        <>
          {data === null && <p className="text-base text-gray-700">暫時抓不到市場溫度資料，請稍後重新整理。</p>}
          <h3 className="text-base font-medium text-gray-900">大盤當沖比（占成交金額）</h3>
          <DaytradeStats twse={s.dtTwse} tpex={s.dtTpex} />
          <h3 className="text-base font-medium text-gray-900 pt-1">恐慌指數</h3>
          <VixStats taivix={s.taivix} vix={s.vix} taivixFrom={data?.first?.taivix ?? null} />
        </>
      )}
    </section>
  )
}

// 指數數據列（跟著「指數走勢」分頁走；加權的收盤/漲跌已在上方「今日市場」，此處只補明細）
function IndexStatStrip({ data, showOpenInterest = false }: { data: IndexResponse; showOpenInterest?: boolean }) {
  const isPositive = data.change >= 0
  const color = isPositive ? 'text-red-600' : 'text-green-600'
  // 缺值（null）顯示 DASH，不顯示 0：index writer 2026-11-05 起缺值寫 null
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : DASH)
  return (
    <div className="bg-white rounded-lg shadow-sm px-4 py-3 mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="font-medium text-gray-800">{data.index_name}</span>
      <span className={`font-bold tabular-nums ${color}`}>
        {data.latest.close.toLocaleString()}
        <span className="ml-1.5 font-medium">
          {isPositive ? '▲' : '▼'} {isPositive ? '+' : ''}{data.change.toFixed(2)} ({isPositive ? '+' : ''}{data.changePercent.toFixed(2)}%)
        </span>
      </span>
      <span className="text-gray-700">開 <span className="text-gray-900 tabular-nums">{num(data.latest.open)}</span></span>
      <span className="text-gray-700">高 <span className="text-red-600 tabular-nums">{num(data.latest.high)}</span></span>
      <span className="text-gray-700">低 <span className="text-green-600 tabular-nums">{num(data.latest.low)}</span></span>
      <span className="text-gray-700">量 <span className="text-gray-900 tabular-nums">{num(data.latest.volume)}</span></span>
      {showOpenInterest && (
        <span className="text-gray-700">未平倉 <span className="text-gray-900 tabular-nums">{num(data.latest.open_interest)}</span></span>
      )}
      <span className="text-gray-600 ml-auto">{data.latest.date}</span>
    </div>
  )
}

export default function Home() {
  const [taiexData, setTaiexData] = useState<IndexResponse | null>(null)
  const [txData, setTxData] = useState<IndexResponse | null>(null)
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
      // 2026-11-05 業主：首頁不放今日強勢股（強勢股在 /strong-stocks），所以這裡不再抓 strong-stocks
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
          <div className="h-36 bg-white rounded-lg shadow-sm animate-pulse" />
          <div className="h-36 bg-white rounded-lg shadow-sm animate-pulse" />
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
        {/* 市場摘要：加權指數＋美股三大指數。卡片一定渲染：加權指數抓不到（只有台指期）時美股那塊仍要顯示（審查 F1） */}
        <section className="bg-white rounded-lg shadow-sm p-4 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              {taiexData ? (
              <div>
                <div className="text-sm text-gray-700">
                  加權指數 · {taiexData.latest.date}
                  <InfoTip title="加權指數（TAIEX）">
                    全體上市股票依市值加權計算的大盤指數，市值越大的股票影響越大。
                    漲跌以前一交易日收盤為基準。
                  </InfoTip>
                </div>
                <div className={`text-3xl md:text-4xl font-bold tabular-nums ${taiexUp ? 'text-red-600' : 'text-green-600'}`}>
                  {taiexData.latest.close.toLocaleString()}
                </div>
                <div className={`text-base font-semibold tabular-nums ${taiexUp ? 'text-red-600' : 'text-green-600'}`}>
                  {taiexUp ? '▲' : '▼'} {taiexUp ? '+' : ''}{taiexData.change.toFixed(2)} ({taiexUp ? '+' : ''}{taiexData.changePercent.toFixed(2)}%)
                </div>
              </div>
              ) : (
                <div className="text-base text-gray-700">加權指數暫時抓不到，請稍後重新整理。</div>
              )}
              {/* 美股三大指數：寬螢幕（xl）在右側；其他寬度排在加權指數下面（2026-11-05） */}
              <UsIndexCells />
            </div>
        </section>

        {/* 市場溫度展開版（2026-11-05）：取代原本的兩行摘要與今日強勢股 */}
        <MoodSection />

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
                const qBase = q ? (q.prev_close && q.prev_close > 0 ? q.prev_close : q.open) : 0
                const chg = q ? q.close - qBase : 0
                const pct = qBase > 0 ? (chg / qBase) * 100 : 0
                const up = chg >= 0
                return (
                  <Link key={w.stock_id} href={`/stock/${w.stock_id}`} className="bg-white rounded-lg shadow-sm p-3 hover:shadow-md transition-shadow">
                    <div className="font-bold text-gray-900">{w.stock_id}</div>
                    <div className="text-xs text-gray-700 font-medium truncate">{w.stock_name}</div>
                    <div className={`mt-1 text-lg font-bold tabular-nums ${up ? 'text-red-600' : 'text-green-600'}`}>{q ? q.close.toFixed(2) : '—'}</div>
                    <div className={`text-xs tabular-nums ${up ? 'text-red-500' : 'text-green-500'}`}>{q ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${pct.toFixed(2)}%` : ''}</div>
                    {(() => {
                      const sigs = computeSignals(q)
                      return sigs.length ? (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {sigs.slice(0, 2).map((s, i) => (
                            <span key={i} className="text-xs px-1 py-0.5 rounded bg-orange-50 text-orange-600">{s.icon}{s.text}</span>
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
          <div className="flex gap-2 mb-4">
            {taiexData && (
              <button onClick={() => setActiveTab('TAIEX')} className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${activeTab === 'TAIEX' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`}>加權指數</button>
            )}
            {txData && (
              <button onClick={() => setActiveTab('TX')} className={`px-5 py-2.5 rounded-lg font-medium transition-colors ${activeTab === 'TX' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100 shadow-sm'}`}>台指期</button>
            )}
          </div>
          {activeData && <IndexStatStrip data={activeData} showOpenInterest={activeTab === 'TX'} />}
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
