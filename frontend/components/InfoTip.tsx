'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 數值說明泡泡：桌機滑鼠移入即顯示，手機/平板點擊切換。
 * 用途：讓使用者知道畫面上的數字「怎麼算出來的」。
 * 無障礙：可鍵盤 focus、Esc 關閉、點外部關閉。
 * 觸控目標：圖示視覺 32×32，但靠 `before:-inset-1.5` 把**命中區**擴成 44×44
 * （符合全站 ≥44px 規則）。不直接放大圖示是因為 /strong-stocks 單頁有 274 顆，
 * 放大會把列表版面撐開；`before` 是絕對定位、不佔版面空間。
 *
 * ⚠️ 泡泡用 `position: fixed` 並自行算座標，**不可改回 `absolute` + `left-1/2 -translate-x-1/2`**。
 * 原因（2026-10-09 實測）：absolute 的泡泡會把自己的寬度算進祖先的 scrollable overflow，
 * 一路傳到 `<html>` → 靠右的格子一點說明就讓**整頁出現橫向捲軸**
 * （375px 下實測 scrollWidth 375→430，且 fixed 的底部導覽列被撐成 431px）。
 * clamp 位移救不了：那只改變視覺位置，overflow 仍照 left:50% 的版面位置計算。
 * fixed 元素不參與根捲動溢出，才是真正的解；代價是要自己跟著 scroll/resize 重算座標。
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
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  // null = 還沒量到座標（此時泡泡 visibility:hidden，避免先閃一下在左上角）
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  const place = useCallback(() => {
    const btn = btnRef.current
    const el = tipRef.current
    if (!btn || !el) return
    const b = btn.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    const M = 8 // 距視窗邊緣的最小留白(px)
    // clientWidth/Height：不含捲軸，與「整頁是否橫捲」用同一把尺
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    // 水平：以按鈕為中心，再夾回視窗內（靠邊的格子才會偏移）
    const left = Math.min(Math.max(M, b.left + b.width / 2 - w / 2), Math.max(M, vw - M - w))
    // 垂直：預設在按鈕下方；下方放不下就翻到上方，**再夾回視窗內**。
    // ⚠️ 夾這一步不可省：矮視窗（橫放手機 / 矮瀏覽器視窗）兩邊都放不下時，
    //    沒夾會讓泡泡底部被切掉（740×360 實測切掉 130px）。
    //    泡泡本身還有 max-h-[calc(100vh-16px)] + overflow-y-auto 處理
    //    「連夾了也還是比視窗高」的極端情況。
    const below = b.bottom + 4
    const raw = below + h > vh - M && b.top - 4 - h >= M ? b.top - 4 - h : below
    const top = Math.max(M, Math.min(raw, Math.max(M, vh - M - h)))
    setPos({ top, left })
  }, [])

  useEffect(() => {
    setCanHover(window.matchMedia('(hover: hover)').matches)
  }, [])

  // 開啟當下先量座標再顯示（useLayoutEffect 在 paint 前跑，不會看到跳動）
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      // 泡泡雖然是 fixed，DOM 上仍是本元件的子節點，所以 contains() 判定照舊有效
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // fixed 不會跟著內容捲動，必須自己重算；capture 才抓得到內層捲動容器（如表格）
    const onMove = () => place()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, place])

  const hoverProps = canHover
    ? { onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false) }
    : {}

  return (
    <span ref={ref} className="relative inline-flex align-middle" {...hoverProps}>
      <button
        ref={btnRef}
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
        className={`relative inline-flex items-center justify-center w-8 h-8 -my-1 rounded-full text-sm font-bold transition-colors before:absolute before:-inset-1.5 before:content-[''] ${
          dark
            ? 'text-gray-300 hover:text-white hover:bg-white/10'
            : 'text-gray-500 hover:text-blue-700 hover:bg-gray-100'
        }`}
      >
        ⓘ
      </button>
      {open && (
        <span
          ref={tipRef}
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          style={{
            top: pos?.top ?? 0,
            left: pos?.left ?? 0,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className="fixed z-[80] w-64 max-w-[78vw] max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg bg-gray-900 text-white text-sm font-normal leading-relaxed px-3 py-2 shadow-xl text-left normal-case"
        >
          <span className="block font-bold mb-0.5">{title}</span>
          <span className="block text-gray-100">{children}</span>
        </span>
      )}
    </span>
  )
}
