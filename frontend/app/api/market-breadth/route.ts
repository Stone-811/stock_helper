import { NextRequest, NextResponse } from 'next/server'

// 大盤漲跌家數（FinMind 無此資料集，改抓證交所 TWSE MI_INDEX 大盤統計 type=MS）
// 用「股票」欄（上市個股），非「整體市場」（含 ETF/權證）。快取 5 分鐘。
export const revalidate = 300

function parsePair(s: unknown): { n: number; sub: number } {
  const m = String(s ?? '').replace(/,/g, '').match(/(\d+)(?:\((\d+)\))?/)
  return { n: m ? parseInt(m[1], 10) : 0, sub: m && m[2] ? parseInt(m[2], 10) : 0 }
}

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') // YYYY-MM-DD（通常帶大盤最新日）
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ available: false, error: 'date (YYYY-MM-DD) required' }, { status: 400 })
  }
  const yyyymmdd = date.replace(/-/g, '')
  try {
    const res = await fetch(
      `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${yyyymmdd}&type=MS`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 300 } }
    )
    if (!res.ok) return NextResponse.json({ date, available: false })
    const j = await res.json()
    if (j.stat !== 'OK') return NextResponse.json({ date, available: false })

    const tables: Array<{ title?: string; data?: unknown[][] }> = j.tables || []
    const table = tables.find((t) => String(t.title || '').includes('漲跌'))
    if (!table || !Array.isArray(table.data)) return NextResponse.json({ date, available: false })

    let up = 0, down = 0, unchanged = 0, limitUp = 0, limitDown = 0
    for (const row of table.data) {
      const label = String(row[0] ?? '')
      const stock = parsePair(row[2]) // [類型, 整體市場, 股票] → 取「股票」欄
      if (label.startsWith('上漲')) { up = stock.n; limitUp = stock.sub }
      else if (label.startsWith('下跌')) { down = stock.n; limitDown = stock.sub }
      else if (label.startsWith('持平')) { unchanged = stock.n }
    }
    return NextResponse.json({ date, available: true, up, down, unchanged, limitUp, limitDown })
  } catch (e) {
    // TWSE 不通時不讓首頁壞掉，回 available:false
    return NextResponse.json({ date, available: false, error: String(e) })
  }
}
