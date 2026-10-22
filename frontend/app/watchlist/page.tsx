'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  auth,
  getWatchlist,
  removeFromWatchlist,
  signInWithGoogle,
  onAuthChange,
  WatchlistItem
} from '../../lib/firebase'
import { PageHeader, CardGridSkeleton, EmptyState, ErrorState } from '../../components/states'
import { NullCell, TableScroll } from '../../components/table'
import { computeSignals, type Signal } from '../../lib/signals'

interface Quote {
  stock_id: string
  stock_name: string
  open: number
  close: number
  volume: number
  prev_close?: number
  macd_status?: string
  foreign_streak?: number
  trust_streak?: number
}

interface WatchlistStock extends WatchlistItem {
  latestData?: Quote
}

/**
 * 今日訊號標籤：手機卡片與桌機表格共用這一段渲染。
 * 以前只有手機卡片有標籤、桌機表格沒有，兩邊各寫一份遲早又會長得不一樣，所以抽出來。
 * 沒有訊號時回傳 null：手機卡片維持原本「不顯示」，桌機表格由呼叫端自己補「無」。
 */
function SignalChips({ signals, className = '' }: { signals: Signal[]; className?: string }) {
  if (!signals.length) return null
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {signals.map((s, i) => (
        <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{s.icon} {s.text}</span>
      ))}
    </div>
  )
}

