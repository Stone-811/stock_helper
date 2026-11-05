'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { StrongStock } from '../lib/firebase'
import InfoTip from './InfoTip'
import {
  DASH,
  fmtNum,
  fmtSigned,
  fmtTradingValue,
  computeChange,
  changeColor,
  signColor,
  tradingValueOf,
  dayTradingRatioOf,
  macdBadgeClass,
} from '../lib/format'

interface StockCardProps {
  /** date 不用：/api/strong-stocks 與 /api/screener 的每檔資料本來就沒有 date（firebase_writer 不寫） */
  stock: Omit<StrongStock, 'date'>
  /** 所選日期不是最新交易日：「強勢 N 日」固定算最近 7 個交易日、與所選日期無關 → 轉灰並說明 */
  strongCountStale?: boolean
  /** 依卡片上看不到的欄位排序時（成交量、當沖比、外資連續、外資持股），把那個值顯示出來，
   *  否則業主看不出卡片為什麼這樣排（2026-10-26 回歸審查）。 */
  sortExtra?: { label: string; value: ReactNode }
}

/*
 * 強勢股頁的卡片檢視、選股頁共用（首頁 2026-11-05 改版後不再放今日強勢股）。
 * 成交額、當沖比、MACD 底色的公式在 lib/format.ts，與強勢股頁的表格同一份：
 * 同一頁切換卡片／表格、或依「當沖比」排序時卡片上的兩個當沖比，數字才不會對不上。
 * 2026-10-26 業主同意放大加深（看過改前改後截圖）：
 * - 數字由 text-xs（13.6px）改為 text-sm／text-base，標籤 gray-700、數值 gray-900。
 * - 紅綠改用 lib/format 的 changeColor／signColor（green-600 3.22、orange-500 約 2.6、cyan 都不過 AA）。
 * - 平盤顯示灰色「0.00%」而不是紅色「+0.00%」；法人 0 顯示灰色「0」而不是紅色「+0」；
 *   MACD 只有「多／空」上紅綠，「-」（資料不足）與空值是灰色「MACD —」，不再被看成空頭。
 * - 缺資料一律「—」，不寫成 0（強勢天數、成交額、法人）。
 */
