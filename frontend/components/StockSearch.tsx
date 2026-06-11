'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Stock {
  stock_id: string
  stock_name: string
}

export default function StockSearch() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Stock[]>([])
  const [allStocks, setAllStocks] = useState<Stock[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
    ).slice(0, 10) // 最多顯示 10 筆

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
    setQuery('')
    setIsOpen(false)
    router.push(`/stock/${stock.stock_id}`)
  }

  return (
    <div className="relative">
      <div className="flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => query && results.length > 0 && setIsOpen(true)}
          placeholder="搜尋股票代碼或名稱..."
          className="w-full md:w-64 px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <button
          onClick={() => {
            if (results.length > 0) {
              handleSelect(results[0])
            }
          }}
          className="ml-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
        >
          查詢
        </button>
      </div>

      {/* 搜尋結果下拉選單 */}
      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full md:w-64 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
        >
          {results.map((stock, index) => (
            <button
              key={stock.stock_id}
              onClick={() => handleSelect(stock)}
              className={`w-full px-4 py-3 text-left hover:bg-gray-100 flex items-center justify-between ${
                index === selectedIndex ? 'bg-blue-50' : ''
              }`}
            >
              <span className="font-medium text-gray-800">{stock.stock_id}</span>
              <span className="text-gray-500 text-sm">{stock.stock_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* 無結果提示 */}
      {query && !loading && results.length === 0 && allStocks.length > 0 && (
        <div className="absolute z-50 w-full md:w-64 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg px-4 py-3 text-gray-500 text-sm">
          找不到符合的股票
        </div>
      )}
    </div>
  )
}
