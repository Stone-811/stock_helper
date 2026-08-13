'use client'

import StockSearchOptimized from './StockSearchOptimized'

/**
 * 全站置頂列：固定於內容區頂端，每頁皆顯示（含首頁）。
 * 提供股票代碼／名稱搜尋，選取後直接跳轉個股頁。
 * 手機版左側預留 hamburger（Sidebar 的 fixed top-4 left-4）空間。
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200 shadow-sm">
      <div className="flex items-center px-4 py-3 pl-16 md:pl-6">
        <div className="ml-auto w-full md:w-auto">
          <StockSearchOptimized />
        </div>
      </div>
    </header>
  )
}
