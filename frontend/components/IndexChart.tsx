'use client'

import CandleChart from './CandleChart'
import { MarketIndex } from '../lib/firebase'

interface IndexChartProps {
  data: MarketIndex[]
  height?: number
  /**
   * 指數代號（'TAIEX' / 'TX'）。務必由父層明確傳入：
   * market_index/{id} 的 history 項目並未帶 index_id，靠 data[0].index_id 會是 undefined
   * → 造成 isTaiex 永遠 false、加權成交量被誤標成「口」。
   */
  indexId?: string
}

/**
 * 大盤指數技術分析圖（共用 CandleChart）
 * 成交量單位：TAIEX（加權指數）以「億」計、TX（台指期）以「口」計
 */
export default function IndexChart({ data, height = 500, indexId }: IndexChartProps) {
  const resolvedId = indexId ?? (data.length > 0 ? data[0].index_id : 'TAIEX')
  const isTaiex = resolvedId === 'TAIEX'

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
