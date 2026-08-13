'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, ColorType, LineData } from 'lightweight-charts'
import type { InstitutionalDay } from '../lib/finmind'

type Range = '1M' | '3M' | '6M' | '1Y'
const rangeCalendarDays: Record<Range, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 }
const rangeLabel: Record<Range, string> = { '1M': '1月', '3M': '3月', '6M': '6月', '1Y': '1年' }

/**
 * 三大法人累計買賣超趨勢圖（外資/投信/自營，張）
 *
 * - 資料 client 端 lazy 從 /api/stock/[id]/institutional 載入（不拖慢個股頁 TTFB）
 * - 「累計」以所選區間起點歸零逐日累加，看資金持續流入/流出趨勢
 * - 刻意獨立成單一 chart（非 K 線子圖），避開多子圖 priceScale 對齊的已知坑
 */
export default function InstitutionalChart({ stockId, height = 300 }: { stockId: string; height?: number }) {
  const chartRef = useRef<HTMLDivElement>(null)
  const [raw, setRaw] = useState<InstitutionalDay[] | null>(null)
  const [error, setError] = useState(false)
  const [range, setRange] = useState<Range>('3M')
  const [hover, setHover] = useState<{ date: string; foreign: number; trust: number; dealer: number } | null>(null)

  // 掛載時抓一次；切換股票由父層以 key={stock_id} 觸發 remount（故不需在 effect 內同步 reset state）
  useEffect(() => {
    let alive = true
    fetch(`/api/stock/${stockId}/institutional`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => {
        if (alive) {
          setRaw((j.data as InstitutionalDay[]) ?? [])
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

  // 依所選區間計算累計買賣超（區間起點歸零）
  const series = useMemo(() => {
    if (!raw || raw.length === 0) return null
    const lastMs = new Date(raw[raw.length - 1].date).getTime()
    const cutoff = new Date(lastMs - rangeCalendarDays[range] * 86400000).toISOString().slice(0, 10)
    const inRange = raw.filter((d) => d.date >= cutoff)
    if (inRange.length === 0) return null

    let cf = 0
    let ct = 0
    let cd = 0
    const foreign: LineData[] = []
    const trust: LineData[] = []
    const dealer: LineData[] = []
    for (const d of inRange) {
      cf += d.foreign
      ct += d.trust
      cd += d.dealer
      foreign.push({ time: d.date, value: cf })
      trust.push({ time: d.date, value: ct })
      dealer.push({ time: d.date, value: cd })
    }
    return {
      foreign,
      trust,
      dealer,
      last: { date: inRange[inRange.length - 1].date, foreign: cf, trust: ct, dealer: cd },
    }
  }, [raw, range])

  useEffect(() => {
    if (!chartRef.current || !series) return

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

    const mkLine = (color: string) =>
      chart.addLineSeries({ color, lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
    const fSeries = mkLine('#3b82f6') // 外資
    fSeries.setData(series.foreign)
    const tSeries = mkLine('#f97316') // 投信
    tSeries.setData(series.trust)
    const dSeries = mkLine('#a78bfa') // 自營
    dSeries.setData(series.dealer)

    // 零基準線（虛線）
    const zero = chart.addLineSeries({
      color: '#64748b',
      lineWidth: 1,
      lineStyle: 2,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })
    zero.setData(series.foreign.map((d) => ({ time: d.time, value: 0 })))

    chart.timeScale().fitContent()

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHover(null)
        return
      }
      const f = param.seriesData.get(fSeries) as LineData | undefined
      const t = param.seriesData.get(tSeries) as LineData | undefined
      const d = param.seriesData.get(dSeries) as LineData | undefined
      if (f && t && d) {
        setHover({
          date: String(param.time),
          foreign: f.value as number,
          trust: t.value as number,
          dealer: d.value as number,
        })
      }
    })

    const ro = new ResizeObserver(() => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth })
    })
    ro.observe(chartRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [series, height])

  // 讀值：滑鼠移動時顯示該點累計；否則顯示區間最新累計
  const legend = hover ?? series?.last ?? null

  return (
    <div className="bg-[#1a1a2e] rounded-lg p-2 md:p-4">
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm md:text-base font-medium">三大法人累計買賣超</span>
          <span className="text-gray-400 text-xs">（張，區間起點歸零）</span>
        </div>
        <div className="flex gap-1 md:gap-2 md:ml-auto">
          {(['1M', '3M', '6M', '1Y'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 md:px-3 py-1 md:py-1.5 text-sm md:text-base font-medium rounded min-h-[36px] ${
                range === r ? 'bg-green-600 text-white' : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'
              }`}
            >
              {rangeLabel[r]}
            </button>
          ))}
        </div>
      </div>

      {/* 圖例 + 讀值 */}
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-sm font-mono">
          {hover && <span className="text-gray-400">{hover.date}</span>}
          <span className="text-blue-400">外資 {fmtLots(legend.foreign)}</span>
          <span className="text-orange-400">投信 {fmtLots(legend.trust)}</span>
          <span className="text-purple-400">自營 {fmtLots(legend.dealer)}</span>
        </div>
      )}

      {raw === null && !error && <div className="text-gray-400 text-sm py-12 text-center">載入中…</div>}
      {error && <div className="text-gray-400 text-sm py-12 text-center">法人資料載入失敗</div>}
      {raw && raw.length === 0 && <div className="text-gray-400 text-sm py-12 text-center">無三大法人資料</div>}
      <div ref={chartRef} style={{ display: series ? 'block' : 'none' }} />
    </div>
  )
}

// 買賣超顯示：正數加 +，千分位
function fmtLots(v: number): string {
  const s = Math.round(v).toLocaleString()
  return v > 0 ? `+${s}` : s
}
