// 個股「今日訊號」共用邏輯（自選股/首頁我的自選用）。
// 只用當日 daily_data 已有欄位；突破/爆量需個股 history，暫不做。

export interface QuoteLite {
  open: number
  close: number
  /** 前一交易日收盤（漲跌幅基準）；缺值時退回 open */
  prev_close?: number
  macd_status?: string
  foreign_streak?: number
  trust_streak?: number
}

export interface Signal {
  icon: string
  text: string
  tone: 'up' | 'down' | 'flow'
}

export function computeSignals(q?: QuoteLite): Signal[] {
  if (!q) return []
  const out: Signal[] = []
  const base = q.prev_close && q.prev_close > 0 ? q.prev_close : q.open
  const chgPct = base > 0 ? ((q.close - base) / base) * 100 : 0
  if (chgPct >= 5) out.push({ icon: '🔥', text: '今日大漲', tone: 'up' })
  if (q.macd_status === '多') out.push({ icon: '📈', text: 'MACD多頭', tone: 'up' })
  const fs = q.foreign_streak ?? 0
  if (fs >= 1) out.push({ icon: '💰', text: `外資連買${fs}日`, tone: 'flow' })
  const ts = q.trust_streak ?? 0
  if (ts >= 1) out.push({ icon: '💰', text: `投信連買${ts}日`, tone: 'flow' })
  return out
}
