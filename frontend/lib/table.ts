/**
 * 表格共用型別與純函式（無 React / 無 JSX，server 與 client 皆可 import）
 *
 * 由 app/strong-table/page.tsx 抽出：那頁的「欄位 registry」模式（單一 Record<Key, ColDef>
 * 當唯一定義來源，每欄同時帶 header / fullName / align / sortValue / render / desc）
 * 在強勢月報頁要再用一次，抄第二份就會開始漂移。
 *
 * ColDef 在原頁是寫死 StrongTableRow，這裡改成泛型 <T, Ctx>，兩頁各自帶入自己的列型別。
 * JSX 片段（NullCell / TbdCell / TableScroll）在 components/table.tsx。
 */

import type { ReactNode } from 'react'

export type Align = 'left' | 'right' | 'center'

export const alignClass = (a: Align) =>
  a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left'

export const justifyClass = (a: Align) =>
  a === 'right' ? 'justify-end' : a === 'center' ? 'justify-center' : 'justify-start'

export interface ColDef<T, Ctx = unknown> {
  /** 表頭短名 */
  header: string
  /**
   * 表頭第二行（小字）。給「同一欄但參數可調」的欄位用，例如
   * 強勢月報的「投信買賣超累計 / 近 20 日」——參數必須看得到，
   * 否則使用者換了視窗卻以為表頭那個數字還是原來的意思。
   */
  subHeader?: string
  /** 完整名稱（含單位）：供「欄位說明」區與手機展開列重用 */
  fullName: string
  align: Align
  sortable: boolean
  /** ⚠️ 回 null 代表「無資料」而非 0；排序時用 compareNullLast 一律沉底 */
  sortValue: (r: T) => number | string | null
  render: (r: T, ctx: Ctx) => ReactNode
  /** 欄位說明區的文字：定義、單位、缺值語意 */
  desc: string
  /** 此欄可能真的缺資料（供「隱藏無資料的列」使用） */
  nullable?: boolean
  /** 此欄的判定規則尚未由業主定義，整欄是佔位（停用排序、顯示「待定義」） */
  tbd?: boolean
}

/** 表單控件統一樣式（觸控 ≥44px；桌機才降到 36px）。
 *  ⚠️ 以 strong-table 這份為準，不要沿用 screener 的 `py-1.5 text-sm`（不符 44px）。 */
export const SELECT =
  'border border-gray-300 rounded px-3 min-h-[44px] lg:min-h-[36px] text-base md:text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'
