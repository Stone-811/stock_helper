/**
 * Firebase Admin SDK 配置
 * 用於 API Routes（伺服器端）
 */

import { initializeApp, getApps, cert, App } from 'firebase-admin/app'
import { getFirestore, Firestore } from 'firebase-admin/firestore'
import { getAuth, Auth } from 'firebase-admin/auth'

let app: App
let adminDb: Firestore
let adminAuth: Auth

function initializeFirebaseAdmin() {
  if (getApps().length === 0) {
    // 優先使用環境變數中的 service account（生產環境）
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
      app = initializeApp({
        credential: cert(serviceAccount),
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'stock-analysis-b5602'
      })
    } else {
      // 本地開發：使用 service-account.json 檔案
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const serviceAccount = require('../service-account.json')
        app = initializeApp({
          credential: cert(serviceAccount),
          projectId: 'stock-analysis-b5602'
        })
      } catch {
        // 如果找不到檔案，使用預設憑證
        app = initializeApp({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'stock-analysis-b5602'
        })
      }
    }
  } else {
    app = getApps()[0]
  }

  adminDb = getFirestore(app)
  adminAuth = getAuth(app)

  return { app, adminDb, adminAuth }
}

// 初始化
const { adminDb: db, adminAuth: auth } = initializeFirebaseAdmin()

export { db, auth }

// ============ 伺服器端資料查詢函數 ============

/**
 * 取得最新日期
 */
export async function getLatestDate(): Promise<string | null> {
  try {
    const metadataRef = db.collection('metadata').doc('latest_date')
    const doc = await metadataRef.get()
    return doc.exists ? doc.data()?.date : null
  } catch (error) {
    console.error('取得最新日期失敗:', error)
    return null
  }
}

/**
 * 取得指定日期的所有股票（優化版：從分片讀取）
 *
 * 新架構：daily_data/{date}/chunks/chunk_{n}
 * 每個分片包含 500 筆股票，約 5-6 個分片
 */
