'use client'

import Link from 'next/link'
import { TodayStrongStock } from '../lib/supabase'

interface StockCardProps {
  stock: TodayStrongStock
}

export default function StockCard({ stock }: StockCardProps) {
  const isPositive = stock.close >= stock.open
  const priceChange = stock.close - stock.open
  const priceChangePct = ((priceChange / stock.open) * 100).toFixed(2)

  return (
    <Link href={`/stock/${stock.stock_id}`}>
      <div className="bg-white rounded-lg shadow-md p-4 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200">
        {/* 股票代碼和名稱 */}
        <div className="flex justify-between items-start mb-2">
          <div>
            <span className="text-lg font-bold text-gray-800">{stock.stock_id}</span>
            <span className="ml-2 text-sm text-gray-600">{stock.stock_name}</span>
          </div>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            stock.macd_status === '多'
              ? 'bg-red-100 text-red-600'
              : 'bg-green-100 text-green-600'
          }`}>
            MACD {stock.macd_status}
          </span>
        </div>

        {/* 價格 */}
        <div className="mb-3">
          <span className={`text-2xl font-bold ${isPositive ? 'text-red-600' : 'text-green-600'}`}>
            ${stock.close.toFixed(2)}
          </span>
          <span className={`ml-2 text-sm ${isPositive ? 'text-red-500' : 'text-green-500'}`}>
            {isPositive ? '+' : ''}{priceChange.toFixed(2)} ({isPositive ? '+' : ''}{priceChangePct}%)
          </span>
        </div>

        {/* 成交量和法人 */}
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
          <div>
            <span className="text-gray-400">成交量</span>
            <span className="ml-1 font-medium">{stock.volume.toLocaleString()} 張</span>
          </div>
          <div>
            <span className="text-gray-400">強勢次數</span>
            <span className="ml-1 font-medium text-orange-500">{stock.strong_count || 0} 日</span>
          </div>
        </div>

        {/* 三大法人 */}
        <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-1 text-xs">
          <div className="text-center">
            <div className="text-gray-400">外資</div>
            <div className={stock.foreign_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.foreign_buy >= 0 ? '+' : ''}{stock.foreign_buy}
            </div>
          </div>
          <div className="text-center">
            <div className="text-gray-400">投信</div>
            <div className={stock.trust_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.trust_buy >= 0 ? '+' : ''}{stock.trust_buy}
            </div>
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
