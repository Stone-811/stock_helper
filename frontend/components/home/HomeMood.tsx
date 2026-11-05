'use client'

import { useEffect, useState } from 'react'
import MarketMoodSections from '../MarketMoodSections'
import type { SentimentResponse } from '../../lib/sentiment'

/**
 * 首頁的市場溫度（2026-11-05「首頁不要放今日強勢股，把大盤當沖比、恐慌指數展開放上」「補上美國恐慌指數」；
 * 2026-11-06「市場溫度的融資融卷、走勢圖也放在首頁」）＝跟 /market-mood 同一份 MarketMoodSections。
 *
 * - ?days=400：卡片要算「近一年最高最低」、走勢圖要 1 年；跟 /market-mood 同一個網址，CDN 共用快取。
 * - ⚠️ 自己 fetch、自己失敗：不可併進首頁 load()（任一 reject 會把整頁變錯誤畫面）。抓不到時每張卡「暫無資料」，不顯示 0。
 */
export default function HomeMood() {
  const [data, setData] = useState<SentimentResponse | null | undefined>(undefined) // undefined=載入中、null=失敗
  useEffect(() => {
    let alive = true
    fetch('/api/market-sentiment?days=400')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('http'))))
      .then((j) => { if (alive) setData(j) })
      .catch(() => { if (alive) setData(null) })
    return () => { alive = false }
  }, [])

  return (
    <section aria-labelledby="home-mood-h" className="space-y-6">
      <h2 id="home-mood-h" className="text-xl font-bold text-gray-900">🌡️ 市場溫度</h2>
      {data === undefined ? (
        <div className="space-y-3" role="status" aria-label="市場溫度載入中">
          <div className="h-40 bg-white rounded-lg shadow-sm animate-pulse" />
          <div className="h-40 bg-white rounded-lg shadow-sm animate-pulse" />
        </div>
      ) : (
        <>
          {data === null && <p className="text-base text-gray-700">暫時抓不到市場溫度資料，請稍後重新整理。</p>}
          <MarketMoodSections data={data} level={3} />
        </>
      )}
    </section>
  )
}