export default function StockCard({ stock, strongCountStale = false, sortExtra }: StockCardProps) {
  const { change, pct, dir } = computeChange(stock)
  const priceCls = dir === 'flat' ? 'text-gray-900' : changeColor(dir)
  const sign = change != null && change > 0 ? '+' : ''

  // 成交額、當沖額：volume 是張數，每張 1000 股。缺任一邊就是「—」，當沖量缺（或為 0）就不顯示那一行
  const tradingValue = tradingValueOf(stock.volume, stock.close)
  const dtv = stock.day_trading_volume
  const dayTradingValue = dtv != null && dtv > 0 ? tradingValueOf(dtv, stock.close) : null
  const dayTradingRatio = dayTradingRatioOf(dtv, stock.volume)

  const macd = stock.macd_status
  const macdCls = macdBadgeClass(macd)

  // 法人欄只有約 65～110px 寬：「+312,708」這種 7 字元以上的數字縮一級，免得擠出欄位壓到隔壁
  const inst = (v: number | null | undefined) => {
    const t = v === 0 ? '0' : fmtSigned(v)
    return <div className={`${t.length >= 7 ? 'text-sm' : 'text-base'} font-semibold tabular-nums ${signColor(v)}`}>{t}</div>
  }
  const streak = (v: number | null | undefined) =>
    v ? (
      <div className={`text-sm ${signColor(v)}`}>{v > 0 ? `連買 ${v}` : `連賣 ${Math.abs(v)}`}</div>
    ) : null

  return (
    <Link href={`/stock/${stock.stock_id}`} className="block h-full">
      <div className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 h-full flex flex-col">
        {/* 代號與名稱分兩行：同一行時 4 欄卡片寬度不夠，「巨生醫」會被斷成「巨生／醫」。
            名稱最多兩行、不截斷（手機看不到 title 提示，不截成「亞德客-…」） */}
        <div className="flex justify-between items-start gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{stock.stock_id}</div>
            <div className="text-base text-gray-700 line-clamp-2">{stock.stock_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className={`px-2 py-0.5 rounded text-sm font-medium ${macdCls}`}>
              MACD {macd === '多' || macd === '空' ? macd : DASH}
            </span>
            {stock.industry && (
              <span className="px-2 py-0.5 rounded text-sm bg-blue-50 text-blue-800 truncate max-w-[11em]" title={stock.industry}>
                {stock.industry}
              </span>
            )}
          </div>
        </div>

        {/* 價格與漲跌幅（基準＝前一交易日收盤；沒有昨收才退回當日開盤） */}
        <div className="mb-3 tabular-nums">
          <span className={`text-2xl font-bold ${priceCls}`}>{stock.close != null ? fmtNum(stock.close, 2) : DASH}</span>
          <span className={`ml-2 text-base font-semibold ${priceCls}`}>
            {pct == null ? DASH : `${sign}${pct.toFixed(2)}%`}
          </span>
        </div>

        {sortExtra && (
          <div className="mb-3 px-3 py-2 rounded bg-blue-50 text-sm text-gray-900">
            <span className="text-gray-700">排序：{sortExtra.label}</span>
            <span className="block font-semibold tabular-nums">{sortExtra.value}</span>
          </div>
        )}

        {/* 成交額與強勢天數（mb-3：法人區用 mt-auto 推到底部，兩者之間要自己留空） */}
        <div className="mb-3">
        <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
          <div>
            成交額<InfoTip title="成交額">當日成交量（張）× 收盤價 × 1000 股，代表這檔今天的資金流動規模。</InfoTip>
            <span className="ml-1 font-semibold text-gray-900 tabular-nums">{fmtTradingValue(tradingValue)}</span>
          </div>
          <div>
            強勢<InfoTip title="強勢天數">最近 7 個交易日中被選入「當日強勢股」的天數。固定算最近 7 天，選以前的日期時這個數字與所選日期無關，會變灰。</InfoTip>
            <span
              className={`ml-1 font-semibold tabular-nums ${strongCountStale ? 'text-gray-600' : 'text-gray-900'}`}
              title={strongCountStale ? '以最近 7 個交易日計算，與所選日期無關' : undefined}
            >
              {stock.strong_count == null ? DASH : `${stock.strong_count} 日`}
            </span>
          </div>
        </div>
        {dayTradingValue != null && (
          <div className="mt-1 text-sm text-gray-700">
            當沖額<InfoTip title="當沖額與比例">當沖成交量 × 收盤價 × 1000 股；括號內為當沖量佔總成交量的百分比，比例高代表短線交易熱絡。</InfoTip>
            <span className="ml-1 font-semibold text-gray-900 tabular-nums">{fmtTradingValue(dayTradingValue)}</span>
            {dayTradingRatio != null && <span className="ml-1 tabular-nums">（{dayTradingRatio.toFixed(1)}%）</span>}
          </div>
        )}
        </div>

        {/* 三大法人（張） */}
        <div className="mt-auto pt-3 border-t border-gray-200 grid grid-cols-3 gap-1 text-center">
          <div>
            <div className="text-sm text-gray-700">外資<InfoTip title="法人買賣超（張）">當日買進張數 − 賣出張數；正數（紅）買超、負數（綠）賣超。下方「連買 N」為連續買超天數。自營＝自行買賣＋避險。⚠️ 0 也可能是當天沒有法人資料。</InfoTip></div>
            {inst(stock.foreign_buy)}
            {streak(stock.foreign_streak)}
          </div>
          <div>
            <div className="text-sm text-gray-700">投信</div>
            {inst(stock.trust_buy)}
            {streak(stock.trust_streak)}
          </div>
          <div>
            <div className="text-sm text-gray-700">自營</div>
            {inst(stock.dealer_buy)}
          </div>
        </div>
      </div>
    </Link>
  )
}
