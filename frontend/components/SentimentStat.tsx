import type { ReactNode } from 'react'
import InfoTip from './InfoTip'
import { DASH } from '../lib/format'
import { DELTA_ARROW, deltaDir, deltaText, fmtMd, type Stat } from '../lib/sentiment'

/**
 * 市場溫度的一張指標卡：大字數字、資料日期、跟前一天比、近一年最高最低。
 *
 * 業主 2026-11-05 選「不貼偏高／偏低標籤」，所以這裡沒有等級、沒有紅綠：
 * 箭頭與差值用中性深灰（紅綠在本站代表股價漲跌，當沖比變高不是「漲」）。
 * 缺值顯示 DASH，絕不顯示 0。
 */
export default function SentimentStat({
  title,
  stat,
  digits,
  unit,
  deltaUnit,
  tip,
  tipTitle,
  dateNote,
  size = 'md',
}: {
  title: string
  stat: Stat | null
  digits: number
  /** 數字後綴（'%'、' 億'） */
  unit: string
  deltaUnit: '個百分點' | '' | '億元' | '張'
  tipTitle: string
  tip: ReactNode
  /** 日期旁的補充（例如「美股收盤」） */
  dateNote?: string
  size?: 'md' | 'lg'
}) {
  const fmt = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const num = size === 'lg' ? 'text-4xl md:text-5xl' : 'text-3xl md:text-4xl'
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 md:p-5 flex flex-col gap-1 min-w-0">
      <div className="text-base text-gray-700">
        {title}
        <InfoTip title={tipTitle}>{tip}</InfoTip>
      </div>
      {stat ? (
        <>
          <div className={`${num} font-bold tabular-nums text-gray-900 leading-tight`}>
            {fmt(stat.value)}
            <span className="text-xl md:text-2xl font-semibold">{unit}</span>
          </div>
          <div className="text-base text-gray-700">
            {fmtMd(stat.date)}{dateNote ? `（${dateNote}）` : ''}
            {stat.delta != null && (
              <span className="ml-2 text-gray-900 tabular-nums">
                <span aria-hidden="true">{DELTA_ARROW[deltaDir(stat.delta, digits)!]} </span>
                {deltaText(stat.delta, deltaUnit, digits)}
              </span>
            )}
          </div>
          {stat.yearHigh && stat.yearLow && (
            <div className="text-sm text-gray-700 tabular-nums">
              近一年（{stat.yearDays} 天）最高 {fmt(stat.yearHigh.value)}{unit}（{fmtMd(stat.yearHigh.date)}）、最低 {fmt(stat.yearLow.value)}{unit}（{fmtMd(stat.yearLow.date)}）
            </div>
          )}
        </>
      ) : (
        <div className={`${num} font-bold text-gray-600`}>
          <span aria-hidden="true">{DASH}</span>
          <span className="sr-only">無資料</span>
          <span className="block text-base font-normal text-gray-700">暫無資料</span>
        </div>
      )}
    </div>
  )
}
