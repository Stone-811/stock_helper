'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import AuthButton from './AuthButton'

interface NavItem {
  href: string
  label: string
  icon: string
  /** 區段標題：三個「強勢*」同前綴、同色，加一條輕量分隔讓它們視覺上收成一組 */
  section?: string
}

const navItems: NavItem[] = [
  { href: '/', label: '首頁', icon: '📊' },
  { href: '/strong-stocks', label: '強勢股', icon: '🔥', section: '強勢股' },
  // ⚠️ 路徑刻意不以 '/strong-stocks' 開頭：下方 isActive 是 pathname.startsWith(href)，
  //    取名 /strong-stocks-table 或 /strong-stocks/table 都會讓「強勢股」與本項同時亮起。
  { href: '/strong-table', label: '強勢總表', icon: '📋' },
  // 月報與上面兩項**同一層、不是總表的子頁**：前兩者是「某一個交易日」的兩種呈現，
  // 月報是「某一個月」的彙整（主鍵與粒度都不同）。做成子路由會同時點亮兩個導覽項。
  // 圖示刻意用 🗓️（與 🔥/📋 形狀差異大）：縮排模式下只剩圖示可辨識。
  { href: '/strong-monthly', label: '強勢月報', icon: '🗓️' },
  { href: '/screener', label: '選股', icon: '🔍', section: '工具' },
  { href: '/watchlist', label: '自選股', icon: '⭐' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [isCollapsed, setIsCollapsed] = useState(false)

  // 從 localStorage 讀取縮放狀態（桌機）
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
      {/* Sidebar：**桌機專屬**（2026-09-28 起手機完全不渲染）。
          手機的主導覽是 MobileBottomNav，登入在 TopBar 右側；抽屜當時只剩這兩項，
          留著等於讓使用者為了一個登入鈕多點一次，還要維護開關事件／遮罩／關閉鈕。 */}
      <aside
        className={`
          hidden md:flex fixed left-0 top-0 h-full bg-[#1a1a2e] z-40
          transition-all duration-300 ease-in-out
          flex-col
          ${isCollapsed ? 'md:w-20' : 'w-64'}
        `}
      >
        {/* Logo/標題 + 縮排/關閉按鈕 */}
        <div className={`border-b border-[#2a2a3e] ${isCollapsed ? 'md:p-2' : 'p-6'} relative`}>
          <div>
            {isCollapsed ? (
              <h1 className="text-white text-2xl font-bold text-center">📊</h1>
            ) : (
              <>
                <h1 className="text-white text-xl font-bold">台股分析系統</h1>
                <p className="text-gray-300 text-sm mt-1">Taiwan Stock Analysis</p>
              </>
            )}
          </div>

          {/* 縮排按鈕 */}
          <button
            onClick={toggleCollapse}
            className="absolute top-4 right-4 p-2 text-gray-300 hover:text-white hover:bg-[#2a2a3e] rounded-lg transition-colors"
            title={isCollapsed ? '展開側邊欄' : '收合側邊欄'}
          >
            <svg
              className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>

        </div>

        {/* 主導航（桌機顯示；手機改用 Bottom Nav） */}
        <nav className={`flex-1 p-4 ${isCollapsed ? 'md:p-2' : ''}`}>
          {navItems.map((item) => (
            <div key={item.href}>
              {/* 區段標題：縮排模式只留分隔線（80px 寬放不下文字），展開才顯示小標。
                  深底要反向提亮，所以用 gray-400 而不是淺底慣例的 gray-600。 */}
              {item.section && (
                <div className={`mt-3 mb-2 pt-3 border-t border-[#2a2a3e] ${isCollapsed ? 'md:mt-2 md:pt-2' : ''}`}>
                  <p className={`px-4 text-xs font-medium text-gray-400 ${isCollapsed ? 'md:hidden' : ''}`}>
                    {item.section}
                  </p>
                </div>
              )}
              <Link
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                className={`
                  flex items-center gap-3 px-4 py-3 rounded-lg mb-2
                  transition-colors duration-200
                  ${isCollapsed ? 'md:justify-center md:px-2' : ''}
                  ${
                    isActive(item.href)
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-300 hover:bg-[#2a2a3e] hover:text-white'
                  }
                `}
              >
                <span className="text-xl">{item.icon}</span>
                <span className={`font-medium ${isCollapsed ? 'md:hidden' : ''}`}>{item.label}</span>
              </Link>
            </div>
          ))}
        </nav>

        {/* 登入區 */}
        <AuthButton isCollapsed={isCollapsed} />

        {/* 底部資訊 */}
        {isCollapsed ? (
          <div className="p-2 border-t border-[#2a2a3e]">
            <p className="text-gray-300 text-xs text-center" title="資料來源：FinMind">📈</p>
          </div>
        ) : (
          <div className="p-4 border-t border-[#2a2a3e]">
            <p className="text-gray-300 text-xs text-center">資料來源：FinMind</p>
          </div>
        )}
      </aside>
    </>
  )
}
