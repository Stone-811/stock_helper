'use client'

import { useEffect, useState } from 'react'
import IndexChartDialog, { type IndexTab } from '../IndexChartDialog'
import { DASH } from '../../lib/format'
import { fmtMd } from '../../lib/sentiment'
import { fmtPoints, type IndexResponse } from '../../lib/market-index'

/**
 * 首頁最上面那張卡：加權指數＋美股三大指數（費半、S&P 500、道瓊），四格均分寬度
 * （2026-11-06 業主：「四個指數均分寬度」）。
 *
 * - 依這張卡自己的寬度排（container query）：≥40rem 四格一排，不夠寬就 2×2；量過 320px 的 2×2 數字不出框。
 * - 加權指數那格是按鈕，點了打開指數走勢彈跳視窗（業主：首頁的線圖區塊「改成用點擊台指大盤彈跳視窗顯示」）。
 * - 美股：自己 fetch、自己失敗（一檔抓不到只那格「—」）；?last=2 只要最新與前一筆。
 *   日期是美東交易日，標「美股 M/D 收盤」；漲跌跟美股前一個交易日收盤比，紅漲綠跌（台股慣例）。
 */
const US_INDICES: { id: 'SOX' | 'SPX' | 'DJI'; label: string }[] = [
  { id: 'SOX', label: '費半' },
  { id: 'SPX', label: 'S&P 500' },
  { id: 'DJI', label: '道瓊' },
]

export default function MarketIndexCard({ taiex, tx }: { taiex: IndexResponse | null; tx: IndexResponse | null }) {
  const [us, setUs] = useState<Record<string, IndexResponse | null>>({})
  const [tab, setTab] = useState<IndexTab | null>(null)

  useEffect(() => {
    let alive = true
    US_INDICES.forEach(({ id }) => {
      fetch(`/api/market-index/${id}?last=2`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive) setUs((d) => ({ ...d, [id]: j })) })
        .catch(() => { if (alive) setUs((d) => ({ ...d, [id]: null })) })
    })
    return () => { alive = false }
  }, [])

  const canOpen = !!(taiex || tx)
  return (
    <section aria-label="加權指數與美股三大指數" className="bg-white rounded-lg shadow-sm p-4 md:p-6">
      <div className="@container">
        <div className="grid grid-cols-2 gap-2 md:gap-3 @min-[40rem]:grid-cols-4">
          <button
            type="button"
            onClick={() => setTab(taiex ? 'TAIEX' : 'TX')}
            disabled={!canOpen}
            aria-haspopup="dialog"
            className="min-w-0 rounded-lg bg-blue-50 px-3 py-2 text-left ring-1 ring-blue-200 transition-colors hover:bg-blue-100 hover:ring-blue-400 disabled:cursor-default disabled:bg-gray-50 disabled:ring-0"
          >
            <IndexFigures label="加權指數" d={taiex} loaded date={(iso) => `${fmtMd(iso)} 收盤`} />
            {canOpen && <span className="mt-1 block text-sm font-medium text-blue-700"><span aria-hidden="true">📈 </span>看走勢圖</span>}
          </button>
          {US_INDICES.map(({ id, label }) => (
            <div key={id} className="min-w-0 rounded-lg bg-gray-50 px-3 py-2">
              <IndexFigures label={label} d={us[id]} loaded={id in us} date={(iso) => `美股 ${fmtMd(iso)} 收盤`} />
            </div>
          ))}
        </div>
      </div>
      <IndexChartDialog tab={tab} onTab={setTab} onClose={() => setTab(null)} taiex={taiex} tx={tx} />
    </section>
  )
}

/** 一格的內容：名稱、點數、漲跌（點數與 %）、日期。用 span（加權那格在 button 裡，button 只能放行內元素）。 */
function IndexFigures({
  label,
  d,
  loaded,
  date,
}: {
  label: string
  d: IndexResponse | null | undefined
  loaded: boolean
  date: (iso: string) => string
}) {
  const up = (d?.change ?? 0) >= 0
  const cls = !d ? 'text-gray-600' : up ? 'text-red-600' : 'text-green-700'
  return (
    <>
      <span className="block text-base font-medium text-gray-800 truncate">{label}</span>
      {d ? (
        <>
          <span className={`block text-xl @min-[40rem]:text-2xl font-bold tabular-nums leading-tight ${cls}`}>{fmtPoints(d.latest.close)}</span>
          <span className={`block text-sm @min-[40rem]:text-base font-semibold tabular-nums ${cls}`}>
            <span className="whitespace-nowrap"><span aria-hidden="true">{up ? '▲' : '▼'} </span>{up ? '+' : ''}{d.change.toFixed(2)}</span>{' '}
            <span className="whitespace-nowrap">({up ? '+' : ''}{d.changePercent.toFixed(2)}%)</span>
          </span>
          <span className="block text-sm text-gray-700">{date(d.latest.date)}</span>
        </>
      ) : (
        <>
          <span className="block text-xl font-bold text-gray-600" aria-hidden="true">{loaded ? DASH : '…'}</span>
          <span className="block text-sm text-gray-700">{loaded ? '暫無資料' : '載入中'}</span>
        </>
      )}
    </>
  )
}
