'use client'

import { useEffect, useId, useRef } from 'react'
import IndexChart from './IndexChart'
import { DASH } from '../lib/format'
import type { IndexResponse } from '../lib/market-index'

export type IndexTab = 'TAIEX' | 'TX'

/**
 * 指數走勢彈跳視窗（2026-11-06 業主：首頁原本的「指數走勢」線圖區塊「改成用點擊台指大盤彈跳視窗顯示」）。
 * 首頁點「加權指數」那格打開；裡面保留「加權指數／台指期」切換，台指期沒有因此消失。
 *
 * - 用原生 <dialog>.showModal()：焦點會被關在視窗裡、Esc 會關、背景不能點，不用自己寫焦點陷阱。
 * - 線圖只在打開時才掛載（lightweight-charts 依掛載當下的寬度建圖，藏起來的 dialog 寬度是 0）。
 * - 背景捲動用 globals.css 的 html:has(dialog[open]) 鎖，不用 JS 改 body.style：
 *   CandleChart 的全螢幕離開時會把 body.style.overflow 清成 ''，JS 鎖會被它洗掉。
 * - tab 由父層控制：null＝關閉。
 */
export default function IndexChartDialog({
  tab,
  onTab,
  onClose,
  taiex,
  tx,
}: {
  tab: IndexTab | null
  onTab: (t: IndexTab) => void
  onClose: () => void
  taiex: IndexResponse | null
  tx: IndexResponse | null
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const hid = useId()
  const open = tab != null

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const active = tab === 'TX' ? tx : taiex
  const tabs: { id: IndexTab; label: string; data: IndexResponse | null }[] = [
    { id: 'TAIEX', label: '加權指數', data: taiex },
    { id: 'TX', label: '台指期', data: tx },
  ]

  return (
    <dialog
      ref={ref}
      aria-labelledby={hid}
      onClose={onClose}
      // 點到視窗外的暗色背景（事件目標是 dialog 本身）就關；內容區包在 div 裡，點裡面不會關
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      className="m-0 h-full max-h-none w-full max-w-none bg-gray-50 p-0 backdrop:bg-black/60 md:m-auto md:h-auto md:max-h-[95vh] md:w-[min(1200px,95vw)] md:rounded-lg"
    >
      {open && (
        <div className="space-y-3 p-3 md:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={hid} className="text-xl md:text-2xl font-bold text-gray-900">指數走勢</h2>
              <p className="text-sm text-gray-700">
                加權指數：全體上市股票依市值加權計算的大盤指數。漲跌以前一交易日收盤為基準。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 inline-flex min-h-[48px] items-center gap-1 rounded-lg border border-gray-400 bg-white px-4 text-base font-medium text-gray-900 hover:border-blue-400"
            >
              <span aria-hidden="true">✕</span> 關閉
            </button>
          </div>
          <div className="flex gap-2" role="group" aria-label="選擇指數">
            {tabs.filter((t) => t.data).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTab(t.id)}
                aria-pressed={tab === t.id}
                className={`min-h-[44px] rounded-lg px-5 font-medium transition-colors ${tab === t.id ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 shadow-sm hover:bg-gray-100'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {active ? (
            <>
              <IndexStatStrip data={active} showOpenInterest={tab === 'TX'} />
              <div className="overflow-hidden rounded-lg bg-white shadow-sm">
                <IndexChart data={active.history} indexId={active.index_id} height={520} />
              </div>
            </>
          ) : (
            <p className="text-base text-gray-700">這個指數暫時抓不到資料，請稍後重新整理。</p>
          )}
        </div>
      )}
    </dialog>
  )
}

/** 指數數據列：收盤、漲跌、開高低量（台指期多未平倉）、資料日期。缺值（null）顯示 DASH，不顯示 0。 */
function IndexStatStrip({ data, showOpenInterest = false }: { data: IndexResponse; showOpenInterest?: boolean }) {
  const isPositive = data.change >= 0
  const color = isPositive ? 'text-red-600' : 'text-green-600'
  const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString() : DASH)
  return (
    <div className="bg-white rounded-lg shadow-sm px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
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
