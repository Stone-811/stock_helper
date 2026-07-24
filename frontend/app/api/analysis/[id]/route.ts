import { NextResponse } from 'next/server'
import { getAnalysisReport } from '../../../../lib/firebase-admin'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 從 Firestore 取得報告
    const report = await getAnalysisReport(id)

    if (!report) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ report })

  } catch (error) {
    console.error('Error fetching report:', error)
    return NextResponse.json(
      { error: 'Failed to fetch report' },
      { status: 500 }
    )
  }
}
