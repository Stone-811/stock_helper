'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface NavItem {
  href: string
  label: string
  icon: string
}

// 手機版主導覽（高頻功能不藏在漢堡選單）
const navItems: NavItem[] = [
  { href: '/', label: '首頁', icon: '📊' },
  { href: '/strong-stocks', label: '強勢', icon: '🔥' },
  { href: '/screener', label: '選股', icon: '🔍' },
  { href: '/watchlist', label: '自選', icon: '⭐' },
]

export default function MobileBottomNav() {
  const pathname = usePathname()
  // /strong-table（表格檢視）與 /strong-monthly（當月彙整）都不在 Bottom Nav 佔格
  // ——底部四格留給高頻功能，月報是每月才看一次的低頻頁——
  // 但仍要讓「強勢」亮起，否則手機使用者會四格全暗、失去所在位置（WCAG 2.4.8）。
  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    if (href === '/strong-stocks') {
      return (
        pathname.startsWith('/strong-stocks') ||
        pathname.startsWith('/strong-table') ||
        pathname.startsWith('/strong-monthly')
      )
    }
    return pathname.startsWith(href)
  }

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
      aria-label="主要導覽"
    >
      <div className="flex">
        {navItems.map((item) => {
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-xs font-medium transition-colors ${
                active ? 'text-blue-600' : 'text-gray-700 hover:text-gray-700'
              }`}
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
