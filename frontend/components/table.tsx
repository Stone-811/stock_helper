'use client'

import type { ReactNode } from 'react'
import { DASH } from '../lib/format'

/**
 * 表格共用 JSX 片段。純型別與純函式在 lib/table.ts。
 *
 * ⚠️ 本檔最重要的一件事：把「沒有這筆資料」與「這欄還沒定義」在視覺上分開。
 *   NullCell（—，灰）  = 資料來源未涵蓋此股此欄，是資料問題
 *   TbdCell（待定義，虛線框） = 業主尚未提供判定規則，是規格問題，整欄都一樣
 * 兩者混用會讓業主以為「待定義」那三欄是壞掉，或以為「—」的股票之後會自己長出值。
 */

/** 無資料儲存格：視覺上是「—」，螢幕報讀器唸「無資料」。
 *  顏色用 gray-600(7.56:1)，不用 gray-400(2.60:1)——「—」視覺量本來就小，再壓對比等於消失。 */
export function NullCell({ title = 'FinMind 未涵蓋此股此欄資料' }: { title?: string }) {
  return (
    <span className="text-gray-600" title={title}>
      <span aria-hidden="true">{DASH}</span>
      <span className="sr-only">無資料</span>
    </span>
  )
}

/**
 * 「待定義」儲存格：整欄的判定規則業主尚未提供。
 *
 * 刻意與 NullCell 在三個維度上都不同，才不會被誤讀成缺資料：
 *   文字（「待定義」而非「—」）、外框（虛線）、底色（amber-50）。
 * 一律**不顯示 0、不顯示空白**——空白會被當成「這檔沒有」，0 會被當成事實。
 */
export function TbdCell({ reason }: { reason?: string }) {
  return (
    <span
      className="inline-flex items-center px-2 rounded border border-dashed border-amber-400 bg-amber-50 text-sm text-amber-900 whitespace-nowrap"
      title={reason ?? '業主尚未提供此欄的判定規則，保留欄位待補'}
    >
      待定義
    </span>
  )
}

/**
 * 表格捲動容器。
 *
 * ⚠️ 為什麼一定要有這層（強勢股總表上週踩過的 critical bug）：
 * 表格比容器寬時，若溢出沒有被關進容器，就會落到「根捲動區」→ 整頁橫捲，
 * 而 Sidebar 是 `fixed left-0` 不跟著捲 → 直接蓋住第一欄的股名與代號。
 * 實測 768/900/1024 分別溢出 345/213/89px。
 *
 * ⚠️ `[contain:paint]` 不是裝飾：實測 Chrome 會把巢狀捲動容器的溢出併進根捲動區
 * （documentElement.scrollWidth 2489），即使每一層 scrollWidth 都等於 clientWidth、
 * 父層已 overflow-hidden。加上 paint containment 後根捲動區才回到視窗寬。
 * `overflow` 與 `[contain:paint]` 必須成對：只留 contain 而放開 overflow 會變成裁切而非捲動。
 *
 * `role="region" + tabIndex={0}`：否則鍵盤使用者捲不動這個容器。
 * 縱向也在容器內捲（maxHeight）＝表頭可以用「相對捲動容器」的 sticky top-0 固定住，
 * 這是 12 欄寬表唯一能同時保住「不整頁橫捲」與「表頭固定」的組合。
 */
export function TableScroll({
  label,
  maxHeight,
  children,
}: {
  label: string
  /** 開了縱向捲動才有容器內 sticky 表頭；不傳則只做橫向 */
  maxHeight?: string
  children: ReactNode
}) {
  return (
    <div
      className={`overflow-x-auto [contain:paint] ${maxHeight ? 'overflow-y-auto' : ''}`}
      style={maxHeight ? { maxHeight } : undefined}
      role="region"
      tabIndex={0}
      aria-label={label}
    >
      {children}
    </div>
  )
}
