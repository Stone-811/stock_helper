'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase, getWatchlist, removeFromWatchlist, WatchlistItem, DailyStock, signInWithGoogle } from '../../lib/supabase'

interface WatchlistStock extends WatchlistItem {
  latestData?: DailyStock
}

export default function WatchlistPage() {
  const [stocks, setStocks] = useState<WatchlistStock[]>([])
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  const fetchWatchlist = async () => {
    const { data, error } = await getWatchlist()
    if (error || !data) {
      setStocks([])
      return
    }

    // Fetch latest data for each stock
    const stocksWithData = await Promise.all(
      data.map(async (item) => {
        try {
          const res = await fetch(`/api/stock/${item.stock_id}`)
          if (res.ok) {
            const stockData = await res.json()
            const latestData = stockData.data?.[stockData.data.length - 1]
            return { ...item, latestData }
          }
        } catch {
          // ignore
        }
        return item
      })
    )

    setStocks(stocksWithData)
  }

  useEffect(() => {
    const checkAuthAndFetch = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setIsAuthenticated(!!session)

      if (session) {
        await fetchWatchlist()
      }
      setLoading(false)
    }

    checkAuthAndFetch()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setIsAuthenticated(!!session)
      if (session) {
        await fetchWatchlist()
      } else {
        setStocks([])
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleRemove = async (stockId: string) => {
    await removeFromWatchlist(stockId)
    setStocks(stocks.filter(s => s.stock_id !== stockId))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-500">載入中...</div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <h1 className="text-xl font-bold text-gray-800 pl-12 md:pl-0">自選股</h1>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <div className="text-6xl mb-4">🔒</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">請先登入</h2>
            <p className="text-gray-500 mb-6">登入後即可使用自選股功能，跨裝置同步您的觀察清單</p>
            <button
              onClick={() => signInWithGoogle()}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
              </svg>
              Google 登入
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-800 pl-12 md:pl-0">自選股</h1>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 統計資訊 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <span className="text-gray-500">自選股數量：</span>
          <span className="font-bold text-blue-600">{stocks.length}</span>
          <span className="text-gray-500"> 檔</span>
        </div>

        {/* 股票列表 */}
        {stocks.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <div className="text-6xl mb-4">📋</div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">尚未加入自選股</h2>
            <p className="text-gray-500 mb-4">前往強勢股或個股頁面，點擊「加入自選」按鈕</p>
            <Link
              href="/strong-stocks"
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              瀏覽強勢股
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
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
        )}
      </div>
    </div>
  )
}
