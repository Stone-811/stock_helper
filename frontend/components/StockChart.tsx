'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData, LineData } from 'lightweight-charts'
import { DailyStock } from '../lib/firebase'

interface StockChartProps {
  data: DailyStock[]
  height?: number
}

type TimeFrame = 'day' | 'week' | 'month'
type Indicator = 'macd' | 'kd' | 'rsi'
type DatePeriod = '3M' | '6M' | '1Y' | '2Y'

// 日期週期對應的交易日數
const periodToDays: Record<DatePeriod, number> = {
  '3M': 65,
  '6M': 130,
  '1Y': 250,
  '2Y': 500,
}

export default function StockChart({ data, height = 500 }: StockChartProps) {
  const mainChartRef = useRef<HTMLDivElement>(null)
  const volumeChartRef = useRef<HTMLDivElement>(null)
  const indicatorChartRef = useRef<HTMLDivElement>(null)

  // MA 系列的 refs（用於控制顯示/隱藏，避免重新創建圖表）
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  const [timeFrame, setTimeFrame] = useState<TimeFrame>('day')
  const [indicator, setIndicator] = useState<Indicator>('macd')
  const [datePeriod, setDatePeriod] = useState<DatePeriod>('3M')
  const [crosshairIndex, setCrosshairIndex] = useState<number>(-1)

  // MA 顯示設定
  const [showMA5, setShowMA5] = useState(true)
  const [showMA10, setShowMA10] = useState(true)
  const [showMA20, setShowMA20] = useState(true)
  const [showMA60, setShowMA60] = useState(false)

  // 根據時間週期轉換資料（使用 useMemo 避免重複計算）
  const chartData = useMemo(() => convertToTimeFrame(data, timeFrame), [data, timeFrame])

  // 根據日期週期篩選顯示的資料
  const displayData = useMemo(() => {
    const days = periodToDays[datePeriod]
    const startIdx = Math.max(0, chartData.length - days)
    return chartData.slice(startIdx)
  }, [chartData, datePeriod])

  // 預先計算所有 MA 和指標數值（基於顯示資料）
  const maData = useMemo(() => ({
    ma5: calculateMAValues(displayData, 5),
    ma10: calculateMAValues(displayData, 10),
    ma20: calculateMAValues(displayData, 20),
    ma60: calculateMAValues(displayData, 60),
  }), [displayData])

  const macdData = useMemo(() => calculateMACDValues(displayData), [displayData])
  const kdData = useMemo(() => calculateKDValues(displayData), [displayData])
  const rsiData = useMemo(() => calculateRSIValues(displayData), [displayData])

  useEffect(() => {
    if (!mainChartRef.current || !volumeChartRef.current || !indicatorChartRef.current || displayData.length === 0) return

    // 主圖高度分配
    const mainHeight = Math.floor(height * 0.55)
    const volumeHeight = Math.floor(height * 0.15)
    const indicatorHeight = Math.floor(height * 0.25)

    // ========== 主圖 (K線 + MA) ==========
    const mainChart = createChart(mainChartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a2e' },
        textColor: '#a0a0a0',
        fontSize: 16,
      },
      width: mainChartRef.current.clientWidth,
      height: mainHeight,
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      crosshair: {
        mode: 1,
        vertLine: { color: '#505070', width: 1, style: 2 },
        horzLine: { color: '#505070', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: '#3a3a4e',
      },
      timeScale: {
        borderColor: '#3a3a4e',
        timeVisible: true,
        visible: false,
        rightOffset: 5,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
    })

    // K 線
    const candleSeries = mainChart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
      lastValueVisible: false,
    })

    const candleData: CandlestickData[] = displayData.map(item => ({
      time: item.date as string,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))
    candleSeries.setData(candleData)

    // MA 線（全部創建，透過 visible 控制顯示）
    const ma5 = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lastValueVisible: false, visible: showMA5 })
    ma5.setData(calculateMA(displayData, 5))
    ma5SeriesRef.current = ma5

    const ma10 = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false, visible: showMA10 })
    ma10.setData(calculateMA(displayData, 10))
    ma10SeriesRef.current = ma10

    const ma20 = mainChart.addLineSeries({ color: '#ec4899', lineWidth: 1, lastValueVisible: false, visible: showMA20 })
    ma20.setData(calculateMA(displayData, 20))
    ma20SeriesRef.current = ma20

    const ma60 = mainChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false, visible: showMA60 })
    ma60.setData(calculateMA(displayData, 60))
    ma60SeriesRef.current = ma60

    // ========== 成交量圖 ==========
    const volumeChart = createChart(volumeChartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a2e' },
        textColor: '#a0a0a0',
        fontSize: 16,
      },
      width: volumeChartRef.current.clientWidth,
      height: volumeHeight,
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      rightPriceScale: {
        borderColor: '#3a3a4e',
      },
      timeScale: {
        borderColor: '#3a3a4e',
        visible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
    })

    const volumeSeries = volumeChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
    })

    const volumeData: HistogramData[] = displayData.map(item => ({
      time: item.date as string,
      value: item.volume,
      color: item.close >= item.open ? '#ef444480' : '#22c55e80',
    }))
    volumeSeries.setData(volumeData)

    // ========== 指標圖 ==========
    const indicatorChart = createChart(indicatorChartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a2e' },
        textColor: '#a0a0a0',
        fontSize: 16,
      },
      width: indicatorChartRef.current.clientWidth,
      height: indicatorHeight,
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      rightPriceScale: {
        borderColor: '#3a3a4e',
      },
      timeScale: {
        borderColor: '#3a3a4e',
        timeVisible: true,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: false,
      handleScale: false,
    })

    // 根據選擇的指標繪製
    if (indicator === 'macd') {
      drawMACD(indicatorChart, displayData)
    } else if (indicator === 'kd') {
      drawKD(indicatorChart, displayData)
    } else if (indicator === 'rsi') {
      drawRSI(indicatorChart, displayData)
    }

    // 十字線同步（跨圖表）
    volumeChart.subscribeCrosshairMove(param => {
      if (param.time) {
        mainChart.setCrosshairPosition(0, param.time, candleSeries)
      }
    })

    indicatorChart.subscribeCrosshairMove(param => {
      if (param.time) {
        mainChart.setCrosshairPosition(0, param.time, candleSeries)
      }
    })

    // 同步十字線 - 記錄 index 給左上角資訊顯示
    mainChart.subscribeCrosshairMove(param => {
      if (param.time) {
        const idx = displayData.findIndex(d => d.date === param.time)
        setCrosshairIndex(idx)
      } else {
        setCrosshairIndex(-1)
      }
    })

    // 顯示全部資料範圍
    mainChart.timeScale().fitContent()
    volumeChart.timeScale().fitContent()
    indicatorChart.timeScale().fitContent()

    // 響應式調整
    const handleResize = () => {
      if (mainChartRef.current) {
        mainChart.applyOptions({ width: mainChartRef.current.clientWidth })
        volumeChart.applyOptions({ width: mainChartRef.current.clientWidth })
        indicatorChart.applyOptions({ width: mainChartRef.current.clientWidth })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      ma5SeriesRef.current = null
      ma10SeriesRef.current = null
      ma20SeriesRef.current = null
      ma60SeriesRef.current = null
      mainChart.remove()
      volumeChart.remove()
      indicatorChart.remove()
    }
  }, [displayData, indicator, height])

  // 獨立的 useEffect 控制 MA 線顯示/隱藏（避免重繪圖表）
  useEffect(() => {
    if (ma5SeriesRef.current) ma5SeriesRef.current.applyOptions({ visible: showMA5 })
  }, [showMA5])

  useEffect(() => {
    if (ma10SeriesRef.current) ma10SeriesRef.current.applyOptions({ visible: showMA10 })
  }, [showMA10])

  useEffect(() => {
    if (ma20SeriesRef.current) ma20SeriesRef.current.applyOptions({ visible: showMA20 })
  }, [showMA20])

  useEffect(() => {
    if (ma60SeriesRef.current) ma60SeriesRef.current.applyOptions({ visible: showMA60 })
  }, [showMA60])

  return (
    <div className="bg-[#1a1a2e] rounded-lg p-2 md:p-4">
      {/* 頂部控制列 - 手機版兩行，桌面版一行 */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-3 md:mb-4">
        {/* 第一行：時間週期 + 日期區間 + 指標 */}
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          {/* 時間週期選擇 */}
          <div className="flex gap-1 md:gap-2">
            {[
              { key: 'day', label: '日K' },
              { key: 'week', label: '週K' },
              { key: 'month', label: '月K' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimeFrame(key as TimeFrame)}
                className={`px-2 md:px-3 py-1 md:py-1.5 text-sm md:text-base font-medium rounded min-h-[36px] ${
                  timeFrame === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* 日期區間 */}
          <div className="flex gap-1 md:gap-2">
            {(['3M', '6M', '1Y', '2Y'] as DatePeriod[]).map(period => (
              <button
                key={period}
                onClick={() => setDatePeriod(period)}
                className={`px-2 md:px-3 py-1 md:py-1.5 text-sm md:text-base font-medium rounded min-h-[36px] ${
                  datePeriod === period
                    ? 'bg-green-600 text-white'
                    : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'
                }`}
              >
                {period}
              </button>
            ))}
          </div>

          {/* 指標選擇 */}
          <div className="flex items-center gap-1 md:gap-2">
            <span className="text-white text-sm md:text-base hidden md:inline">指標:</span>
            <select
              value={indicator}
              onChange={(e) => setIndicator(e.target.value as Indicator)}
              className="bg-[#2a2a3e] text-white text-sm md:text-base font-medium rounded px-2 py-1 md:py-1.5 border border-[#3a3a4e] min-h-[36px]"
            >
              <option value="macd">MACD</option>
              <option value="kd">KD</option>
              <option value="rsi">RSI</option>
            </select>
          </div>
        </div>

        {/* 第二行（手機）/ 同一行右側（桌面）：MA 勾選 */}
        <div className="flex items-center gap-2 md:gap-3 md:ml-auto">
          <label className="flex items-center gap-1 cursor-pointer min-h-[36px]">
            <input
              type="checkbox"
              checked={showMA5}
              onChange={(e) => setShowMA5(e.target.checked)}
              className="w-4 h-4 accent-amber-500"
            />
            <span className="text-amber-400 text-xs md:text-sm">MA5</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer min-h-[36px]">
            <input
              type="checkbox"
              checked={showMA10}
              onChange={(e) => setShowMA10(e.target.checked)}
              className="w-4 h-4 accent-blue-500"
            />
            <span className="text-blue-400 text-xs md:text-sm">MA10</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer min-h-[36px]">
            <input
              type="checkbox"
              checked={showMA20}
              onChange={(e) => setShowMA20(e.target.checked)}
              className="w-4 h-4 accent-pink-500"
            />
            <span className="text-pink-400 text-xs md:text-sm">MA20</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer min-h-[36px]">
            <input
              type="checkbox"
              checked={showMA60}
              onChange={(e) => setShowMA60(e.target.checked)}
              className="w-4 h-4 accent-purple-500"
            />
            <span className="text-purple-400 text-xs md:text-sm">MA60</span>
          </label>
        </div>
      </div>

      {/* 圖表區域 */}
      <div className="relative">
        {/* 左上角資訊顯示 */}
        {crosshairIndex >= 0 && displayData[crosshairIndex] && (
          <div className="absolute top-2 left-2 z-10 text-white text-base font-mono bg-[#1a1a2e]/80 px-2 py-1 rounded">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{displayData[crosshairIndex].date}</span>
              <span>開 <span className="text-yellow-400">{displayData[crosshairIndex].open.toFixed(2)}</span></span>
              <span>高 <span className="text-red-400">{displayData[crosshairIndex].high.toFixed(2)}</span></span>
              <span>低 <span className="text-green-400">{displayData[crosshairIndex].low.toFixed(2)}</span></span>
              <span>收 <span className={displayData[crosshairIndex].close >= displayData[crosshairIndex].open ? 'text-red-400' : 'text-green-400'}>
                {displayData[crosshairIndex].close.toFixed(2)}
              </span></span>
              <span>量 <span className="text-gray-300">{displayData[crosshairIndex].volume.toLocaleString()}張</span></span>
              {displayData[crosshairIndex].day_trading_volume > 0 && (
                <span>沖 <span className="text-cyan-400">
                  {displayData[crosshairIndex].day_trading_volume.toLocaleString()}張
                  {displayData[crosshairIndex].volume > 0 && (
                    <span className="text-cyan-300"> ({((displayData[crosshairIndex].day_trading_volume / displayData[crosshairIndex].volume) * 100).toFixed(1)}%)</span>
                  )}
                </span></span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 mt-1">
              {showMA5 && maData.ma5[crosshairIndex] && <span className="text-amber-400">MA5 {maData.ma5[crosshairIndex]!.toFixed(2)}</span>}
              {showMA10 && maData.ma10[crosshairIndex] && <span className="text-blue-400">MA10 {maData.ma10[crosshairIndex]!.toFixed(2)}</span>}
              {showMA20 && maData.ma20[crosshairIndex] && <span className="text-pink-400">MA20 {maData.ma20[crosshairIndex]!.toFixed(2)}</span>}
              {showMA60 && maData.ma60[crosshairIndex] && <span className="text-purple-400">MA60 {maData.ma60[crosshairIndex]!.toFixed(2)}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 mt-1">
              {indicator === 'macd' && macdData[crosshairIndex] && (
                <>
                  <span className="text-blue-400">DIF {macdData[crosshairIndex]!.dif.toFixed(2)}</span>
                  <span className="text-orange-400">MACD {macdData[crosshairIndex]!.macd.toFixed(2)}</span>
                  <span className={macdData[crosshairIndex]!.histogram >= 0 ? 'text-red-400' : 'text-green-400'}>
                    柱 {macdData[crosshairIndex]!.histogram.toFixed(2)}
                  </span>
                </>
              )}
              {indicator === 'kd' && kdData[crosshairIndex] && (
                <>
                  <span className="text-blue-400">K {kdData[crosshairIndex]!.k.toFixed(2)}</span>
                  <span className="text-orange-400">D {kdData[crosshairIndex]!.d.toFixed(2)}</span>
                </>
              )}
              {indicator === 'rsi' && rsiData[crosshairIndex] && (
                <span className="text-purple-400">RSI {rsiData[crosshairIndex]!.toFixed(2)}</span>
              )}
            </div>
          </div>
        )}
        <div ref={mainChartRef} />
      </div>
      <div ref={volumeChartRef} className="mt-1" />
      <div ref={indicatorChartRef} className="mt-1" />
    </div>
  )
}

// ========== 工具函數 ==========

function convertToTimeFrame(data: DailyStock[], timeFrame: TimeFrame): DailyStock[] {
  if (timeFrame === 'day') return data

  const grouped: { [key: string]: DailyStock[] } = {}

  data.forEach(item => {
    const date = new Date(item.date)
    let key: string

    if (timeFrame === 'week') {
      // 取該週的週一
      const day = date.getDay()
      const diff = date.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(date.setDate(diff))
      key = monday.toISOString().split('T')[0]
    } else {
      // 月
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`
    }

    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  })

  return Object.entries(grouped).map(([date, items]) => ({
    date,
    stock_id: items[0].stock_id,
    stock_name: items[0].stock_name,
    open: items[0].open,
    high: Math.max(...items.map(i => i.high)),
    low: Math.min(...items.map(i => i.low)),
    close: items[items.length - 1].close,
    volume: items.reduce((sum, i) => sum + i.volume, 0),
    day_trading_volume: items.reduce((sum, i) => sum + (i.day_trading_volume || 0), 0),
    foreign_buy: items.reduce((sum, i) => sum + i.foreign_buy, 0),
    trust_buy: items.reduce((sum, i) => sum + i.trust_buy, 0),
    dealer_buy: items.reduce((sum, i) => sum + i.dealer_buy, 0),
    foreign_hold_ratio: items[items.length - 1].foreign_hold_ratio,
    foreign_remain_ratio: items[items.length - 1].foreign_remain_ratio,
    foreign_limit_ratio: items[items.length - 1].foreign_limit_ratio,
    macd_status: items[items.length - 1].macd_status,
  })).sort((a, b) => a.date.localeCompare(b.date))
}

function calculateMA(data: DailyStock[], period: number): LineData[] {
  const result: LineData[] = []
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, item) => acc + item.close, 0)
    result.push({
      time: data[i].date as string,
      value: sum / period,
    })
  }
  return result
}

