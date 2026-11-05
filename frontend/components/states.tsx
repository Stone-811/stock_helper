import type { ReactNode } from 'react'

/**
 * 共用狀態/版面元件：
 * - PageHeader：輕量頁面標題（取代舊的 bg-white shadow header，避免與置頂搜尋列形成雙層）
 * - CardGridSkeleton / ChartSkeleton / TableSkeleton：Loading 骨架
 * - EmptyState / ErrorState：一致的空狀態與錯誤狀態（後者含重新載入）
 */

export function PageHeader({
  title,
  maxWidth = 'max-w-7xl',
}: {
  /** 一般是字串；強勢月報要控制手機在哪裡換行，所以也收 ReactNode */
  title: ReactNode
  // 2026-11-05 業主：標題下那行灰色副標題「不用顯示」→ 拿掉 subtitle（原本強勢股、強勢月報、市場溫度三頁有用）。
  // 那三頁的副標題資訊頁面上都另有地方顯示（強勢股的日期卡、各指標卡的日期、月報統計列的「數字為 M/D」）。
  /** 寬表格頁可放寬容器；預設等同現況，不影響既有呼叫點。
   *  ⚠️ 改這個就要連內文容器一起改，否則標題會跟內容左緣對不齊。 */
  maxWidth?: string
}) {
  return (
    <div className={`${maxWidth} mx-auto px-4 pt-5 pb-1`}>
      <h1 className="text-xl md:text-2xl font-bold text-gray-900">{title}</h1>
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

/**
 * 表格 Loading 骨架。
 * ⚠️ 表格頁不要用 CardGridSkeleton：卡片網格形狀跟表格差太多，會先閃一排卡片再跳成表格。
 * 對視力不佳者，跳版比慢更難受。
 */
export function TableSkeleton({ rows = 12, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-white rounded-lg shadow-sm overflow-hidden p-4" role="status">
      <div className="h-5 bg-gray-200 rounded animate-pulse mb-4" />
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className={`h-4 bg-gray-100 rounded animate-pulse ${i % 2 === 0 ? 'w-full' : 'w-11/12'}`}
          />
        ))}
      </div>
      <span className="sr-only">資料載入中，共 {cols} 欄</span>
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
      {description && <div className="text-gray-700 text-sm mb-4">{description}</div>}
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
      {message && <div className="text-gray-700 text-sm mb-4">{message}</div>}
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
