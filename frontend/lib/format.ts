/**
 * 共用數值格式化（純函式，無 React / 無 'use client'，server 與 client 皆可用）
 *
 * 為什麼要有這個檔：漲跌幅基準、億/萬 級距、紅綠配色、成交額／當沖比、MACD 標籤底色
 * 原本在 StockCard.tsx、強勢股頁、StockDetailClient 等處各抄一份，日後只改到其中一份就會對不上，
 * 因此把「重複且無爭議」的邏輯抽到這裡。成交額／當沖比：強勢股頁表格（app/strong-stocks/columns.tsx）
 * 與 StockCard 共用；MACD 底色再加上強勢月報。
 *
 * StockDetailClient／StockSignals 的漲跌基準是 history 倒數第二根（不靠 API 的 prev_close），
 * 語境不同，不併進 computeChange。當沖比：StockDetailClient 已改用 dayTradingRatioOf（2026-11-06）；StockSignals 仍自己算一份（公式相同）。
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

/**
 * 成交額（元）＝成交量（張）× 收盤價 × 1000 股。任一邊缺 → null（顯示「—」，不是 0）。
 * 強勢股頁的表格與 StockCard 共用（同一頁切換卡片／表格，數字必須同一份公式）。
 * 當沖額也是同一條公式：把當沖量當成交量傳進來。
 */
export function tradingValueOf(volume: number | null | undefined, close: number | null | undefined): number | null {
  return volume == null || close == null ? null : volume * close * 1000
}

/**
 * 當沖比例（%）＝當沖量 ÷ 成交量 × 100。
 * ⚠️ 缺值語意（本專案最常出事的地方，改之前先想清楚）：
 *   當沖量 null（交易所沒公布：興櫃、處置股…）→ null，**不可回 0%**；
 *   成交量 0 或缺 → null（除不出來）；
 *   當沖量 0 → 0（真的沒人當沖，是有效值）。
 * 強勢股頁「排序：當沖比例」與同一張卡片上的「當沖額（x%）」都走這裡，兩個數字才不會對不上。
 */
export function dayTradingRatioOf(dtv: number | null | undefined, volume: number | null | undefined): number | null {
  return dtv != null && volume != null && volume > 0 ? (dtv / volume) * 100 : null
}

/**
 * MACD 標籤的底色：「多」紅、「空」綠，其他（「-」資料不足、空值）灰。只回 class，
 * 標籤文字與缺值要顯示什麼由各頁自己決定（強勢股表格灰底「—」、月報 NullCell、卡片「MACD —」）。
 */
