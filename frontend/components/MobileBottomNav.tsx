'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { navItems, isNavActive } from './Sidebar'

// 手機版主導覽：與桌機側邊欄**同一份清單**（Sidebar.tsx 的 navItems），6 格、順序與目的地完全一致。
// 原本只有 4 格（總表、月報不佔格、改由「強勢」代亮），手機使用者得先進強勢股頁才找得到它們，
// 等於手機比桌機少兩個功能入口；現在每一頁都有自己的格子，亮燈也改成「只在自己的頁面亮」。
// 三個強勢路徑 /strong-stocks、/strong-table、/strong-monthly 彼此不是前綴，startsWith 不會雙亮。
export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
      aria-label="主要導覽"
    >
      <div className="flex">
        {navItems.map((item) => {
          const active = isNavActive(pathname, item.href)
          return (
            // 320px 寬 ÷ 6 ≈ 53px：flex-1 + min-w-0 讓 6 格永遠等分、不會因內容把導覽列撐出視窗；
            // 兩字標籤（text-xs 約 27px）＋圖示在 53px 內放得下，whitespace-nowrap 保證不換行。
            // 高度維持 56px（≥44px 觸控），MainContent 的底部留白不必跟著改。
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-xs font-medium whitespace-nowrap transition-colors ${
                active ? 'text-blue-600' : 'text-gray-700 hover:text-gray-700'
              }`}
            >
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
