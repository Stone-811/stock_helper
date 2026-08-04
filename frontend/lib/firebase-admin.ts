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

export async function getStocksByDate(date: string): Promise<any[]> {
  try {
    // 1. 優先從新架構讀取（分片）
    const summaryRef = db.collection('daily_data').doc(date)
    const summaryDoc = await summaryRef.get()

    if (summaryDoc.exists) {
      const summary = summaryDoc.data()
      const chunkCount = summary?.chunk_count || 0

      if (chunkCount > 0) {
        // 並行讀取所有分片
        const chunkPromises = []
        for (let i = 0; i < chunkCount; i++) {
          chunkPromises.push(
            summaryRef.collection('chunks').doc(`chunk_${i}`).get()
          )
        }

        const chunkDocs = await Promise.all(chunkPromises)
        const allStocks: any[] = []

        for (const chunkDoc of chunkDocs) {
          if (chunkDoc.exists) {
            const chunkData = chunkDoc.data()
            allStocks.push(...(chunkData?.stocks || []))
          }
        }

        return dedupeByStockId(allStocks)
      }
    }

    // 2. 備用：舊架構 stocks_by_date（單一聚合文件）
    const aggregateRef = db.collection('stocks_by_date').doc(date)
    const aggregateDoc = await aggregateRef.get()

    if (aggregateDoc.exists) {
      return dedupeByStockId(aggregateDoc.data()?.stocks || [])
    }

    // 3. 最後備用：逐筆查詢 daily_stocks
    const snapshot = await db.collection('daily_stocks')
      .where('date', '==', date)
      .get()

    return dedupeByStockId(snapshot.docs.map(doc => doc.data()))
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
    // 1. 優先從新架構讀取
    const newRef = db.collection('strong_stocks').doc(date)
    const newDoc = await newRef.get()

    if (newDoc.exists) {
      return newDoc.data()?.stocks || []
    }

    // 2. 備用：舊架構 strong_stocks_by_date
    const aggregateRef = db.collection('strong_stocks_by_date').doc(date)
    const aggregateDoc = await aggregateRef.get()

    if (aggregateDoc.exists) {
      return aggregateDoc.data()?.stocks || []
    }

    // 3. 最後備用：逐筆查詢 strong_stock_matrix
    const snapshot = await db.collection('strong_stock_matrix')
      .where('date', '==', date)
      .get()

    return snapshot.docs.map(doc => doc.data())
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

    if (!newSnapshot.empty) {
      return newSnapshot.docs.map(doc => doc.id)
    }

    // 3. 最後備用：舊架構 stocks_by_date
    const snapshot = await db.collection('stocks_by_date')
      .orderBy('date', 'desc')
      .limit(limitCount)
      .get()

    return snapshot.docs.map(doc => doc.id)
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
    // 1. 優先從新架構讀取（聚合歷史）
    const newRef = db.collection('market_index').doc(indexId)
    const newDoc = await newRef.get()

    if (newDoc.exists) {
      const data = newDoc.data()
      return data?.history || []
    }

    // 2. 備用：舊架構 market_index_daily（逐筆查詢）
    const snapshot = await db.collection('market_index_daily')
      .where('index_id', '==', indexId)
      .orderBy('date', 'asc')
      .get()

    return snapshot.docs.map(doc => doc.data())
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
    // 1. 先嘗試舊架構 strong_stock_matrix
    const oldSnapshot = await db.collection('strong_stock_matrix')
      .where('stock_id', '==', stockId)
      .orderBy('date', 'asc')
      .limit(1)
      .get()

    if (!oldSnapshot.empty) {
      // 舊架構存在，使用完整查詢
      const fullSnapshot = await db.collection('strong_stock_matrix')
        .where('stock_id', '==', stockId)
        .orderBy('date', 'asc')
        .get()

      return fullSnapshot.docs.map(doc => ({
        date: doc.data().date,
        is_strong: true
      }))
    }

    // 2. 新架構：遍歷 strong_stocks 集合
    const dates = await getAvailableDates(limitDays)
    const strongHistory: { date: string, is_strong: boolean }[] = []

    // 分批處理
    const batchSize = 20
    for (let i = 0; i < dates.length; i += batchSize) {
      const batchDates = dates.slice(i, i + batchSize)
      const batchPromises = batchDates.map(date => getStrongStocksByDate(date))
      const batchResults = await Promise.all(batchPromises)

      for (let j = 0; j < batchResults.length; j++) {
        const stocks = batchResults[j]
        const found = stocks.some((s: any) => s.stock_id === stockId)
        if (found) {
          strongHistory.push({
            date: batchDates[j],
            is_strong: true
          })
        }
      }
    }

    // 按日期排序
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
