/**
 * 共用數值格式化（純函式，無 React / 無 'use client'，server 與 client 皆可用）
 *
 * 為什麼要有這個檔：漲跌幅基準、億/萬 級距、紅綠配色、連買連賣字串
 * 原本散在 StockCard.tsx / watchlist / StockDetailClient / lib/signals.ts 四處各一份。
 * 強勢股總表一次要用到 20 欄，再抄一次就是第五份，因此把「重複且無爭議」的邏輯抽到這裡。
 *
 * 遷移策略只做加法：新頁面直接用本檔；StockCard 的私有 formatTradingValue 改成 import。
 * watchlist / StockDetailClient / signals.ts 各有語境差異（latestData 可能 undefined、
 * base 從 history 倒數第二根取），本次不動，留作後續。
 */

/** 無資料的統一符號：全形破折號 U+2014（與 app/page.tsx 一致，不是半形 '-'） */
export const DASH = '—'

function isMissing(v: number | null | undefined): v is null | undefined {
  return v === null || v === undefined || !Number.isFinite(v)
}

/** 數字千分位。null / undefined / NaN 一律回 DASH，**不回 0** */
export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (isMissing(v)) return DASH
  return v.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** 帶正負號的數字（法人買賣超）。0 顯示 "+0"（0 是真的 0，不是缺資料） */
export function fmtSigned(v: number | null | undefined, digits = 0): string {
  if (isMissing(v)) return DASH
  return (v >= 0 ? '+' : '') + fmtNum(v, digits)
}

/** 百分比。注意：傳入的是已經 ×100 的數值（例如 31.25 → "31.25%"） */
export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (isMissing(v)) return DASH
  return fmtNum(v, digits) + '%'
}

/**
 * 成交額格式化（億 / 萬），沿用 StockCard 原本的級距。
 * 相對原版補上三個缺口：(a) 負數（先取絕對值再補回負號）、(b) null → DASH、
 * (c) 級距切換處「9999萬 → 1.00億」是刻意的，同欄並排看得出來但可接受。
 */
export function fmtTradingValue(v: number | null | undefined): string {
  if (isMissing(v)) return DASH
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (abs >= 1e8) return sign + (abs / 1e8).toFixed(2) + '億'
  if (abs >= 1e4) return sign + (abs / 1e4).toFixed(0) + '萬'
  return sign + abs.toFixed(0)
}

export type ChangeDir = 'up' | 'down' | 'flat'

export interface ChangeResult {
  base: number
  /** 漲跌點數；無法計算時為 null（不可用 0 代替） */
  change: number | null
  /** 漲跌百分比；無法計算時為 null */
  pct: number | null
  dir: ChangeDir
}

/**
 * 漲跌幅：基準一律是「前一交易日收盤」（台股慣例）。
 * 沒有昨收資料（route.ts 查無此股時 prev_close 整個 key 不存在）才退回當日開盤。
 * ⚠️ 絕對不可寫成 close - open —— 那是當日振幅，不是漲跌幅。
 */
export function computeChange(s: {
  close: number
  open: number
  prev_close?: number | null
}): ChangeResult {
  const base = s.prev_close != null && s.prev_close > 0 ? s.prev_close : s.open
  if (isMissing(s.close) || isMissing(base) || base <= 0) {
    return { base: 0, change: null, pct: null, dir: 'flat' }
  }
  const change = s.close - base
  const pct = (change / base) * 100
  return {
    base,
    change,
    pct,
    dir: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  }
}

/**
 * 台股慣例：漲紅、跌綠。
 *
 * ⚠️ 刻意偏離站上其他頁的 green-600，請勿「順手統一」回去。
 * 實測 WCAG 對比（白底 / gray-50 底，用 tailwindcss v4 theme.css 的 oklch 值換算）：
 *   red-600   4.76 / 4.56 （門檻 4.5，gray-50 底只剩 0.06 餘裕）
 *   green-600 3.22 / 3.08 ← 不過 AA
 *   green-700 4.94 / 4.74 ← 用這個
 * 表格內文 text-sm 在本站 @theme 下 = 15.2px，屬「一般文字」，吃不到
 * 「≥24px 或 ≥18.66px 粗體」的 3:1 大字例外（首頁/個股頁用 text-lg 粗體所以還在例外內）。
 * 這也是強勢股總表不做斑馬紋、hover 停在 gray-50 的原因：底色再深一階，red-600 就會跌破 4.5。
 */
export function changeColor(dir: ChangeDir): string {
  if (dir === 'up') return 'text-red-600'
  if (dir === 'down') return 'text-green-700'
  return 'text-gray-700'
}

/** 依數值正負上色（法人買賣超、連買連賣）。null 給中性灰，**不上紅綠** */
export function signColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'text-gray-600'
  if (v > 0) return 'text-red-600'
  if (v < 0) return 'text-green-700'
  return 'text-gray-700'
}


/**
 * 排序比較器：null 一律沉到最底，不論升冪或降冪。
 * ⚠️ 禁止 (a.x ?? 0) - (b.x ?? 0) —— 那會把「無資料」混進 0 的位置，
 * 使用者會以為那些股票的外資持股真的是 0，正是本專案花大工夫修掉的那類 bug。
 */
export function compareNullLast(
  av: number | string | null | undefined,
  bv: number | string | null | undefined,
  dir: 'asc' | 'desc'
): number {
  const aNull = av === null || av === undefined || av === '' || (typeof av === 'number' && !Number.isFinite(av))
  const bNull = bv === null || bv === undefined || bv === '' || (typeof bv === 'number' && !Number.isFinite(bv))
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  const c =
    typeof av === 'string' || typeof bv === 'string'
      ? String(av).localeCompare(String(bv))
      : (av as number) - (bv as number)
  return dir === 'desc' ? -c : c
}
