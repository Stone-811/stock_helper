'use client'

import StockSearchOptimized from './StockSearchOptimized'

/**
 * 全站置頂列：固定於內容區頂端，每頁皆顯示（含首頁）。
 * 手機版左側 ☰ 開啟次要抽屜（帳號 / 資料來源）；主導覽在 Bottom Nav。
 * 提供股票代碼／名稱即時搜尋，選取後直接跳轉個股頁。
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="flex items-center gap-2 px-4 py-2.5 md:pl-6">
        {/* 手機版選單鈕 */}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('toggle-mobile-menu'))}
          className="md:hidden flex items-center justify-center w-11 h-11 -ml-2 rounded-lg text-gray-600 hover:bg-gray-100"
          aria-label="開啟選單"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <div className="flex-1 md:flex-none md:ml-auto">
          <StockSearchOptimized />
        </div>
      </div>
    </header>
  )
}
