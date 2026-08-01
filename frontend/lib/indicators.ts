/**
 * 技術指標計算（純函式）
 *
 * StockChart（個股）與 IndexChart（大盤）共用，避免重複實作。
 * 計算邏輯與原本圖表元件保持一致，另新增布林通道（BBAND）。
 *
 * 命名慣例：
 *   - xxxValues：回傳按 index 對齊的陣列（含 null），供十字線 tooltip 讀取
 *   - toLineData：把 Values 陣列轉成 lightweight-charts 的 { time, value }[]（過濾 null）
 */

// 指標計算所需的最小 K 線欄位（DailyStock / MarketIndex 皆相容）
export interface Candle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MACDValue {
  dif: number
  macd: number
  histogram: number
}

export interface KDValue {
  k: number
  d: number
}

export interface BBandValue {
  upper: number
  middle: number
  lower: number
}

export interface LinePoint {
  time: string
  value: number
}

// ========== EMA（指數移動平均，供 MACD 使用）==========
export function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = []
  const multiplier = 2 / (period + 1)

  let sum = 0
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i]
  }
  result[period - 1] = sum / period

  for (let i = period; i < data.length; i++) {
    result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1]
  }
  return result
}

// ========== MA（簡單移動平均）==========
export function calculateMAValues<T extends Candle>(data: T[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null)
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, item) => acc + item.close, 0)
    result[i] = sum / period
  }
  return result
}

// ========== MACD ==========
export function calculateMACDValues<T extends Candle>(
  data: T[],
  fast = 12,
  slow = 26,
  signal = 9
): (MACDValue | null)[] {
  const result: (MACDValue | null)[] = new Array(data.length).fill(null)
  const closes = data.map(d => d.close)
  const emaFast = calculateEMA(closes, fast)
  const emaSlow = calculateEMA(closes, slow)

  const dif: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1) {
      dif.push(0)
    } else {
      dif.push(emaFast[i] - emaSlow[i])
    }
  }

  const macdLine = calculateEMA(dif.slice(slow - 1), signal)
  const fullMacd = new Array(slow - 1).fill(0).concat(macdLine)

  for (let i = slow + signal - 2; i < data.length; i++) {
    result[i] = {
      dif: dif[i],
      macd: fullMacd[i],
      histogram: dif[i] - fullMacd[i],
    }
  }
  return result
}

// ========== KD（隨機指標）==========
export function calculateKDValues<T extends Candle>(data: T[], period = 9): (KDValue | null)[] {
  const result: (KDValue | null)[] = new Array(data.length).fill(null)
  let prevK = 50
  let prevD = 50

  for (let i = period - 1; i < data.length; i++) {
    const periodData = data.slice(i - period + 1, i + 1)
    const high = Math.max(...periodData.map(d => d.high))
    const low = Math.min(...periodData.map(d => d.low))
    const close = data[i].close

    const rsv = high !== low ? ((close - low) / (high - low)) * 100 : 50
    const k = (2 / 3) * prevK + (1 / 3) * rsv
    const d = (2 / 3) * prevD + (1 / 3) * k

    result[i] = { k, d }
    prevK = k
    prevD = d
  }
  return result
}

// ========== RSI（相對強弱指標）==========
export function calculateRSIValues<T extends Candle>(data: T[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null)
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)

    if (i >= period) {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      result[i] = 100 - (100 / (1 + rs))
    }
  }
  return result
}

// ========== 布林通道 BBAND（新增）==========
// middle = MA(period)，upper/lower = middle ± mult × 標準差
export function calculateBBANDValues<T extends Candle>(
  data: T[],
  period = 20,
  mult = 2
): (BBandValue | null)[] {
  const result: (BBandValue | null)[] = new Array(data.length).fill(null)
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(d => d.close)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    result[i] = {
      middle: mean,
      upper: mean + mult * std,
      lower: mean - mult * std,
    }
  }
  return result
}

// ========== Helper：Values 陣列 → lightweight-charts LineData（過濾 null）==========
export function toLineData<T extends Candle>(
  data: T[],
  values: (number | null)[]
): LinePoint[] {
  const out: LinePoint[] = []
  for (let i = 0; i < data.length; i++) {
    const v = values[i]
    if (v !== null && v !== undefined) {
      out.push({ time: data[i].date, value: v })
    }
  }
  return out
}

// ========== Helper：從 BBand Values 取單一線（upper/middle/lower）→ LineData ==========
export function bbandLine<T extends Candle>(
  data: T[],
  values: (BBandValue | null)[],
  key: keyof BBandValue
): LinePoint[] {
  const out: LinePoint[] = []
  for (let i = 0; i < data.length; i++) {
    const v = values[i]
    if (v) {
      out.push({ time: data[i].date, value: v[key] })
    }
  }
  return out
}
