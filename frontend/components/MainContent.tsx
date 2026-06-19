'use client'

import { useState, useEffect } from 'react'

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
    <main className={`flex-1 transition-all duration-300 ${isCollapsed ? 'md:ml-20' : 'md:ml-64'}`}>
      {children}
    </main>
  )
}
