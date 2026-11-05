/**
 * /api/strong-stocks（強勢股頁）與 /api/screener（選股頁）共用的三條規則，改一處兩支同步：
 *   1. 哪一天：指定日期在可選清單內才用；否則用權威 latest_date，它不在清單內才退回清單第一天。
 *   2. 昨收：prev_close＝前一交易日收盤（台股漲跌幅基準）。查不到就是 undefined → JSON 省略這個 key，
 *      前端（lib/format.ts 的 computeChange）才會退回用 open。
 *   3. 強勢天數：讀取失敗是 null（畫面「—」），讀到了但近 N 日沒入選才是 0。
 *
 * ⚠️ 只給伺服器端用：內部走 lib/firebase-admin（Admin SDK）。
 *    專案沒有安裝 server-only 套件，所以這裡不寫 `import 'server-only'`；
 *    不要從 'use client' 元件 import 這支（只要型別也一樣，型別請另外放）。
 *
 * 已知 bug（未修，另開票）：getStrongCountForStocks 只收 (stockIds, days)，內部取「最新 N 個交易日」，
 * 不看 targetDate → 選舊日期時強勢天數仍是以最新日往回算（頁面以灰字與提示補救）。
 * 根治時要改 firebase-admin 的簽名讓它收 targetDate，然後只改這裡的呼叫。
 */

import { getAvailableDates, getLatestDate, getPrevCloseMap, getStrongCountForStocks } from './firebase-admin'

/** 日期下拉最多列幾個交易日（新→舊） */
const AVAILABLE_DATES_LIMIT = 20

/**
 * 決定這次請求要用哪一個交易日。
 * @param requested 網址帶的 date；不在可選清單內就靜默退回預設日（呼叫端以回應的 latestDate 為準）
 * @returns dates＝可選交易日（新→舊）、targetDate＝這次要用的那一天；沒有任何可用日期回 null
 */
export async function resolveTradingDay(
  requested: string | null
): Promise<{ dates: string[]; targetDate: string } | null> {
  const dates = await getAvailableDates(AVAILABLE_DATES_LIMIT)
  if (dates.length === 0) return null
  // 預設＝權威 latest_date（metadata），強勢股頁與選股頁同一個「最新日」，避免各頁各說各話
  const authoritative = await getLatestDate()
  const defaultDate = authoritative && dates.includes(authoritative) ? authoritative : dates[0]
  const targetDate = requested && dates.includes(requested) ? requested : defaultDate
  return { dates, targetDate }
}

export type WithStrongCountAndPrevClose<T> = T & {
  /** 近 N 日入選強勢股的天數；null＝讀取失敗（畫面「—」），不是 0 */
  strong_count: number | null
  /** 前一交易日收盤；undefined＝查不到（JSON 省略），前端退回用 open */
  prev_close: number | undefined
}

/**
 * 每檔補上 strong_count（近 days 個交易日的強勢天數）與 prev_close（前一交易日收盤）。
 * rows 是空的就直接回 []，不讀任何資料（選股 0 檔時不必多讀 days 份 strong_stocks）。
 * 回傳新物件，不改 rows（rows 可能是 dayCache 共用的陣列元素）。
 */
export async function withStrongCountAndPrevClose<T extends { stock_id?: unknown }>(
  rows: T[],
  targetDate: string,
  days: number
): Promise<WithStrongCountAndPrevClose<T>[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => String(r.stock_id))
  const [countMap, prevClose] = await Promise.all([
    getStrongCountForStocks(ids, days),
    getPrevCloseMap(targetDate),
  ])
  return rows.map((r) => {
    const id = String(r.stock_id)
    return {
      ...r,
      strong_count: countMap ? countMap[id] || 0 : null,
      // ⚠️ 不要改成 `?? null`：查不到時要整個沒有這個 key（見檔頭第 2 條）
      prev_close: prevClose[id],
    }
  })
}
