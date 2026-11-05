'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader, ErrorState } from '../../components/states'
import MarketMoodSections from '../../components/MarketMoodSections'
import type { SentimentResponse } from '../../lib/sentiment'

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
 * 手機底部導覽沒有這一頁；入口是電腦側欄。2026-11-06 起首頁也放同一份內容（MarketMoodSections）。
 * 頁首要有大字標題與 ≥44px 的「← 回首頁」。
 *
 * ⚠️ 這頁的 fetch 獨立於首頁；缺任何一組都只讓那張卡顯示「暫無資料」，不可整頁變錯誤畫面。
 * ⚠️ 當沖與融資是「當日晚間」公布：22:00 前看到的是前一個交易日。每個數字旁都有日期，說明也寫了。
 * ------------------------------------------------------------------ */

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



  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="市場溫度" />

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
            <MarketMoodSections data={data} level={2} />
          </>
        )}
      </div>
    </div>
  )
}
