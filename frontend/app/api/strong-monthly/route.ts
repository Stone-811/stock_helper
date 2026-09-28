import { NextResponse } from 'next/server'
import { buildMonthlyReport } from '../../../lib/monthly-report'

/**
 * 強勢月報 API：/api/strong-monthly?month=YYYY-MM（省略＝最新月）
 *
 * ⚠️ 刻意不沿用 /api/strong-stocks 的契約：那支是「單一交易日」的明細，
 * 月報要跨約 30 個日期做聚合（見 lib/monthly-report.ts 檔頭的三個效能鐵則）。
 *
 * 冷算實測約 33 秒（22 MB Firestore 傳輸），所以 HTTP 快取比什麼都重要：
 *  - `s-maxage=1800`：跨 instance 共享同一份結果。
 *    ⚠️ apphosting.yaml 是 minInstances: 0，每次 scale-from-zero 記憶體快取都是空的，
 *    所以「跨 instance 的 HTTP 快取」比 module 級 Map 有效得多。
 *  - `stale-while-revalidate=3600`：背景更新，使用者不會等 33 秒。
 * 資料每天只在台灣 17:00／22:00 變兩次，長 TTL 很安全。
 */

/** 月份格式檢查：擋掉 '2026-13'、'../..' 這類輸入（buildMonthlyReport 本身也會白名單比對） */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const raw = searchParams.get('month')
  const month = raw && MONTH_RE.test(raw) ? raw : undefined

  try {
    const report = await buildMonthlyReport(month)

    return NextResponse.json(
      {
        ...report,
        /** 前端要能分辨「你送的月份被退回最新月」（同 /api/strong-stocks 的靜默退回慣例） */
        requestedMonth: raw ?? null,
        count: report.rows.length,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
        },
      }
    )
  } catch (error) {
    console.error('Error building monthly strong report:', error)
    return NextResponse.json({ error: 'Failed to build monthly report' }, { status: 500 })
  }
}
