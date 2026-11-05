'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navItems, isNavActive } from './Sidebar'

// 手機版主導覽：與桌機側邊欄**同一份清單**（Sidebar.tsx 的 navItems），順序與目的地完全一致。
// 2026-10-26 強勢股卡片頁與總表合併成一頁後變 5 格（首頁／強勢／月報／選股／自選），每格約寬兩成；
// 業主同意順便把字放大一級、所在格加粗並加上方色條（原本只用藍色表示「你在這一頁」）。
// /strong-stocks 與 /strong-monthly 彼此不是前綴，startsWith 不會雙亮。
export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
      aria-label="主要導覽"
    >
      <div className="flex">
        {navItems.filter((item) => !item.desktopOnly).map((item) => {
          const active = isNavActive(pathname, item.href)
          return (
            // 320px 寬 ÷ 5 = 64px：flex-1 + min-w-0 讓每格永遠等分、不會因內容把導覽列撐出視窗；
            // 兩字標籤（text-sm 約 31px）＋圖示在 64px 內放得下，whitespace-nowrap 保證不換行。
            // 高度維持 56px（≥44px 觸控），MainContent 的底部留白不必跟著改。
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={`relative flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-sm whitespace-nowrap transition-colors ${
                active ? 'text-blue-700 font-bold' : 'text-gray-700 font-medium'
              }`}
            >
              {active && <span className="absolute top-0 inset-x-3 h-1 rounded-b bg-blue-600" aria-hidden="true" />}
              <span className="text-xl leading-none" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.shortLabel}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
