import type { ReactNode } from 'react'

/**
 * 共用狀態/版面元件：
 * - PageHeader：輕量頁面標題（取代舊的 bg-white shadow header，避免與置頂搜尋列形成雙層）
 * - CardGridSkeleton / ChartSkeleton：Loading 骨架
 * - EmptyState / ErrorState：一致的空狀態與錯誤狀態（後者含重新載入）
 */

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <div className="max-w-7xl mx-auto px-4 pt-5 pb-1">
      <h1 className="text-xl md:text-2xl font-bold text-gray-900">{title}</h1>
      {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  )
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4 animate-pulse">
      <div className="flex justify-between mb-3">
        <div className="space-y-2">
          <div className="h-4 w-20 bg-gray-200 rounded" />
          <div className="h-3 w-14 bg-gray-100 rounded" />
        </div>
        <div className="space-y-2">
          <div className="h-5 w-16 bg-gray-200 rounded ml-auto" />
          <div className="h-3 w-12 bg-gray-100 rounded ml-auto" />
        </div>
      </div>
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <div className="h-5 w-16 bg-gray-100 rounded" />
        <div className="h-5 w-20 bg-gray-100 rounded" />
      </div>
    </div>
  )
}

export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 320 }: { height?: number }) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-4">
      <div className="animate-pulse w-full bg-gray-100 rounded" style={{ height }} />
    </div>
  )
}

export function EmptyState({
  icon = '📭',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-8 text-center">
      <div className="text-5xl mb-3" aria-hidden="true">{icon}</div>
      <h2 className="text-lg font-bold text-gray-800 mb-1">{title}</h2>
      {description && <div className="text-gray-500 text-sm mb-4">{description}</div>}
      {action}
    </div>
  )
}

export function ErrorState({
  title = '載入發生問題',
  message,
  onRetry,
}: {
  title?: string
  message?: ReactNode
  onRetry?: () => void
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-8 text-center">
      <div className="text-5xl mb-3" aria-hidden="true">⚠️</div>
      <h2 className="text-lg font-bold text-gray-800 mb-1">{title}</h2>
      {message && <div className="text-gray-500 text-sm mb-4">{message}</div>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center justify-center min-h-[44px] px-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          重新載入
        </button>
      )}
    </div>
  )
}
