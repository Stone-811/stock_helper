'use client'

import { useEffect, useRef } from 'react'
import { createChart, ColorType, IChartApi } from 'lightweight-charts'
import { DailyStock } from '@/lib/supabase'

interface CandlestickChartProps {
  data: DailyStock[]
  height?: number
}

export default function CandlestickChart({ data, height = 400 }: CandlestickChartProps) {
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
      crosshair: {
        mode: 1,
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

    // K 線
    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderUpColor: '#ef4444',
      borderDownColor: '#22c55e',
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    })

    const candleData = data.map(item => ({
      time: item.date,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }))

    candlestickSeries.setData(candleData)

    // MA5
    const ma5Series = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 1,
      title: 'MA5',
    })

    const ma5Data = calculateMA(data, 5)
    ma5Series.setData(ma5Data)

    // MA20
    const ma20Series = chart.addLineSeries({
      color: '#f97316',
      lineWidth: 1,
      title: 'MA20',
    })

    const ma20Data = calculateMA(data, 20)
    ma20Series.setData(ma20Data)

    // MA60
    const ma60Series = chart.addLineSeries({
      color: '#8b5cf6',
      lineWidth: 1,
      title: 'MA60',
    })

    const ma60Data = calculateMA(data, 60)
    ma60Series.setData(ma60Data)

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
          MA5
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-orange-500 inline-block"></span>
          MA20
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-purple-500 inline-block"></span>
          MA60
        </span>
      </div>
      <div ref={chartContainerRef} />
    </div>
  )
}

// 計算移動平均線
function calculateMA(data: DailyStock[], period: number) {
  const result = []
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((acc, item) => acc + item.close, 0)
    result.push({
      time: data[i].date,
      value: sum / period,
    })
  }
  return result
}
