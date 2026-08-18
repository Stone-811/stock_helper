'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, ColorType, LineData, Time } from 'lightweight-charts'
import type { InstitutionalDay, ForeignHoldingDay } from '../lib/finmind'

type Range = '1M' | '3M' | '6M' | '1Y'
type Mode = 'flow' | 'holding' | 'daytrade'
type DayTradePoint = { date: string; ratio: number }
const rangeCalendarDays: Record<Range, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 }
const rangeLabel: Record<Range, string> = { '1M': '1月', '3M': '3月', '6M': '6月', '1Y': '1年' }

/**
 * 籌碼分析圖（client 端 lazy 從 /api/stock/[id]/institutional 載入，不拖慢個股頁 TTFB）
 * 三種模式：
 * - 買賣超(flow)：外資/投信/自營「累計買賣超」，區間起點歸零，看資金流方向
 * - 外資持股(holding)：外資「實際持股張數」（FinMind 官方申報，非買賣超推估）。
 *   只有外資有逐檔官方持股；投信/自營無此資料，故僅在「買賣超」模式顯示。
 * - 當沖(daytrade)：每日當沖佔成交量 %（由個股頁以 K 線 history 算好傳入；當沖屬籌碼/交易行為，非技術指標）。
 * 刻意獨立成單一 chart（非 K 線子圖），避開多子圖 priceScale 對齊的已知坑。
 */
