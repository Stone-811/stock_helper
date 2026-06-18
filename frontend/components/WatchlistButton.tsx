'use client'

import { useEffect, useState } from 'react'
import { supabase, addToWatchlist, removeFromWatchlist, isInWatchlist, signInWithGoogle } from '../lib/supabase'

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
    // Check auth and watchlist status
    const checkStatus = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setIsAuthenticated(!!session)

      if (session) {
        const result = await isInWatchlist(stockId)
        setInWatchlist(result)
      }
      setLoading(false)
    }

    checkStatus()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setIsAuthenticated(!!session)
      if (session) {
        const result = await isInWatchlist(stockId)
        setInWatchlist(result)
      } else {
        setInWatchlist(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [stockId])

  const handleClick = async () => {
    if (!isAuthenticated) {
      await signInWithGoogle()
      return
    }

    setLoading(true)
    if (inWatchlist) {
      const { error } = await removeFromWatchlist(stockId)
      if (!error) setInWatchlist(false)
    } else {
      const { error } = await addToWatchlist(stockId, stockName)
      if (!error) setInWatchlist(true)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <button
        disabled
        className={`px-3 py-1.5 rounded-lg text-gray-400 bg-gray-100 ${className}`}
      >
        ...
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      className={`px-3 py-1.5 rounded-lg transition-colors ${
        inWatchlist
          ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
      } ${className}`}
      title={inWatchlist ? '從自選股移除' : '加入自選股'}
    >
      {inWatchlist ? '★ 已加入' : '☆ 加入自選'}
    </button>
  )
}
