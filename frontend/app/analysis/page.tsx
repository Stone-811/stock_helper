'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import type { StockAnalysisReport } from '../../lib/supabase'
import ReactMarkdown from 'react-markdown'

interface Stock {
  stock_id: string
  stock_name: string
}

export default function AnalysisPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [allStocks, setAllStocks] = useState<Stock[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null)
  const [generating, setGenerating] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recentReports, setRecentReports] = useState<StockAnalysisReport[]>([])
  const [user, setUser] = useState<{ id: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 載入用戶資訊
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user)
    })
  }, [])

  // 載入所有股票清單
  useEffect(() => {
    async function fetchStocks() {
      try {
        const res = await fetch('/api/stocks')
        const data = await res.json()
        setAllStocks(data.stocks || [])
      } catch (error) {
        console.error('Failed to fetch stocks:', error)
      }
    }
    fetchStocks()
  }, [])

  // 載入最近報告
  useEffect(() => {
    async function fetchRecentReports() {
      try {
        const res = await fetch('/api/analysis?limit=5')
        const data = await res.json()
        setRecentReports(data.reports || [])
      } catch (error) {
        console.error('Failed to fetch reports:', error)
      }
    }
    fetchRecentReports()
  }, [])

  // 搜尋邏輯
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setIsOpen(false)
      return
    }

    const q = query.toLowerCase()
    const filtered = allStocks.filter(
      stock =>
        stock.stock_id.includes(q) ||
        stock.stock_name.toLowerCase().includes(q)
    ).slice(0, 10)

    setResults(filtered)
    setIsOpen(filtered.length > 0)
    setSelectedIndex(-1)
  }, [query, allStocks])

  // 點擊外部關閉
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        !inputRef.current?.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // 鍵盤導航
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : prev))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1))
        break
      case 'Enter':
        e.preventDefault()
        if (selectedIndex >= 0 && results[selectedIndex]) {
          handleSelect(results[selectedIndex])
        } else if (results.length > 0) {
          handleSelect(results[0])
        }
        break
      case 'Escape':
        setIsOpen(false)
        break
    }
  }

  // 選擇股票
  const handleSelect = (stock: Stock) => {
    setSelectedStock(stock)
    setQuery(`${stock.stock_id} ${stock.stock_name}`)
    setIsOpen(false)
    setError(null)
  }

  // 生成分析報告
  const handleGenerate = async () => {
    if (!selectedStock) {
      setError('請先選擇一檔股票')
      return
    }

    setGenerating(true)
    setError(null)
    setReport(null)

    try {
      // 取得 auth token
      const { data: { session } } = await supabase.auth.getSession()

      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token && {
            'Authorization': `Bearer ${session.access_token}`
          })
        },
        body: JSON.stringify({
          stock_id: selectedStock.stock_id,
          stock_name: selectedStock.stock_name
        })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate analysis')
      }

      setReport(data.report.content)

      // 重新載入最近報告
      const reportsRes = await fetch('/api/analysis?limit=5')
      const reportsData = await reportsRes.json()
      setRecentReports(reportsData.reports || [])

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setGenerating(false)
    }
  }

  // 載入歷史報告
  const loadReport = async (reportId: number) => {
    try {
      const res = await fetch(`/api/analysis/${reportId}`)
      const data = await res.json()
      if (data.report) {
        setReport(data.report.report_content)
        setSelectedStock({
          stock_id: data.report.stock_id,
          stock_name: data.report.stock_name
        })
        setQuery(`${data.report.stock_id} ${data.report.stock_name}`)
      }
    } catch (err) {
      console.error('Failed to load report:', err)
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-6">基本面分析</h1>

        {/* 搜尋區域 */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedStock(null)
                }}
                onKeyDown={handleKeyDown}
                onFocus={() => query && results.length > 0 && setIsOpen(true)}
                placeholder="搜尋股票代碼或名稱..."
                className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* 搜尋結果下拉選單 */}
              {isOpen && results.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-80 overflow-y-auto"
                >
                  {results.map((stock, index) => (
                    <button
                      key={stock.stock_id}
                      onClick={() => handleSelect(stock)}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-600 flex items-center justify-between ${
                        index === selectedIndex ? 'bg-gray-600' : ''
                      }`}
                    >
                      <span className="font-medium text-white">{stock.stock_id}</span>
                      <span className="text-gray-300 text-sm">{stock.stock_name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating || !selectedStock}
              className={`px-6 py-3 rounded-lg font-medium transition-colors ${
                generating || !selectedStock
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {generating ? '分析中...' : '生成分析報告'}
            </button>
          </div>

          {selectedStock && (
            <p className="mt-3 text-gray-400">
              已選擇：{selectedStock.stock_id} {selectedStock.stock_name}
            </p>
          )}

          {error && (
            <p className="mt-3 text-red-400">{error}</p>
          )}

          {generating && (
            <div className="mt-4 p-4 bg-gray-700 rounded-lg">
              <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent"></div>
                <span className="text-gray-300">
                  AI 正在分析 {selectedStock?.stock_name}，這可能需要 30-60 秒...
                </span>
              </div>
            </div>
          )}

          {!user && (
            <p className="mt-3 text-yellow-400 text-sm">
              提示：登入後可儲存分析報告
            </p>
          )}
        </div>

        {/* 最近報告 */}
        {recentReports.length > 0 && !report && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">最近分析報告</h2>
            <div className="space-y-2">
              {recentReports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => loadReport(r.id)}
                  className="w-full text-left px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.stock_id} {r.stock_name}</span>
                    <span className="text-gray-400 text-sm">
                      {new Date(r.created_at).toLocaleDateString('zh-TW')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 報告顯示區域 */}
        {report && (
          <div className="bg-gray-800 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">
                {selectedStock?.stock_id} {selectedStock?.stock_name} 分析報告
              </h2>
              <button
                onClick={() => setReport(null)}
                className="text-gray-400 hover:text-white"
              >
                關閉
              </button>
            </div>

            <div className="prose prose-invert max-w-none">
              <ReactMarkdown
                components={{
                  table: ({ children }) => (
                    <div className="overflow-x-auto">
                      <table className="min-w-full border-collapse border border-gray-600">
                        {children}
                      </table>
                    </div>
                  ),
                  th: ({ children }) => (
                    <th className="border border-gray-600 px-4 py-2 bg-gray-700 text-left">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="border border-gray-600 px-4 py-2">
                      {children}
                    </td>
                  ),
                  h1: ({ children }) => (
                    <h1 className="text-2xl font-bold mt-8 mb-4 text-white border-b border-gray-600 pb-2">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl font-semibold mt-6 mb-3 text-white">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-lg font-medium mt-4 mb-2 text-gray-200">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-gray-300 mb-4 leading-relaxed">
                      {children}
                    </p>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside text-gray-300 mb-4 space-y-1">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside text-gray-300 mb-4 space-y-1">
                      {children}
                    </ol>
                  ),
                  code: ({ children, className }) => {
                    const isInline = !className
                    return isInline ? (
                      <code className="bg-gray-700 px-1 py-0.5 rounded text-sm text-blue-300">
                        {children}
                      </code>
                    ) : (
                      <code className="block bg-gray-700 p-4 rounded-lg text-sm overflow-x-auto">
                        {children}
                      </code>
                    )
                  },
                  blockquote: ({ children }) => (
                    <blockquote className="border-l-4 border-blue-500 pl-4 my-4 text-gray-400 italic">
                      {children}
                    </blockquote>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-white">{children}</strong>
                  ),
                }}
              >
                {report}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