// 計算 MA 並返回按 index 索引的數組
function calculateMAValues(data: DailyStock[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null)
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, item) => acc + item.close, 0)
    result[i] = sum / period
  }
  return result
}

// 計算 MACD 並返回按 index 索引的數組
function calculateMACDValues(data: DailyStock[], fast = 12, slow = 26, signal = 9): ({ dif: number; macd: number; histogram: number } | null)[] {
  const result: ({ dif: number; macd: number; histogram: number } | null)[] = new Array(data.length).fill(null)
  const closes = data.map(d => d.close)
  const emaFast = calculateEMA(closes, fast)
  const emaSlow = calculateEMA(closes, slow)

  const dif: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1) {
      dif.push(0)
    } else {
      dif.push(emaFast[i] - emaSlow[i])
    }
  }

  const macdLine = calculateEMA(dif.slice(slow - 1), signal)
  const fullMacd = new Array(slow - 1).fill(0).concat(macdLine)

  for (let i = slow + signal - 2; i < data.length; i++) {
    result[i] = {
      dif: dif[i],
      macd: fullMacd[i],
      histogram: dif[i] - fullMacd[i],
    }
  }
  return result
}

// 計算 KD 並返回按 index 索引的數組
function calculateKDValues(data: DailyStock[], period = 9): ({ k: number; d: number } | null)[] {
  const result: ({ k: number; d: number } | null)[] = new Array(data.length).fill(null)
  let prevK = 50
  let prevD = 50

  for (let i = period - 1; i < data.length; i++) {
    const periodData = data.slice(i - period + 1, i + 1)
    const high = Math.max(...periodData.map(d => d.high))
    const low = Math.min(...periodData.map(d => d.low))
    const close = data[i].close

    const rsv = high !== low ? ((close - low) / (high - low)) * 100 : 50
    const k = (2 / 3) * prevK + (1 / 3) * rsv
    const d = (2 / 3) * prevD + (1 / 3) * k

    result[i] = { k, d }
    prevK = k
    prevD = d
  }
  return result
}

