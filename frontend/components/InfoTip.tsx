'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 數值說明泡泡：桌機滑鼠移入即顯示，手機/平板點擊切換。
 * 用途：讓使用者知道畫面上的數字「怎麼算出來的」。
 * 無障礙：可鍵盤 focus、Esc 關閉、點外部關閉，觸控目標 ≥32px。
 */
export default function InfoTip({
  title,
  children,
  dark = false,
}: {
  title: string
  children: ReactNode
  /** 深色底（圖表區）用淺色按鈕 */
  dark?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [canHover, setCanHover] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    setCanHover(window.matchMedia('(hover: hover)').matches)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const hoverProps = canHover
    ? { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }
    : {}

  return (
    <span ref={ref} className="relative inline-flex align-middle" {...hoverProps}>
      <button
        type="button"
        aria-label={`說明：${title}`}
        aria-expanded={open}
        onClick={(e) => {
          // 卡片常整張包在 <Link> 內：阻止冒泡，避免點說明就跳轉
          e.preventDefault()
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`inline-flex items-center justify-center w-8 h-8 -my-1 rounded-full text-sm font-bold transition-colors ${
          dark
            ? 'text-gray-300 hover:text-white hover:bg-white/10'
            : 'text-gray-500 hover:text-blue-700 hover:bg-gray-100'
        }`}
      >
        ⓘ
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-[80] w-64 max-w-[78vw] rounded-lg bg-gray-900 text-white text-sm font-normal leading-relaxed px-3 py-2 shadow-xl text-left normal-case"
        >
          <span className="block font-bold mb-0.5">{title}</span>
          <span className="block text-gray-100">{children}</span>
        </span>
      )}
    </span>
  )
}
