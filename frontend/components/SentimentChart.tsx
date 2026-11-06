'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createChart, ColorType, type LineData, type Time } from 'lightweight-charts'
import { DASH } from '../lib/format'
import { fmtMd } from '../lib/sentiment'

type Range = '1M' | '3M' | '6M' | '1Y'
const RANGE_DAYS: Record<Range, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366 }
const RANGE_LABEL: Record<Range, string> = { '1M': '1月', '3M': '3月', '6M': '6月', '1Y': '1年' }

export interface SentimentSeries {
  key: string
  label: string
  color: string
  points: { date: string; value: number | null }[]
}

/**
 * 市場溫度走勢圖：一到兩條線（例如上市／上櫃當沖比），淺色底、大字。
 *
 * 刻意獨立一張簡單的圖，不塞進 CandleChart：那張是 K 線＋多子圖同步的架構，改動回歸風險最高（SKILL.md）。
 * - 區間從**資料最後一天**往回算日曆天（跟籌碼圖一樣），不是從今天算。
 * - 缺值（null）的日子直接跳過、線不補 0；同一天兩條線只要一條有值就畫。
 * - ⚠️ `vertTouchDrag: false`＋不可縮放：手機上手指在圖上滑要能捲整頁（K 線圖吃掉整頁捲動是 CLAUDE.md 的已知限制，這裡不重蹈）。
 * - 讀值放在圖**外**（上方一列）：手指停在哪天就顯示那天，放開回到最後一天；視力不佳者不必看圖上的小字。
 */
export default function SentimentChart({
  series,
  height = 260,
  digits = 1,
  unit = '',
}: {
  series: SentimentSeries[]
  height?: number
  /** 讀值小數位 */
  digits?: number
  /** 讀值後綴（'%'、'億'） */
  unit?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [range, setRange] = useState<Range>('3M')
  const [hover, setHover] = useState<string | null>(null)

  const view = useMemo(() => {
    const all = series.flatMap((s) => s.points.filter((p) => p.value != null).map((p) => p.date))
    if (!all.length) return null
    const last = all.sort()[all.length - 1]
    const cutoff = new Date(new Date(`${last}T00:00:00Z`).getTime() - RANGE_DAYS[range] * 86400000).toISOString().slice(0, 10)
    const lines = series.map((s) => ({
      ...s,
      data: s.points
        .filter((p) => p.value != null && p.date >= cutoff)
        .map((p) => ({ time: p.date as Time, value: p.value as number })) as LineData[],
    }))
    const byDate = new Map<string, Record<string, number | null>>()
    for (const s of series) {
      for (const p of s.points) {
        if (p.date < cutoff) continue
        const row = byDate.get(p.date) ?? {}
        row[s.key] = p.value
        byDate.set(p.date, row)
      }
    }
    return { lines, byDate, last }
  }, [series, range])

  useEffect(() => {
    const el = ref.current
    if (!el || !view) return
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: '#ffffff' }, textColor: '#374151', fontSize: 14 },
      width: el.clientWidth,
      height,
      grid: { vertLines: { color: '#e5e7eb' }, horzLines: { color: '#e5e7eb' } },
      crosshair: { mode: 1, vertLine: { color: '#6b7280', width: 1, style: 2 }, horzLine: { visible: false, labelVisible: false } },
      rightPriceScale: { borderColor: '#d1d5db', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#d1d5db', timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false, axisDoubleClickReset: false },
    })
    for (const ln of view.lines) {
      const s = chart.addLineSeries({ color: ln.color, lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerRadius: 5 })
      s.setData(ln.data)
    }
    chart.timeScale().fitContent()
    chart.subscribeCrosshairMove((p) => setHover(p.time ? String(p.time) : null))
    // 寬度變了要重新 fitContent：lightweight-charts 縮窄時會把最右邊幾根推出畫面，而這張圖關了捲動／縮放、拉不回來（審查 F1）
    const ro = new ResizeObserver(() => { chart.applyOptions({ width: el.clientWidth }); chart.timeScale().fitContent() })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [view, height])

  const readDate = hover && view?.byDate.has(hover) ? hover : view?.last ?? null
  const read = readDate ? view?.byDate.get(readDate) : undefined

  return (
    <div>
      {/* 控制列：區間（≥44px） */}
      <div className="flex flex-wrap items-center gap-2 mb-2" role="group" aria-label="走勢區間">
        {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            onClick={() => setRange(r)}
            className={`min-h-[44px] min-w-[44px] px-4 rounded-lg text-base font-medium border transition-colors ${
              range === r ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-400 hover:border-blue-400'
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {/* 讀值列（圖外）：停在哪天就是哪天，沒停就是最後一天 */}
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 mb-2 text-base tabular-nums min-h-[1.75rem]" aria-live="polite">
        {readDate ? (
          <>
            <span className="text-gray-700">{fmtMd(readDate)}</span>
            {series.map((s) => {
              const v = read?.[s.key]
              return (
                <span key={s.key} className="text-gray-900">
                  <span className="inline-block w-3 h-3 rounded-sm mr-1 align-middle" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}{' '}
                  <strong>{v == null ? DASH : `${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${unit}`}</strong>
                </span>
              )
            })}
          </>
        ) : (
          <span className="text-gray-700">沒有可畫的資料</span>
        )}
      </div>

      <div ref={ref} style={{ height }} className={view ? '' : 'hidden'} aria-hidden="true" />
      {view && <p className="mt-1 text-sm text-gray-700">電腦：滑鼠移到圖上看某一天；手機：長按圖再左右滑。</p>}
      {!view && <div className="flex items-center justify-center text-gray-700" style={{ height }}>暫無資料</div>}
    </div>
  )
}
