'use client'

import { useEffect, useRef } from 'react'
import { createChart, ColorType, IChartApi } from 'lightweight-charts'
import { DailyStock } from '../lib/supabase'

interface VolumeChartProps {
  data: DailyStock[]
  height?: number
}

export default function VolumeChart({ data, height = 150 }: VolumeChartProps) {
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

    // 成交量
    const volumeSeries = chart.addHistogramSeries({
      color: '#60a5fa',
      priceFormat: {
        type: 'volume',
      },
    })

    const volumeData = data.map(item => ({
      time: item.date,
      value: item.volume,
      color: item.close >= item.open ? '#ef4444' : '#22c55e',
    }))

    volumeSeries.setData(volumeData)

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
      <div className="text-sm text-gray-500 mb-2">成交量 (張)</div>
      <div ref={chartContainerRef} />
    </div>
  )
}