// 計算 RSI 並返回按 index 索引的數組
function calculateRSIValues(data: DailyStock[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null)
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)

    if (i >= period) {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      result[i] = 100 - (100 / (1 + rs))
    }
  }
  return result
}

function drawMACD(chart: IChartApi, data: DailyStock[]) {
  const macdData = calculateMACD(data)

  // Histogram
  const histogramSeries = chart.addHistogramSeries({
    priceFormat: { type: 'price', precision: 2 },
    lastValueVisible: false,
  })
  histogramSeries.setData(macdData.map(d => ({
    time: d.time as string,
    value: d.histogram,
    color: d.histogram >= 0 ? '#ef444480' : '#22c55e80',
  })))

  // DIF
  const difSeries = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false })
  difSeries.setData(macdData.map(d => ({ time: d.time as string, value: d.dif })))

  // MACD
  const macdSeries = chart.addLineSeries({ color: '#f97316', lineWidth: 1, lastValueVisible: false })
  macdSeries.setData(macdData.map(d => ({ time: d.time as string, value: d.macd })))
}

function drawKD(chart: IChartApi, data: DailyStock[]) {
  const kdData = calculateKD(data)

  const kSeries = chart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false })
  kSeries.setData(kdData.map(d => ({ time: d.time as string, value: d.k })))

  const dSeries = chart.addLineSeries({ color: '#f97316', lineWidth: 1, lastValueVisible: false })
  dSeries.setData(kdData.map(d => ({ time: d.time as string, value: d.d })))

  // 超買超賣線
  const overbought = chart.addLineSeries({ color: '#ef4444', lineWidth: 1, lineStyle: 2, lastValueVisible: false })
  const oversold = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, lineStyle: 2, lastValueVisible: false })
  overbought.setData(kdData.map(d => ({ time: d.time as string, value: 80 })))
  oversold.setData(kdData.map(d => ({ time: d.time as string, value: 20 })))
}

