'use client'

import { useId, useMemo, type ReactNode } from 'react'
import SentimentChart from './SentimentChart'
import { DaytradeStats, MarginStats, VixStats } from './MoodStats'
import { statOf, thousandsToYi, type SentimentResponse } from '../lib/sentiment'

/**
 * 市場溫度的三組內容（大盤當沖比、融資融券、恐慌指數：每組大卡＋走勢圖）與「📖 說明」。
 * 放在首頁（2026-11-06 業主：「市場溫度的融資融卷、走勢圖也放在首頁」；同一天 /market-mood 頁拿掉、轉到首頁）。
 *
 * - data 為 null（抓不到）時每張卡顯示「暫無資料」、圖顯示無資料，不顯示 0。
 * - 標題層級：首頁 h1「今日市場」→ h2「🌡️ 市場溫度」→ 這三組 h3 → 圖的小標 h4。
 * - 業主的決定：不貼「偏高／偏低」標籤；上市藍、上櫃琥珀（紅綠在本站代表股價漲跌）。
 */
const TWSE = '#1d4ed8' // 上市：藍
const TPEX = '#b45309' // 上櫃：琥珀（白底對比 4.9，不用紅綠——紅綠在本站代表股價漲跌）

/**
 * 兩張走勢圖並排、各佔一半（2026-11-06 業主：「圖表平行擺放，各佔50%」）。
 * 依這一塊自己的寬度排（container query）：≥44rem（704px）才並排＝側欄展開約視窗 992、收合約 816 以上
 * （820／834 直拿 iPad 收合側欄時也會並排）；手機與 768 平板上下排——一半寬在手機只剩約 170px，圖和區間按鈕都看不清楚。
 * 只有一張的當沖比圖維持全寬。
 */
function ChartPair({ children }: { children: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @min-[44rem]:grid-cols-2">{children}</div>
    </div>
  )
}

