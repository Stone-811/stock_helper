/**
 * 強勢月報彙整層（伺服器端）
 *
 * 取代業主每月手工維護的 Word《強勢商品篩選》：把「當月曾入選強勢股」的每一檔
 * 聚合成一行，欄位順序與月報一致。
 *
 * ── 為什麼要有這一層（不要把邏輯寫進 route）─────────────────────────────
 * 月報一次要跨約 30 個交易日。三個效能鐵則：
 *  1. **每個日期只讀一次 daily_data**。絕不可「每檔股票各讀自己的 10 天」——
 *     631 檔 × 10 天 = 6,310 次 getStocksByDate，dayCache 只有 4 格會全部 miss，
 *     等於同一份 0.9 MB 被重讀上百次。
 *  2. 讀完一批日期就**立刻投影成瘦資料（只留需要的 stock_id 的收盤價）並釋放整日陣列**。
 *     實測 27 天全握在記憶體是 +43 MB heap，而 apphosting.yaml 是 memoryMiB 512
 *     + concurrency 80 + minInstances 0 → 幾個並行冷算就 OOM。
 *  3. 傳給 getStocksByDate 的是 `{ cacheWrite: false }`：不要把 30 天塞進只有 4 格的
 *     dayCache（互相淘汰 + 擠掉個股頁的熱快取）。快取改做在本檔的「成品列」那層。
 *
 * 實測成本（2026-09，18 個交易日）：strong_stocks 段 ~19 次讀取 / 57 KB / 0.2 秒；
 * 數值段 37 個日期 × 6 = ~222 次讀取 / ~30 MB / ~45 秒。共約 241 次文件讀取
 * = 免費額度 50K/天的 0.48%。**瓶頸是傳輸量與延遲，不是讀取次數。**
 *
 * ⚠️ 數值段的日期窗原本是 27 天（MA10 只要 9 天暖身），2026-09-28 因為
 * 「近 20 日投信買賣超累計」而放大到 37 天（見 WINDOW_WARMUP 的註解與實測數字）。
 * 長遠正解是讓 collector 每天寫一份 monthly_strong/{YYYY-MM} 聚合文件（前端變 1 次讀取），
 * 但那要動收集器並重建 Cloud Run image，不在本次範圍。
 *
 * ── 定義（業主親自確認的部分）─────────────────────────────────────────
 *  日期     = 該檔「當月第一次」被納入強勢股的日子
 *  收盤價   = **最後一次強勢日**的收盤（不是第一次；已用 81 筆實測：70 筆吻合最後一次、0 筆吻合第一次）
 *  成交量   = 最後一次強勢日的成交量（張）
 *  5/10日均價 = 以最後一次強勢日為基準日的 MA5 / MA10
 *  當月強勢日期 = 該檔當月所有入選日的「日」
 *  籌碼(投信) = **近 N 個交易日的投信買賣超累計（張）**，終點同樣是最後一次強勢日。
 *               ⚠️ 這是流量不是持股，原因見 lib/format.ts 的 TRUST_WINDOWS 註解。
 *               N 由前端切換，所以這裡一次算好 5/10/20 三個視窗（同一份資料，零額外讀取）。
 *
 * ⚠️ KD / 均線型態兩欄的判定規則業主尚未提供，本檔**不產生任何猜測值**，
 * 頁面以「待定義」佔位。籌碼(外資) 的三角形基準亦未確認，見 foreignHoldDir 註解。
 */

import {
  getAvailableDates,
  getLatestDate,
  getStocksByDate,
  getStrongStocksByDate,
} from './firebase-admin'
import { maFromCloses } from './indicators'
import {
  holdDeltaDir,
  TRUST_WINDOWS,
  type HoldDelta,
  type TrustNetSum,
  type TrustWindow,
} from './format'