export default function WatchlistPage() {
  const [stocks, setStocks] = useState<WatchlistStock[]>([])
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [error, setError] = useState(false)

  const fetchWatchlist = async () => {
    setError(false)
    let data
    try {
      data = await getWatchlist()
    } catch (e) {
      console.error('Failed to load watchlist:', e)
      setError(true)
      return
    }
    if (data.length === 0) {
      setStocks([])
      return
    }

    // 一次批次取多股報價（取代逐股呼叫 /api/stock，消除 N+1）；報價失敗仍顯示清單（僅缺價格）
    try {
      const ids = data.map((d) => d.stock_id).join(',')
      const res = await fetch(`/api/quotes?ids=${ids}`)
      if (!res.ok) throw new Error('http')
      const { quotes } = await res.json()
      setStocks(data.map((item) => ({ ...item, latestData: quotes[item.stock_id] })))
    } catch {
      setStocks(data)
    }
  }

  useEffect(() => {
    const unsubscribe = onAuthChange(async (user) => {
      setIsAuthenticated(!!user)

      if (user) {
        await fetchWatchlist()
      } else {
        setStocks([])
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const handleRemove = async (stockId: string) => {
    const success = await removeFromWatchlist(stockId)
    if (success) {
      setStocks(stocks.filter(s => s.stock_id !== stockId))
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="自選股" />
        <div className="max-w-7xl mx-auto px-4 py-6"><CardGridSkeleton count={6} /></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="自選股" />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <EmptyState
            icon="🔒"
            title="請先登入"
            description="登入後即可使用自選股功能，跨裝置同步您的觀察清單"
            action={
              <button
                onClick={() => signInWithGoogle()}
                className="inline-flex items-center gap-2 min-h-[44px] px-6 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                </svg>
                Google 登入
              </button>
            }
          />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50">
        <PageHeader title="自選股" />
        <div className="max-w-7xl mx-auto px-4 py-6">
          <ErrorState
            message="無法取得自選股清單"
            onRetry={() => {
              setLoading(true)
              fetchWatchlist().finally(() => setLoading(false))
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader title="自選股" />

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 統計資訊 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <span className="text-gray-700">自選股數量：</span>
          <span className="font-bold text-blue-600">{stocks.length}</span>
          <span className="text-gray-700"> 檔</span>
        </div>

        {/* 今日訊號提醒 */}
        {(() => {
          const n = stocks.filter((s) => computeSignals(s.latestData).length > 0).length
          return n > 0 ? (
            <div className="mb-4 flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-4 py-3 text-sm text-orange-800">
              <span aria-hidden="true">🔔</span>今日有 <span className="font-bold">{n}</span> 支自選股出現訊號
            </div>
          ) : null
        })()}

        {/* 股票列表 */}
        {stocks.length === 0 ? (
          <EmptyState
            icon="📋"
            title="尚未加入自選股"
            description="加入關注的股票，每天快速掌握技術與法人變化"
            action={
              <Link
                href="/strong-stocks"
                className="inline-flex items-center min-h-[44px] px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                瀏覽強勢股
              </Link>
            }
          />
        ) : (
          <>
            {/* 手機版：卡片式佈局 */}
            <div className="md:hidden space-y-3">
              {stocks.map((stock) => {
                const base = stock.latestData
                  ? (stock.latestData.prev_close && stock.latestData.prev_close > 0 ? stock.latestData.prev_close : stock.latestData.open)
                  : 0
                const change = stock.latestData ? stock.latestData.close - base : 0
                const changePercent = base > 0 ? (change / base) * 100 : 0
                const isPositive = change >= 0

                return (
                  <div key={stock.stock_id} className="bg-white rounded-lg shadow-sm p-4">
                    <div className="flex justify-between items-start mb-2">
                      <Link href={`/stock/${stock.stock_id}`} className="flex-1">
                        <div className="font-bold text-gray-900">{stock.stock_id}</div>
                        <div className="text-sm text-gray-700 truncate max-w-[120px]">{stock.stock_name}</div>
                      </Link>
                      <div className="text-right">
                        <div className={`text-lg font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                          {stock.latestData?.close.toFixed(2) || '-'}
                        </div>
                        <div className={`text-sm ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
                          {stock.latestData ? (
                            <>
                              {isPositive ? '+' : ''}{changePercent.toFixed(2)}%
                            </>
                          ) : '-'}
                        </div>
                      </div>
                    </div>
                    <SignalChips signals={computeSignals(stock.latestData)} className="mb-2" />
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-sm text-gray-700">
                        成交量 {stock.latestData?.volume.toLocaleString() || '-'}
                      </span>
                      <button
                        onClick={() => handleRemove(stock.stock_id)}
                        className="px-3 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors min-h-[44px]"
                      >
                        移除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 桌面版：表格佈局
                加了「今日訊號」欄後，md 斷點＋展開的側欄（內容區約 480px）放不下六欄 →
                溢出一律關進 TableScroll（overflow-x-auto + [contain:paint]），不可讓整頁橫捲
                （fixed Sidebar 不跟著捲，會蓋住第一欄的股名）。
                ⚠️ 這個容器裡不可放 InfoTip：fixed 泡泡會被 [contain:paint] 裁掉。 */}
            <div className="hidden md:block bg-white rounded-lg shadow-sm overflow-hidden">
              <TableScroll label="自選股表格，視窗較窄時可左右捲動">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">股票</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">收盤價</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">漲跌</th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-700">成交量</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">今日訊號</th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-700">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stocks.map((stock) => {
                      const base = stock.latestData
                        ? (stock.latestData.prev_close && stock.latestData.prev_close > 0 ? stock.latestData.prev_close : stock.latestData.open)
                        : 0
                      const change = stock.latestData ? stock.latestData.close - base : 0
                      const changePercent = base > 0 ? (change / base) * 100 : 0
                      const isPositive = change >= 0
                      const sigs = computeSignals(stock.latestData)

                      return (
                        <tr key={stock.stock_id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <Link
                              href={`/stock/${stock.stock_id}`}
                              className="hover:text-blue-600"
                            >
                              {/* nowrap：多了訊號欄後表格變寬，auto 版面會先擠能斷行的中文股名，
                                  「國泰永續高股息」會在字中間折行；寧可交給外層 TableScroll 橫捲 */}
                              <div className="font-medium text-gray-900 whitespace-nowrap">{stock.stock_name}</div>
                              <div className="text-sm text-gray-700 whitespace-nowrap">{stock.stock_id}</div>
                            </Link>
                          </td>
                          {/* 沒報價時三格一律用 NullCell「—」且不上色：原本是紅色的「-」
                              （change 為 0 時 isPositive 成立），跟訊號欄的「—」並排會像兩種意思 */}
                          <td className="px-4 py-3 text-right">
                            {stock.latestData ? (
                              <span className={`font-medium ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                                {stock.latestData.close.toFixed(2)}
                              </span>
                            ) : <NullCell title="無報價資料" />}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {stock.latestData ? (
                              <span className={isPositive ? 'text-red-600' : 'text-green-600'}>
                                {isPositive ? '+' : ''}{change.toFixed(2)}
                                <span className="text-sm ml-1">
                                  ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
                                </span>
                              </span>
                            ) : <NullCell title="無報價資料" />}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">
                            {stock.latestData ? stock.latestData.volume.toLocaleString() : <NullCell title="無報價資料" />}
                          </td>
                          {/* 三種狀態要分得出來：
                              沒報價（API 失敗或當日無此股）＝不知道有沒有訊號 → NullCell「—」
                              有報價但 MACD／連買資料不齊（新上市暖身不足、當年度年初）＝無法判斷 → NullCell「—」
                              資料齊全且沒有訊號 ＝ 確定今天沒有 → 「無」
                              （/api/quotes 已改為缺值不轉 0，才分得出後兩種）
                              空白格會被誤以為壞掉，所以兩種都不可留白。
                              whitespace-nowrap 讓單一標籤不在字中間折行（「外資連/買3日」很難讀），
                              標籤之間仍可換行；max-w 限制本欄最寬約兩個標籤，
                              免得一列有 4 個訊號就把收盤價、漲跌欄擠到折行。 */}
                          <td className="px-4 py-3">
                            {!stock.latestData ? (
                              <NullCell title="無報價資料，無法判斷今日訊號" />
                            ) : !sigs.length && (stock.latestData.macd_status == null || stock.latestData.foreign_streak == null || stock.latestData.trust_streak == null) ? (
                              <NullCell title="MACD 或法人連買資料不齊，無法判斷今日訊號" />
                            ) : sigs.length ? (
                              <SignalChips signals={sigs} className="whitespace-nowrap max-w-[18rem]" />
                            ) : (
                              <span className="text-sm text-gray-700">無</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => handleRemove(stock.stock_id)}
                              className="px-3 min-h-[44px] whitespace-nowrap text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
