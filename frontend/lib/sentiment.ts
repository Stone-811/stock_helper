/**
 * 市場溫度（大盤當沖比、融資融券餘額、恐慌指數）的型別與純函式。
 * 無 React／無 'use client'：API route、首頁、/market-mood 頁共用。
 *
 * 業主 2026-11-05 的決定：
 *  - 當沖比＝官方「成交金額（買進）占比」（新聞口徑），上市、上櫃各一個數字；股數占比只放說明。
 *  - 恐慌指數：台股臺指VIX（首頁）＋美股 VIX（新頁另列），兩者不可互比。
 *  - 融資餘額＋融券餘額（上市、上櫃）。
 *  - **不貼「偏高／偏低」標籤**：只寫數字、跟前一天比、近一年最高最低。
 *
 * ⚠️ 缺值是 null（collector null-aware），一律顯示 DASH，不可 `?? 0`。
 *    當沖與融資的官方數字「當日晚間」才公布：22:00 前看到的是前一個交易日，畫面每個數字都要標日期。
 */

export interface DaytradeDay {
  date: string
  twse_buy_pct: number | null
  twse_sell_pct: number | null
  twse_shares_pct: number | null
  twse_dt_shares: number | null
  twse_buy_amount: number | null
  twse_sell_amount: number | null
  tpex_buy_pct: number | null
  tpex_sell_pct: number | null
  tpex_shares_pct: number | null
  tpex_dt_shares: number | null
  tpex_buy_amount: number | null
  tpex_sell_amount: number | null
}

export interface MarginDay {
  date: string
  /** 仟元 */
  twse_margin_balance: number | null
  /** 張 */
  twse_margin_lots: number | null
  twse_short_lots: number | null
  tpex_margin_balance: number | null
  tpex_margin_lots: number | null
  tpex_short_lots: number | null
}

export interface TaivixDay {
  date: string
  /** 13:45 收盤 */
  close: number | null
  close_1min_avg: number | null
}

export interface VixDay {
  /** 美東日期：美股 11/04 收盤＝台灣 11/05 清晨，並排顯示要標「美股 M/D 收盤」 */
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
}

export interface SentimentResponse {
  daytrade: DaytradeDay[]
  margin: MarginDay[]
  taivix: TaivixDay[]
  vix: VixDay[]
  /** 臺指VIX 在資料庫裡的第一筆（不受 days 切窗影響；沒有資料＝null）：「本站自 X 起統計」用 */
  first: { taivix: string | null }
}

/** 一個指標的「最新值、前一天、近一年最高最低」——業主選的呈現方式（不貼標籤） */
export interface Stat {
  date: string
  value: number
  prevDate: string | null
  prev: number | null
  /** 與前一筆的差（同單位；百分比指標就是「個百分點」） */
  delta: number | null
  /** 近一年（最新日往前 365 個日曆天，含當天）的最高／最低與發生日 */
  yearHigh: { date: string; value: number } | null
  yearLow: { date: string; value: number } | null
  /** 近一年樣本數（寫在畫面上，業主才知道「最高」是跟幾天比） */
  yearDays: number
}

/** 從一個系列算出 Stat。pick 回 null 的日子會被跳過（上市／上櫃任一邊缺就不算那一天）。 */
export function statOf<T extends { date: string }>(rows: T[], pick: (r: T) => number | null | undefined): Stat | null {
  const pts = rows
    .map((r) => ({ date: r.date, value: pick(r) }))
    .filter((p): p is { date: string; value: number } => typeof p.value === 'number' && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (!pts.length) return null
  const last = pts[pts.length - 1]
  const prev = pts.length > 1 ? pts[pts.length - 2] : null
  // 近一年：日曆天往回 365 天（不用交易日軸：這裡只是「最近一年」的口語範圍，不需要精準到交易日）
  const cutoff = shiftDays(last.date, -365)
  const year = pts.filter((p) => p.date >= cutoff)
  let hi = year[0], lo = year[0]
  for (const p of year) {
    if (p.value > hi.value) hi = p
    if (p.value < lo.value) lo = p
  }
  return {
    date: last.date,
    value: last.value,
    prevDate: prev?.date ?? null,
    prev: prev?.value ?? null,
    delta: prev ? last.value - prev.value : null,
    yearHigh: hi ? { date: hi.date, value: hi.value } : null,
    yearLow: lo ? { date: lo.date, value: lo.value } : null,
    yearDays: year.length,
  }
}

/** YYYY-MM-DD ± n 天（UTC 計算，避免時區把日期推到前一天） */
export function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** YYYY-MM-DD → M/D（畫面上日期一律這樣寫，月份不補零：「11/4」比「11/04」少一個字） */
export function fmtMd(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 仟元 → 億元（融資餘額的官方單位是仟元；1 億＝100,000 仟元） */
export function thousandsToYi(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v / 100000 : null
}

/** 顯示用的方向：依顯示小數位四捨五入後再判斷，否則 +0.004 會畫 ▲ 卻寫「相同」 */
export function deltaDir(delta: number | null, digits: number): 'up' | 'down' | 'flat' | null {
  if (delta == null) return null
  const r = Math.round(delta * Math.pow(10, digits))
  return r > 0 ? 'up' : r < 0 ? 'down' : 'flat'
}
export const DELTA_ARROW = { up: '▲', down: '▼', flat: '＝' } as const

/**
 * 跟前一筆比的文字：「比 11/3 高 8.7 個百分點」「比 11/3 低 1.18」「與 11/3 相同」；沒有前一筆回 null。
 * ⚠️ 一定寫出日期：prev 是「前一筆有值的日子」，單邊缺一天或連假後就不是前一個交易日（審查 F5）。
 */
export function deltaText(delta: number | null, unit: '個百分點' | '' | '億元' | '張', digits: number, prevDate: string | null): string | null {
  const dirKey = deltaDir(delta, digits)
  if (delta == null || dirKey == null) return null
  const ref = prevDate ? fmtMd(prevDate) : '前一筆'
  if (dirKey === 'flat') return `與 ${ref} 相同`
  const dir = dirKey === 'up' ? '高' : '低'
  const n = Math.abs(delta).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
  return `比 ${ref} ${dir} ${n}${unit ? ` ${unit}` : ''}`
}