export default function InstitutionalChart({ stockId, height = 300, dayTrade }: { stockId: string; height?: number; dayTrade?: DayTradePoint[] }) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [raw, setRaw] = useState<InstitutionalDay[] | null>(null)
  const [holdings, setHoldings] = useState<ForeignHoldingDay[] | null>(null)
  const [error, setError] = useState(false)
  const [range, setRange] = useState<Range>('3M')
  const [mode, setMode] = useState<Mode>('flow')
  const [hoverTime, setHoverTime] = useState<string | null>(null)

  const hasDayTrade = !!(dayTrade && dayTrade.length > 0)

  // 掛載時抓一次；切換股票由父層以 key={stock_id} 觸發 remount
  useEffect(() => {
    let alive = true
    fetch(`/api/stock/${stockId}/institutional`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => {
        if (alive) {
          setRaw((j.data as InstitutionalDay[]) ?? [])
          setHoldings((j.holdings as ForeignHoldingDay[]) ?? [])
          setError(false)
        }
      })
      .catch(() => {
        if (alive) setError(true)
      })
    return () => {
      alive = false
    }
  }, [stockId])

  const view = useMemo(() => {
    const cutoffOf = (arr: { date: string }[]) =>
      new Date(new Date(arr[arr.length - 1].date).getTime() - rangeCalendarDays[range] * 86400000).toISOString().slice(0, 10)

    if (mode === 'daytrade') {
      if (!dayTrade || dayTrade.length === 0) return null
      const inRange = dayTrade.filter((d) => d.date >= cutoffOf(dayTrade))
      if (!inRange.length) return null
      const line: LineData[] = inRange.map((d) => ({ time: d.date as Time, value: d.ratio }))
      const points = new Map(inRange.map((d) => [d.date, { ratio: d.ratio }]))
      return { mode: 'daytrade' as const, lines: [{ color: '#06b6d4', data: line }], baseline: false, points, lastDate: inRange[inRange.length - 1].date }
    }

    if (mode === 'holding') {
      if (!holdings || holdings.length === 0) return null
      const inRange = holdings.filter((d) => d.date >= cutoffOf(holdings))
      if (!inRange.length) return null
      const line: LineData[] = inRange.map((d) => ({ time: d.date as Time, value: d.shares }))
      const points = new Map(inRange.map((d) => [d.date, { shares: d.shares, ratio: d.ratio }]))
      return { mode: 'holding' as const, lines: [{ color: '#3b82f6', data: line }], baseline: false, points, lastDate: inRange[inRange.length - 1].date }
    }

    if (!raw || raw.length === 0) return null
    const inRange = raw.filter((d) => d.date >= cutoffOf(raw))
    if (!inRange.length) return null
    let cf = 0, ct = 0, cd = 0
    const foreign: LineData[] = [], trust: LineData[] = [], dealer: LineData[] = []
    const points = new Map<string, { foreign: number; trust: number; dealer: number }>()
    for (const d of inRange) {
      cf += d.foreign; ct += d.trust; cd += d.dealer
      foreign.push({ time: d.date as Time, value: cf })
      trust.push({ time: d.date as Time, value: ct })
      dealer.push({ time: d.date as Time, value: cd })
      points.set(d.date, { foreign: cf, trust: ct, dealer: cd })
    }
    return {
      mode: 'flow' as const,
      lines: [{ color: '#3b82f6', data: foreign }, { color: '#f97316', data: trust }, { color: '#a78bfa', data: dealer }],
      baseline: true,
      points,
      lastDate: inRange[inRange.length - 1].date,
    }
  }, [mode, raw, holdings, dayTrade, range])

  useEffect(() => {
    if (!chartRef.current || !view) return

    const chart = createChart(chartRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#1a1a2e' }, textColor: '#a0a0a0', fontSize: 14 },
      width: chartRef.current.clientWidth,
      height,
      grid: { vertLines: { color: '#2a2a3e' }, horzLines: { color: '#2a2a3e' } },
      crosshair: {
        mode: 1,
        vertLine: { color: '#505070', width: 1, style: 2 },
        horzLine: { color: '#505070', width: 1, style: 2 },
      },
      rightPriceScale: { borderColor: '#3a3a4e' },
      timeScale: { borderColor: '#3a3a4e', timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    })

    view.lines.forEach((ln) => {
      const s = chart.addLineSeries({ color: ln.color, lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
      s.setData(ln.data)
    })

    if (view.baseline) {
      const zero = chart.addLineSeries({ color: '#64748b', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
      zero.setData(view.lines[0].data.map((d) => ({ time: d.time, value: 0 })))
    }

    chart.timeScale().fitContent()
    chart.subscribeCrosshairMove((param) => setHoverTime(param.time ? String(param.time) : null))

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth })
    })
    ro.observe(chartRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [view, height])

  const legendDate = hoverTime && view?.points.has(hoverTime) ? hoverTime : view?.lastDate ?? null
  const holdingUnavailable = mode === 'holding' && holdings !== null && holdings.length === 0
  const daytradeUnavailable = mode === 'daytrade' && !hasDayTrade

  const title = mode === 'holding' ? '外資持股張數' : mode === 'daytrade' ? '當沖比例' : '三大法人累計買賣超'
  const subtitle = mode === 'holding' ? '（張，實際持有量）' : mode === 'daytrade' ? '（當沖佔成交量 %）' : '（張，區間起點歸零）'
  const tabBtn = (active: boolean, activeColor = 'bg-green-600') =>
    `px-2.5 md:px-3 py-1 md:py-1.5 text-sm font-medium rounded min-h-[44px] md:min-h-[36px] ${active ? `${activeColor} text-white` : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'}`

  return (
    <div className="bg-[#1a1a2e] rounded-lg p-2 md:p-4">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm md:text-base font-medium">{title}</span>
          <span className="text-gray-400 text-xs">{subtitle}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 md:gap-2 md:ml-auto">
          {/* 模式切換 */}
          <button onClick={() => setMode('flow')} className={tabBtn(mode === 'flow', 'bg-blue-600')}>買賣超</button>
          <button onClick={() => setMode('holding')} className={tabBtn(mode === 'holding', 'bg-blue-600')}>外資持股</button>
          {hasDayTrade && (
            <button onClick={() => setMode('daytrade')} className={tabBtn(mode === 'daytrade', 'bg-blue-600')}>當沖</button>
          )}
          <span className="w-px self-stretch bg-[#3a3a4e] mx-1 hidden md:block" />
          {/* 區間 */}
          {(['1M', '3M', '6M', '1Y'] as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={tabBtn(range === r)}>{rangeLabel[r]}</button>
          ))}
        </div>
      </div>

      {/* 圖例 + 讀值 */}
      {view && legendDate && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-sm font-mono">
          {hoverTime === legendDate && <span className="text-gray-400">{legendDate}</span>}
          {view.mode === 'flow' ? (
            <>
              <span className="text-blue-400">外資 {fmtLots(view.points.get(legendDate)!.foreign)}</span>
              <span className="text-orange-400">投信 {fmtLots(view.points.get(legendDate)!.trust)}</span>
              <span className="text-purple-400">自營 {fmtLots(view.points.get(legendDate)!.dealer)}</span>
            </>
          ) : view.mode === 'holding' ? (
            <span className="text-blue-400">
              外資持股 {view.points.get(legendDate)!.shares.toLocaleString()} 張（{view.points.get(legendDate)!.ratio.toFixed(2)}%）
            </span>
          ) : (
            <span className="text-cyan-400">當沖 {view.points.get(legendDate)!.ratio.toFixed(1)}%</span>
          )}
        </div>
      )}

      {mode !== 'daytrade' && raw === null && !error && <div className="text-gray-400 text-sm py-12 text-center">載入中…</div>}
      {mode !== 'daytrade' && error && <div className="text-gray-400 text-sm py-12 text-center">法人資料載入失敗</div>}
      {mode === 'flow' && raw && raw.length === 0 && <div className="text-gray-400 text-sm py-12 text-center">無三大法人資料</div>}
      {holdingUnavailable && <div className="text-gray-400 text-sm py-12 text-center">此股無外資持股申報資料</div>}
      {daytradeUnavailable && <div className="text-gray-400 text-sm py-12 text-center">無當沖資料</div>}
      <div ref={chartRef} style={{ display: view ? 'block' : 'none' }} />
    </div>
  )
}

// 買賣超顯示：正數加 +，千分位
function fmtLots(v: number): string {
  const s = Math.round(v).toLocaleString()
  return v > 0 ? `+${s}` : s
}
