'use client'

import { useMemo } from 'react'
import {
  Candle,
  calculateMAValues,
  calculateMACDValues,
  calculateKDValues,
  calculateRSIValues,
} from '../lib/indicators'

type Bar = Candle & { day_trading_volume?: number }
type Tone = 'up' | 'down' | 'warn'

interface Signal {
  icon: string
  title: string
  detail: string
  tone: Tone
}

const TONE: Record<Tone, string> = {
  up: 'border-red-200 bg-red-50 text-red-700',
  down: 'border-green-200 bg-green-50 text-green-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
}

/**
 * 個股「今日訊號」（B2 Signal Engine）
 * 全部在前端用已載入的 K 線 history 計算 → 零額外 API。
 * 只呈現「事件型」訊號（今天才發生的交叉/突破），避免每天都亮一樣的燈。
 */
export default function StockSignals({ history }: { history: Bar[] }) {
  const signals = useMemo<Signal[]>(() => {
    const n = history.length
    if (n < 25) return []
    const i = n - 1
    const cur = history[i]
    const prev = history[i - 1]
    const out: Signal[] = []

    // 漲跌幅（對前一日收盤）
    const chgPct = prev.close > 0 ? ((cur.close - prev.close) / prev.close) * 100 : 0
    if (chgPct >= 5) out.push({ icon: '🔥', title: '今日大漲', detail: `較前一日收盤 +${chgPct.toFixed(2)}%`, tone: 'up' })
    else if (chgPct <= -5) out.push({ icon: '❄️', title: '今日大跌', detail: `較前一日收盤 ${chgPct.toFixed(2)}%`, tone: 'down' })

    // 突破 / 跌破 近 20 日高低（不含今日）
    const win = history.slice(i - 20, i)
    const hi20 = Math.max(...win.map((d) => d.high))
    const lo20 = Math.min(...win.map((d) => d.low))
    if (cur.close >= hi20) out.push({ icon: '🚀', title: '突破近 20 日高點', detail: `收 ${cur.close.toFixed(2)}，前 20 日最高 ${hi20.toFixed(2)}`, tone: 'up' })
    else if (cur.close <= lo20) out.push({ icon: '⚠️', title: '跌破近 20 日低點', detail: `收 ${cur.close.toFixed(2)}，前 20 日最低 ${lo20.toFixed(2)}`, tone: 'down' })

    // 爆量 / 量縮（對前 5 日均量）
    const vol5 = history.slice(i - 5, i).reduce((s, d) => s + d.volume, 0) / 5
    if (vol5 > 0) {
      const ratio = cur.volume / vol5
      if (ratio >= 1.5) out.push({ icon: '📊', title: '爆量', detail: `成交量為 5 日均量 ${ratio.toFixed(1)} 倍`, tone: 'warn' })
      else if (ratio <= 0.5) out.push({ icon: '💤', title: '量縮', detail: `成交量僅 5 日均量 ${ratio.toFixed(1)} 倍`, tone: 'warn' })
    }

    // 均線排列 / 站上、跌破 MA20
    const ma5 = calculateMAValues(history, 5)
    const ma10 = calculateMAValues(history, 10)
    const ma20 = calculateMAValues(history, 20)
    const a = ma5[i], b = ma10[i], c = ma20[i], cPrev = ma20[i - 1]
    if (a != null && b != null && c != null) {
      if (a > b && b > c) out.push({ icon: '📈', title: '均線多頭排列', detail: `MA5 ${a.toFixed(1)} > MA10 ${b.toFixed(1)} > MA20 ${c.toFixed(1)}`, tone: 'up' })
      else if (a < b && b < c) out.push({ icon: '📉', title: '均線空頭排列', detail: `MA5 ${a.toFixed(1)} < MA10 ${b.toFixed(1)} < MA20 ${c.toFixed(1)}`, tone: 'down' })
      if (cPrev != null) {
        if (cur.close > c && prev.close <= cPrev) out.push({ icon: '🧗', title: '今日站上 MA20', detail: `收 ${cur.close.toFixed(2)} 越過 MA20 ${c.toFixed(1)}`, tone: 'up' })
        else if (cur.close < c && prev.close >= cPrev) out.push({ icon: '🪂', title: '今日跌破 MA20', detail: `收 ${cur.close.toFixed(2)} 跌落 MA20 ${c.toFixed(1)}`, tone: 'down' })
      }
    }

    // MACD 金叉 / 死叉（柱狀由負轉正、正轉負）
    const macd = calculateMACDValues(history)
    const m = macd[i], mPrev = macd[i - 1]
    if (m && mPrev) {
      if (m.histogram >= 0 && mPrev.histogram < 0) out.push({ icon: '⚡', title: 'MACD 金叉', detail: `DIF ${m.dif.toFixed(2)} 上穿 MACD ${m.macd.toFixed(2)}`, tone: 'up' })
      else if (m.histogram < 0 && mPrev.histogram >= 0) out.push({ icon: '⚡', title: 'MACD 死叉', detail: `DIF ${m.dif.toFixed(2)} 下穿 MACD ${m.macd.toFixed(2)}`, tone: 'down' })
    }

    // KD 交叉與超買超賣
    const kd = calculateKDValues(history)
    const k = kd[i], kPrev = kd[i - 1]
    if (k && kPrev) {
      if (k.k > k.d && kPrev.k <= kPrev.d) out.push({ icon: '🔀', title: 'KD 黃金交叉', detail: `K ${k.k.toFixed(1)} 上穿 D ${k.d.toFixed(1)}`, tone: 'up' })
      else if (k.k < k.d && kPrev.k >= kPrev.d) out.push({ icon: '🔀', title: 'KD 死亡交叉', detail: `K ${k.k.toFixed(1)} 下穿 D ${k.d.toFixed(1)}`, tone: 'down' })
      if (k.k >= 80) out.push({ icon: '🌡️', title: 'KD 超買區', detail: `K 值 ${k.k.toFixed(1)}（≥80）`, tone: 'warn' })
      else if (k.k <= 20) out.push({ icon: '🌡️', title: 'KD 超賣區', detail: `K 值 ${k.k.toFixed(1)}（≤20）`, tone: 'warn' })
    }

    // RSI 超買超賣
    const rsi = calculateRSIValues(history)
    const r = rsi[i]
    if (r != null) {
      if (r >= 70) out.push({ icon: '🌡️', title: 'RSI 超買', detail: `RSI ${r.toFixed(1)}（≥70）`, tone: 'warn' })
      else if (r <= 30) out.push({ icon: '🌡️', title: 'RSI 超賣', detail: `RSI ${r.toFixed(1)}（≤30）`, tone: 'warn' })
    }

    // 當沖比例偏高
    if (cur.day_trading_volume != null && cur.volume > 0) {
      const dt = (cur.day_trading_volume / cur.volume) * 100
      if (dt >= 40) out.push({ icon: '⚡', title: '當沖比例偏高', detail: `當沖占成交量 ${dt.toFixed(1)}%（≥40%）`, tone: 'warn' })
    }

    return out
  }, [history])

  return (
    <div className="bg-white rounded-lg shadow-sm p-4 md:p-6">
      <h2 className="text-lg font-bold text-gray-900 mb-3">今日訊號</h2>
      {signals.length === 0 ? (
        <p className="text-sm text-gray-700">今日無明顯技術訊號</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
          {signals.map((s, idx) => (
            <div key={idx} className={`flex items-start gap-2 border rounded-lg px-3 py-2.5 ${TONE[s.tone]}`}>
              <span className="text-lg leading-none mt-0.5" aria-hidden="true">{s.icon}</span>
              <div className="min-w-0">
                <div className="font-bold">{s.title}</div>
                <div className="text-sm opacity-90 tabular-nums">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-600 font-medium mt-3">依當日 K 線與技術指標自動判讀，僅供參考，非投資建議。</p>
    </div>
  )
}
