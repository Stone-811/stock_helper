'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, HistogramData } from 'lightweight-charts'
import {
  Candle,
  calculateMAValues,
  calculateMACDValues,
  calculateKDValues,
  calculateRSIValues,
  calculateBBANDValues,
  toLineData,
  bbandLine,
} from '../lib/indicators'

// 個股會多帶當沖量；大盤沒有（可選）
type ChartCandle = Candle & { day_trading_volume?: number }

interface CandleChartProps {
  data: ChartCandle[]
  height?: number
  /** 成交量顯示格式（個股：張；大盤：億/口） */
  volumeFormatter?: (v: number) => string
}

type TimeFrame = 'day' | 'week' | 'month'
type Indicator = 'macd' | 'kd' | 'rsi'
type DatePeriod = '3M' | '6M' | '1Y' | '2Y'

const periodToDays: Record<DatePeriod, number> = {
  '3M': 65,
  '6M': 130,
  '1Y': 250,
  '2Y': 500,
}

const defaultVolumeFormatter = (v: number) => `${v.toLocaleString()}張`

export default function CandleChart({ data, height = 500, volumeFormatter = defaultVolumeFormatter }: CandleChartProps) {
  const mainChartRef = useRef<HTMLDivElement>(null)
  const volumeChartRef = useRef<HTMLDivElement>(null)
  const indicatorChartRef = useRef<HTMLDivElement>(null)

  // MA 系列的 refs（控制顯示/隱藏，避免重建圖表）
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  // 布林通道三條線的 refs
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbMiddleRef = useRef<ISeriesApi<'Line'> | null>(null)
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null)

  const [timeFrame, setTimeFrame] = useState<TimeFrame>('day')
  const [indicator, setIndicator] = useState<Indicator>('macd')
  const [datePeriod, setDatePeriod] = useState<DatePeriod>('3M')
  const [crosshairIndex, setCrosshairIndex] = useState<number>(-1)

  // MA 顯示設定
  const [showMA5, setShowMA5] = useState(true)
  const [showMA10, setShowMA10] = useState(true)
  const [showMA20, setShowMA20] = useState(true)
  const [showMA60, setShowMA60] = useState(false)
  // 布林通道顯示設定
  const [showBB, setShowBB] = useState(false)

  // 依時間週期轉換資料
  const chartData = useMemo(() => convertToTimeFrame(data, timeFrame), [data, timeFrame])

  // 依日期區間篩選
  const displayData = useMemo(() => {
    const days = periodToDays[datePeriod]
    const startIdx = Math.max(0, chartData.length - days)
    return chartData.slice(startIdx)
  }, [chartData, datePeriod])

  // 預先計算所有指標（單一來源，圖表與 tooltip 共用，不重複計算）
  const maData = useMemo(() => ({
    ma5: calculateMAValues(displayData, 5),
    ma10: calculateMAValues(displayData, 10),
    ma20: calculateMAValues(displayData, 20),
    ma60: calculateMAValues(displayData, 60),
  }), [displayData])

  const bbData = useMemo(() => calculateBBANDValues(displayData, 20, 2), [displayData])
  const macdData = useMemo(() => calculateMACDValues(displayData), [displayData])
  const kdData = useMemo(() => calculateKDValues(displayData), [displayData])
  const rsiData = useMemo(() => calculateRSIValues(displayData), [displayData])

  useEffect(() => {
    if (!mainChartRef.current || !volumeChartRef.current || !indicatorChartRef.current || displayData.length === 0) return

    const mainHeight = Math.floor(height * 0.55)
    const volumeHeight = Math.floor(height * 0.15)
    const indicatorHeight = Math.floor(height * 0.25)

    const commonLayout = {
      background: { type: ColorType.Solid, color: '#1a1a2e' },
      textColor: '#a0a0a0',
      fontSize: 16,
    }
    const commonGrid = {
      vertLines: { color: '#2a2a3e' },
      horzLines: { color: '#2a2a3e' },
    }

    // ========== 主圖 (K線 + MA + 布林) ==========
    const mainChart = createChart(mainChartRef.current, {
      layout: commonLayout,
      width: mainChartRef.current.clientWidth,
      height: mainHeight,
      grid: commonGrid,
      crosshair: {
        mode: 1,
        vertLine: { color: '#505070', width: 1, style: 2 },
        horzLine: { color: '#505070', width: 1, style: 2 },
      },
      rightPriceScale: { borderColor: '#3a3a4e' },
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
      time: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))
    candleSeries.setData(candleData)

    // 布林通道（先加，讓 K 線畫在上層）
    const bbUpper = mainChart.addLineSeries({ color: '#f472b6', lineWidth: 1, lastValueVisible: false, visible: showBB, crosshairMarkerVisible: false })
    bbUpper.setData(bbandLine(displayData, bbData, 'upper'))
    bbUpperRef.current = bbUpper
    const bbMiddle = mainChart.addLineSeries({ color: '#a78bfa', lineWidth: 1, lineStyle: 2, lastValueVisible: false, visible: showBB, crosshairMarkerVisible: false })
    bbMiddle.setData(bbandLine(displayData, bbData, 'middle'))
    bbMiddleRef.current = bbMiddle
    const bbLower = mainChart.addLineSeries({ color: '#f472b6', lineWidth: 1, lastValueVisible: false, visible: showBB, crosshairMarkerVisible: false })
    bbLower.setData(bbandLine(displayData, bbData, 'lower'))
    bbLowerRef.current = bbLower

    // MA 線
    const ma5 = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lastValueVisible: false, visible: showMA5 })
    ma5.setData(toLineData(displayData, maData.ma5))
    ma5SeriesRef.current = ma5

    const ma10 = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false, visible: showMA10 })
    ma10.setData(toLineData(displayData, maData.ma10))
    ma10SeriesRef.current = ma10

    const ma20 = mainChart.addLineSeries({ color: '#ec4899', lineWidth: 1, lastValueVisible: false, visible: showMA20 })
    ma20.setData(toLineData(displayData, maData.ma20))
    ma20SeriesRef.current = ma20

    const ma60 = mainChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false, visible: showMA60 })
    ma60.setData(toLineData(displayData, maData.ma60))
    ma60SeriesRef.current = ma60

    // ========== 成交量圖 ==========
    const volumeChart = createChart(volumeChartRef.current, {
      layout: commonLayout,
      width: volumeChartRef.current.clientWidth,
      height: volumeHeight,
      grid: commonGrid,
      rightPriceScale: { borderColor: '#3a3a4e' },
      timeScale: { borderColor: '#3a3a4e', visible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    })
    const volumeSeries = volumeChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
    })
    const volumeData: HistogramData[] = displayData.map(item => ({
      time: item.date,
      value: item.volume,
      color: item.close >= item.open ? '#ef444480' : '#22c55e80',
    }))
    volumeSeries.setData(volumeData)

    // ========== 副圖指標 ==========
    const indicatorChart = createChart(indicatorChartRef.current, {
      layout: commonLayout,
      width: indicatorChartRef.current.clientWidth,
      height: indicatorHeight,
      grid: commonGrid,
      rightPriceScale: { borderColor: '#3a3a4e' },
      timeScale: { borderColor: '#3a3a4e', timeVisible: true, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: false,
      handleScale: false,
    })

    if (indicator === 'macd') {
      const hist = indicatorChart.addHistogramSeries({ priceFormat: { type: 'price', precision: 2 }, lastValueVisible: false })
      hist.setData(displayData.map((d, i) => ({
        time: d.date,
        value: macdData[i]?.histogram ?? 0,
        color: (macdData[i]?.histogram ?? 0) >= 0 ? '#ef444480' : '#22c55e80',
      })).filter((_, i) => macdData[i]))
      const dif = indicatorChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false })
      dif.setData(toLineData(displayData, macdData.map(m => m?.dif ?? null)))
      const macd = indicatorChart.addLineSeries({ color: '#f97316', lineWidth: 1, lastValueVisible: false })
      macd.setData(toLineData(displayData, macdData.map(m => m?.macd ?? null)))
    } else if (indicator === 'kd') {
      const kLine = indicatorChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false })
      kLine.setData(toLineData(displayData, kdData.map(v => v?.k ?? null)))
      const dLine = indicatorChart.addLineSeries({ color: '#f97316', lineWidth: 1, lastValueVisible: false })
      dLine.setData(toLineData(displayData, kdData.map(v => v?.d ?? null)))
      addBandLines(indicatorChart, displayData, 80, 20)
    } else if (indicator === 'rsi') {
      const rsiLine = indicatorChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false })
      rsiLine.setData(toLineData(displayData, rsiData))
      addBandLines(indicatorChart, displayData, 70, 30)
    }

    // 十字線同步
    volumeChart.subscribeCrosshairMove(param => {
      if (param.time) mainChart.setCrosshairPosition(0, param.time, candleSeries)
    })
    indicatorChart.subscribeCrosshairMove(param => {
      if (param.time) mainChart.setCrosshairPosition(0, param.time, candleSeries)
    })
    mainChart.subscribeCrosshairMove(param => {
      if (param.time) {
        const idx = displayData.findIndex(d => d.date === param.time)
        setCrosshairIndex(idx)
      } else {
        setCrosshairIndex(-1)
      }
    })

    mainChart.timeScale().fitContent()
    volumeChart.timeScale().fitContent()
    indicatorChart.timeScale().fitContent()

    const handleResize = () => {
      if (mainChartRef.current) {
        const w = mainChartRef.current.clientWidth
        mainChart.applyOptions({ width: w })
        volumeChart.applyOptions({ width: w })
        indicatorChart.applyOptions({ width: w })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      ma5SeriesRef.current = null
      ma10SeriesRef.current = null
      ma20SeriesRef.current = null
      ma60SeriesRef.current = null
      bbUpperRef.current = null
      bbMiddleRef.current = null
      bbLowerRef.current = null
      mainChart.remove()
      volumeChart.remove()
      indicatorChart.remove()
    }
  }, [displayData, indicator, height, maData, bbData, macdData, kdData, rsiData, showBB, showMA5, showMA10, showMA20, showMA60, volumeFormatter])

  // 控制 MA / 布林 顯示（避免重建圖表）
  useEffect(() => { ma5SeriesRef.current?.applyOptions({ visible: showMA5 }) }, [showMA5])
  useEffect(() => { ma10SeriesRef.current?.applyOptions({ visible: showMA10 }) }, [showMA10])
  useEffect(() => { ma20SeriesRef.current?.applyOptions({ visible: showMA20 }) }, [showMA20])
  useEffect(() => { ma60SeriesRef.current?.applyOptions({ visible: showMA60 }) }, [showMA60])
  useEffect(() => {
    bbUpperRef.current?.applyOptions({ visible: showBB })
    bbMiddleRef.current?.applyOptions({ visible: showBB })
    bbLowerRef.current?.applyOptions({ visible: showBB })
  }, [showBB])

  const cur = crosshairIndex >= 0 ? displayData[crosshairIndex] : null

  return (
    <div className="bg-[#1a1a2e] rounded-lg p-2 md:p-4">
      {/* 控制列 */}
      <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 mb-3 md:mb-4">
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          {/* 時間週期 */}
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
                  timeFrame === key ? 'bg-blue-600 text-white' : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'
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
                  datePeriod === period ? 'bg-green-600 text-white' : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
          {/* 副圖指標 */}
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

        {/* MA + 布林 勾選 */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3 md:ml-auto">
          {[
            { on: showMA5, set: setShowMA5, label: 'MA5', color: 'accent-amber-500', text: 'text-amber-400' },
            { on: showMA10, set: setShowMA10, label: 'MA10', color: 'accent-blue-500', text: 'text-blue-400' },
            { on: showMA20, set: setShowMA20, label: 'MA20', color: 'accent-pink-500', text: 'text-pink-400' },
            { on: showMA60, set: setShowMA60, label: 'MA60', color: 'accent-purple-500', text: 'text-purple-400' },
          ].map(({ on, set, label, color, text }) => (
            <label key={label} className="flex items-center gap-1 cursor-pointer min-h-[36px]">
              <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className={`w-4 h-4 ${color}`} />
              <span className={`${text} text-xs md:text-sm`}>{label}</span>
            </label>
          ))}
          <label className="flex items-center gap-1 cursor-pointer min-h-[36px]">
            <input type="checkbox" checked={showBB} onChange={(e) => setShowBB(e.target.checked)} className="w-4 h-4 accent-fuchsia-500" />
            <span className="text-fuchsia-400 text-xs md:text-sm">布林</span>
          </label>
        </div>
      </div>

      {/* 圖表區 */}
      <div className="relative">
        {cur && (
          <div className="absolute top-2 left-2 z-10 text-white text-base font-mono bg-[#1a1a2e]/80 px-2 py-1 rounded">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{cur.date}</span>
              <span>開 <span className="text-yellow-400">{cur.open.toFixed(2)}</span></span>
              <span>高 <span className="text-red-400">{cur.high.toFixed(2)}</span></span>
              <span>低 <span className="text-green-400">{cur.low.toFixed(2)}</span></span>
              <span>收 <span className={cur.close >= cur.open ? 'text-red-400' : 'text-green-400'}>{cur.close.toFixed(2)}</span></span>
              <span>量 <span className="text-gray-300">{volumeFormatter(cur.volume)}</span></span>
              {cur.day_trading_volume !== undefined && cur.day_trading_volume > 0 && (
                <span>沖 <span className="text-cyan-400">
                  {cur.day_trading_volume.toLocaleString()}張
                  {cur.volume > 0 && <span className="text-cyan-300"> ({((cur.day_trading_volume / cur.volume) * 100).toFixed(1)}%)</span>}
                </span></span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 mt-1">
              {showMA5 && maData.ma5[crosshairIndex] != null && <span className="text-amber-400">MA5 {maData.ma5[crosshairIndex]!.toFixed(2)}</span>}
              {showMA10 && maData.ma10[crosshairIndex] != null && <span className="text-blue-400">MA10 {maData.ma10[crosshairIndex]!.toFixed(2)}</span>}
              {showMA20 && maData.ma20[crosshairIndex] != null && <span className="text-pink-400">MA20 {maData.ma20[crosshairIndex]!.toFixed(2)}</span>}
              {showMA60 && maData.ma60[crosshairIndex] != null && <span className="text-purple-400">MA60 {maData.ma60[crosshairIndex]!.toFixed(2)}</span>}
              {showBB && bbData[crosshairIndex] && (
                <>
                  <span className="text-fuchsia-300">BB上 {bbData[crosshairIndex]!.upper.toFixed(2)}</span>
                  <span className="text-violet-300">BB中 {bbData[crosshairIndex]!.middle.toFixed(2)}</span>
                  <span className="text-fuchsia-300">BB下 {bbData[crosshairIndex]!.lower.toFixed(2)}</span>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 mt-1">
              {indicator === 'macd' && macdData[crosshairIndex] && (
                <>
                  <span className="text-blue-400">DIF {macdData[crosshairIndex]!.dif.toFixed(2)}</span>
                  <span className="text-orange-400">MACD {macdData[crosshairIndex]!.macd.toFixed(2)}</span>
                  <span className={macdData[crosshairIndex]!.histogram >= 0 ? 'text-red-400' : 'text-green-400'}>柱 {macdData[crosshairIndex]!.histogram.toFixed(2)}</span>
                </>
              )}
              {indicator === 'kd' && kdData[crosshairIndex] && (
                <>
                  <span className="text-blue-400">K {kdData[crosshairIndex]!.k.toFixed(2)}</span>
                  <span className="text-orange-400">D {kdData[crosshairIndex]!.d.toFixed(2)}</span>
                </>
              )}
              {indicator === 'rsi' && rsiData[crosshairIndex] != null && (
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

// 超買/超賣水平線
function addBandLines(chart: IChartApi, data: ChartCandle[], upper: number, lower: number) {
  const ob = chart.addLineSeries({ color: '#ef4444', lineWidth: 1, lineStyle: 2, lastValueVisible: false, crosshairMarkerVisible: false })
  const os = chart.addLineSeries({ color: '#22c55e', lineWidth: 1, lineStyle: 2, lastValueVisible: false, crosshairMarkerVisible: false })
  ob.setData(data.map(d => ({ time: d.date, value: upper })))
  os.setData(data.map(d => ({ time: d.date, value: lower })))
}

// 日K → 週K / 月K 聚合（保留額外欄位，OHLCV 正確聚合）
function convertToTimeFrame(data: ChartCandle[], timeFrame: TimeFrame): ChartCandle[] {
  if (timeFrame === 'day') return data

  const grouped: { [key: string]: ChartCandle[] } = {}
  data.forEach(item => {
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
    ...items[items.length - 1], // 保留額外欄位（法人等，取區間最後一筆）
    date,
    open: items[0].open,
    high: Math.max(...items.map(i => i.high)),
    low: Math.min(...items.map(i => i.low)),
    close: items[items.length - 1].close,
    volume: items.reduce((sum, i) => sum + i.volume, 0),
    day_trading_volume: items.reduce((sum, i) => sum + (i.day_trading_volume || 0), 0),
  })).sort((a, b) => a.date.localeCompare(b.date))
}
