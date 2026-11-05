import type { MarketIndex } from './firebase'

/** /api/market-index/[id] 的回應：TAIEX、TX、美股 SOX／SPX／DJI 都是同一個形狀（change／changePercent 已用完整歷史最後兩筆算好）。 */
export interface IndexResponse {
  index_id: string
  index_name: string
  latest: MarketIndex
  history: MarketIndex[]
  change: number
  changePercent: number
}

/** 指數點數：一律兩位小數、千分位（不跟著瀏覽器語系變） */
export function fmtPoints(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
