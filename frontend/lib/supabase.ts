import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// Types
export interface DailyStock {
  date: string
  stock_id: string
  stock_name: string
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
}

export interface StrongStock {
  stock_id: string
  stock_name: string
  date: string
  is_strong: boolean
}

export interface TodayStrongStock extends DailyStock {
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

export interface WatchlistItem {
  id: number
  user_id: string
  stock_id: string
  stock_name: string
  added_at: string
}

export interface StockAnalysisReport {
  id: number
  user_id: string
  stock_id: string
  stock_name: string
  report_content: string
  model_used: string
  created_at: string
}

// Auth helpers
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`
    }
  })
  return { data, error }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  return { error }
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Watchlist helpers
export async function getWatchlist() {
  const { data, error } = await supabase
    .from('user_watchlist')
    .select('*')
    .order('added_at', { ascending: false })
  return { data: data as WatchlistItem[] | null, error }
}

export async function addToWatchlist(stockId: string, stockName: string) {
  const user = await getUser()
  if (!user) return { data: null, error: new Error('Not authenticated') }

  const { data, error } = await supabase
    .from('user_watchlist')
    .insert({ user_id: user.id, stock_id: stockId, stock_name: stockName })
    .select()
    .single()
  return { data, error }
}

export async function removeFromWatchlist(stockId: string) {
  const user = await getUser()
  if (!user) return { data: null, error: new Error('Not authenticated') }

  const { data, error } = await supabase
    .from('user_watchlist')
    .delete()
    .eq('user_id', user.id)
    .eq('stock_id', stockId)
  return { data, error }
}

export async function isInWatchlist(stockId: string) {
  const user = await getUser()
  if (!user) return false

  const { data } = await supabase
    .from('user_watchlist')
    .select('id')
    .eq('user_id', user.id)
    .eq('stock_id', stockId)
    .single()
  return !!data
}