function drawRSI(chart: IChartApi, data: DailyStock[]) {
  const rsiData = calculateRSI(data)

  const rsiSeries = chart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false })
  rsiSeries.setData(rsiData)

  // 超買超賣線
  const overbought = chart.addLineSeries({ color: '#ef4444', lineWidth: 1, lineStyle: 2, lastValueVisible: false })
  const oversold = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, lineStyle: 2, lastValueVisible: false })
  overbought.setData(rsiData.map(d => ({ time: d.time as string, value: 70 })))
  oversold.setData(rsiData.map(d => ({ time: d.time as string, value: 30 })))
}

function calculateMACD(data: DailyStock[], fast = 12, slow = 26, signal = 9) {
  const closes = data.map(d => d.close)
  const emaFast = calculateEMA(closes, fast)
  const emaSlow = calculateEMA(closes, slow)

  const dif: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1) {
      dif.push(0)
    } else {
      dif.push(emaFast[i] - emaSlow[i])
    }
  }

  const macdLine = calculateEMA(dif.slice(slow - 1), signal)
  const fullMacd = new Array(slow - 1).fill(0).concat(macdLine)

  const result = []
  for (let i = slow + signal - 2; i < data.length; i++) {
    result.push({
      time: data[i].date,
      dif: dif[i],
      macd: fullMacd[i],
      histogram: dif[i] - fullMacd[i],
    })
  }
  return result
}

