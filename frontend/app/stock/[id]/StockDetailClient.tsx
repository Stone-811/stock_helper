'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import StockChart from '../../../components/StockChart'
import InstitutionalChart from '../../../components/InstitutionalChart'
import AlertButton from '../../../components/AlertButton'
import WatchlistButton from '../../../components/WatchlistButton'
import type { StockDetailData } from '../../../lib/stock-data'

export default function StockDetailClient({ data }: { data: StockDetailData }) {
  const [showInst, setShowInst] = useState(false) // 手機版：三大法人明細收合（桌機恆顯示）
  const router = useRouter()
  // 返回「上一頁」（強勢股/選股/自選股/搜尋皆可正確回去）；無瀏覽歷史（直接開個股頁）才退回首頁
  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back()
    else router.push('/')
  }
  const { latest, history } = data
  const hasName = !!(data.stock_name && data.stock_name !== data.stock_id)
  const displayName = hasName ? data.stock_name : data.stock_id
  const isPositive = latest.close >= latest.open
  const priceChange = latest.close - latest.open
  const priceChangePct = ((priceChange / latest.open) * 100).toFixed(2)
  const priceColor = isPositive ? 'text-red-600' : 'text-green-600'
  // 當日當沖比例 = 當沖量 / 成交量
  const dayTradeRatio =
    latest.day_trading_volume != null && latest.volume > 0
      ? (latest.day_trading_volume / latest.volume) * 100
      : null
  // 當沖比例歷史序列（籌碼圖「當沖」模式用；當沖屬籌碼，非技術指標）
  const dayTradeSeries = useMemo(
    () =>
      history
        .filter((d) => d.day_trading_volume != null && d.volume > 0)
        .map((d) => ({ date: d.date, ratio: (d.day_trading_volume! / d.volume) * 100 })),
    [history]
  )

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 個股 Header：名稱醒目 + 代碼 + 加入自選 / 提醒 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBack}
              aria-label="返回"
              className="flex items-center justify-center w-11 h-11 -ml-2 shrink-0 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg text-xl"
            >
              ←
            </button>
            <h1 className="min-w-0 flex-1 flex items-baseline gap-2">
              <span className="text-lg md:text-2xl font-bold text-gray-900 truncate">{displayName}</span>
              {hasName && (
                <span className="text-sm md:text-base font-medium text-gray-400 shrink-0 tabular-nums">{data.stock_id}</span>
              )}
            </h1>
            <WatchlistButton stockId={data.stock_id} stockName={data.stock_name} className="shrink-0" />
            <AlertButton stockId={data.stock_id} stockName={data.stock_name} />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 股票資訊卡片 */}
        <div className="bg-white rounded-lg shadow-sm p-4 md:p-6 mb-6">
          {/* 價格焦點 + 次要指標 */}
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            {/* 價格 hero */}
            <div className="min-w-0">
              <div className={`text-4xl md:text-5xl font-bold tabular-nums leading-none ${priceColor}`}>
                {latest.close.toFixed(2)}
              </div>
              <div className={`mt-2 flex items-center gap-1.5 text-base md:text-lg font-semibold tabular-nums ${priceColor}`}>
                <span aria-hidden="true">{isPositive ? '▲' : '▼'}</span>
                <span>{isPositive ? '+' : ''}{priceChange.toFixed(2)}</span>
                <span>({isPositive ? '+' : ''}{priceChangePct}%)</span>
              </div>
              <div className="mt-1.5 text-sm text-gray-500 tabular-nums">
                {latest.date} · 成交量 {latest.volume.toLocaleString()} 張
              </div>
            </div>

            {/* 次要指標：MACD / 當沖 / 近7日強勢 */}
            <div className="flex items-start gap-5 md:gap-8">
              <div>
                <div className="text-gray-500 text-xs md:text-sm">MACD</div>
                <div className={`text-lg md:text-xl font-bold ${latest.macd_status === '多' ? 'text-red-600' : 'text-green-600'}`}>
                  {latest.macd_status === '多' ? '多頭' : '空頭'}
                </div>
              </div>
              <div>
                <div className="text-gray-500 text-xs md:text-sm">當日當沖</div>
                {dayTradeRatio === null ? (
                  <div className="text-lg md:text-xl font-bold text-gray-400">—</div>
                ) : (
                  <div className="text-lg md:text-xl font-bold text-cyan-600 tabular-nums">{dayTradeRatio.toFixed(1)}%</div>
                )}
              </div>
              <div>
                <div className="text-gray-500 text-xs md:text-sm">近7日強勢</div>
                <div className="text-lg md:text-xl font-bold text-orange-500 tabular-nums">
                  {data.recentStrongDays}
                  <span className="text-sm font-normal text-gray-500 ml-0.5">天</span>
                </div>
              </div>
            </div>
          </div>

          {/* 三大法人（手機版預設收合，桌機恆顯示） */}
          <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="text-gray-900 text-base font-medium">
                三大法人買賣超（張）
                {latest.foreign_buy === null && (
                  <span className="text-sm font-normal text-gray-400 ml-2">當日資料尚未提供</span>
                )}
              </div>
              <button
                onClick={() => setShowInst((v) => !v)}
                className="md:hidden text-gray-500 text-sm px-2 py-1 -mr-2 whitespace-nowrap"
              >
                {showInst ? '收合 ▲' : '展開 ▼'}
              </button>
            </div>
            <div className={`${showInst ? 'grid' : 'hidden'} md:grid grid-cols-3 md:grid-cols-6 gap-4`}>
              {([
                { label: '外資', v: latest.foreign_buy, kind: 'buy', streak: latest.foreign_streak },
                { label: '投信', v: latest.trust_buy, kind: 'buy', streak: latest.trust_streak },
                { label: '自營商', v: latest.dealer_buy, kind: 'buy', streak: null },
                { label: '外資持股比例', v: latest.foreign_hold_ratio, kind: 'pct', streak: null },
                { label: '外資尚可投資', v: latest.foreign_remain_ratio, kind: 'pct', streak: null },
                { label: '外資投資上限', v: latest.foreign_limit_ratio, kind: 'pct', streak: null },
              ] as const).map(({ label, v, kind, streak }) => (
                <div key={label}>
                  <div className="text-gray-800 text-sm font-medium">{label}</div>
                  {v === null ? (
                    <div className="text-lg font-medium text-gray-400">—</div>
                  ) : kind === 'buy' ? (
                    <div className={`text-lg font-bold tabular-nums ${v >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {v >= 0 ? '+' : ''}{v.toLocaleString()}
                    </div>
                  ) : (
                    <div className="text-lg font-medium text-gray-900 tabular-nums">{v.toFixed(2)}%</div>
                  )}
                  {streak !== null && streak !== 0 && (
                    <div className={`text-xs font-medium mt-0.5 ${streak > 0 ? 'text-red-500' : 'text-green-500'}`}>
                      {streak > 0 ? `連買 ${streak} 天` : `連賣 ${Math.abs(streak)} 天`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 技術分析圖表 - 全幅 */}
      <div className="w-full px-2 mb-6">
        <StockChart data={history} height={600} />
      </div>

      {/* 三大法人累計買賣超趨勢 - 全幅 */}
      <div className="w-full px-2 mb-6">
        <InstitutionalChart key={data.stock_id} stockId={data.stock_id} height={320} dayTrade={dayTradeSeries} />
      </div>
    </main>
  )
}
