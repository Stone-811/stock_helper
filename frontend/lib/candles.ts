/**
 * K 線圖（components/CandleChart.tsx）用的純函式：週期聚合、子圖折線資料。
 *
 * 2026-11-06 從 CandleChart.tsx 原樣搬出（方便單獨驗證）。邏輯改了兩處：
 * (1) 週K／月K 的成交量加總改成 null-aware（見 sumVolume），原本 `sum + i.volume` 會把缺值當 0 加。
 * (2) 刪掉 day_trading_volume 的 `(i.day_trading_volume || 0)` 加總（審查 D5：技術圖沒人讀這欄）。
 *     所以週K／月K 的 day_trading_volume 現在是「期間最後一根的值」（經由 `...items[items.length - 1]`），
 *     不是期間加總；以後要用的話，另寫一個跟 sumVolume 一樣 null-aware 的加總，不要改回 `|| 0`。
 *
 * ⚠️ 這裡只放不碰圖表物件的純函式。建圖、LogicalRange 同步、十字線同步都留在 CandleChart，
 *    指標一律用完整資料算（SKILL.md 地雷 #4），不要在這裡切資料。
 */
import type { Time } from 'lightweight-charts'
import type { Candle } from './indicators'

export type TimeFrame = 'day' | 'week' | 'month'

/** 折線資料，暖身期(null)以 whitespace {time} 佔位（保留完整時間軸，勿濾掉 → 子圖與主圖同步對齊） */
export function toLineWS(data: Candle[], values: (number | null)[]) {
  return data.map((d, i) => (values[i] != null ? { time: d.date as Time, value: values[i] as number } : { time: d.date as Time }))
}

/**
 * 一段期間（一週／一個月）的成交量加總，缺值不當 0：
 * - 有值的日子照加，缺值（null／undefined）的日子跳過。
 * - 整段都缺值 → 回 null（圖上畫空白、讀值顯示「—」），不是 0。
 * Candle.volume 型別寫 number，但執行期缺值是 null（index writer 2026-11-05 起缺值寫 null；
 * CandleChart 日K 的量也是用 `== null` 判斷缺值）。
 */
function sumVolume(items: Candle[]): number | null {
  let sum: number | null = null
  for (const item of items) {
    if (item.volume == null) continue
    sum = (sum ?? 0) + item.volume
  }
  return sum
}

/**
 * 日K → 週K / 月K 聚合。
 * 開＝期間第一根的開、收＝最後一根的收、高低取極值、量見 sumVolume。
 * 其餘欄位沿用期間最後一根（`...items[items.length - 1]`）；技術圖不讀那些欄位。
 */
export function convertToTimeFrame(data: Candle[], timeFrame: TimeFrame): Candle[] {
  if (timeFrame === 'day') return data
  const grouped: { [key: string]: Candle[] } = {}
  data.forEach((item) => {
    const date = new Date(item.date)
    let key: string
    if (timeFrame === 'week') {
      const day = date.getDay()
      const diff = date.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(date.setDate(diff))
      key = monday.toISOString().split('T')[0]
    } else {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    }
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  })
  return Object.entries(grouped).map(([date, items]) => ({
    ...items[items.length - 1],
    date,
    open: items[0].open,
    high: Math.max(...items.map((i) => i.high)),
    low: Math.min(...items.map((i) => i.low)),
    close: items[items.length - 1].close,
    // 整段缺值時執行期是 null（型別仍標 number，與 Candle 其他來源一致）
    volume: sumVolume(items) as number,
  })).sort((a, b) => a.date.localeCompare(b.date))
}
