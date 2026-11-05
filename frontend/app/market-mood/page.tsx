'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { PageHeader, ErrorState } from '../../components/states'
import SentimentStat from '../../components/SentimentStat'
import SentimentChart from '../../components/SentimentChart'
import { fmtMd, statOf, thousandsToYi, type SentimentResponse } from '../../lib/sentiment'

/* ------------------------------------------------------------------ *
 * 市場溫度 /market-mood（2026-11-05 業主要的新分頁）
 *
 * 四組指標，全部官方來源、每天由收集器寫進 market_sentiment/：
 *   1. 大盤當沖比（上市、上櫃各一個；官方「成交金額（買進）占比」＝新聞的當沖比）
 *   2. 融資餘額、融券餘額（上市、上櫃）
 *   3. 台股恐慌指數（臺指VIX，期交所；免費歷史只從 2026-03-02 起）
 *   4. 美股恐慌指數（VIX，CBOE；日期是美東，標「美股 M/D 收盤」）
 *
 * 業主的決定：不貼「偏高／偏低」標籤，只寫數字、跟前一天比、近一年最高最低。
 * 手機底部導覽維持 5 格（這頁不在裡面）；入口是首頁那兩行摘要與電腦側欄。
 * 所以頁首要有大字標題與 ≥44px 的「← 回首頁」。
 *
 * ⚠️ 這頁的 fetch 獨立於首頁；缺任何一組都只讓那張卡顯示「暫無資料」，不可整頁變錯誤畫面。
 * ⚠️ 當沖與融資是「當日晚間」公布：22:00 前看到的是前一個交易日。每個數字旁都有日期，說明也寫了。
 * ------------------------------------------------------------------ */

const TWSE = '#1d4ed8' // 上市：藍
const TPEX = '#b45309' // 上櫃：琥珀（白底對比 4.9，不用紅綠——紅綠在本站代表股價漲跌）

