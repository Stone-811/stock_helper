/**
 * Firebase Client SDK 配置
 * 用於前端身份驗證和 Firestore 查詢
 */

import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  User
} from 'firebase/auth'
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp
} from 'firebase/firestore'

// Firebase 配置
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBVxC5LJayAWEdQCBCZdt2-t8KD8ZwDgWM",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "stock-analysis-b5602.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "stock-analysis-b5602",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "stock-analysis-b5602.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "378586078979",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:378586078979:web:a7a1a719d67c00df249336",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-WCF4TNHGJ2"
}

// 初始化 Firebase（確保只初始化一次）
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]
export const auth = getAuth(app)
export const db = getFirestore(app)

// Google OAuth Provider
const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({
  prompt: 'select_account'
})

// ============ 身份驗證函數 ============

/**
 * 使用 Google 登入
 */
export async function signInWithGoogle(): Promise<User | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider)
    return result.user
  } catch (error) {
    console.error('Google 登入失敗:', error)
    return null
  }
}

/**
 * 登出
 */
export async function signOut(): Promise<void> {
  try {
    await firebaseSignOut(auth)
  } catch (error) {
    console.error('登出失敗:', error)
  }
}

/**
 * 監聽認證狀態變化
 */
export function onAuthChange(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

// ============ 自選股函數 ============

export interface WatchlistItem {
  stock_id: string
  stock_name: string
  added_at: Date
}

/**
 * 取得用戶自選股列表
 */
export async function getWatchlist(): Promise<WatchlistItem[]> {
  const user = auth.currentUser
  if (!user) return []

  try {
    const watchlistRef = collection(db, 'user_watchlists', user.uid, 'stocks')
    const snapshot = await getDocs(watchlistRef)

    return snapshot.docs.map(doc => {
      const data = doc.data()
      return {
        stock_id: data.stock_id,
        stock_name: data.stock_name,
        added_at: data.added_at?.toDate() || new Date()
      }
    })
  } catch (error) {
    console.error('取得自選股失敗:', error)
    return []
  }
}

/**
 * 新增自選股
 */
export async function addToWatchlist(stockId: string, stockName: string): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false

  try {
    const stockRef = doc(db, 'user_watchlists', user.uid, 'stocks', stockId)
    await setDoc(stockRef, {
      stock_id: stockId,
      stock_name: stockName,
      added_at: Timestamp.now()
    })
    return true
  } catch (error) {
    console.error('新增自選股失敗:', error)
    return false
  }
}

/**
 * 移除自選股
 */
export async function removeFromWatchlist(stockId: string): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false

  try {
    const stockRef = doc(db, 'user_watchlists', user.uid, 'stocks', stockId)
    await deleteDoc(stockRef)
    return true
  } catch (error) {
    console.error('移除自選股失敗:', error)
    return false
  }
}

/**
 * 檢查股票是否在自選股中
 */
export async function isInWatchlist(stockId: string): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false

  try {
    const stockRef = doc(db, 'user_watchlists', user.uid, 'stocks', stockId)
    const docSnap = await getDoc(stockRef)
    return docSnap.exists()
  } catch (error) {
    console.error('檢查自選股失敗:', error)
    return false
  }
}

// ============ 到價 / 訊號警示 ============

export type AlertType = 'price_above' | 'price_below' | 'macd_bullish' | 'macd_bearish' | 'foreign_streak' | 'trust_streak'

export interface StockAlert {
  id: string
  stock_id: string
  stock_name: string
  type: AlertType
  value: number
  email: string
  enabled: boolean
  created_at: Date
  triggered_at?: string
}

/** 新增警示（auto-id）；自動帶登入者 email 供後端寄送 */
export async function addAlert(stockId: string, stockName: string, type: AlertType, value: number): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false
  try {
    const alertsRef = collection(db, 'user_alerts', user.uid, 'alerts')
    await addDoc(alertsRef, {
      stock_id: stockId,
      stock_name: stockName,
      type,
      value,
      email: user.email || '',
      enabled: true,
      created_at: Timestamp.now(),
    })
    return true
  } catch (error) {
    console.error('新增警示失敗:', error)
    return false
  }
}

/** 取得使用者所有警示 */
export async function getAlerts(): Promise<StockAlert[]> {
  const user = auth.currentUser
  if (!user) return []
  try {
    const snapshot = await getDocs(collection(db, 'user_alerts', user.uid, 'alerts'))
    return snapshot.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        stock_id: data.stock_id,
        stock_name: data.stock_name,
        type: data.type,
        value: data.value,
        email: data.email,
        enabled: data.enabled,
        created_at: data.created_at?.toDate() || new Date(),
        triggered_at: data.triggered_at,
      }
    })
  } catch (error) {
    console.error('取得警示失敗:', error)
    return []
  }
}

/** 取得某檔股票的警示 */
export async function getAlertsForStock(stockId: string): Promise<StockAlert[]> {
  return (await getAlerts()).filter((a) => a.stock_id === stockId)
}

/** 移除警示 */
export async function removeAlert(alertId: string): Promise<boolean> {
  const user = auth.currentUser
  if (!user) return false
  try {
    await deleteDoc(doc(db, 'user_alerts', user.uid, 'alerts', alertId))
    return true
  } catch (error) {
    console.error('移除警示失敗:', error)
    return false
  }
}

// ============ TypeScript 類型定義 ============

export interface DailyStock {
  date: string
  stock_id: string
  stock_name: string
  industry?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  day_trading_volume: number
  foreign_buy: number
  trust_buy: number
  dealer_buy: number
  foreign_hold_ratio: number
  foreign_remain_ratio: number
  foreign_limit_ratio: number
  macd_status: string
  foreign_streak?: number // 外資連續買賣天數（連買 +N、連賣 -N；舊資料可能無此欄位）
  trust_streak?: number   // 投信連續買賣天數
}

export interface StrongStock extends DailyStock {
  /** 前一交易日收盤（漲跌幅基準，由 API 補；舊資料可能沒有）*/
  prev_close?: number
  strong_count?: number
}

export interface MarketIndex {
  date: string
  index_id: string
  index_name: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  open_interest?: number
  settlement_price?: number
}
