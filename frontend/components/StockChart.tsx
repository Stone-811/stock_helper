'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, ColorType, IChartApi, CandlestickData, HistogramData, LineData } from 'lightweight-charts'
import { DailyStock } from '../lib/supabase'

interface StockChartProps {
  data: DailyStock[]
  height?: number
}

type TimeFrame = 'day' | 'week' | 'month'
type Indicator = 'macd' | 'kd' | 'rsi'

export default function StockChart({ data, height = 500 }: StockChartProps) {
  const mainChartRef = useRef<HTMLDivElement>(null)
  const volumeChartRef = useRef<HTMLDivElement>(null)
  const indicatorChartRef = useRef<HTMLDivElement>(null)

  const [timeFrame, setTimeFrame] = useState<TimeFrame>('day')
  const [indicator, setIndicator] = useState<Indicator>('macd')

  // 根據時間週期轉換資料
  const chartData = convertToTimeFrame(data, timeFrame)

  // 預先計算所有 MA 和指標數值（用於右側價格標籤）
  const maData = {
    ma5: calculateMAValues(chartData, 5),
    ma10: calculateMAValues(chartData, 10),
    ma20: calculateMAValues(chartData, 20),
    ma60: calculateMAValues(chartData, 60),
  }
  const macdData = calculateMACDValues(chartData)
  const kdData = calculateKDValues(chartData)
  const rsiData = calculateRSIValues(chartData)

  useEffect(() => {
    if (!mainChartRef.current || !volumeChartRef.current || !indicatorChartRef.current || chartData.length === 0) return

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
        visible: false, // 隱藏主圖時間軸
      },
    })

    // K 線
    const candleSeries = mainChart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
      lastValueVisible: false, // 隱藏預設的最後價格標籤
    })

    const candleData: CandlestickData[] = chartData.map(item => ({
      time: item.date as string,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))
    candleSeries.setData(candleData)

    // MA 線
    const ma5 = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 1, lastValueVisible: false })
    const ma10 = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false })
    const ma20 = mainChart.addLineSeries({ color: '#ec4899', lineWidth: 1, lastValueVisible: false })
    const ma60 = mainChart.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false })

    ma5.setData(calculateMA(chartData, 5))
    ma10.setData(calculateMA(chartData, 10))
    ma20.setData(calculateMA(chartData, 20))
    ma60.setData(calculateMA(chartData, 60))

    // 建立右側價格標籤 (Price Lines)
    const lastIdx = chartData.length - 1
    const lastClose = chartData[lastIdx]?.close || 0

    // 收盤價標籤
    let closePriceLine = candleSeries.createPriceLine({
      price: lastClose,
      color: chartData[lastIdx]?.close >= chartData[lastIdx]?.open ? '#ef4444' : '#22c55e',
      lineWidth: 1,
      lineStyle: 2, // Dashed
      axisLabelVisible: true,
      title: '',
    })

    // MA 價格標籤
    let ma5PriceLine = ma5.createPriceLine({
      price: maData.ma5[lastIdx] || 0,
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    })

    let ma10PriceLine = ma10.createPriceLine({
      price: maData.ma10[lastIdx] || 0,
      color: '#3b82f6',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    })

    let ma20PriceLine = ma20.createPriceLine({
      price: maData.ma20[lastIdx] || 0,
      color: '#ec4899',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    })

    let ma60PriceLine = ma60.createPriceLine({
      price: maData.ma60[lastIdx] || 0,
      color: '#8b5cf6',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    })

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
      },
    })

    const volumeSeries = volumeChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
    })

    const volumeData: HistogramData[] = chartData.map(item => ({
      time: item.date as string,
      value: item.volume,
      color: item.close >= item.open ? '#ef444480' : '#22c55e80',
    }))
    volumeSeries.setData(volumeData)

    // 成交量價格標籤
    let volumePriceLine = volumeSeries.createPriceLine({
      price: chartData[lastIdx]?.volume || 0,
      color: chartData[lastIdx]?.close >= chartData[lastIdx]?.open ? '#ef4444' : '#22c55e',
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    })

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
      },
    })

    // 根據選擇的指標繪製，並建立價格標籤
    let indicatorSeries: any = null
    let indicatorPriceLines: any[] = []

    if (indicator === 'macd') {
      const series = drawMACD(indicatorChart, chartData)
      indicatorSeries = series
      const lastMacd = macdData[lastIdx]
      if (lastMacd) {
        indicatorPriceLines = [
          series.difSeries.createPriceLine({ price: lastMacd.dif, color: '#3b82f6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
          series.macdSeries.createPriceLine({ price: lastMacd.macd, color: '#f97316', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
          series.histogramSeries.createPriceLine({ price: lastMacd.histogram, color: lastMacd.histogram >= 0 ? '#ef4444' : '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
        ]
      }
    } else if (indicator === 'kd') {
      const series = drawKD(indicatorChart, chartData)
      indicatorSeries = series
      const lastKd = kdData[lastIdx]
      if (lastKd) {
        indicatorPriceLines = [
          series.kSeries.createPriceLine({ price: lastKd.k, color: '#3b82f6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
          series.dSeries.createPriceLine({ price: lastKd.d, color: '#f97316', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
        ]
      }
    } else if (indicator === 'rsi') {
      const series = drawRSI(indicatorChart, chartData)
      indicatorSeries = series
      const lastRsi = rsiData[lastIdx]
      if (lastRsi) {
        indicatorPriceLines = [
          series.rsiSeries.createPriceLine({ price: lastRsi, color: '#8b5cf6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
        ]
      }
    }

    // 同步三個圖表的時間軸
    mainChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) {
        volumeChart.timeScale().setVisibleLogicalRange(range)
        indicatorChart.timeScale().setVisibleLogicalRange(range)
      }
    })

    volumeChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) {
        mainChart.timeScale().setVisibleLogicalRange(range)
        indicatorChart.timeScale().setVisibleLogicalRange(range)
      }
    })

    indicatorChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
      if (range) {
        mainChart.timeScale().setVisibleLogicalRange(range)
        volumeChart.timeScale().setVisibleLogicalRange(range)
      }
    })

    // 同步十字線 - 記錄 index 並更新右側價格標籤
    const updatePriceLabels = (idx: number) => {
      if (idx < 0 || idx >= chartData.length) return

      const currentData = chartData[idx]
      const isUp = currentData.close >= currentData.open

      // 更新收盤價標籤
      candleSeries.removePriceLine(closePriceLine)
      closePriceLine = candleSeries.createPriceLine({
        price: currentData.close,
        color: isUp ? '#ef4444' : '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      })

      // 更新 MA 標籤
      if (maData.ma5[idx]) {
        ma5.removePriceLine(ma5PriceLine)
        ma5PriceLine = ma5.createPriceLine({
          price: maData.ma5[idx]!,
          color: '#f59e0b',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '',
        })
      }

      if (maData.ma10[idx]) {
        ma10.removePriceLine(ma10PriceLine)
        ma10PriceLine = ma10.createPriceLine({
          price: maData.ma10[idx]!,
          color: '#3b82f6',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '',
        })
      }

      if (maData.ma20[idx]) {
        ma20.removePriceLine(ma20PriceLine)
        ma20PriceLine = ma20.createPriceLine({
          price: maData.ma20[idx]!,
          color: '#ec4899',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '',
        })
      }

      if (maData.ma60[idx]) {
        ma60.removePriceLine(ma60PriceLine)
        ma60PriceLine = ma60.createPriceLine({
          price: maData.ma60[idx]!,
          color: '#8b5cf6',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '',
        })
      }

      // 更新成交量標籤
      volumeSeries.removePriceLine(volumePriceLine)
      volumePriceLine = volumeSeries.createPriceLine({
        price: currentData.volume,
        color: isUp ? '#ef4444' : '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '',
      })

      // 更新指標標籤
      if (indicator === 'macd' && indicatorSeries && macdData[idx]) {
        const m = macdData[idx]!
        indicatorPriceLines.forEach((pl, i) => {
          if (i === 0) indicatorSeries.difSeries.removePriceLine(pl)
          else if (i === 1) indicatorSeries.macdSeries.removePriceLine(pl)
          else indicatorSeries.histogramSeries.removePriceLine(pl)
        })
        indicatorPriceLines = [
          indicatorSeries.difSeries.createPriceLine({ price: m.dif, color: '#3b82f6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
          indicatorSeries.macdSeries.createPriceLine({ price: m.macd, color: '#f97316', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
          indicatorSeries.histogramSeries.createPriceLine({ price: m.histogram, color: m.histogram >= 0 ? '#ef4444' : '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
        ]
      } else if (indicator === 'kd' && indicatorSeries && kdData[idx]) {
        const k = kdData[idx]!
        indicatorPriceLines.forEach((pl, i) => {
          if (i === 0) indicatorSeries.kSeries.removePriceLine(pl)
          else indicatorSeries.dSeries.removePriceLine(pl)
        })
        indicatorPriceLines = [
          indicatorSeries.kSeries.createPriceLine({ price: k.k, color: '#3b82f6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
          indicatorSeries.dSeries.createPriceLine({ price: k.d, color: '#f97316', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
        ]
      } else if (indicator === 'rsi' && indicatorSeries && rsiData[idx]) {
        indicatorPriceLines.forEach(pl => indicatorSeries.rsiSeries.removePriceLine(pl))
        indicatorPriceLines = [
          indicatorSeries.rsiSeries.createPriceLine({ price: rsiData[idx]!, color: '#8b5cf6', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '' }),
        ]
      }
    }

    mainChart.subscribeCrosshairMove(param => {
      if (param.time) {
        const idx = chartData.findIndex(d => d.date === param.time)
        if (idx !== -1) {
          updatePriceLabels(idx)
        }
      }
    })

    // 預設顯示近三個月資料（約 65 個交易日），但仍可往前拉
    const threeMonthBars = 65
    const totalBars = chartData.length
    const from = Math.max(0, totalBars - threeMonthBars)
    const visibleRange = { from, to: totalBars }

    mainChart.timeScale().setVisibleLogicalRange(visibleRange)
    volumeChart.timeScale().setVisibleLogicalRange(visibleRange)
    indicatorChart.timeScale().setVisibleLogicalRange(visibleRange)

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
      mainChart.remove()
      volumeChart.remove()
      indicatorChart.remove()
    }
  }, [chartData, indicator, height])

  return (
    <div className="bg-[#1a1a2e] rounded-lg p-4">
      {/* 頂部控制列 */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        {/* 時間週期選擇 */}
        <div className="flex gap-2">
          {[
            { key: 'day', label: '日K' },
            { key: 'week', label: '週K' },
            { key: 'month', label: '月K' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTimeFrame(key as TimeFrame)}
              className={`px-4 py-2 text-lg font-medium rounded ${
                timeFrame === key
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#2a2a3e] text-white hover:bg-[#3a3a4e]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 指標選擇 */}
        <div className="flex items-center gap-3">
          <span className="text-white text-lg">指標:</span>
          <select
            value={indicator}
            onChange={(e) => setIndicator(e.target.value as Indicator)}
            className="bg-[#2a2a3e] text-white text-lg font-medium rounded px-3 py-2 border border-[#3a3a4e]"
          >
            <option value="macd">MACD</option>
            <option value="kd">KD</option>
            <option value="rsi">RSI</option>
          </select>
        </div>

      </div>

      {/* 圖表區域 */}
      <div ref={mainChartRef} />
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

  return { difSeries, macdSeries, histogramSeries }
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

  return { kSeries, dSeries }
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

  return { rsiSeries }
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
