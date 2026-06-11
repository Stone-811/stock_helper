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
