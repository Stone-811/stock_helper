'use client'

import Link from 'next/link'
import StockChart from '../../../components/StockChart'
import StockSearchOptimized from '../../../components/StockSearchOptimized'
import AlertButton from '../../../components/AlertButton'
import type { StockDetailData } from '../../../lib/stock-data'

export default function StockDetailClient({ data }: { data: StockDetailData }) {
  const { latest, history } = data
  const isPositive = latest.close >= latest.open
  const priceChange = latest.close - latest.open
  const priceChangePct = ((priceChange / latest.open) * 100).toFixed(2)

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-gray-500 hover:text-gray-700">
                ← 返回
              </Link>
              <h1 className="text-xl font-bold text-gray-800">
                {data.stock_id} {data.stock_name}
              </h1>
              <AlertButton stockId={data.stock_id} stockName={data.stock_name} />
            </div>
            <StockSearchOptimized />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* 股票資訊卡片 */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            {/* 價格 */}
            <div className="col-span-2">
              <div className="text-gray-900 text-base font-medium">收盤價</div>
              <div className={`text-3xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
                ${latest.close.toFixed(2)}
              </div>
              <div className={`text-base ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
                {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePct}%)
              </div>
            </div>

            {/* MACD 狀態 */}
            <div>
              <div className="text-gray-900 text-base font-medium">MACD</div>
              <div className={`text-xl font-bold ${latest.macd_status === '多' ? 'text-red-600' : 'text-green-600'}`}>
                {latest.macd_status === '多' ? '多頭' : '空頭'}
              </div>
            </div>

            {/* 成交量 */}
            <div>
              <div className="text-gray-900 text-base font-medium">成交量</div>
              <div className="text-xl font-bold text-gray-900">{latest.volume.toLocaleString()}</div>
              <div className="text-sm text-gray-700">張</div>
            </div>

            {/* 強勢次數 */}
            <div>
              <div className="text-gray-900 text-base font-medium">近7日強勢</div>
              <div className="text-xl font-bold text-orange-500">{data.recentStrongDays}</div>
              <div className="text-sm text-gray-700">天</div>
            </div>

            {/* 資料日期 */}
            <div>
              <div className="text-gray-900 text-base font-medium">資料日期</div>
              <div className="text-lg font-medium text-gray-900">{latest.date}</div>
            </div>
          </div>

          {/* 三大法人 */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="text-gray-900 text-base font-medium mb-3">
              三大法人買賣超（張）
              {latest.foreign_buy === null && (
                <span className="text-sm font-normal text-gray-400 ml-2">當日資料尚未提供</span>
              )}
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-4">
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
                    <div className={`text-lg font-bold ${v >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {v >= 0 ? '+' : ''}{v.toLocaleString()}
                    </div>
                  ) : (
                    <div className="text-lg font-medium text-gray-900">{v.toFixed(2)}%</div>
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
    </main>
  )
}
