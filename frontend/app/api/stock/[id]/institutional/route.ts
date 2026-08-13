import { NextResponse } from 'next/server'
import { fetchInstitutionalHistory } from '../../../../../lib/finmind'

/**
 * 個股三大法人買賣超歷史（外資/投信/自營，張）
 * 供個股頁「三大法人趨勢圖」client 端 lazy 載入，避免拖慢頁面 TTFB。
 * 取近約 400 天（涵蓋前端 1 年區間 + 緩衝）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const start = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const data = await fetchInstitutionalHistory(id, start)
    return NextResponse.json({ data })
  } catch (error) {
    console.error('Error fetching institutional history:', error)
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 })
  }
}