/** 月報的一列（一檔股票一列） */
export interface MonthlyReportRow {
  stockId: string
  stockName: string
  industry: string | null
  /** 欄位 1：當月第一次入選日（YYYY-MM-DD） */
  firstDate: string
  /** 收盤／成交量／籌碼／MA 全部以這一天為基準（當月最後一次入選日） */
  lastDate: string
  /** 欄位 12：當月所有入選日的「日」，升冪 */
  strongDays: number[]
  /** lastDate 當天的收盤價 */
  close: number | null
  /** lastDate 當天的成交量（張） */
  volume: number | null
  /** lastDate 當天的外資累積持股張數。null = 無資料（未涵蓋，或該日期根本還沒有這個欄位） */
  foreignHoldShares: number | null
  /** 比較基準：lastDate 的「前一個交易日」的外資持股張數 */
  foreignHoldPrev: number | null
  /**
   * 增減方向。
   * ⚠️ 基準是「前一個交易日」，**不是業主月報說的「前次」**——業主未定義「前次」是
   * 前一交易日還是該檔上一個強勢日，而實測 45.5% 的檔當月只入選 1 天（月內沒有前次可比）。
   * 另外業主的記法只有增／減兩種，但實測日間有 9.6% 真的持平 → 這裡誠實回 'flat'。
   */
  foreignHoldDir: HoldDelta
  /**
   * 欄位 6：近 N 個交易日的**投信買賣超累計**（張），終點＝lastDate。
   * 三個視窗（5/10/20）一次算好，前端切換不必重新請求（冷算要數十秒）。
   * ⚠️ 流量不是存量：不可與外資那欄的「累積持股張數」混為一談。
   * 每個視窗都附 days（實際累加的交易日數），days < window 時 UI 必須標明。
   */
  trustNet: Record<TrustWindow, TrustNetSum>
  /** 以 lastDate 為基準日的 MA5；暖身不足或期間內有缺值 → null（顯示「—」，不是 0） */
  ma5: number | null
  ma10: number | null
  /** daily_data 的 macd_status（「多」／「空」）。⚠️ 這不是業主的 +↗ / –↗ 記法 */
  macdStatus: string | null
}

export interface MonthlyReport {
  /** 實際產出的月份（YYYY-MM）。要求的月份不在 availableMonths 時會退回最新月 */
  month: string
  rows: MonthlyReportRow[]
  /** 可選月份（由 available_dates 推導，新→舊） */
  availableMonths: string[]
  /** metadata/latest_date（權威最新交易日）——表頭要標「統計至」 */
  latestDate: string | null
  /** 本月實際納入計算的交易日範圍 */
  coverage: { from: string; to: string; tradingDays: number } | null
  /**
   * 本月的明細資料（daily_data）起點晚於月初，或 MA10 暖身不足。
   * 例：daily_data 最早只到 2026-07-24，做 8 月報表時 8 月初那些列的 MA10 必須是「—」。
   */
  partialMonth: boolean
  /** 本月完全沒有外資持股張數（collector 2026-09-01 起才收這欄）→ 整欄要標示原因 */
  foreignHoldUnavailable: boolean
  /** 該月在 daily_data 完全沒有明細 → 頁面要說「此月份無明細資料」而不是渲染一整頁「—」 */
  dataMissing: boolean
  generatedAt: string
}

/* --------------------------- 內部工具 --------------------------- */

