'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import AuthButton from './AuthButton'

interface NavItem {
  href: string
  label: string
  icon: string
}

const navItems: NavItem[] = [
  { href: '/', label: '首頁', icon: '📊' },
  { href: '/strong-stocks', label: '強勢股', icon: '🔥' },
  { href: '/screener', label: '選股', icon: '🔍' },
  { href: '/watchlist', label: '自選股', icon: '⭐' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)

  // 從 localStorage 讀取縮放狀態
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed')
    if (saved === 'true') {
      setIsCollapsed(true)
    }
  }, [])

  // 儲存縮放狀態並通知其他元件
  const toggleCollapse = () => {
    const newState = !isCollapsed
    setIsCollapsed(newState)
    localStorage.setItem('sidebar-collapsed', String(newState))
    // 發送自訂事件通知 MainContent
    window.dispatchEvent(new CustomEvent('sidebar-collapse-change', {
      detail: { collapsed: newState }
    }))
  }

  // 判斷是否為當前路徑（或子路徑）
  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/'
    }
    return pathname.startsWith(href)
  }

  return (
    <>
      {/* 手機版漢堡選單按鈕 */}
      <button
        className="md:hidden fixed top-4 left-4 z-50 p-2 rounded-lg bg-[#1a1a2e] text-white shadow-lg"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle menu"
      >
        <svg
          className="w-6 h-6"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {isOpen ? (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          ) : (
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 6h16M4 12h16M4 18h16"
            />
          )}
        </svg>
      </button>

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 h-full bg-[#1a1a2e] z-40
          transform transition-all duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0
          flex flex-col
          ${isCollapsed ? 'md:w-20' : 'w-64'}
        `}
      >
        {/* Logo/標題 + 縮排按鈕 */}
        <div className={`border-b border-[#2a2a3e] ${isCollapsed ? 'md:p-2' : 'p-6'} relative`}>
          {/* 桌面版 */}
          <div className="hidden md:block">
            {isCollapsed ? (
              <h1 className="text-white text-2xl font-bold text-center">📊</h1>
            ) : (
              <>
                <h1 className="text-white text-xl font-bold">台股分析系統</h1>
                <p className="text-gray-500 text-sm mt-1">Taiwan Stock Analysis</p>
              </>
            )}
          </div>

          {/* 手機版（左內距避開固定在 top-4 left-4 的 X 關閉鈕，避免壓到標題） */}
          <div className="md:hidden pl-10">
            <h1 className="text-white text-xl font-bold">台股分析系統</h1>
            <p className="text-gray-500 text-sm mt-1">Taiwan Stock Analysis</p>
          </div>

          {/* 桌面版縮排按鈕（移到標題區右上角） */}
          <button
            onClick={toggleCollapse}
            className="hidden md:block absolute top-4 right-4 p-2 text-gray-400 hover:text-white hover:bg-[#2a2a3e] rounded-lg transition-colors"
            title={isCollapsed ? '展開側邊欄' : '收合側邊欄'}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            </svg>
          </button>
        </div>

        {/* 導航列表 */}
        <nav className={`flex-1 p-4 ${isCollapsed ? 'md:p-2' : ''}`}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              title={isCollapsed ? item.label : undefined}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-lg mb-2
                transition-colors duration-200
                ${isCollapsed ? 'md:justify-center md:px-2' : ''}
                ${
                  isActive(item.href)
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-[#2a2a3e] hover:text-white'
                }
              `}
            >
              <span className="text-xl">{item.icon}</span>
              <span className={`font-medium ${isCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
            </Link>
          ))}
        </nav>

        {/* 登入區 */}
        <AuthButton isCollapsed={isCollapsed} />

        {/* 底部資訊 */}
        {isCollapsed ? (
          <div className="hidden md:block p-2 border-t border-[#2a2a3e]">
            <p className="text-gray-500 text-xs text-center" title="資料來源：FinMind">
              📈
            </p>
          </div>
        ) : (
          <div className="p-4 border-t border-[#2a2a3e]">
            <p className="text-gray-500 text-xs text-center">
              資料來源：FinMind
            </p>
          </div>
        )}
      </aside>

      {/* 手機版遮罩 */}
      {isOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  )
}
