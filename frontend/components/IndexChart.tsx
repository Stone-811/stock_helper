'use client'

import CandleChart from './CandleChart'
import { MarketIndex } from '../lib/firebase'

interface IndexChartProps {
  data: MarketIndex[]
  height?: number
}

/**
 * 大盤指數技術分析圖（共用 CandleChart）
 * 成交量單位：TAIEX（加權指數）以「億」計、TX（台指期）以「口」計
 */
export default function IndexChart({ data, height = 500 }: IndexChartProps) {
  const indexId = data.length > 0 ? data[0].index_id : 'TAIEX'
  const isTaiex = indexId === 'TAIEX'

  const volumeFormatter = (v: number) =>
    isTaiex ? `${(v / 100000000).toFixed(2)}億` : `${v.toLocaleString()}口`

  return (
    <CandleChart
      data={data}
      height={height}
      volumeFormatter={volumeFormatter}
    />
  )
}
