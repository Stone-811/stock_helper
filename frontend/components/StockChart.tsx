'use client'

import CandleChart from './CandleChart'
import { Candle } from '../lib/indicators'

interface StockChartProps {
  data: (Candle & { day_trading_volume?: number })[]
  height?: number
}

/**
 * 個股技術分析圖（共用 CandleChart，成交量單位為「張」）
 */
export default function StockChart({ data, height = 500 }: StockChartProps) {
  return (
    <CandleChart
      data={data}
      height={height}
      volumeFormatter={(v) => `${v.toLocaleString()}張`}
    />
  )
}
