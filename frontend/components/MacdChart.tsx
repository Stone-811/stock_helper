'use client'

import { useEffect, useRef } from 'react'
import { createChart, ColorType, IChartApi } from 'lightweight-charts'
import { DailyStock } from '@/lib/supabase'

interface MacdChartProps {
  data: DailyStock[]
  height?: number
}

export default function MacdChart({ data, height = 200 }: MacdChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current || data.length === 0) return

    // 建立圖表
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'white' },
        textColor: '#333',
      },
      width: chartContainerRef.current.clientWidth,
      height: height,
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: {
        borderColor: '#ddd',
      },
      timeScale: {
        borderColor: '#ddd',
        timeVisible: true,
      },
    })

    chartRef.current = chart

    // 計算 MACD
    const macdData = calculateMACD(data)

    // MACD 柱狀圖
    const histogramSeries = chart.addHistogramSeries({
      color: '#22c55e',
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    })

    const histogramData = macdData.map(item => ({
      time: item.time,
      value: item.histogram,
      color: item.histogram >= 0 ? '#ef4444' : '#22c55e',
    }))

    histogramSeries.setData(histogramData)

    // MACD 線
    const macdLineSeries = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 1,
      title: 'MACD',
    })

    const macdLineData = macdData.map(item => ({
      time: item.time,
      value: item.macd,
    }))

    macdLineSeries.setData(macdLineData)

    // Signal 線
    const signalSeries = chart.addLineSeries({
      color: '#f97316',
      lineWidth: 1,
      title: 'Signal',
    })

    const signalData = macdData.map(item => ({
      time: item.time,
      value: item.signal,
    }))

    signalSeries.setData(signalData)

    // 自適應寬度
    chart.timeScale().fitContent()

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [data, height])

  return (
    <div>
      <div className="flex gap-4 mb-2 text-sm">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-blue-500 inline-block"></span>
          MACD
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-orange-500 inline-block"></span>
          Signal
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 bg-red-500 inline-block"></span>
          /
          <span className="w-3 h-3 bg-green-500 inline-block"></span>
          Histogram
        </span>
      </div>
      <div ref={chartContainerRef} />
    </div>
  )
}

// 計算 MACD
function calculateMACD(data: DailyStock[], fast = 12, slow = 26, signal = 9) {
  const closes = data.map(d => d.close)

  // 計算 EMA
  const emaFast = calculateEMA(closes, fast)
  const emaSlow = calculateEMA(closes, slow)

  // 計算 MACD 線 (DIF)
  const macdLine: number[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < slow - 1) {
      macdLine.push(0)
    } else {
      macdLine.push(emaFast[i] - emaSlow[i])
    }
  }

  // 計算 Signal 線 (DEM)
  const signalLine = calculateEMA(macdLine.slice(slow - 1), signal)
  const fullSignalLine = new Array(slow - 1).fill(0).concat(signalLine)

  // 計算 Histogram
  const result = []
  for (let i = slow + signal - 2; i < data.length; i++) {
    result.push({
      time: data[i].date,
      macd: macdLine[i],
      signal: fullSignalLine[i],
      histogram: macdLine[i] - fullSignalLine[i],
    })
  }

  return result
}

// 計算 EMA
function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = []
  const multiplier = 2 / (period + 1)

  // 第一個值使用 SMA
  let sum = 0
  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i]
  }

  result[period - 1] = sum / period

  // 之後使用 EMA 公式
  for (let i = period; i < data.length; i++) {
    result[i] = (data[i] - result[i - 1]) * multiplier + result[i - 1]
  }

  return result
}
