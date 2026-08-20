'use client'

import Link from 'next/link'
import { StrongStock as TodayStrongStock } from '../lib/firebase'
import InfoTip from './InfoTip'

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
  // 漲跌幅基準＝前一交易日收盤（台股慣例）；無前一日資料時退回當日開盤
  const base = stock.prev_close && stock.prev_close > 0 ? stock.prev_close : stock.open
  const isPositive = stock.close >= base
  const priceChange = stock.close - base
  const priceChangePct = base > 0 ? ((priceChange / base) * 100).toFixed(2) : '0.00'

  // 計算成交額和當沖額（volume 是張數，每張 1000 股）
  const tradingValue = stock.volume * stock.close * 1000
  const dayTradingValue = (stock.day_trading_volume || 0) * stock.close * 1000
  const dayTradingRatio = stock.volume > 0 ? ((stock.day_trading_volume || 0) / stock.volume) * 100 : 0

  return (
    <Link href={`/stock/${stock.stock_id}`} className="block h-full">
      <div className="bg-white rounded-lg shadow-md p-3 md:p-4 hover:shadow-lg transition-shadow cursor-pointer border border-gray-200 h-full flex flex-col">
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
        <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 font-medium">
          <div>
            <span className="text-gray-600">成交額</span><InfoTip title="成交額">當日成交量（張）× 收盤價 × 1000 股，代表這檔今天的資金流動規模。</InfoTip>
            <span className="ml-1 font-medium">{formatTradingValue(tradingValue)}</span>
          </div>
          <div>
            <span className="text-gray-600">強勢</span><InfoTip title="強勢天數">最近 7 個交易日中被選入「當日強勢股」的天數。</InfoTip>
            <span className="ml-1 font-medium text-orange-500">{stock.strong_count || 0} 日</span>
          </div>
        </div>
        {dayTradingValue > 0 && (
          <div className="mt-1 text-xs text-gray-600 font-medium">
            <span className="text-gray-600">當沖額</span><InfoTip title="當沖額與比例">當沖成交量 × 收盤價 × 1000 股；括號內為當沖量佔總成交量的百分比，比例高代表短線交易熱絡。</InfoTip>
            <span className="ml-1 font-medium text-cyan-600">{formatTradingValue(dayTradingValue)}</span>
            <span className="ml-1 text-cyan-500">({dayTradingRatio.toFixed(1)}%)</span>
          </div>
        )}

        {/* 三大法人 */}
        <div className="mt-auto pt-2 border-t border-gray-100 grid grid-cols-3 gap-1 text-xs">
          <div className="text-center">
            <div className="text-gray-600">外資<InfoTip title="法人買賣超（張）">當日買進張數 − 賣出張數；正數（紅）買超、負數（綠）賣超。下方「連買 N」為連續買超天數。自營＝自行買賣＋避險。</InfoTip></div>
            <div className={stock.foreign_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.foreign_buy >= 0 ? '+' : ''}{stock.foreign_buy}
            </div>
            {!!stock.foreign_streak && (
              <div className={`text-xs ${stock.foreign_streak > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {stock.foreign_streak > 0 ? `連買${stock.foreign_streak}` : `連賣${Math.abs(stock.foreign_streak)}`}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-gray-600">投信</div>
            <div className={stock.trust_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.trust_buy >= 0 ? '+' : ''}{stock.trust_buy}
            </div>
            {!!stock.trust_streak && (
              <div className={`text-xs ${stock.trust_streak > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {stock.trust_streak > 0 ? `連買${stock.trust_streak}` : `連賣${Math.abs(stock.trust_streak)}`}
              </div>
            )}
          </div>
          <div className="text-center">
            <div className="text-gray-600">自營</div>
            <div className={stock.dealer_buy >= 0 ? 'text-red-500' : 'text-green-500'}>
              {stock.dealer_buy >= 0 ? '+' : ''}{stock.dealer_buy}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
