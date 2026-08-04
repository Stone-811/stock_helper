'use client'

import Link from 'next/link'
import { StrongStock as TodayStrongStock } from '../lib/firebase'

interface StockCardProps {
  stock: TodayStrongStock
}

// 格式化成交金額（億、萬）
function formatTradingValue(value: number): string {
  if (value >= 1e8) {
    return (value / 1e8).toFixed(2) + '億'
  } else if (value >= 1e4) {
    return (value / 1e4).toFixed(0) + '萬'
  }
  return value.toFixed(0)
}

export default function StockCard({ stock }: StockCardProps) {
  const isPositive = stock.close >= stock.open
  const priceChange = stock.close - stock.open
  const priceChangePct = ((priceChange / stock.open) * 100).toFixed(2)

  // 計算成交額和當沖額（volume 是張數，每張 1000 股）
  const tradingValue = stock.volume * stock.close * 1000
  const dayTradingValue = (stock.day_trading_volume || 0) * stock.close * 1000
  const dayTradingRatio = stock.volume > 0 ? ((stock.day_trading_volume || 0) / stock.volume) * 100 : 0

  return (
    <Link href={`/stock/${stock.stock_id}`}>
      <div className="bg-white rounded-lg shadow-md p-3 md:p-4 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200">
        {/* 股票代碼和名稱 */}
        <div className="flex justify-between items-start mb-2">
          <div className="min-w-0 flex-1 mr-2">
            <span className="text-base md:text-lg font-bold text-gray-800">{stock.stock_id}</span>
            <span className="ml-1.5 md:ml-2 text-sm text-gray-600 truncate inline-block max-w-[80px] md:max-w-[100px] align-bottom">{stock.stock_name}</span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <span className={`px-2 py-1 rounded text-xs font-medium ${
              stock.macd_status === '多'
                ? 'bg-red-100 text-red-600'
                : 'bg-green-100 text-green-600'
            }`}>
              MACD {stock.macd_status}
            </span>
            {stock.industry && (
              <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 truncate max-w-[100px]">
                {stock.industry}
              </span>
            )}
          </div>
        </div>

        {/* 價格 */}
        <div className="mb-2 md:mb-3">
          <span className={`text-xl md:text-2xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
            ${stock.close.toFixed(2)}
          </span>
          <span className={`ml-1.5 md:ml-2 text-xs md:text-sm ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
            {isPositive ? '+' : ''}{priceChangePct}%
          </span>
        </div>

        {/* 成交額和當沖額 */}
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
          <div>
            <span className="text-gray-400">成交額</span>
            <span className="ml-1 font-medium">{formatTradingValue(tradingValue)}</span>
          </div>
          <div>
            <span className="text-gray-400">強勢</span>
            <span className="ml-1 font-medium text-orange-500">{stock.strong_count || 0} 日</span>
          </div>
        </div>
        {dayTradingValue > 0 && (
          <div className="mt-1 text-xs text-gray-600">
            <span className="text-gray-400">當沖額</span>
            <span className="ml-1 font-medium text-cyan-600">{formatTradingValue(dayTradingValue)}</span>
            <span className="ml-1 text-cyan-500">({dayTradingRatio.toFixed(1)}%)</span>
          </div>
        )}

        {/* 三大法人 */}
        <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-1 text-xs">
          <div className="text-center">
            <div className="text-gray-400">外資</div>
            <div className={stock.foreign_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.foreign_buy >= 0 ? '+' : ''}{stock.foreign_buy}
            </div>
            {!!stock.foreign_streak && (
              <div className={`text-[10px] ${stock.foreign_streak > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {stock.foreign_streak > 0 ? `連買${stock.foreign_streak}` : `連賣${Math.abs(stock.foreign_streak)}`}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-gray-400">投信</div>
            <div className={stock.trust_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.trust_buy >= 0 ? '+' : ''}{stock.trust_buy}
            </div>
            {!!stock.trust_streak && (
              <div className={`text-[10px] ${stock.trust_streak > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {stock.trust_streak > 0 ? `連買${stock.trust_streak}` : `連賣${Math.abs(stock.trust_streak)}`}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-gray-400">自營</div>
            <div className={stock.dealer_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.dealer_buy >= 0 ? '+' : ''}{stock.dealer_buy}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
