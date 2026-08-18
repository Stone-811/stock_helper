'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { createChart, ColorType, IChartApi, ISeriesApi, Time } from 'lightweight-charts'
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

// 個股會多帶當沖量；大盤沒有（可選）。當沖量保留於資料結構供籌碼區使用，技術圖不再繪製。
type ChartCandle = Candle & { day_trading_volume?: number }

interface CandleChartProps {
  data: ChartCandle[]
  height?: number
  /** 成交量顯示格式（個股：張；大盤：億/口） */
  volumeFormatter?: (v: number) => string
}

type TimeFrame = 'day' | 'week' | 'month'
type Indicator = 'macd' | 'kd' | 'rsi'
type DatePeriod = '1M' | '3M' | '6M' | '1Y' | '2Y'
type LayoutPreset = 'price' | 'balanced' | 'indicator'

const INDICATOR_LABELS: Record<Indicator, string> = { macd: 'MACD', kd: 'KD', rsi: 'RSI' }
const AXIS_WIDTH = 68 // 固定右軸寬 → 各圖繪圖區左右緣一致、天生對齊（免動態喬寬）

const periodCalendarDays: Record<DatePeriod, number> = { '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '2Y': 731 }
const defaultVolumeFormatter = (v: number) => `${v.toLocaleString()}張`

const BG = '#131722'
const GRID = '#1f2530'
const BORDER = '#2a2e39'
const TEXT = '#9598a1'

// 主圖佔總高的比例（依 preset 與是否有指標）
function priceRatio(numInd: number, preset: LayoutPreset): number {
  if (numInd === 0) return 1
  if (preset === 'price') return 0.74
  if (preset === 'indicator') return 0.54
  return 0.64
}

export default function CandleChart({ data, height = 500, volumeFormatter = defaultVolumeFormatter }: CandleChartProps) {
  const priceRef = useRef<HTMLDivElement>(null)
  const indicatorRefs = useRef<(HTMLDivElement | null)[]>([])

  // 免重建即可切換顯示的系列
  const maRefs = useRef<{ ma5?: ISeriesApi<'Line'>; ma10?: ISeriesApi<'Line'>; ma20?: ISeriesApi<'Line'>; ma60?: ISeriesApi<'Line'> }>({})
  const bbRefs = useRef<{ upper?: ISeriesApi<'Line'>; middle?: ISeriesApi<'Line'>; lower?: ISeriesApi<'Line'> }>({})
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const [timeFrame, setTimeFrame] = useState<TimeFrame>('day')
  const [datePeriod, setDatePeriod] = useState<DatePeriod>('3M')
  const [indicator, setIndicator] = useState<Indicator>('macd') // 單選（技術指標）
  const [preset, setPreset] = useState<LayoutPreset>('balanced')
  const [showMA5, setShowMA5] = useState(true)
  const [showMA10, setShowMA10] = useState(true)
  const [showMA20, setShowMA20] = useState(true)
  const [showMA60, setShowMA60] = useState(false)
  const [showBB, setShowBB] = useState(false)
  const [showVolume, setShowVolume] = useState(true)
  const [moreOpen, setMoreOpen] = useState(false) // 手機版：圖表設定（版面/疊加）收合
  const [crosshairTime, setCrosshairTime] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fsHeight, setFsHeight] = useState(0)

  const chartData = useMemo(() => convertToTimeFrame(data, timeFrame), [data, timeFrame])

  // 指標一律用完整資料算（暖身足夠、與卡片一致）
  const ma = useMemo(() => ({
    ma5: calculateMAValues(chartData, 5),
    ma10: calculateMAValues(chartData, 10),
    ma20: calculateMAValues(chartData, 20),
    ma60: calculateMAValues(chartData, 60),
  }), [chartData])
  const bb = useMemo(() => calculateBBANDValues(chartData, 20, 2), [chartData])
  const macd = useMemo(() => calculateMACDValues(chartData), [chartData])
  const kd = useMemo(() => calculateKDValues(chartData), [chartData])
  const rsi = useMemo(() => calculateRSIValues(chartData), [chartData])

  const activeIndicators = useMemo(() => [indicator] as Indicator[], [indicator])

  // 全螢幕：鎖背景捲動、依視窗算高、監聽旋轉/resize（橫向自動適配）
  useEffect(() => {
    if (!isFullscreen) return
    const compute = () => setFsHeight(Math.max(320, window.innerHeight - 132))
    compute()
    window.addEventListener('resize', compute)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('resize', compute)
      document.body.style.overflow = ''
    }
  }, [isFullscreen])

  const effHeight = isFullscreen && fsHeight ? fsHeight : height

  useEffect(() => {
    if (!priceRef.current || chartData.length === 0) return

    const numInd = activeIndicators.length
    const pRatio = priceRatio(numInd, preset)
    const priceH = numInd === 0 ? effHeight : Math.round(effHeight * pRatio)
    const indH = numInd === 0 ? 0 : Math.floor((effHeight - priceH) / numInd)

    const layout = { background: { type: ColorType.Solid, color: BG }, textColor: TEXT, fontSize: 12 }
    const grid = { vertLines: { color: GRID }, horzLines: { color: GRID } }
    const crosshair = {
      mode: 1 as const,
      vertLine: { color: '#5b616e', width: 1 as const, style: 3 as const, labelBackgroundColor: '#363a45' },
      horzLine: { color: '#5b616e', width: 1 as const, style: 3 as const, labelBackgroundColor: '#363a45' },
    }
    const commonScale = { borderColor: BORDER, minimumWidth: AXIS_WIDTH }

    const charts: IChartApi[] = []
    const primarySeries: ISeriesApi<'Candlestick' | 'Line' | 'Histogram'>[] = []
    const bottomIdx = numInd // 最後一張（顯示時間軸）

    // ===== 主圖：K線 + 均線 + 布林 + 成交量（底部半透明疊加）=====
    const priceChart = createChart(priceRef.current, {
      layout, width: priceRef.current.clientWidth, height: priceH, grid, crosshair,
      rightPriceScale: { ...commonScale, scaleMargins: { top: 0.1, bottom: 0.2 } },
      timeScale: { borderColor: BORDER, timeVisible: true, rightOffset: 6, barSpacing: 8, visible: numInd === 0 },
      handleScroll: true, handleScale: true,
    })
    charts.push(priceChart)

    const volSeries = priceChart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false })
    volSeries.setData(chartData.map((d) => ({ time: d.date as Time, value: d.volume, color: d.close >= d.open ? '#ef444440' : '#22c55e40' })))
    volSeries.applyOptions({ visible: showVolume })
    volRef.current = volSeries
    priceChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false })

    const candle = priceChart.addCandlestickSeries({
      upColor: '#ef4444', downColor: '#22c55e', borderUpColor: '#ef4444', borderDownColor: '#22c55e', wickUpColor: '#ef4444', wickDownColor: '#22c55e',
      lastValueVisible: true, priceLineVisible: true, priceLineColor: '#5b616e', priceLineStyle: 2, priceLineWidth: 1,
    })
    candle.setData(chartData.map((d) => ({ time: d.date as Time, open: d.open, high: d.high, low: d.low, close: d.close })))
    primarySeries.push(candle)

    const mkLine = (color: string, style = 0, visible = true) =>
      priceChart.addLineSeries({ color, lineWidth: 1, lineStyle: style, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, visible })
    const bbU = mkLine('#f472b6', 0, showBB); bbU.setData(bbandLine(chartData, bb, 'upper')); bbRefs.current.upper = bbU
    const bbM = mkLine('#a78bfa', 2, showBB); bbM.setData(bbandLine(chartData, bb, 'middle')); bbRefs.current.middle = bbM
    const bbL = mkLine('#f472b6', 0, showBB); bbL.setData(bbandLine(chartData, bb, 'lower')); bbRefs.current.lower = bbL

    const mkMA = (values: (number | null)[], color: string, visible: boolean) => {
      const s = mkLine(color, 0, visible); s.setData(toLineData(chartData, values)); return s
    }
    maRefs.current.ma5 = mkMA(ma.ma5, '#f59e0b', showMA5)
    maRefs.current.ma10 = mkMA(ma.ma10, '#3b82f6', showMA10)
    maRefs.current.ma20 = mkMA(ma.ma20, '#ec4899', showMA20)
    maRefs.current.ma60 = mkMA(ma.ma60, '#8b5cf6', showMA60)

    // ===== 指標子圖（各一張，軸乾淨、可縮放）=====
    activeIndicators.forEach((ind, i) => {
      const el = indicatorRefs.current[i]
      if (!el) return
      const isBottom = i + 1 === bottomIdx
      const ch = createChart(el, {
        layout, width: el.clientWidth, height: indH, grid, crosshair,
        rightPriceScale: { ...commonScale, scaleMargins: { top: 0.12, bottom: 0.1 } },
        timeScale: { borderColor: BORDER, timeVisible: true, rightOffset: 6, barSpacing: 8, visible: isBottom },
        handleScroll: true, handleScale: true,
      })
      charts.push(ch)

      let primary: ISeriesApi<'Line' | 'Histogram'>
      // ⚠️ 所有指標系列一律「保留完整時間軸」（暖身期用 whitespace {time} 佔位、不濾掉），
      //   讓每張子圖的時間軸起點都與主圖一致；否則各圖 logical index 錯位 → K 棒與指標柱對不上。
      if (ind === 'macd') {
        const hist = ch.addHistogramSeries({ priceFormat: { type: 'price', precision: 2 }, lastValueVisible: false, priceLineVisible: false })
        hist.setData(chartData.map((d, k) => macd[k] ? { time: d.date as Time, value: macd[k]!.histogram, color: macd[k]!.histogram >= 0 ? '#ef444488' : '#22c55e88' } : { time: d.date as Time }))
        const dif = ch.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
        dif.setData(toLineWS(chartData, macd.map((m) => m?.dif ?? null)))
        const dea = ch.addLineSeries({ color: '#f97316', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
        dea.setData(toLineWS(chartData, macd.map((m) => m?.macd ?? null)))
        primary = hist
      } else if (ind === 'kd') {
        const k = ch.addLineSeries({ color: '#3b82f6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
        k.setData(toLineWS(chartData, kd.map((v) => v?.k ?? null)))
        const d = ch.addLineSeries({ color: '#f97316', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
        d.setData(toLineWS(chartData, kd.map((v) => v?.d ?? null)))
        addBandLines(ch, chartData, 80, 20)
        primary = k
      } else {
        const r = ch.addLineSeries({ color: '#8b5cf6', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
        r.setData(toLineWS(chartData, rsi))
        addBandLines(ch, chartData, 70, 30)
        primary = r
      }
      primarySeries.push(primary)
    })

    // ===== 初始可視範圍（用邏輯索引，穩定不受非交易日字串影響）=====
    const lastDate = chartData[chartData.length - 1].date
    const cutoff = new Date(new Date(lastDate).getTime() - periodCalendarDays[datePeriod] * 86400000).toISOString().slice(0, 10)
    let startIdx = chartData.findIndex((d) => d.date >= cutoff)
    if (startIdx < 0) startIdx = 0
    const logical = { from: startIdx - 0.5, to: chartData.length - 1 + 6 }
    charts.forEach((c) => c.timeScale().setVisibleLogicalRange(logical))

    // ===== 同步：可視範圍（縮放/平移）=====
    let rangeSyncing = false
    charts.forEach((src) => {
      src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (rangeSyncing || !range) return
        rangeSyncing = true
        charts.forEach((c) => { if (c !== src) c.timeScale().setVisibleLogicalRange(range) })
        rangeSyncing = false
      })
    })

    // ===== 同步：十字線 + 讀值 =====
    let chSyncing = false
    charts.forEach((src, si) => {
      src.subscribeCrosshairMove((param) => {
        setCrosshairTime(param.time ? String(param.time) : null)
        if (chSyncing) return
        chSyncing = true
        charts.forEach((c, ci) => {
          if (ci === si) return
          if (param.time) c.setCrosshairPosition(0, param.time, primarySeries[ci])
          else c.clearCrosshairPosition()
        })
        chSyncing = false
      })
    })

    // ===== 寬度隨容器變化 =====
    const ro = new ResizeObserver(() => {
      const w = priceRef.current?.clientWidth
      if (w) charts.forEach((c) => c.applyOptions({ width: w }))
    })
    if (priceRef.current) ro.observe(priceRef.current)

    return () => {
      ro.disconnect()
      maRefs.current = {}
      bbRefs.current = {}
      volRef.current = null
      charts.forEach((c) => c.remove())
    }
  }, [chartData, effHeight, activeIndicators, preset, datePeriod, ma, bb, macd, kd, rsi]) // eslint-disable-line react-hooks/exhaustive-deps

  // 顯示/隱藏（免重建）
  useEffect(() => { maRefs.current.ma5?.applyOptions({ visible: showMA5 }) }, [showMA5])
  useEffect(() => { maRefs.current.ma10?.applyOptions({ visible: showMA10 }) }, [showMA10])
  useEffect(() => { maRefs.current.ma20?.applyOptions({ visible: showMA20 }) }, [showMA20])
  useEffect(() => { maRefs.current.ma60?.applyOptions({ visible: showMA60 }) }, [showMA60])
  useEffect(() => {
    bbRefs.current.upper?.applyOptions({ visible: showBB })
    bbRefs.current.middle?.applyOptions({ visible: showBB })
    bbRefs.current.lower?.applyOptions({ visible: showBB })
  }, [showBB])
  useEffect(() => { volRef.current?.applyOptions({ visible: showVolume }) }, [showVolume])

  const curIndex = crosshairTime ? chartData.findIndex((d) => d.date === crosshairTime) : chartData.length - 1
  const cur = curIndex >= 0 ? chartData[curIndex] : null
  const prevClose = cur ? (curIndex > 0 ? chartData[curIndex - 1].close : cur.open) : 0
  const chg = cur ? cur.close - prevClose : 0
  const chgPct = prevClose ? (chg / prevClose) * 100 : 0
  const up = chg >= 0

  const btn = (active: boolean) =>
    `px-2.5 md:px-3 py-1 md:py-1.5 text-sm font-medium rounded min-h-[44px] md:min-h-[34px] ${active ? 'bg-blue-600 text-white' : 'bg-[#232733] text-gray-200 hover:bg-[#2d323f]'}`

  return (
    <div className={`bg-[#131722] p-2 md:p-3 ${isFullscreen ? 'fixed inset-0 z-[70] rounded-none overflow-auto' : 'rounded-lg'}`}>
      {/* 控制列 */}
      <div className="flex flex-col gap-2 mb-2">
        {/* 常駐：週期 + 區間（＋手機版「圖表設定」切換版面/疊加）*/}
        <div className="flex flex-wrap items-center gap-1.5 md:gap-3">
          <div className="flex gap-1">
            {([['day', '日K'], ['week', '週K'], ['month', '月K']] as [TimeFrame, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setTimeFrame(k)} className={btn(timeFrame === k)}>{l}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['1M', '3M', '6M', '1Y', '2Y'] as DatePeriod[]).map((p) => (
              <button key={p} onClick={() => setDatePeriod(p)} className={btn(datePeriod === p)}>{p}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={() => setMoreOpen((v) => !v)} className={`md:hidden ${btn(moreOpen)}`}>⚙️ 圖表設定</button>
            <button
              onClick={() => setIsFullscreen((v) => !v)}
              className={btn(false)}
              aria-label={isFullscreen ? '離開全螢幕' : '全螢幕'}
              title={isFullscreen ? '離開全螢幕' : '全螢幕'}
            >
              {isFullscreen ? '✕' : '⛶'}
            </button>
          </div>
        </div>

        {/* 常駐：技術指標（單選 Tabs） */}
        <div className="flex items-center gap-4 border-b border-[#2d323f]">
          {(['macd', 'kd', 'rsi'] as Indicator[]).map((ind) => {
            const active = indicator === ind
            return (
              <button
                key={ind}
                onClick={() => setIndicator(ind)}
                aria-selected={active}
                role="tab"
                className={`relative py-2 text-sm font-medium min-h-[44px] md:min-h-[36px] transition-colors ${active ? 'text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                {INDICATOR_LABELS[ind]}
                {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-blue-500 rounded-full" />}
              </button>
            )
          })}
        </div>

        {/* 版面 + 疊加：手機收合（⚙️ 圖表設定）、桌機常駐 */}
        <div className={`${moreOpen ? 'flex' : 'hidden'} md:flex flex-wrap items-center gap-x-3 gap-y-1`}>
          <div className="flex items-center gap-1">
            <span className="text-gray-400 text-xs">版面</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value as LayoutPreset)} className="bg-[#232733] text-gray-200 text-sm rounded px-2 py-1 border border-[#2d323f] min-h-[44px] md:min-h-[34px]">
              <option value="price">價格為主</option>
              <option value="balanced">均衡</option>
              <option value="indicator">指標為主</option>
            </select>
          </div>
          <span className="text-gray-400 text-xs md:ml-2">疊加</span>
          {([['MA5', showMA5, setShowMA5, 'text-amber-400'], ['MA10', showMA10, setShowMA10, 'text-blue-400'], ['MA20', showMA20, setShowMA20, 'text-pink-400'], ['MA60', showMA60, setShowMA60, 'text-purple-400']] as [string, boolean, (v: boolean) => void, string][]).map(([label, on, set, color]) => (
            <label key={label} className="flex items-center gap-1 cursor-pointer min-h-[44px] md:min-h-[30px]">
              <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="w-4 h-4 md:w-3.5 md:h-3.5" />
              <span className={`${color} text-xs`}>{label}</span>
            </label>
          ))}
          <label className="flex items-center gap-1 cursor-pointer min-h-[44px] md:min-h-[30px]">
            <input type="checkbox" checked={showBB} onChange={(e) => setShowBB(e.target.checked)} className="w-4 h-4 md:w-3.5 md:h-3.5" />
            <span className="text-fuchsia-400 text-xs">布林</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer min-h-[44px] md:min-h-[30px]">
            <input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} className="w-4 h-4 md:w-3.5 md:h-3.5" />
            <span className="text-gray-300 text-xs">量</span>
          </label>
        </div>
      </div>

      {/* 圖表 + 左上讀值 */}
      <div className="relative">
        {cur && (
          <div className="absolute top-1 left-2 z-10 text-xs md:text-sm font-mono bg-[#131722]/85 px-2 py-0.5 rounded pointer-events-none">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-gray-300">
              <span className="text-gray-400">{cur.date}</span>
              <span>收 <span className={up ? 'text-red-400' : 'text-green-400'}>{cur.close.toFixed(2)}</span>
                <span className={up ? 'text-red-400' : 'text-green-400'}> {up ? '+' : ''}{chg.toFixed(2)} ({up ? '+' : ''}{chgPct.toFixed(2)}%)</span>
              </span>
              <span>量 <span className="text-gray-300">{volumeFormatter(cur.volume)}</span></span>
              {/* MA/布林/指標數值：手機版隱藏（避免 legend 太密蓋住 K 棒），桌機顯示 */}
              <span className="hidden md:contents">
                {(showMA5 && ma.ma5[curIndex] != null) && <span className="text-amber-400">MA5 {ma.ma5[curIndex]!.toFixed(1)}</span>}
                {(showMA10 && ma.ma10[curIndex] != null) && <span className="text-blue-400">MA10 {ma.ma10[curIndex]!.toFixed(1)}</span>}
                {(showMA20 && ma.ma20[curIndex] != null) && <span className="text-pink-400">MA20 {ma.ma20[curIndex]!.toFixed(1)}</span>}
                {(showMA60 && ma.ma60[curIndex] != null) && <span className="text-purple-400">MA60 {ma.ma60[curIndex]!.toFixed(1)}</span>}
                {(showBB && bb[curIndex]) && <span className="text-fuchsia-300">BB {bb[curIndex]!.upper.toFixed(0)}/{bb[curIndex]!.middle.toFixed(0)}/{bb[curIndex]!.lower.toFixed(0)}</span>}
                {indicator === 'macd' && macd[curIndex] && (
                  <span><span className="text-gray-500">MACD</span> <span className="text-blue-400">{macd[curIndex]!.dif.toFixed(2)}</span> <span className="text-orange-400">{macd[curIndex]!.macd.toFixed(2)}</span> <span className={macd[curIndex]!.histogram >= 0 ? 'text-red-400' : 'text-green-400'}>{macd[curIndex]!.histogram.toFixed(2)}</span></span>
                )}
                {indicator === 'kd' && kd[curIndex] && (
                  <span><span className="text-gray-500">KD</span> <span className="text-blue-400">{kd[curIndex]!.k.toFixed(1)}</span> <span className="text-orange-400">{kd[curIndex]!.d.toFixed(1)}</span></span>
                )}
                {indicator === 'rsi' && rsi[curIndex] != null && (
                  <span><span className="text-gray-500">RSI</span> <span className="text-purple-400">{rsi[curIndex]!.toFixed(1)}</span></span>
                )}
              </span>
            </div>
          </div>
        )}
        <div ref={priceRef} />
        {activeIndicators.map((ind, i) => (
          <div key={ind} ref={(el) => { indicatorRefs.current[i] = el }} className="mt-px" />
        ))}
      </div>
    </div>
  )
}

// ========== 工具函數 ==========

// 折線資料，暖身期(null)以 whitespace {time} 佔位（保留完整時間軸，勿濾掉 → 子圖與主圖同步對齊）
function toLineWS(data: ChartCandle[], values: (number | null)[]) {
  return data.map((d, i) => (values[i] != null ? { time: d.date as Time, value: values[i] as number } : { time: d.date as Time }))
}

// 指標超買/超賣參考線
function addBandLines(chart: IChartApi, data: ChartCandle[], upper: number, lower: number) {
  const ob = chart.addLineSeries({ color: '#ef444455', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
  const os = chart.addLineSeries({ color: '#22c55e55', lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
  ob.setData(data.map((d) => ({ time: d.date as Time, value: upper })))
  os.setData(data.map((d) => ({ time: d.date as Time, value: lower })))
}

// 日K → 週K / 月K 聚合（保留額外欄位，OHLCV 正確聚合）
function convertToTimeFrame(data: ChartCandle[], timeFrame: TimeFrame): ChartCandle[] {
  if (timeFrame === 'day') return data
  const grouped: { [key: string]: ChartCandle[] } = {}
  data.forEach((item) => {
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
    ...items[items.length - 1],
    date,
    open: items[0].open,
    high: Math.max(...items.map((i) => i.high)),
    low: Math.min(...items.map((i) => i.low)),
    close: items[items.length - 1].close,
    volume: items.reduce((sum, i) => sum + i.volume, 0),
    day_trading_volume: items.reduce((sum, i) => sum + (i.day_trading_volume || 0), 0),
  })).sort((a, b) => a.date.localeCompare(b.date))
}
