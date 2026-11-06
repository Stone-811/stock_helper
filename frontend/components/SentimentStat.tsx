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
  // 手機上六張卡都一排兩張（2026-11-06 業主：「上市融資、上櫃融資同一排，各佔版面50%」→「當沖、恐慌指數也要並排」）。
  // md 卡（融資融券）數字會長到「277,051 張」，要跟著卡寬縮；lg 卡（當沖比、恐慌指數）最長「88.8%」「88.88」＝2.78 倍字級，
  // 用 min(36px, 34cqi)：320 寬以上（卡片內容 ≥114px）一律 36px、跟以前一樣；只有字放大到約 150% 以上（畫面剩 ~260px）才縮，免得數字超出卡片（審查 F1）。
  // @container 六張卡都加（lg 卡沒用到 cqi）；實測不影響 InfoTip 的 fixed 泡泡位置。
  // 數字依卡片內容寬縮放：min(30px, 19.5cqi)。量過「277,051 張」單行寬＝4.98 倍字級（單位 0.75em），
  // 19.5cqi 留 3% 餘裕 → 320～430 寬都不會把「張」擠到下一行；412 以上就是原本的 30px（text-3xl）。
  // 單位 0.75em＝原本 text-xl（22.4px）÷ text-3xl（30px）。用 max-md 限定：平板、電腦的字級跟以前一模一樣。
  // 內距手機 p-3（原本 p-4）：多 8px 讓 375 寬的標題「上市融資餘額」跟 ⓘ 留在同一行（需要 138px）。平板、電腦照舊 p-5。
  const num = size === 'lg' ? 'max-md:text-[length:min(2.25rem,34cqi)] md:text-5xl' : 'max-md:text-[length:min(1.875rem,19.5cqi)] md:text-4xl'
  // lg 單位 0.6222em＝原本 text-xl（22.4px）÷ text-4xl（36px）
  const unitCls = size === 'lg' ? 'max-md:text-[0.6222em] md:text-2xl' : 'max-md:text-[0.75em] md:text-2xl'
  // 標題括號那段不拆開：「台股恐慌指數（臺指VIX）」在半寬卡片放不下一行時，從「（」前面折，不會變成「（臺」「指VIX）」。
  // 只在卡片內容寬 ≥6.5rem（「（臺指VIX）」約 97px）時不拆，字放大到卡片比它還窄時照常折行、不超框。
  const paren = title.indexOf('（')
  return (
    <div className="@container bg-white rounded-lg shadow-sm p-3 md:p-5 flex flex-col gap-1 min-w-0">
      <div className="text-base text-gray-700">
        {paren > 0 ? <>{title.slice(0, paren)}<span className="@min-[6.5rem]:whitespace-nowrap">{title.slice(paren)}</span></> : title}
        <InfoTip title={tipTitle}>{tip}</InfoTip>
      </div>
      {stat ? (
        <>
          <div className={`${num} font-bold tabular-nums text-gray-900 leading-tight`}>
            {fmt(stat.value)}
            <span className={`${unitCls} font-semibold`}>{unit}</span>
          </div>
          <div className="text-base text-gray-700">
            {fmtMd(stat.date)}{dateNote ? `（${dateNote}）` : ''}
            {stat.delta != null && (
              <span className="ml-2 text-gray-900 tabular-nums">
                <span aria-hidden="true">{DELTA_ARROW[deltaDir(stat.delta, digits)!]} </span>
                {deltaText(stat.delta, deltaUnit, digits, stat.prevDate)}
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
