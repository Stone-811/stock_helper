'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import StockChart from '../../../components/StockChart'
import InstitutionalChart from '../../../components/InstitutionalChart'
import AlertButton from '../../../components/AlertButton'
import StockSignals from '../../../components/StockSignals'
import InfoTip from '../../../components/InfoTip'
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
  // 漲跌幅基準＝前一交易日收盤（台股慣例）；history 已載入，直接取倒數第二根
  const prevClose = history.length >= 2 ? history[history.length - 2].close : latest.open
  const base = prevClose > 0 ? prevClose : latest.open
  const isPositive = latest.close >= base
  const priceChange = latest.close - base
  const priceChangePct = base > 0 ? ((priceChange / base) * 100).toFixed(2) : '0.00'
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

  // 籌碼摘要 badges（insight first：連買/連賣或當日買賣超；🟢=偏多、🔴=偏空）
  const instBadges: { dot: string; text: string }[] = []
  if (latest.foreign_buy !== null) {
    const fs = latest.foreign_streak ?? 0
    if (fs > 0) instBadges.push({ dot: '🟢', text: `外資連買${fs}日` })
    else if (fs < 0) instBadges.push({ dot: '🔴', text: `外資連賣${Math.abs(fs)}日` })
    else if ((latest.foreign_buy ?? 0) > 0) instBadges.push({ dot: '🟢', text: '外資買超' })
    else if ((latest.foreign_buy ?? 0) < 0) instBadges.push({ dot: '🔴', text: '外資賣超' })
    const ts = latest.trust_streak ?? 0
    if (ts > 0) instBadges.push({ dot: '🟢', text: `投信連買${ts}日` })
    else if (ts < 0) instBadges.push({ dot: '🔴', text: `投信連賣${Math.abs(ts)}日` })
    else if ((latest.trust_buy ?? 0) > 0) instBadges.push({ dot: '🟢', text: '投信買超' })
    else if ((latest.trust_buy ?? 0) < 0) instBadges.push({ dot: '🔴', text: '投信賣超' })
    const db = latest.dealer_buy ?? 0
    if (db > 0) instBadges.push({ dot: '🟢', text: '自營買超' })
    else if (db < 0) instBadges.push({ dot: '🔴', text: '自營賣超' })
  }

  return (
    <main className="min-h-screen bg-gray-50">
      {/* 個股 Header：名稱醒目 + 代碼 + 加入自選 / 提醒 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBack}
              aria-label="返回"
              className="flex items-center justify-center w-11 h-11 -ml-2 shrink-0 text-gray-700 hover:text-gray-800 hover:bg-gray-100 rounded-lg text-xl"
            >
              ←
            </button>
            <h1 className="min-w-0 flex-1 flex items-baseline gap-2">
              <span className="text-lg md:text-2xl font-bold text-gray-900 truncate">{displayName}</span>
              {hasName && (
                <span className="text-sm md:text-base font-medium text-gray-600 shrink-0 tabular-nums">{data.stock_id}</span>
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
                <InfoTip title="漲跌如何計算">
                  漲跌 = 今日收盤 {latest.close.toFixed(2)} − 前一交易日收盤 {base.toFixed(2)}；
                  百分比 = 漲跌 ÷ 前一交易日收盤 × 100%。台股慣例以前一交易日收盤為基準（非當日開盤）。
                </InfoTip>
              </div>
              <div className="mt-1.5 text-sm text-gray-700 tabular-nums">
                {latest.date} · 成交量 {latest.volume.toLocaleString()} 張
              </div>
            </div>

            {/* 次要指標：MACD / 當沖 / 近7日強勢 */}
            <div className="flex items-start gap-5 md:gap-8">
              <div>
                <div className="text-gray-700 text-xs font-medium md:text-sm">MACD<InfoTip title="MACD 多頭 / 空頭">
                  12 日與 26 日 EMA（指數移動平均）相減得 DIF，再取 DIF 的 9 日 EMA 作訊號線；
                  兩者差（柱狀圖）大於 0 顯示「多頭」，小於 0 顯示「空頭」。
                </InfoTip></div>
                <div className={`text-lg md:text-xl font-bold ${latest.macd_status === '多' ? 'text-red-600' : 'text-green-600'}`}>
                  {latest.macd_status === '多' ? '多頭' : '空頭'}
                </div>
              </div>
              <div>
                <div className="text-gray-700 text-xs font-medium md:text-sm">當日當沖<InfoTip title="當日當沖比例">
                  當沖成交量 ÷ 當日總成交量 × 100%。比例越高代表當天「買進又賣出」的短線交易越多，股價波動通常較大。
                </InfoTip></div>
                {dayTradeRatio === null ? (
                  <div className="text-lg md:text-xl font-bold text-gray-600">—</div>
                ) : (
                  <div className="text-lg md:text-xl font-bold text-cyan-600 tabular-nums">{dayTradeRatio.toFixed(1)}%</div>
                )}
              </div>
              <div>
                <div className="text-gray-700 text-xs font-medium md:text-sm">近7日強勢<InfoTip title="近 7 日強勢天數">
                  最近 7 個交易日中，本檔被系統選入「當日強勢股」的天數；天數越多代表強勢延續性越好。
                </InfoTip></div>
                <div className="text-lg md:text-xl font-bold text-orange-500 tabular-nums">
                  {data.recentStrongDays}
                  <span className="text-sm font-normal text-gray-700 ml-0.5">天</span>
                </div>
              </div>
            </div>
          </div>

          {/* 三大法人（手機版預設收合，桌機恆顯示） */}
          <div className="mt-4 md:mt-6 pt-4 md:pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <div className="text-gray-900 text-base font-medium">
                三大法人買賣超（張）
                <InfoTip title="三大法人買賣超">
                  當日「買進張數 − 賣出張數」。正數（紅）為買超、負數（綠）為賣超。
                  外資＝外資及陸資；自營商＝自行買賣＋避險。「連買 N 天」是連續買超的天數。
                </InfoTip>
                {latest.foreign_buy === null && (
                  <span className="text-sm font-normal text-gray-600 ml-2">當日資料尚未提供</span>
                )}
              </div>
              <button
                onClick={() => setShowInst((v) => !v)}
                className="md:hidden text-gray-700 text-sm px-2 py-1 -mr-2 whitespace-nowrap"
              >
                {showInst ? '收合 ▲' : '展開 ▼'}
              </button>
            </div>
            {/* 籌碼摘要（insight first；明細收合時仍顯示） */}
            {instBadges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {instBadges.map((b, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs md:text-sm px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                    <span aria-hidden="true">{b.dot}</span>{b.text}
                  </span>
                ))}
              </div>
            )}
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
                  <div className="text-gray-800 text-sm font-medium">
                    {label}
                    {label === '外資持股比例' && <InfoTip title="外資持股比例">外資實際持有張數 ÷ 該公司已發行股數 × 100%。比例高代表外資參與深。</InfoTip>}
                    {label === '外資尚可投資' && <InfoTip title="外資尚可投資比例">依投資上限，外資目前還可以再買進的比例（＝上限 − 已持有）。</InfoTip>}
                    {label === '外資投資上限' && <InfoTip title="外資投資上限">法規或公司章程訂定的外資持股上限比例，多數上市公司為 100%。</InfoTip>}
                  </div>
                  {v === null ? (
                    <div className="text-lg font-medium text-gray-600">—</div>
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

      {/* 今日訊號（前端用已載入的 history 即時判讀，零額外 API）*/}
      <div className="max-w-7xl mx-auto px-4 mb-6">
        <StockSignals history={history} />
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
