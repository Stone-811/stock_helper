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
import { computeSignals } from '../../lib/signals'

interface Quote {
  stock_id: string
  stock_name: string
  open: number
  close: number
  volume: number
  macd_status?: string
  foreign_streak?: number
  trust_streak?: number
}

interface WatchlistStock extends WatchlistItem {
  latestData?: Quote
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
          <span className="text-gray-500">自選股數量：</span>
          <span className="font-bold text-blue-600">{stocks.length}</span>
          <span className="text-gray-500"> 檔</span>
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
                const change = stock.latestData
                  ? stock.latestData.close - stock.latestData.open
                  : 0
                const changePercent = stock.latestData && stock.latestData.open > 0
                  ? (change / stock.latestData.open) * 100
                  : 0
                const isPositive = change >= 0

                return (
                  <div key={stock.stock_id} className="bg-white rounded-lg shadow-sm p-4">
                    <div className="flex justify-between items-start mb-2">
                      <Link href={`/stock/${stock.stock_id}`} className="flex-1">
                        <div className="font-bold text-gray-900">{stock.stock_id}</div>
                        <div className="text-sm text-gray-500 truncate max-w-[120px]">{stock.stock_name}</div>
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
                    {(() => {
                      const sigs = computeSignals(stock.latestData)
                      return sigs.length ? (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {sigs.map((s, i) => (
                            <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-orange-50 text-orange-700">{s.icon} {s.text}</span>
                          ))}
                        </div>
                      ) : null
                    })()}
                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <span className="text-sm text-gray-500">
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

            {/* 桌面版：表格佈局 */}
            <div className="hidden md:block bg-white rounded-lg shadow-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">股票</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">收盤價</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">漲跌</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">成交量</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {stocks.map((stock) => {
                    const change = stock.latestData
                      ? stock.latestData.close - stock.latestData.open
                      : 0
                    const changePercent = stock.latestData && stock.latestData.open > 0
                      ? (change / stock.latestData.open) * 100
                      : 0
                    const isPositive = change >= 0

                    return (
                      <tr key={stock.stock_id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/stock/${stock.stock_id}`}
                            className="hover:text-blue-600"
                          >
                            <div className="font-medium text-gray-900">{stock.stock_name}</div>
                            <div className="text-sm text-gray-500">{stock.stock_id}</div>
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-medium ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                            {stock.latestData?.close.toFixed(2) || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={isPositive ? 'text-red-600' : 'text-green-600'}>
                            {stock.latestData ? (
                              <>
                                {isPositive ? '+' : ''}{change.toFixed(2)}
                                <span className="text-sm ml-1">
                                  ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
                                </span>
                              </>
                            ) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {stock.latestData?.volume.toLocaleString() || '-'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleRemove(stock.stock_id)}
                            className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