export default function MarketMoodSections({ data }: { data: SentimentResponse | null }) {
  const uid = useId()
  const hCls = 'text-lg font-bold text-gray-900 mb-3'

  const s = useMemo(() => {
    const dt = data?.daytrade ?? [], mg = data?.margin ?? [], tv = data?.taivix ?? [], vx = data?.vix ?? []
    return {
      dtTwse: statOf(dt, (r) => r.twse_buy_pct),
      dtTpex: statOf(dt, (r) => r.tpex_buy_pct),
      mgTwse: statOf(mg, (r) => thousandsToYi(r.twse_margin_balance)),
      mgTpex: statOf(mg, (r) => thousandsToYi(r.tpex_margin_balance)),
      shTwse: statOf(mg, (r) => r.twse_short_lots),
      shTpex: statOf(mg, (r) => r.tpex_short_lots),
      taivix: statOf(tv, (r) => r.close),
      vix: statOf(vx, (r) => r.close),
    }
  }, [data])

  const dtSeries = useMemo(() => [
    { key: 'twse', label: '上市', color: TWSE, points: (data?.daytrade ?? []).map((r) => ({ date: r.date, value: r.twse_buy_pct })) },
    { key: 'tpex', label: '上櫃', color: TPEX, points: (data?.daytrade ?? []).map((r) => ({ date: r.date, value: r.tpex_buy_pct })) },
  ], [data])
  const mgSeries = useMemo(() => [
    { key: 'twse', label: '上市', color: TWSE, points: (data?.margin ?? []).map((r) => ({ date: r.date, value: thousandsToYi(r.twse_margin_balance) })) },
    { key: 'tpex', label: '上櫃', color: TPEX, points: (data?.margin ?? []).map((r) => ({ date: r.date, value: thousandsToYi(r.tpex_margin_balance) })) },
  ], [data])
  const shSeries = useMemo(() => [
    { key: 'twse', label: '上市', color: TWSE, points: (data?.margin ?? []).map((r) => ({ date: r.date, value: r.twse_short_lots })) },
    { key: 'tpex', label: '上櫃', color: TPEX, points: (data?.margin ?? []).map((r) => ({ date: r.date, value: r.tpex_short_lots })) },
  ], [data])
  const tvSeries = useMemo(() => [
    { key: 'tv', label: '臺指VIX', color: TWSE, points: (data?.taivix ?? []).map((r) => ({ date: r.date, value: r.close })) },
  ], [data])
  const vxSeries = useMemo(() => [
    { key: 'vx', label: '美股 VIX', color: '#6d28d9', points: (data?.vix ?? []).map((r) => ({ date: r.date, value: r.close })) },
  ], [data])

  const taivixFrom = data?.first?.taivix ?? null

  return (
    <>
      {/* 1. 當沖比 */}
      <section aria-labelledby={`${uid}-dt-h`}>
        <h3 id={`${uid}-dt-h`} className={hCls}>大盤當沖比（占成交金額）</h3>
        <div className="mb-4"><DaytradeStats twse={s.dtTwse} tpex={s.dtTpex} /></div>
        <div className="bg-white rounded-lg shadow-sm p-4">
          <SentimentChart series={dtSeries} digits={1} unit="%" />
        </div>
      </section>

      {/* 2. 融資融券 */}
      <section aria-labelledby={`${uid}-mg-h`}>
        <h3 id={`${uid}-mg-h`} className={hCls}>融資餘額、融券餘額</h3>
        <div className="mb-4"><MarginStats mgTwse={s.mgTwse} mgTpex={s.mgTpex} shTwse={s.shTwse} shTpex={s.shTpex} /></div>
        <ChartPair>
          <div className="bg-white rounded-lg shadow-sm p-4 min-w-0">
            <h4 className="text-base font-medium text-gray-900 mb-2">融資餘額走勢（億元）</h4>
            <SentimentChart series={mgSeries} digits={0} unit="億" />
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 min-w-0">
            <h4 className="text-base font-medium text-gray-900 mb-2">融券餘額走勢（張）</h4>
            <SentimentChart series={shSeries} digits={0} unit="張" />
          </div>
        </ChartPair>
      </section>

      {/* 3. 恐慌指數 */}
      <section aria-labelledby={`${uid}-vix-h`}>
        <h3 id={`${uid}-vix-h`} className={hCls}>恐慌指數</h3>
        <div className="mb-4"><VixStats taivix={s.taivix} vix={s.vix} taivixFrom={taivixFrom} /></div>
        <ChartPair>
          <div className="bg-white rounded-lg shadow-sm p-4 min-w-0">
            <h4 className="text-base font-medium text-gray-900 mb-2">台股恐慌指數走勢</h4>
            <SentimentChart series={tvSeries} digits={2} />
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 min-w-0">
            <h4 className="text-base font-medium text-gray-900 mb-2">美股恐慌指數走勢</h4>
            <SentimentChart series={vxSeries} digits={2} />
          </div>
        </ChartPair>
      </section>

      <details className="bg-white rounded-lg shadow-sm">
        <summary className="min-h-[48px] flex items-center px-4 text-base font-medium text-gray-900 cursor-pointer">📖 說明（這些數字怎麼來、什麼時候更新）</summary>
        <div className="px-4 pb-4 text-base text-gray-800 space-y-2">
          <p>當沖比、融資融券來自證交所與櫃買中心的每日統計，<strong>當天晚上才公布</strong>，晚上 10 點以前看到的是前一個交易日；官方數字兩天後才定案，網站每天會重抓最近三天。</p>
          <p>台股恐慌指數來自期貨交易所，收盤後約 16:10 公布；美股恐慌指數來自芝加哥選擇權交易所，台灣時間上午約 10:20 才有前一晚的收盤。</p>
          <p>「近一年最高最低」是跟本站存的最近 365 天比，括號裡的天數就是比較的樣本；台股恐慌指數本站從 2026 年 3 月才開始有資料，天數會比較少。</p>
          <p>這些數字描述的是市場的熱度和緊張程度，<strong>不是買賣建議</strong>：歷史上恐慌指數高的時候，之後一個月的大盤有漲有跌，沒有固定方向。</p>
        </div>
      </details>
    </>
  )
}