export default function MarketMoodPage() {
  const [data, setData] = useState<SentimentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/market-sentiment?days=400')
      if (!res.ok) throw new Error('http')
      setData(await res.json())
    } catch (e) {
      console.error('Failed to fetch market sentiment:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])
  const retry = () => { setLoading(true); setError(false); load() }

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
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title="市場溫度"
        subtitle={
          <>
            大盤當沖比、融資融券、恐慌指數。
            {data?.latest.daytrade && <>當沖與融資為 <strong>{fmtMd(data.latest.daytrade)}</strong> 的數字</>}
            {data?.latest.taivix && <>｜台股恐慌指數 <strong>{fmtMd(data.latest.taivix)}</strong></>}
            {data?.latest.vix && <>｜美股恐慌指數 美股 <strong>{fmtMd(data.latest.vix)}</strong> 收盤</>}
          </>
        }
      />

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-6">
        {/* 這頁不在手機底部導覽裡，所以一定要有回首頁 */}
        <Link href="/" className="inline-flex items-center min-h-[44px] px-4 rounded-lg bg-white border border-gray-400 text-base text-gray-900 hover:border-blue-400">
          ← 回首頁
        </Link>

        {error ? (
          <ErrorState message="無法取得市場溫度資料" onRetry={retry} />
        ) : loading ? (
          <div className="space-y-4" role="status" aria-label="載入中">
            <div className="h-40 bg-white rounded-lg shadow-sm animate-pulse" />
            <div className="h-40 bg-white rounded-lg shadow-sm animate-pulse" />
          </div>
        ) : (
          <>
            {/* 1. 當沖比 */}
            <section aria-labelledby="dt-h">
              <h2 id="dt-h" className="text-xl font-bold text-gray-900 mb-3">大盤當沖比（占成交金額）</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4">
                <SentimentStat
                  title="上市當沖比" stat={s.dtTwse} digits={1} unit="%" deltaUnit="個百分點" size="lg"
                  tipTitle="上市當沖比"
                  tip="證交所公布的「當日沖銷交易買進金額 ÷ 全市場成交金額」。當沖＝同一天買進又賣出。這是新聞說的「當沖比」；另一種用股數算的數字分母含 ETF 和權證，會跟著它們的成交量亂跳，所以不用。證交所當天晚上才公布，22:00 以前看到的是前一個交易日。"
                />
                <SentimentStat
                  title="上櫃當沖比" stat={s.dtTpex} digits={1} unit="%" deltaUnit="個百分點" size="lg"
                  tipTitle="上櫃當沖比"
                  tip="櫃買中心公布的「當日沖銷交易買進金額 ÷ 上櫃市場成交金額」。上櫃股票多為中小型股，當沖比通常比上市高，兩個數字不要直接相比。"
                />
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4">
                <SentimentChart series={dtSeries} digits={1} unit="%" />
              </div>
            </section>

            {/* 2. 融資融券 */}
            <section aria-labelledby="mg-h">
              <h2 id="mg-h" className="text-xl font-bold text-gray-900 mb-3">融資餘額、融券餘額</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4">
                <SentimentStat
                  title="上市融資餘額" stat={s.mgTwse} digits={0} unit=" 億" deltaUnit="億元"
                  tipTitle="融資餘額"
                  tip="投資人向券商借錢買股票、還沒還的總金額（證交所每天公布，單位換成億元）。餘額增加代表借錢買股的人變多。"
                />
                <SentimentStat
                  title="上櫃融資餘額" stat={s.mgTpex} digits={0} unit=" 億" deltaUnit="億元"
                  tipTitle="上櫃融資餘額"
                  tip="櫃買中心公布的上櫃市場融資餘額合計（億元）。"
                />
                <SentimentStat
                  title="上市融券餘額" stat={s.shTwse} digits={0} unit=" 張" deltaUnit="張"
                  tipTitle="融券餘額"
                  tip="投資人向券商借股票先賣、還沒買回的總張數（證交所每天公布）。餘額增加代表看空的人變多。這裡不含借券賣出。"
                />
                <SentimentStat
                  title="上櫃融券餘額" stat={s.shTpex} digits={0} unit=" 張" deltaUnit="張"
                  tipTitle="上櫃融券餘額"
                  tip="櫃買中心公布的上櫃市場融券餘額合計（張）。"
                />
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
                <h3 className="text-base font-medium text-gray-900 mb-2">融資餘額走勢（億元）</h3>
                <SentimentChart series={mgSeries} digits={0} unit="億" />
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-base font-medium text-gray-900 mb-2">融券餘額走勢（張）</h3>
                <SentimentChart series={shSeries} digits={0} unit="張" />
              </div>
            </section>

            {/* 3. 恐慌指數 */}
            <section aria-labelledby="vix-h">
              <h2 id="vix-h" className="text-xl font-bold text-gray-900 mb-3">恐慌指數</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-4">
                <SentimentStat
                  title="台股恐慌指數（臺指VIX）" stat={s.taivix} digits={2} unit="" deltaUnit="" size="lg"
                  tipTitle="臺指VIX"
                  tip={<>期貨交易所用臺指選擇權算出來的「市場預期未來 30 天的波動」，每天 13:45 收盤值。數字越高代表市場越緊張。{taivixFrom ? `本站自 ${fmtMd(taivixFrom)}（${taivixFrom.slice(0, 4)} 年）起統計，` : ''}更早的官方不再提供。台股的數字一向比美股高很多，兩個不能互相比。</>}
                />
                <SentimentStat
                  title="美股恐慌指數（VIX）" stat={s.vix} digits={2} unit="" deltaUnit="" size="lg" dateNote="美股收盤"
                  tipTitle="美股 VIX"
                  tip="芝加哥選擇權交易所用 S&P 500 選擇權算出的 30 天預期波動。日期是美國當地的交易日：美股 11/4 收盤等於台灣 11/5 清晨，可以當隔天台股開盤前的參考。"
                />
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
                <h3 className="text-base font-medium text-gray-900 mb-2">台股恐慌指數走勢</h3>
                <SentimentChart series={tvSeries} digits={2} />
              </div>
              <div className="bg-white rounded-lg shadow-sm p-4">
                <h3 className="text-base font-medium text-gray-900 mb-2">美股恐慌指數走勢</h3>
                <SentimentChart series={vxSeries} digits={2} />
              </div>
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
        )}
      </div>
    </div>
  )
}