/** 去重：daily_data 分片可能含重複 stock_id（見 collector _merge_data 一對多 merge 修正），前端讀取層再保險一次 */
function dedupeByStockId(stocks: any[]): any[] {
  const seen = new Set<string>()
  return stocks.filter((s) => {
    const id = String(s?.stock_id ?? '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

// 當日全市場資料的跨請求快取。
// getStocksByDate 一次要讀 1 個 summary + 5 個 chunk（約 0.9 MB／2,343 檔），但個股頁
// 只用其中 1 檔的十幾個欄位；React 的 cache() 只在「單一請求內」有效，跨請求仍會重讀。
// 資料每天只在 17:00／22:00 更新兩次，故短 TTL 既安全又能吃到大部分命中。
// 注意：回傳的陣列由呼叫端共用，呼叫端只做 map/filter 產生新物件，不可就地修改。
const DAY_CACHE_TTL_MS = 5 * 60 * 1000
const DAY_CACHE_MAX = 4
const dayCache = new Map<string, { at: number; data: any[] }>()

function readDayCache(date: string): any[] | null {
  const hit = dayCache.get(date)
  if (hit && Date.now() - hit.at < DAY_CACHE_TTL_MS) return hit.data
  if (hit) dayCache.delete(date)
  return null
}

function writeDayCache(date: string, data: any[]) {
  if (!data.length) return            // 不快取空結果，避免資料剛產生時被擋 5 分鐘
  dayCache.set(date, { at: Date.now(), data })
  while (dayCache.size > DAY_CACHE_MAX) {
    const oldest = [...dayCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    dayCache.delete(oldest[0])
  }
}

export async function getStocksByDate(date: string): Promise<any[]> {
  const cached = readDayCache(date)
  if (cached) return cached

  try {
    const summaryRef = db.collection('daily_data').doc(date)
    const summaryDoc = await summaryRef.get()
    if (!summaryDoc.exists) return []

    const chunkCount = summaryDoc.data()?.chunk_count || 0
    if (chunkCount <= 0) return []

    // 並行讀取所有分片
    const chunkDocs = await Promise.all(
      Array.from({ length: chunkCount }, (_, i) =>
        summaryRef.collection('chunks').doc(`chunk_${i}`).get()
      )
    )

    const allStocks: any[] = []
    for (const chunkDoc of chunkDocs) {
      if (chunkDoc.exists) allStocks.push(...(chunkDoc.data()?.stocks || []))
    }

    const result = dedupeByStockId(allStocks)
    writeDayCache(date, result)
    return result
  } catch (error) {
    console.error('取得股票資料失敗:', error)
    return []
  }
}

/**
 * 取得指定日期的強勢股（優化版：單一聚合文件）
 *
 * 新架構：strong_stocks/{date}
 * 每個文件包含當日所有強勢股（約 50-100 筆）
 */
export async function getStrongStocksByDate(date: string): Promise<any[]> {
  try {
    // strong_stocks/{date} 是唯一來源。
    // 舊架構 strong_stock_matrix 已於 2024-07-03 停止更新，若留作備援會在
    // strong_stocks 偶然缺漏時默默回傳 14 個月前的舊資料（同樣的坑在
    // getStockStrongHistory 踩過一次，見該函式註解），故一併移除。
    const doc = await db.collection('strong_stocks').doc(date).get()
    return doc.exists ? (doc.data()?.stocks || []) : []
  } catch (error) {
    console.error('取得強勢股失敗:', error)
    return []
  }
}

/**
 * 取得可用的交易日期列表（優化版）
 *
 * 優先從 metadata/available_dates 讀取（1 次讀取）
 */
export async function getAvailableDates(limitCount: number = 20): Promise<string[]> {
  try {
    // 1. 優先從 metadata 讀取
    const metadataRef = db.collection('metadata').doc('available_dates')
    const doc = await metadataRef.get()

    if (doc.exists) {
      const dates = doc.data()?.dates || []
      return dates.slice(0, limitCount)
    }

    // 2. 備用：從新架構 daily_data 查詢
    const newSnapshot = await db.collection('daily_data')
      .orderBy('date', 'desc')
      .limit(limitCount)
      .get()

    return newSnapshot.empty ? [] : newSnapshot.docs.map(doc => doc.id)
  } catch (error) {
    console.error('取得日期列表失敗:', error)
    return []
  }
}

/**
 * 取得指數資料（優化版：聚合歷史）
 *
 * 新架構：market_index/{index_id}
 * 單一文件包含完整歷史記錄（history 陣列）
 * 讀取次數：1 次（原本 500+ 次）
 */
export async function getMarketIndex(indexId: string): Promise<any[]> {
  try {
    // market_index/{indexId} 的 history 陣列是唯一來源（1 次讀取涵蓋完整歷史）。
    // 舊架構 market_index_daily 已停止更新且範圍較窄，移除以免回傳過期資料。
    const doc = await db.collection('market_index').doc(indexId).get()
    return doc.exists ? (doc.data()?.history || []) : []
  } catch (error) {
    console.error('取得指數資料失敗:', error)
    return []
  }
}

/**
 * 取得個股強勢股歷史（優化版）
 *
 * 從 strong_stocks/{date} 聚合文件中搜尋
 */
export async function getStockStrongHistory(stockId: string, limitDays: number = 100): Promise<{ date: string, is_strong: boolean }[]> {
  try {
    // 現行架構：逐日讀 strong_stocks/{date} 的強勢股清單。
    // 註：舊架構 strong_stock_matrix 已停止更新（最後一日 2024-07-03），不再作為來源——
    //     否則會讀到過期資料，導致「近 N 日強勢」恆為 0（且該 stock_id+date 查詢還需複合索引）。
    const dates = await getAvailableDates(limitDays)
    const strongHistory: { date: string, is_strong: boolean }[] = []

    // 分批並行查詢，降低往返延遲
    const batchSize = 20
    for (let i = 0; i < dates.length; i += batchSize) {
      const batchDates = dates.slice(i, i + batchSize)
      const batchResults = await Promise.all(batchDates.map(date => getStrongStocksByDate(date)))

      for (let j = 0; j < batchResults.length; j++) {
        const found = batchResults[j].some((s: any) => s.stock_id === stockId)
        if (found) {
          strongHistory.push({ date: batchDates[j], is_strong: true })
        }
      }
    }

    strongHistory.sort((a, b) => a.date.localeCompare(b.date))
    return strongHistory
  } catch (error) {
    console.error('取得強勢股歷史失敗:', error)
    return []
  }
}

/**
 * 計算股票列表在指定天數內的強勢次數（優化版）
 *
 * 用於強勢股頁面顯示連續強勢天數
 */
export async function getStrongCountForStocks(stockIds: string[], days: number = 7): Promise<Record<string, number>> {
  try {
    const countMap: Record<string, number> = {}
    const dates = await getAvailableDates(days)

    // 從每個日期的強勢股文件中計算
    for (const date of dates) {
      const stocks = await getStrongStocksByDate(date)
      for (const stock of stocks) {
        if (stockIds.includes(stock.stock_id)) {
          countMap[stock.stock_id] = (countMap[stock.stock_id] || 0) + 1
        }
      }
    }

    return countMap
  } catch (error) {
    console.error('計算強勢次數失敗:', error)
    return {}
  }
}

/**
 * 取「前一交易日收盤價」對照表（stock_id → close）。
 * 台股漲跌幅慣例是對前一日收盤，但 daily_data 每日文件沒有此欄位，
 * 故從 available_dates 找出 targetDate 的前一天、讀該日聚合資料組成 map。
 * 找不到前一日（例如 daily_data 只保留近幾天、targetDate 已是最舊）時回空 map，
 * 呼叫端應 fallback 回當日開盤價。
 */
export async function getPrevCloseMap(targetDate: string): Promise<Record<string, number>> {
  try {
    const dates = await getAvailableDates(30)
    const sorted = [...dates].sort().reverse() // 由新到舊
    const idx = sorted.indexOf(targetDate)
    const prevDate = idx >= 0 ? sorted[idx + 1] : sorted.find((d) => d < targetDate)
    if (!prevDate) return {}
    const prevStocks = await getStocksByDate(prevDate)
    const map: Record<string, number> = {}
    for (const s of prevStocks as Array<{ stock_id?: string; close?: number }>) {
      if (s.stock_id && typeof s.close === 'number') map[s.stock_id] = s.close
    }
    return map
  } catch (e) {
    console.error('getPrevCloseMap failed:', e)
    return {}
  }
}
