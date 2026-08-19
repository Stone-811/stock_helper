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
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

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
