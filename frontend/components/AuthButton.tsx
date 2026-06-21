'use client'

import { useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { supabase, signInWithGoogle, signOut } from '../lib/supabase'

interface AuthButtonProps {
  isCollapsed?: boolean
}

export default function AuthButton({ isCollapsed = false }: AuthButtonProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleSignIn = async () => {
    // Don't set loading here - OAuth redirects away from page
    // If user cancels and returns, we don't want to be stuck in loading state
    const { error } = await signInWithGoogle()
    // Only reaches here if OAuth failed (no redirect)
    if (error) {
      console.error('Sign in error:', error)
    }
  }

  const handleSignOut = async () => {
    setLoading(true)
    await signOut()
    setLoading(false)
  }

  if (loading) {
    return isCollapsed ? (
      <div className="flex justify-center p-2">
        <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse" />
      </div>
    ) : (
      <div className="px-4 py-2 text-sm text-gray-400">
        載入中...
      </div>
    )
  }

  if (user) {
    // 縮排模式：只顯示頭像
    if (isCollapsed) {
      return (
        <div className="flex justify-center p-2 border-t border-gray-700">
          <button
            onClick={handleSignOut}
            title={`登出 (${user.user_metadata?.full_name || user.email})`}
            className="relative group"
          >
            {user.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt="avatar"
                className="w-10 h-10 rounded-full ring-2 ring-transparent group-hover:ring-blue-500 transition-all"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold ring-2 ring-transparent group-hover:ring-blue-500 transition-all">
                {(user.user_metadata?.full_name || user.email || '?')[0].toUpperCase()}
              </div>
            )}
            {/* 懸停提示點 */}
            <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-[#1a1a2e]" />
          </button>
        </div>
      )
    }

    // 展開模式：顯示完整資訊
    return (
      <div className="px-4 py-2 border-t border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          {user.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt="avatar"
              className="w-8 h-8 rounded-full"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
              {(user.user_metadata?.full_name || user.email || '?')[0].toUpperCase()}
            </div>
          )}
          <span className="text-sm text-gray-300 truncate">
            {user.user_metadata?.full_name || user.email}
          </span>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full px-3 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
        >
          登出
        </button>
      </div>
    )
  }

  // 未登入狀態
  // 縮排模式：只顯示 Google 圖示
  if (isCollapsed) {
    return (
      <div className="flex justify-center p-2 border-t border-gray-700">
        <button
          onClick={handleSignIn}
          title="Google 登入"
          className="w-10 h-10 rounded-full bg-white hover:bg-gray-100 flex items-center justify-center transition-colors"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
        </button>
      </div>
    )
  }

  // 展開模式：顯示完整按鈕
  return (
    <div className="px-4 py-2 border-t border-gray-700">
      <button
        onClick={handleSignIn}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-white hover:bg-gray-100 text-gray-800 rounded-lg transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </svg>
        Google 登入
      </button>
    </div>
  )
}