function calculateKD(data: DailyStock[], period = 9) {
  const result = []
  let prevK = 50
  let prevD = 50

  for (let i = period - 1; i < data.length; i++) {
    const periodData = data.slice(i - period + 1, i + 1)
    const high = Math.max(...periodData.map(d => d.high))
    const low = Math.min(...periodData.map(d => d.low))
    const close = data[i].close

    const rsv = high !== low ? ((close - low) / (high - low)) * 100 : 50
    const k = (2 / 3) * prevK + (1 / 3) * rsv
    const d = (2 / 3) * prevD + (1 / 3) * k

    result.push({ time: data[i].date, k, d })
    prevK = k
    prevD = d
  }
  return result
}

function calculateRSI(data: DailyStock[], period = 14): LineData[] {
  const result: LineData[] = []
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close
    gains.push(change > 0 ? change : 0)
    losses.push(change < 0 ? -change : 0)

    if (i >= period) {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
      const rsi = 100 - (100 / (1 + rs))
      result.push({ time: data[i].date as string, value: rsi })
    }
  }
  return result
}

function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = []
  const multiplier = 2 / (period + 1)

  let sum = 0
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i]
  }
  result[period - 1] = sum / period

  for (let i = period; i < data.length; i++) {
    result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1]
  }
  return result
}
