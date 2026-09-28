'use client'

import StockSearchOptimized from './StockSearchOptimized'
import AuthButton from './AuthButton'

/**
 * 全站置頂列：固定於內容區頂端，每頁皆顯示（含首頁）。
 * 提供股票代碼／名稱即時搜尋，選取後直接跳轉個股頁。
 *
 * 手機版右側放登入／帳號（2026-09-28 起）。
 * 原本手機是左側 ☰ 開一個側邊抽屜，但抽屜裡只剩「登入」與「資料來源：FinMind」
 * 兩項——主導覽早在 P0 改版時就移到 Bottom Nav 了。為了一個登入鈕而讓使用者
 * 多點一次、還要維護抽屜／遮罩／開關事件並不划算，故把登入直接放上來、
 * 手機不再渲染 Sidebar（見 Sidebar.tsx 的註解）。
 */
export default function TopBar() {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-gray-200">
      <div className="flex items-center gap-2 px-4 py-2.5 md:pl-6">
        <div className="flex-1 md:flex-none md:ml-auto">
          <StockSearchOptimized />
        </div>

        {/* 手機版帳號入口；桌機的登入在 Sidebar 底部，不重複顯示 */}
        <div className="md:hidden shrink-0">
          <AuthButton variant="topbar" />
        </div>
      </div>
    </header>
  )
}
