'use client'

import { useCallback, useEffect, useState } from 'react'
import { PageHeader, ErrorState } from '../components/states'
import MarketIndexCard from '../components/home/MarketIndexCard'
import HomeMood from '../components/home/HomeMood'
import type { IndexResponse } from '../lib/market-index'

/**
 * 首頁「今日市場」（2026-11-05／11-06 業主在聊天裡逐項改的）：
 *  1. 加權指數＋美股三大指數，四格均分寬度；點加權指數 → 指數走勢彈跳視窗（加權／台指期）
 *  2. 市場溫度：當沖比、融資融券、恐慌指數的大卡＋走勢圖（跟 /market-mood 同一份元件）
 * 已拿掉：今日強勢股（11-05）、我的自選（11-06「不用這個功能」）、頁面下方的指數走勢線圖（改成彈跳視窗）。
 *
 * ⚠️ 加權／台指期抓不到時只讓上面那張卡變錯誤訊息（有「重新載入」），市場溫度照常顯示：兩塊各自 fetch、各自失敗。
 */
export default function Home() {
  const [taiex, setTaiex] = useState<IndexResponse | null>(null)
  const [tx, setTx] = useState<IndexResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [taiexRes, txRes] = await Promise.all([
        fetch('/api/market-index/TAIEX'),
        fetch('/api/market-index/TX'),
      ])
      if (taiexRes.ok) setTaiex(await taiexRes.json())
      if (txRes.ok) setTx(await txRes.json())
      if (!taiexRes.ok && !txRes.ok) throw new Error('無法取得指數資料')
    } catch (err) {
      console.error('Failed to fetch:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="今日市場" />
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-8">
        {loading ? (
          <div className="h-36 bg-white rounded-lg shadow-sm animate-pulse" role="status" aria-label="指數載入中" />
        ) : error ? (
          <ErrorState message="加權指數與台指期暫時抓不到，請稍後重新載入。" onRetry={load} />
        ) : (
          <MarketIndexCard taiex={taiex} tx={tx} />
        )}
        <HomeMood />
      </div>
    </div>
  )
}