/** daily_data 的一列（只取月報用得到的欄位）。⚠️ 沒有 date 欄位：日期一律由外層迴圈帶 */
interface DailyRow {
  stock_id?: string
  stock_name?: string
  industry?: string
  close?: number | null
  volume?: number | null
  macd_status?: string
  foreign_hold_shares?: number | null
  /** 投信買賣超（張）。collector 一律補 0（0 多半是真的：樣本中投信 78% 當天真的沒買賣），
   *  所以這裡的 undefined 只會出現在「該日整檔沒有明細」的情況 */
  trust_buy?: number | null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** 一次讀幾個日期。太大會讓峰值記憶體爆掉（每天約 0.9 MB × 2,344 檔物件） */
const DATE_BATCH = 6
/** MA10 需要基準日往前 9 個交易日 */
const MA_WARMUP = 9

/** 投信累計最大視窗（= TRUST_WINDOWS 的最大值），往前需要 20-1 = 19 個交易日 */
const MAX_TRUST_WINDOW = Math.max(...TRUST_WINDOWS)

/**
 * 數值段日期窗要往前暖身幾個交易日。
 *
 * ⚠️ 這個數字直接決定 Firestore 傳輸量，**改動前先看實測**（2026-09、18 個交易日、631 檔）：
 *   warmup 9（原本，只夠 MA10）：窗 27 天 → ~162 次讀取 / 22 MB / ~33 秒，
 *     但近 20 日投信累計會有 **206/631 = 32.6%** 的列拿不到完整 20 天。
 *   warmup 19（現在）：窗 37 天 → ~222 次讀取 / ~30 MB / ~45 秒，20 日視窗 **0% 被截短**。
 *
 * 選 19 的理由：那 32.6% 的資料**明明存在**（available_dates 有 45 天、最舊 2026-07-24，
 * 原本的窗起點還在 index 18），少算就是在一個標榜「累計」的數字上默默漏掉三分之一的列。
 * 本專案的第一原則是「絕不顯示不是它聲稱的那個數字」（同 MA10 絕不用 6 天平均充當），
 * 為此多讀 60 份文件（免費額度 50K/天的 0.12%）是划算的。
 * 記憶體不受影響：每批讀完仍立刻投影成瘦 map 並釋放整日陣列（見檔頭鐵則 2）。
 *
 * 若哪天要把傳輸量壓回去：把這裡改回 MA_WARMUP，並把 TRUST_WINDOWS 的 20 拿掉
 * （**不要**留著 20 卻縮窗，那會讓三分之一的列變成「實際 10 日」）。
 */
const WINDOW_WARMUP = Math.max(MA_WARMUP, MAX_TRUST_WINDOW - 1)

/* ------------------------- 成品快取 ------------------------- *
 * 快取的是「成品列」（631 列 × 十幾個數字，幾十 KB），不是 0.9 MB 的原始日資料。
 * key 帶 latestDate：collector 寫入新的一天就自動失效。
 * ⚠️ minInstances: 0 代表每次 scale-from-zero 這個 Map 都是空的，所以 route 層的
 * HTTP 快取（跨 instance）比這個記憶體 Map 重要得多；這裡只擋同一台的重複請求。
 * ---------------------------------------------------------- */
const REPORT_CACHE_TTL_MS = 10 * 60 * 1000
const REPORT_CACHE_MAX = 3
const reportCache = new Map<string, { at: number; data: MonthlyReport }>()

function readReportCache(key: string): MonthlyReport | null {
  const hit = reportCache.get(key)
  if (hit && Date.now() - hit.at < REPORT_CACHE_TTL_MS) return hit.data
  if (hit) reportCache.delete(key)
  return null
}

function writeReportCache(key: string, data: MonthlyReport) {
  reportCache.set(key, { at: Date.now(), data })
  while (reportCache.size > REPORT_CACHE_MAX) {
    const oldest = [...reportCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    reportCache.delete(oldest[0])
  }
}

/* --------------------------- 主函式 --------------------------- */

export async function buildMonthlyReport(requestedMonth?: string): Promise<MonthlyReport> {
  // 交易日軸一律用 available_dates（1 次讀取），**不可用日曆天加減**（會踩到假日）。
  // ⚠️ getAvailableDates 是從陣列前端 slice（新→舊），限制數字給小了會把舊月份無聲截掉，
  //    所以一次拿全集（目前 45 天，給 400 是為了未來幾個月不必再改）。
  const dates = await getAvailableDates(400)
  const latestDate = await getLatestDate()

  const emptyReport = (month: string): MonthlyReport => ({
    month,
    rows: [],
    availableMonths: [],
    latestDate,
    coverage: null,
    partialMonth: false,
    foreignHoldUnavailable: false,
    dataMissing: true,
    generatedAt: new Date().toISOString(),
  })

  if (!dates.length) return emptyReport(requestedMonth ?? '')

  // getAvailableDates 回傳的是 slice 產生的新陣列，可以安全排序（與 dayCache 的共用陣列不同）
  const asc = [...dates].sort()
  const availableMonths = Array.from(new Set(asc.map((d) => d.slice(0, 7)))).sort().reverse()

  const month =
    requestedMonth && availableMonths.includes(requestedMonth)
      ? requestedMonth
      : availableMonths[0]

  const cacheKey = `${month}|${latestDate ?? asc[asc.length - 1]}`
  const cached = readReportCache(cacheKey)
  if (cached) return cached

  const monthDates = asc.filter((d) => d.slice(0, 7) === month)
  if (!monthDates.length) {
    const r = { ...emptyReport(month), availableMonths }
    return r
  }

  /* ---- 第一段：入選日（便宜。整月 ~21 次 point get、約 57 KB）---- */
  // 用現成的 getStrongStocksByDate 並行打就好：實測 range query 同樣計費，但慢 3.8 倍。
  const strongLists = await inBatches(monthDates, 12, (d) => getStrongStocksByDate(d))

  interface Agg {
    stockId: string
    stockName: string
    firstDate: string
    lastDate: string
    days: number[]
  }
  const agg = new Map<string, Agg>()

  monthDates.forEach((date, i) => {
    const day = Number(date.slice(8, 10))
    for (const s of strongLists[i] as Array<{ stock_id?: string; stock_name?: string }>) {
      const id = String(s?.stock_id ?? '')
      if (!id) continue
      const prev = agg.get(id)
      if (!prev) {
        agg.set(id, {
          stockId: id,
          stockName: s.stock_name || id,
          firstDate: date,
          lastDate: date,
          days: [day],
        })
      } else {
        // monthDates 是升冪，所以後面遇到的一定比較晚
        prev.lastDate = date
        prev.days.push(day)
        if (!prev.stockName || prev.stockName === id) prev.stockName = s.stock_name || prev.stockName
      }
    }
  })

  if (agg.size === 0) {
    const r: MonthlyReport = {
      ...emptyReport(month),
      availableMonths,
      coverage: { from: monthDates[0], to: monthDates[monthDates.length - 1], tradingDays: monthDates.length },
      dataMissing: false, // 有交易日、只是當月沒有任何股票入選
    }
    writeReportCache(cacheKey, r)
    return r
  }

  /* ---- 第二段：數值（貴的都在這）---- */
  const indexOf = new Map(asc.map((d, i) => [d, i]))
  const aggs = [...agg.values()]

  const lastIdxOf = new Map<string, number>()
  for (const a of aggs) lastIdxOf.set(a.stockId, indexOf.get(a.lastDate) ?? -1)

  const minLastIdx = Math.min(...aggs.map((a) => lastIdxOf.get(a.stockId)!))
  const maxLastIdx = Math.max(...aggs.map((a) => lastIdxOf.get(a.stockId)!))
  // 日期窗＝「最早的 last-strong-day 往前 WINDOW_WARMUP 個交易日」到「最晚的 last-strong-day」，
  // 用 available_dates 的 index 位移取（不是日曆天）。
  // WINDOW_WARMUP ≥ MAX_TRUST_WINDOW-1 保證每一檔的 20 日投信視窗都落在窗內
  // （windowStart = minLastIdx-19 ≤ li-19，因為 minLastIdx ≤ li），所以截短只會發生在
  // 「往前撞到整個 available_dates 的起點」這種真正的資料不足。
  const windowStart = Math.max(0, minLastIdx - WINDOW_WARMUP)
  const windowDates = asc.slice(windowStart, maxLastIdx + 1)

  const needed = new Set(aggs.map((a) => a.stockId))

  /** 反查：哪些股票以這一天為 lastDate（要抓整列）／以這一天為「前一交易日」（只要外資持股） */
  const lastDateStocks = new Map<string, string[]>()
  const prevDateStocks = new Map<string, string[]>()
  for (const a of aggs) {
    push(lastDateStocks, a.lastDate, a.stockId)
    const li = lastIdxOf.get(a.stockId)!
    // li === 0 代表 lastDate 就是資料集最舊的一天 → 沒有前一交易日 → 之後一律「—」、不畫三角
    if (li > 0) push(prevDateStocks, asc[li - 1], a.stockId)
  }

  /** 日期 × 股票 → 收盤價（只留需要的股票，實測整月僅數百 KB） */
  const closeByDate = new Map<string, Map<string, number | null>>()
  /**
   * 日期 × 股票 → 投信買賣超（張）。與 closeByDate 在**同一次掃描**填好，
   * 不另外讀 Firestore（檔頭鐵則 1）。
   * ⚠️ 只放「有數字」的項目：查不到 key 就代表該檔該日沒有明細（視窗要少算一天並標明），
   * 與「trust_buy 真的是 0」在語意上必須分開。
   */
  const trustByDate = new Map<string, Map<string, number>>()
  const rowAtLast = new Map<string, DailyRow>()
  const holdAtPrev = new Map<string, number | null>()

  for (let i = 0; i < windowDates.length; i += DATE_BATCH) {
    const batch = windowDates.slice(i, i + DATE_BATCH)
    const loaded = await Promise.all(
      // ⚠️ cacheWrite:false —— 見檔頭鐵則 3
      batch.map((d) => getStocksByDate(d, { cacheWrite: false }) as Promise<DailyRow[]>)
    )
    batch.forEach((date, j) => {
      const rows = loaded[j]
      const closes = new Map<string, number | null>()
      const trusts = new Map<string, number>()
      const wantFull = lastDateStocks.get(date)
      const wantHold = prevDateStocks.get(date)
      const fullSet = wantFull ? new Set(wantFull) : null
      const holdSet = wantHold ? new Set(wantHold) : null
      for (const r of rows) {
        const id = r?.stock_id ? String(r.stock_id) : ''
        if (!id || !needed.has(id)) continue
        closes.set(id, num(r.close))
        const tb = num(r.trust_buy)
        if (tb !== null) trusts.set(id, tb)
        if (fullSet?.has(id)) {
          rowAtLast.set(id, {
            stock_id: id,
            stock_name: r.stock_name,
            industry: r.industry,
            close: num(r.close),
            volume: num(r.volume),
            macd_status: typeof r.macd_status === 'string' ? r.macd_status : undefined,
            // undefined（2026-08-31 及更早沒這個 key）與 null（FinMind 未涵蓋）都收斂成 null，
            // 兩者 UI 都是「—」；語意差異由 report.foreignHoldUnavailable 在頁面層說明。
            foreign_hold_shares: num(r.foreign_hold_shares),
          })
        }
        if (holdSet?.has(id)) holdAtPrev.set(id, num(r.foreign_hold_shares))
      }
      closeByDate.set(date, closes)
      trustByDate.set(date, trusts)
      // loaded[j] 這一天的整日陣列到此就沒人引用了，交給 GC（峰值從 +43 MB 壓到約一天的 2 MB）
      loaded[j] = []
    })
  }

  /* ---- 組列 ---- */
  const rows: MonthlyReportRow[] = aggs.map((a) => {
    const li = lastIdxOf.get(a.stockId)!
    const detail = rowAtLast.get(a.stockId)

    // MA：從交易日軸上取「連續」的收盤價序列。缺一格就回 null，絕不用有值的日子擠在一起充數
    const closesFor = (period: number): (number | null | undefined)[] => {
      const out: (number | null | undefined)[] = []
      for (let k = li - period + 1; k <= li; k++) {
        if (k < 0) return [] // 暖身不足 → maFromCloses 會回 null
        out.push(closeByDate.get(asc[k])?.get(a.stockId))
      }
      return out
    }

    /**
     * 近 N 日投信買賣超累計：終點固定 lastDate（與收盤／成交量／MA 同基準日），
     * 往前用交易日軸的 index 位移取 N 天（不可用日曆天）。
     *
     * ⚠️ 遇到「該檔該日沒有明細」時**跳過且不計入 days**，不是當成 0——
     * 當成 0 會讓累計看起來完整，實際上是少算。days < window 時由 UI 明講「實際 M 日」。
     */
    const trustNet = {} as Record<TrustWindow, TrustNetSum>
    for (const w of TRUST_WINDOWS) {
      let sum = 0
      let days = 0
      let from: string | null = null
      for (let k = Math.max(0, li - w + 1); k <= li; k++) {
        const v = trustByDate.get(asc[k])?.get(a.stockId)
        if (v === undefined) continue
        sum += v
        days += 1
        if (from === null) from = asc[k]
      }
      trustNet[w] = { window: w, days, sum: days > 0 ? sum : null, from, to: a.lastDate }
    }

    const hold = detail ? (detail.foreign_hold_shares ?? null) : null
    const holdPrev = holdAtPrev.has(a.stockId) ? (holdAtPrev.get(a.stockId) ?? null) : null

    return {
      stockId: a.stockId,
      stockName: detail?.stock_name || a.stockName,
      industry: detail?.industry ? String(detail.industry) : null,
      firstDate: a.firstDate,
      lastDate: a.lastDate,
      strongDays: [...a.days].sort((x, y) => x - y),
      close: detail?.close ?? null,
      volume: detail?.volume ?? null,
      foreignHoldShares: hold,
      foreignHoldPrev: holdPrev,
      foreignHoldDir: holdDeltaDir(hold, holdPrev),
      trustNet,
      ma5: maFromCloses(closesFor(5), 5),
      ma10: maFromCloses(closesFor(10), 10),
      macdStatus: detail?.macd_status ?? null,
    }
  })

  // 預設排序：第一次入選日、同日以代號穩定排序（與 Word 月報的閱讀順序一致）
  rows.sort((x, y) => x.firstDate.localeCompare(y.firstDate) || x.stockId.localeCompare(y.stockId))

  const report: MonthlyReport = {
    month,
    rows,
    availableMonths,
    latestDate,
    coverage: {
      from: monthDates[0],
      to: monthDates[monthDates.length - 1],
      tradingDays: monthDates.length,
    },
    /**
     * 兩種情況都會讓部分列的 MA 必須是「—」，頁面用同一則提示說明：
     *  (a) 本月最早的交易日就是整個 daily_data 的起點 → 月初可能還有交易日沒有明細
     *      （實例：daily_data 最早只到 2026-07-24，做 7 月報表時月初 15 個交易日全缺）
     *  (b) 最早的「最後強勢日」往前不足 9 個交易日 → MA10 暖身不足
     *      （實例：做 8 月報表時 2026-08-03 往前只有 6 個交易日）
     * ⚠️ 絕不可拿 6 天平均充當 MA10。
     */
    partialMonth: monthDates[0] === asc[0] || minLastIdx - MA_WARMUP < 0,
    foreignHoldUnavailable: rows.every((r) => r.foreignHoldShares === null),
    dataMissing: false,
    generatedAt: new Date().toISOString(),
  }

  writeReportCache(cacheKey, report)
  return report
}

/* --------------------------- 小工具 --------------------------- */

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const cur = m.get(k)
  if (cur) cur.push(v)
  else m.set(k, [v])
}

/** 分批並行：一次打太多 point get 會被 Firestore 排隊，太少則延遲疊加 */
async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return out
}