export function macdBadgeClass(m: string | null | undefined): string {
  return m === '多' ? 'bg-red-100 text-red-700' : m === '空' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
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
 * 這也是強勢股頁的表格不做斑馬紋、hover 停在 gray-50 的原因：底色再深一階，red-600 就會跌破 4.5。
 */
export function changeColor(dir: ChangeDir): string {
  if (dir === 'up') return 'text-red-600'
  if (dir === 'down') return 'text-green-700'
  return 'text-gray-700'
}

/**
 * 「當月強勢日期」的日清單：[4, 10] → "4, 10"。
 * 月報第 12 欄只列「日」（月份已由報表標題決定）。空陣列回 DASH，**不回 "0"**。
 */
export function fmtDayList(days: number[]): string {
  if (!days.length) return DASH
  return days.join(', ')
}

/** 籌碼增減方向。'flat' 是真的持平；null 代表「其中一邊沒有資料」，不可當成未增加 */
export type HoldDelta = 'up' | 'down' | 'flat' | null

/**
 * 外資持股張數的增減方向。
 * ⚠️ cur / prev 為 null（FinMind 未涵蓋）或 undefined（2026-08-31 及更早根本沒這個欄位）
 * 時一律回 null——「沒有比較基準」與「沒有增加」是兩件事。
 *
 * ⚠️ 比較基準（前一交易日 vs 該檔上一個強勢日）屬業主定義，本函式不決定，
 * 由呼叫端決定要餵哪個 prev 進來。
 */
export function holdDeltaDir(
  cur: number | null | undefined,
  prev: number | null | undefined
): HoldDelta {
  if (isMissing(cur) || isMissing(prev)) return null
  if (cur > prev) return 'up'
  if (cur < prev) return 'down'
  return 'flat'
}

/**
 * 是否收在漲停價（強勢月報收盤價的紅字，業主 2026-10-26 確認「紅字＝漲停，只標收盤價」）。
 *
 * 漲停價＝前一交易日收盤 × 1.1，再依升降單位**捨去**到一檔（證交所／櫃買規則）。
 * 一律換成 0.001 元的整數算，避免 33.25 × 1.1 這類浮點誤差。
 * 另外要求「最高價＝收盤價」：真的漲停時最高價不可能超過漲停價；
 * 興櫃沒有漲跌幅限制，偶爾剛好收在算出來的價位但盤中更高（實測 8～10 月 14 筆），靠這條排除。
 *
 * 已知漏網：除權息當天的參考價不是前一日收盤，那天的漲停會判斷成「沒漲停」。
 * 2026-08～10 全市場實測：漲停 2,132 筆全部對上「漲幅 ≥9.4% 且收在最高」，
 * 對不上的 105 筆都是興櫃（沒有漲停限制）。
 * 任一邊沒有資料 → null（不知道），不可當成「沒漲停」。
 */
export function isLimitUp(
  prevClose: number | null | undefined,
  close: number | null | undefined,
  high: number | null | undefined,
  stockId: string
): boolean | null {
  if (isMissing(prevClose) || isMissing(close) || isMissing(high) || prevClose <= 0 || close <= 0) return null
  const raw = Math.round(prevClose * 100) * 11 // 前收 × 1.1，單位 0.001 元
  const tick = limitTick(raw / 1000, stockId.startsWith('00'))
  const limit = Math.floor(raw / tick) * tick
  const c = Math.round(close * 1000)
  return c === limit && Math.round(high * 1000) === c
}

/** 升降單位（0.001 元為單位）。ETF（00 開頭）只有 0.01／0.05 兩級 */
function limitTick(price: number, etf: boolean): number {
  if (etf) return price < 50 ? 10 : 50
  if (price < 10) return 10
  if (price < 50) return 50
  if (price < 100) return 100
  if (price < 500) return 500
  if (price < 1000) return 1000
  return 5000
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

/* ---------------- 近 N 日投信買賣超累計（流量，不是持股） ---------------- *
 * 強勢月報的「籌碼(投信)」欄。業主手工月報那一欄原本是「投信累積持股張數」，
 * 但實測確認沒有可靠來源：FinMind 105 個資料集只有外資有逐檔官方持股申報
 * （外資有投資上限要申報，投信沒有）；投信投顧公會月報只揭露「每檔基金前十大持股」
 * 與「季占淨值 1% 以上」，加總只得下限；商業資料商的數字本身就是推估。
 * 用「公會錨點 ＋ 每日買賣超累加」的漂移實測：台積電一年 +0.89%、聯電 +5.55%，
 * 但宏齊一個月就 −43%、友達半年 −34%——而強勢股正好多是中小型股。
 *
 * ⚠️ 所以這一欄改成 100% 準確、語意明確的**流量**指標。
 * 與持股（存量）是完全不同的東西，任何顯示（表頭、說明、手機展開列）都必須標清楚。
 * -------------------------------------------------------------------- */

/**
 * 可選的累計視窗（交易日數）。
 * ⚠️ 上限刻意壓在 20（約一個月）：daily_data 目前只有 45 個交易日
 * （2026-07-24 起，只增不減），月報還要往前留 MA 暖身，再大就會有大量列拿不到完整視窗。
 */
export const TRUST_WINDOWS = [5, 10, 20] as const
export type TrustWindow = (typeof TRUST_WINDOWS)[number]

/** 預設 20 個交易日（約一個月），對應業主月報的月度視角 */
export const DEFAULT_TRUST_WINDOW: TrustWindow = 20

/** 字串（sessionStorage / query）→ 合法視窗；不合法回預設值 */
export function parseTrustWindow(v: unknown): TrustWindow {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return (TRUST_WINDOWS as readonly number[]).includes(n) ? (n as TrustWindow) : DEFAULT_TRUST_WINDOW
}

/**
 * 近 N 個交易日的投信買賣超**累計**（張）。
 *
 * ⚠️ 流量（這段期間買進減賣出的淨額），**不是**存量（手上有多少張）。
 * days < window 代表基準日往前的交易日不足，必須在 UI 明講「實際用 M 日」，
 * 絕不可默默少算當成完整 N 日。
 */
export interface TrustNetSum {
  /** 要求的視窗（交易日數） */
  window: number
  /** 實際累加到的交易日數。0 → 完全沒有明細（sum 為 null） */
  days: number
  /** 累計張數。days === 0 → null（顯示「—」）；0 是真的 0（期間淨額為零） */
  sum: number | null
  /** 實際納入的最早交易日；days === 0 → null */
  from: string | null
  /** 終點：該檔當月最後一次強勢日（與收盤價／成交量／MA 同一基準日） */
  to: string
}

/** 這一列的視窗是否被截短（有值、但不足 window 個交易日） */
export function isTrustShort(t: TrustNetSum | undefined | null): boolean {
  return !!t && t.days > 0 && t.days < t.window
}
