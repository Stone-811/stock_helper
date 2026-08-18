'use client'

import { useEffect, useState } from 'react'
import {
  auth,
  addToWatchlist,
  removeFromWatchlist,
  isInWatchlist,
  signInWithGoogle,
  onAuthChange
} from '../lib/firebase'

interface WatchlistButtonProps {
  stockId: string
  stockName: string
  className?: string
}

export default function WatchlistButton({ stockId, stockName, className = '' }: WatchlistButtonProps) {
  const [inWatchlist, setInWatchlist] = useState(false)
  const [loading, setLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    // 監聽認證狀態變化
    const unsubscribe = onAuthChange(async (user) => {
      setIsAuthenticated(!!user)

      if (user) {
        const result = await isInWatchlist(stockId)
        setInWatchlist(result)
      } else {
        setInWatchlist(false)
      }
      setLoading(false)
    })

    return () => unsubscribe()
  }, [stockId])

  const handleClick = async () => {
    if (!isAuthenticated) {
      await signInWithGoogle()
      return
    }

    setLoading(true)
    try {
      if (inWatchlist) {
        const success = await removeFromWatchlist(stockId)
        if (success) setInWatchlist(false)
      } else {
        const success = await addToWatchlist(stockId, stockName)
        if (success) setInWatchlist(true)
      }
    } catch (error) {
      console.error('Watchlist operation failed:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <button
        disabled
        aria-label="自選股載入中"
        className={`inline-flex items-center justify-center min-h-[40px] px-3 rounded-lg text-gray-400 bg-gray-100 ${className}`}
      >
        …
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      className={`inline-flex items-center justify-center gap-1 min-h-[40px] px-3 rounded-lg text-sm font-medium transition-colors ${
        inWatchlist
          ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      } ${className}`}
      title={inWatchlist ? '從自選股移除' : '加入自選股'}
      aria-label={inWatchlist ? '從自選股移除' : '加入自選股'}
    >
      <span aria-hidden="true">{inWatchlist ? '★' : '☆'}</span>
      <span className="hidden sm:inline">{inWatchlist ? '已加入' : '加入自選'}</span>
    </button>
  )
}
