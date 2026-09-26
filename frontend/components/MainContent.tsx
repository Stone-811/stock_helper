'use client'

import { useState, useEffect } from 'react'
import TopBar from './TopBar'

export default function MainContent({ children }: { children: React.ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    // 初始化時讀取 localStorage
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') {
      setIsCollapsed(true)
    }

    // 監聽 storage 事件（跨標籤頁同步）
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'sidebar-collapsed') {
        setIsCollapsed(e.newValue === 'true')
      }
    }

    // 監聽自訂事件（同一頁面內同步）
    const handleSidebarChange = (e: CustomEvent) => {
      setIsCollapsed(e.detail.collapsed)
    }

    window.addEventListener('storage', handleStorage)
    window.addEventListener('sidebar-collapse-change', handleSidebarChange as EventListener)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('sidebar-collapse-change', handleSidebarChange as EventListener)
    }
  }, [])

  return (
    // min-w-0：flex 子項預設 min-width:auto，會用「內容的 min-content 寬」當下限。
    // 少了它，任何一張寬表格都會把 <main> 撐大 → 整個 body 橫向捲動 → 與 fixed Sidebar 錯位。
    <main className={`flex-1 min-w-0 transition-all duration-300 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0 ${isCollapsed ? 'md:ml-20' : 'md:ml-64'}`}>
      <TopBar />
      {children}
    </main>
  )
}
