'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-gray-50 px-4 text-center">
      <div className="text-6xl">⚠️</div>
      <h1 className="text-2xl font-bold text-gray-800">發生錯誤</h1>
      <p className="text-gray-500">資料載入失敗，請稍後再試。</p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          重試
        </button>
        <Link
          href="/"
          className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg transition-colors"
        >
          返回首頁
        </Link>
      </div>
    </div>
  )
}
