'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '../../components/states'
import InfoTip from '../../components/InfoTip'
import {
  DASH,
  fmtNum,
  fmtPct,
  fmtSigned,
  fmtTradingValue,
  computeChange,
  changeColor,
  signColor,
  compareNullLast,
} from '../../lib/format'
import { NullCell } from '../../components/table'
import { SELECT, alignClass, justifyClass, type ColDef } from '../../lib/table'
import type { StrongStock } from '../../lib/firebase'

/* ------------------------------------------------------------------ *
 * 強勢股總表
 *
 * 版面核心取捨：寧可一次少看幾欄，也不縮字級、不擠行高。
 * 20 欄一次全上，在本站 @theme 放大後的 text-sm(15.2px) 下最小總寬約 1550~1700px，
 * 而桌機內容區（1440 螢幕扣 256px 側欄）只有 1184px —— 必然橫捲。
 * 橫捲資料格對視力不佳者是最糟的組合，所以改成
 *   「固定 3 欄（股票／收盤／漲跌幅）恆常釘住 ＋ 一次只顯示一組 4~5 欄」，
 * 任一分頁最多同時 8 欄、估寬約 1005px，桌機預設路徑零水平捲動。
 * 這個決策同時消掉四個陷阱：不需要 sticky 左欄、不需要巢狀捲動容器、
 * sticky 表頭不會黏錯層、InfoTip 泡泡不會被 overflow 裁切。
 *
 * 「顯示全部欄位」是次要逃生門（預設關閉），只有它才會開 overflow-x-auto。
 * ------------------------------------------------------------------ */

/** ⚠️ 刻意不 import lib/firebase.ts 的 StrongStock：
 *  那個型別把下列 4 欄宣告成非空 number，但 API 會原樣送 null
 *  （firebase_writer.py 的 _opt_num 明確寫 None），
 *  `stock.foreign_hold_ratio.toFixed(2)` 會編譯得過、上線後 TypeError 白畫面。 */
/** 直接由共用型別衍生，避免同一份 payload 有兩套會各自漂移的宣告。
 *  Omit 掉 date：firebase_writer._convert_stock_row 並不寫入 date 欄位，
 *  /api/strong-stocks 也不補，所以 DailyStock.date 對這份 payload 而言不成立。
 *  可為 null 的 4 個欄位（當沖量、外資三比例）的語意見 lib/firebase.ts 的註解。 */
type StrongTableRow = Omit<StrongStock, 'date'>

interface StrongTableResponse {
  stocks: StrongTableRow[]
  /** API 完全無可用日期時會早退回 null，且**沒有 totalCount** */
  latestDate: string | null
  availableDates: string[]
  totalCount?: number
  dataMissing?: boolean
}

/* ----------------------------- 共用片段 ----------------------------- */
/* NullCell / SELECT / Align / alignClass / justifyClass / ColDef 已抽到
   components/table.tsx 與 lib/table.ts（強勢月報頁共用同一份，避免兩頁各自漂移）。 */

interface RenderCtx {
  /** 所選日期不是最新交易日 → strong_count 是錯的（見下方 STALE 說明） */
  strongCountStale: boolean
  /** 手機摘要列：省略次要的第二行 */
  compact: boolean
}

/* --------------------------- 衍生值計算 --------------------------- */

const tradingValueOf = (r: StrongTableRow): number | null =>
  r.close == null || r.volume == null ? null : r.volume * r.close * 1000

/** ⚠️ 母數是 null 時回 null，**不可回 0%**（StockCard 的 `|| 0` 正是錯誤示範） */
const dayTradingRatioOf = (r: StrongTableRow): number | null =>
  r.day_trading_volume != null && r.volume > 0 ? (r.day_trading_volume / r.volume) * 100 : null

const numCell = (v: number | null | undefined, digits = 0, cls = 'text-gray-900') =>
  v == null ? <NullCell /> : <span className={cls}>{fmtNum(v, digits)}</span>

const signedCell = (v: number | null | undefined) =>
  v == null ? <NullCell /> : <span className={signColor(v)}>{fmtSigned(v)}</span>

const pctCell = (v: number | null | undefined, digits = 2, cls = 'text-gray-900') =>
  v == null ? <NullCell /> : <span className={cls}>{fmtPct(v, digits)}</span>

/** 連買／連賣：0 要顯示「0」（真的無連續），只有 undefined 才是「—」 */
const streakCell = (v: number | null | undefined) => {
  if (v == null) return <NullCell />
  if (v === 0) return <span className="text-gray-700">0</span>
  return (
    <span className={signColor(v)}>{v > 0 ? `連買 ${v}` : `連賣 ${Math.abs(v)}`}</span>
  )
}

/* ------------------------------ 欄位 registry ------------------------------ *
 * 單一定義來源：分組只是 ColKey[] 清單，所以 volume / foreign_buy 可以同時出現在
 * 「總覽」與它的本家組，而定義只有一份、不會漂移。
 * ------------------------------------------------------------------------- */

type ColKey =
  | 'stock' | 'close' | 'change_pct'
  | 'macd_status' | 'strong_count' | 'volume' | 'foreign_buy' | 'industry'
  | 'open' | 'high' | 'low' | 'prev_close'
  | 'trading_value' | 'day_trading_volume' | 'day_trading_ratio'
  | 'trust_buy' | 'dealer_buy' | 'foreign_streak' | 'trust_streak'
  | 'foreign_hold_ratio' | 'foreign_remain_ratio' | 'foreign_limit_ratio'

const COLUMNS: Record<ColKey, ColDef<StrongTableRow, RenderCtx>> = {
  /* --- 固定欄（所有分頁恆常顯示） --- */
  stock: {
    header: '股票',
    fullName: '股票名稱與代號',
    align: 'left',
    sortable: true,
    sortValue: (r) => r.stock_id,
    desc: '點擊可前往個股頁查看 K 線與籌碼。排序依股票代號。',
    render: (r) => (
      <Link href={`/stock/${r.stock_id}`} className="block min-h-[44px] hover:text-blue-600">
        <span className="block font-medium text-gray-900 truncate max-w-[16ch]" title={r.stock_name || r.stock_id}>
          {r.stock_name || r.stock_id}
        </span>
        <span className="block text-sm text-gray-700 tabular-nums">{r.stock_id}</span>
      </Link>
    ),
  },
  close: {
    header: '收盤',
    fullName: '收盤價（元）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.close ?? null,
    desc: '當日收盤價。顏色與漲跌方向一致（漲紅、跌綠、平盤黑）。',
    render: (r) => {
      if (r.close == null) return <NullCell />
      const { dir } = computeChange(r)
      const cls = dir === 'flat' ? 'text-gray-900' : changeColor(dir)
      return <span className={`font-medium ${cls}`}>{fmtNum(r.close, 2)}</span>
    },
  },
  change_pct: {
    header: '漲跌幅',
    fullName: '漲跌幅（%，基準為前一交易日收盤）',
    align: 'right',
    sortable: true,
    sortValue: (r) => computeChange(r).pct,
    desc: '（收盤 − 昨收）÷ 昨收。沒有昨收資料時才退回以當日開盤價為基準。不是「收盤 − 開盤」（那是當日振幅）。',
    render: (r, ctx) => {
      const { change, pct, dir } = computeChange(r)
      if (pct == null || change == null) return <NullCell />
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''
      const sign = change > 0 ? '+' : ''
      return (
        <span className={`font-semibold ${changeColor(dir)}`}>
          {arrow && <span aria-hidden="true">{arrow} </span>}
          {sign}
          {pct.toFixed(2)}%
          {!ctx.compact && (
            <span className="block text-xs font-normal text-gray-700">
              {sign}
              {change.toFixed(2)}
            </span>
          )}
        </span>
      )
    },
  },

  /* --- 總覽 --- */
  macd_status: {
    header: 'MACD',
    fullName: 'MACD 狀態',
    align: 'center',
    sortable: false,
    sortValue: (r) => r.macd_status || null,
    desc: 'MACD 柱狀體方向：「多」為柱體翻正、「空」為翻負。這是技術面狀態描述，不是買賣建議。',
    render: (r) => {
      const m = r.macd_status
      if (!m) return <NullCell />
      const cls =
        m === '多'
          ? 'bg-red-100 text-red-700'
          : m === '空'
            ? 'bg-green-100 text-green-800'
            : 'bg-gray-100 text-gray-700'
      return (
        <span className={`inline-flex items-center min-h-[28px] px-2 rounded text-sm font-medium ${cls}`}>
          {m}
        </span>
      )
    },
  },
  strong_count: {
    header: '強勢日',
    fullName: '近 7 個交易日入選強勢股的次數',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.strong_count ?? null,
    desc: '固定以「最近 7 個交易日」計算，與所選日期無關。因此選擇非最新交易日時，此欄會停用排序並轉為灰字。',
    render: (r, ctx) => {
      if (r.strong_count == null) return <NullCell />
      const cls = ctx.strongCountStale
        ? 'text-gray-600'
        : r.strong_count >= 5
          ? 'font-bold text-gray-900'
          : 'text-gray-900'
      return (
        <span className={cls} title={ctx.strongCountStale ? '此欄以最近 7 個交易日計算，與所選日期無關' : undefined}>
          {r.strong_count}
        </span>
      )
    },
  },
  volume: {
    header: '成交量',
    fullName: '成交量（張）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.volume ?? null,
    desc: '當日成交張數。此欄的 0 是真的 0，不是缺資料。',
    render: (r) => numCell(r.volume),
  },
  foreign_buy: {
    header: '外資',
    fullName: '外資買賣超（張）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.foreign_buy ?? null,
    desc: '外資當日買進 − 賣出。正數（紅）買超、負數（綠）賣超、0 代表當日無買賣超（真的 0）。',
    render: (r) => signedCell(r.foreign_buy),
  },
  industry: {
    header: '產業',
    fullName: '產業別',
    align: 'left',
    sortable: false,
    sortValue: (r) => r.industry || null,
    desc: '資料來源的產業分類。少數個股為空字串，顯示為「—」。',
    render: (r) =>
      r.industry ? (
        <span className="block truncate max-w-[10ch] text-gray-700" title={r.industry}>
          {r.industry}
        </span>
      ) : (
        <NullCell />
      ),
  },

  /* --- 價格 --- */
  open: {
    header: '開盤',
    fullName: '開盤價（元）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.open ?? null,
    desc: '當日開盤價。整排價格刻意不上紅綠，方向資訊由固定欄的漲跌幅承擔。',
    render: (r) => numCell(r.open, 2),
  },
  high: {
    header: '最高',
    fullName: '當日最高價（元）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.high ?? null,
    desc: '當日盤中最高成交價。',
    render: (r) => numCell(r.high, 2),
  },
  low: {
    header: '最低',
    fullName: '當日最低價（元）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.low ?? null,
    desc: '當日盤中最低成交價。',
    render: (r) => numCell(r.low, 2),
  },
  prev_close: {
    header: '昨收',
    fullName: '前一交易日收盤價（元）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.prev_close ?? null,
    desc: '漲跌幅的計算基準。顯示「—」時代表查無前一交易日資料，該檔的漲跌幅改以當日開盤價為基準。',
    render: (r) => numCell(r.prev_close, 2, 'text-gray-700'),
  },

  /* --- 量能 --- */
  trading_value: {
    header: '成交額',
    fullName: '成交金額（成交量 × 收盤價 × 1000）',
    align: 'right',
    sortable: true,
    sortValue: (r) => tradingValueOf(r),
    desc: '成交量（張）× 收盤價 × 1000 股。顯示級距在「9999萬」之後會跳為「1.00億」。排序依原始金額，不是依顯示文字。',
    render: (r) => {
      const v = tradingValueOf(r)
      return v == null ? <NullCell /> : <span className="text-gray-900">{fmtTradingValue(v)}</span>
    },
  },
  day_trading_volume: {
    header: '當沖量',
    fullName: '當沖成交量（張）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.day_trading_volume,
    desc: 'FinMind 當沖資料集未涵蓋的個股顯示「—」（多為上櫃／新掛牌），這不代表當日沒有當沖，而是沒有這筆資料。',
    render: (r) => numCell(r.day_trading_volume),
  },
  day_trading_ratio: {
    header: '當沖比',
    fullName: '當沖比例（當沖量 ÷ 成交量，%）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => dayTradingRatioOf(r),
    desc: '當沖量 ÷ 成交量。當沖量無資料時整格顯示「—」，不會顯示 0%。比例偏高（≥30%）以粗體標示，代表短線交易熱絡。',
    render: (r) => {
      const v = dayTradingRatioOf(r)
      if (v == null) return <NullCell />
      return <span className={v >= 30 ? 'font-semibold text-gray-900' : 'text-gray-900'}>{fmtPct(v, 1)}</span>
    },
  },

  /* --- 法人買賣超 --- */
  trust_buy: {
    header: '投信',
    fullName: '投信買賣超（張）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.trust_buy ?? null,
    desc: '投信當日買進 − 賣出。0 代表當日無買賣超（真的 0）。',
    render: (r) => signedCell(r.trust_buy),
  },
  dealer_buy: {
    header: '自營',
    fullName: '自營商買賣超（張，含自行買賣與避險）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.dealer_buy ?? null,
    desc: '自營商當日買進 − 賣出，含自行買賣與避險。0 代表當日無買賣超。',
    render: (r) => signedCell(r.dealer_buy),
  },
  foreign_streak: {
    header: '外資連續',
    fullName: '外資連續買賣超天數',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.foreign_streak ?? null,
    desc: '正數為連續買超天數、負數為連續賣超天數。「0」＝今日無連續（真的 0）；「—」＝舊資料沒有這個欄位。',
    render: (r) => streakCell(r.foreign_streak),
  },
  trust_streak: {
    header: '投信連續',
    fullName: '投信連續買賣超天數',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.trust_streak ?? null,
    desc: '同「外資連續」：0 是無連續，「—」是無此欄資料。',
    render: (r) => streakCell(r.trust_streak),
  },

  /* --- 外資持股（null 最密集的一組） --- */
  foreign_hold_ratio: {
    header: '外資持股',
    fullName: '外資持股比例（占已發行股數，%）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.foreign_hold_ratio,
    desc: '外資目前持股占已發行股數的比例。FinMind 未涵蓋此股時顯示「—」。',
    render: (r) => pctCell(r.foreign_hold_ratio),
  },
  foreign_remain_ratio: {
    header: '尚可投資',
    fullName: '外資尚可投資比例（%）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.foreign_remain_ratio,
    desc: '距離外資投資上限還可買進的比例。FinMind 未涵蓋此股時顯示「—」。',
    render: (r) => pctCell(r.foreign_remain_ratio),
  },
  foreign_limit_ratio: {
    header: '投資上限',
    fullName: '外資投資上限比例（%）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.foreign_limit_ratio,
    desc: '法規／公司章程訂定的外資持股上限。此欄曾因把無資料寫成 0 而出現過「0.00%」這種不可能值，所以無資料一律顯示「—」。',
    render: (r) => pctCell(r.foreign_limit_ratio),
  },
}

/* ------------------------------- 分組 ------------------------------- */

const FIXED_KEYS: ColKey[] = ['stock', 'close', 'change_pct']

const GROUPS = {
  overview: { label: '總覽', columns: ['macd_status', 'strong_count', 'volume', 'foreign_buy', 'industry'] as ColKey[] },
  price: { label: '價格', columns: ['open', 'high', 'low', 'prev_close'] as ColKey[] },
  liquidity: { label: '量能', columns: ['volume', 'trading_value', 'day_trading_volume', 'day_trading_ratio'] as ColKey[] },
  institution: { label: '法人買賣超', columns: ['foreign_buy', 'trust_buy', 'dealer_buy', 'foreign_streak', 'trust_streak'] as ColKey[] },
  holding: { label: '外資持股', columns: ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio'] as ColKey[] },
} as const

type GroupKey = keyof typeof GROUPS
const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[]

/** 「顯示全部欄位」用：去重後的全部資料欄 */
const ALL_DATA_KEYS: ColKey[] = Array.from(
  new Set(GROUP_KEYS.flatMap((g) => GROUPS[g].columns))
)

/** 手機展開列：一次列出全部欄位，刻意去重並重新編組（不照桌機分頁走） */
const DETAIL_GROUPS: { label: string; columns: ColKey[] }[] = [
  { label: '價格', columns: ['close', 'change_pct', 'open', 'high', 'low', 'prev_close'] },
  { label: '量能', columns: ['volume', 'trading_value', 'day_trading_volume', 'day_trading_ratio'] },
  { label: '法人買賣超', columns: ['foreign_buy', 'trust_buy', 'dealer_buy', 'foreign_streak', 'trust_streak'] },
  { label: '外資持股', columns: ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio'] },
  { label: '其他', columns: ['macd_status', 'industry', 'strong_count'] },
]

/** 手機第 3 欄的候選（焦點欄 chip）。橫向捲動的是 44px 高的控制項，不是資料格。 */
const MOBILE_FOCUS_KEYS: ColKey[] = [
  'volume', 'trading_value', 'day_trading_ratio', 'foreign_buy', 'trust_buy',
  'dealer_buy', 'foreign_streak', 'foreign_hold_ratio', 'strong_count',
]

const QUICK_FILTERS = [
  { key: 'all', label: '全部', macd: 'all', minVolume: 0, foreignBuy: false, streakMin: 0 },
  { key: 'tech', label: '技術多頭', macd: '多', minVolume: 0, foreignBuy: false, streakMin: 0 },
  { key: 'foreign', label: '法人買超', macd: 'all', minVolume: 0, foreignBuy: true, streakMin: 0 },
  { key: 'volume', label: '爆量', macd: 'all', minVolume: 10000, foreignBuy: false, streakMin: 0 },
  { key: 'streak', label: '外資連買 3 日以上', macd: 'all', minVolume: 0, foreignBuy: false, streakMin: 3 },
] as const

const STORAGE_KEY = 'strong-table-view' // ⚠️ 不與 /strong-stocks 的 'strong-filters' 共用：欄位形狀不同

const DEFAULT_SORT: { key: ColKey; dir: 'asc' | 'desc' } = { key: 'change_pct', dir: 'desc' }

/* ------------------------------ 頁面 ------------------------------ */

export default function StrongTablePage() {
  const [data, setData] = useState<StrongTableResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false) // 還原完成前不存檔，也避免用預設條件多抓一次

  const [selectedDate, setSelectedDate] = useState('')
  const [group, setGroup] = useState<GroupKey>('overview')
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [filter, setFilter] = useState({
    macd: 'all',
    minVolume: 0,
    industry: 'all',
    foreignBuy: false,
    streakMin: 0,
  })
  const [hideNullRows, setHideNullRows] = useState(false)
  // 預設「固定全欄位表格」：業主要的是一次看到全部欄位，而非在分組間切換。
  // 代價是桌機會水平捲動（表格天生寬約 2,000px），但溢出關在表格自己的捲動容器裡，
  // 整頁不橫捲、Sidebar 不會被蓋住（見下方 [contain:paint] 註解）。
  const [showAll, setShowAll] = useState(true)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const dateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* --------------------------- 資料抓取 --------------------------- */

  // days 一律送整數字面值 7：route.ts 的 parseInt 沒有 isNaN 檢查，
  // 送非數字會讓所有 strong_count 靜默變 0 而完全不報錯。
  const fetchData = async (date?: string) => {
    setLoading(true)
    setError(false)
    try {
      const url = date
        ? `/api/strong-stocks?days=7&date=${encodeURIComponent(date)}`
        : '/api/strong-stocks?days=7'
      const res = await fetch(url)
      if (!res.ok) throw new Error('http')
      const json: StrongTableResponse = await res.json()
      setData(json)
      // API 對不在白名單的日期是「靜默退回最新日」而不是回 400，
      // 所以一律以回應的 latestDate 為準，不要相信自己送出去的 date。
      setSelectedDate(json.latestDate || '')
    } catch (e) {
      console.error('Failed to fetch strong stocks:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // 還原視圖狀態（sessionStorage）→ 從個股頁返回時保留
  useEffect(() => {
    let savedDate: string | undefined
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const f = JSON.parse(raw)
        if (typeof f.selectedDate === 'string' && f.selectedDate) {
          savedDate = f.selectedDate
          setSelectedDate(f.selectedDate)
        }
        // 逐欄檢查，而且要驗證 key 仍存在於現行 registry：
        // 否則日後改欄位名，舊 storage 會讓比較器拿到 undefined、全表看起來沒排序卻不報錯。
        if (typeof f.group === 'string' && (GROUP_KEYS as string[]).includes(f.group)) {
          setGroup(f.group as GroupKey)
        }
        if (
          f.sort &&
          typeof f.sort.key === 'string' &&
          Object.prototype.hasOwnProperty.call(COLUMNS, f.sort.key) &&
          (f.sort.dir === 'asc' || f.sort.dir === 'desc')
        ) {
          setSort({ key: f.sort.key as ColKey, dir: f.sort.dir })
        }
        if (f.filter && typeof f.filter === 'object') {
          setFilter((prev) => ({
            macd: typeof f.filter.macd === 'string' ? f.filter.macd : prev.macd,
            minVolume: typeof f.filter.minVolume === 'number' ? f.filter.minVolume : prev.minVolume,
            industry: typeof f.filter.industry === 'string' ? f.filter.industry : prev.industry,
            foreignBuy: typeof f.filter.foreignBuy === 'boolean' ? f.filter.foreignBuy : prev.foreignBuy,
            streakMin: typeof f.filter.streakMin === 'number' ? f.filter.streakMin : prev.streakMin,
          }))
        }
        if (typeof f.hideNullRows === 'boolean') setHideNullRows(f.hideNullRows)
        if (typeof f.showAll === 'boolean') setShowAll(f.showAll)
        if (typeof f.query === 'string') {
          setQuery(f.query)
          setDebouncedQuery(f.query)
        }
      }
    } catch {}
    // setState 是非同步的，fetch 讀不到剛 set 的 state → 把 savedDate 當參數直接傳進去
    fetchData(savedDate)
    setReady(true)
    return () => {
      if (dateTimer.current) clearTimeout(dateTimer.current)
    }
  }, []) // 僅在掛載時還原一次（與 /strong-stocks、/screener 的 ready 閘門模式一致）

  // 視圖狀態變動即存（ready 閘門：避免第一次跑就用預設值蓋掉 storage）
  useEffect(() => {
    if (!ready) return
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selectedDate, group, sort, filter, hideNullRows, showAll, query })
      )
    } catch {}
  }, [ready, selectedDate, group, sort, filter, hideNullRows, showAll, query])

  // 搜尋 debounce 200ms（純字串比對，不做中文分詞、不走 Firestore 查詢）
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [query])

  // 切換日期：先切成骨架讓使用者看到反應，再 debounce 400ms 發請求。
  // 單次請求會吃掉伺服器端 dayCache 4 格中的 2 格（getStocksByDate ＋ getPrevCloseMap 內部再一次），
  // 快速前後切換會把命中率打到趨近 0，每次 miss 約 0.9MB Firestore 讀取。
  const handleDateChange = (date: string) => {
    setSelectedDate(date)
    setLoading(true)
    setError(false)
    if (dateTimer.current) clearTimeout(dateTimer.current)
    dateTimer.current = setTimeout(() => fetchData(date), 400)
  }

  /* --------------------------- 衍生狀態 --------------------------- */

  const rows = useMemo(() => data?.stocks ?? [], [data])
  const availableDates = data?.availableDates ?? []
  const newestDate = availableDates[0]
  const totalCount = data?.totalCount ?? rows.length

  /**
   * ⚠️ 既有資料 bug：getStrongCountForStocks 只收 (stockIds, days)，內部用
   * getAvailableDates(days) 取「最新 N 個交易日」，完全不看 targetDate。
   * 也就是選一週前的日期時，明細是那天的、strong_count 卻是「最近 7 天」的。
   * 卡片頁看不出來，表格做成可排序欄位就會被當成事實，所以這裡三件事一起做：
   * 停用該欄排序、數值降為灰字、上方顯示提示。（根治要改 firebase-admin，另開票。）
   */
  const strongCountStale = !!(selectedDate && newestDate && selectedDate !== newestDate)

  const visibleKeys = useMemo<ColKey[]>(
    () => (showAll ? [...FIXED_KEYS, ...ALL_DATA_KEYS] : [...FIXED_KEYS, ...GROUPS[group].columns]),
    [showAll, group]
  )

  /**
   * 實際生效的排序鍵。刻意在 render 期間推導、不用 useEffect + setState：
   * (a) 切換分組後若排序鍵不在可見欄，回退到預設，不留看不見的排序狀態；
   * (b) 非最新交易日時 strong_count 是錯的（見上方說明），不可拿它排序。
   * 使用者原本挑的 sort 保留著，切回該分組就會自動復原。
   */
  const effectiveSort = useMemo(() => {
    if (strongCountStale && sort.key === 'strong_count') return DEFAULT_SORT
    if (!showAll && ![...FIXED_KEYS, ...GROUPS[group].columns].includes(sort.key)) return DEFAULT_SORT
    return sort
  }, [sort, strongCountStale, showAll, group])

  const sortNotice =
    effectiveSort.key === sort.key
      ? ''
      : strongCountStale && sort.key === 'strong_count'
        ? '所選日期不是最新交易日，「強勢日」欄位無法排序，已改為依漲跌幅排序'
        : `「${COLUMNS[sort.key].fullName}」不在目前欄位組，已改為依漲跌幅排序`

  const focusKey: ColKey = MOBILE_FOCUS_KEYS.includes(effectiveSort.key) ? effectiveSort.key : 'volume'

  const industries = useMemo(
    () => Array.from(new Set(rows.map((s) => s.industry).filter(Boolean) as string[])).sort(),
    [rows]
  )

  // 「隱藏無資料的列」檢查範圍＝目前可見欄 ＋ 目前排序欄（手機只看得到焦點欄）
  const nullableCheckKeys = useMemo(
    () => Array.from(new Set<ColKey>([effectiveSort.key, focusKey, ...visibleKeys])).filter((k) => COLUMNS[k].nullable),
    [effectiveSort.key, focusKey, visibleKeys]
  )

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filter.macd !== 'all' && r.macd_status !== filter.macd) return false
      if (filter.minVolume > 0 && !(r.volume >= filter.minVolume)) return false
      if (filter.industry !== 'all' && r.industry !== filter.industry) return false
      if (filter.foreignBuy && !(r.foreign_buy > 0)) return false
      if (filter.streakMin > 0 && !((r.foreign_streak ?? 0) >= filter.streakMin)) return false
      if (debouncedQuery) {
        const idHit = r.stock_id.toLowerCase().startsWith(debouncedQuery)
        const nameHit = (r.stock_name || '').toLowerCase().includes(debouncedQuery)
        if (!idHit && !nameHit) return false
      }
      if (hideNullRows && nullableCheckKeys.some((k) => COLUMNS[k].sortValue(r) == null)) return false
      return true
    })
  }, [rows, filter, debouncedQuery, hideNullRows, nullableCheckKeys])

  // 排序一律在前端做：瀏覽器拿到的是 JSON.parse 出來的全新物件，怎麼 sort 都安全。
  // （伺服器端 getStocksByDate 的回傳陣列是跨請求共用的 process 級記憶體，
  //   對它 sort/reverse 會汙染 dayCache 五分鐘並影響 /api/screener 與個股頁。）
  const sortedRows = useMemo(() => {
    const col = COLUMNS[effectiveSort.key] ?? COLUMNS.change_pct
    return [...filteredRows].sort((a, b) => {
      const c = compareNullLast(col.sortValue(a), col.sortValue(b), effectiveSort.dir)
      if (c !== 0) return c
      return a.stock_id.localeCompare(b.stock_id) // 同值時穩定排序
    })
  }, [filteredRows, effectiveSort])

  const nullCount = useMemo(() => {
    const col = COLUMNS[effectiveSort.key] ?? COLUMNS.change_pct
    return sortedRows.filter((r) => col.sortValue(r) == null).length
  }, [sortedRows, effectiveSort.key])

  const sortSummary = `已依「${COLUMNS[effectiveSort.key]?.fullName ?? ''}」${
    effectiveSort.dir === 'desc' ? '由大到小' : '由小到大'
  }排序，共 ${sortedRows.length} 檔${nullCount > 0 ? `，其中 ${nullCount} 檔無資料排在最後` : ''}`

  // 只有兩態（desc ⇄ asc），不做「第三次點回預設」——多一個看不見的狀態對視力不佳者是負擔
  const toggleSort = (key: ColKey) => {
    setSort(
      effectiveSort.key === key
        ? { key, dir: effectiveSort.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'stock' ? 'asc' : 'desc' } // 數值欄首次點擊一律由大到小
    )
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const ctx: RenderCtx = { strongCountStale, compact: false }
  const ctxCompact: RenderCtx = { strongCountStale, compact: true }

  /* --------------------------- 表格片段 --------------------------- */

  const renderTh = (key: ColKey, opts: { sticky: boolean; stickyLeft?: boolean }) => {
    const col = COLUMNS[key]
    const active = effectiveSort.key === key
    const canSort = col.sortable && !(key === 'strong_count' && strongCountStale)
    // ⚠️ sticky 掛在 <th> 而不是 <thead>：Tailwind preflight 讓 table 是 border-collapse:collapse，
    //    掛在 thead 的相容性較差。top-[65px] 是 TopBar 實測高度（sticky top-0 z-30），
    //    z 必須小於 30 才會正確滑到 TopBar 底下。
    const stickyCls = opts.sticky
      ? 'sticky top-[65px] z-10 bg-gray-50 first:rounded-tl-lg last:rounded-tr-lg'
      : ''
    const leftCls = opts.stickyLeft ? 'sticky left-0 z-20 bg-gray-50' : ''
    return (
      <th
        key={key}
        scope="col"
        aria-sort={canSort ? (active ? (effectiveSort.dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
        className={`px-4 py-3 ${alignClass(col.align)} text-sm font-medium text-gray-700 whitespace-nowrap ${stickyCls} ${leftCls}`}
      >
        {canSort ? (
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className={`w-full min-h-[44px] lg:min-h-[36px] flex items-center gap-1 ${justifyClass(col.align)} rounded hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            <span>{col.header}</span>
            <span aria-hidden="true" className="text-xs">
              {active ? (effectiveSort.dir === 'desc' ? '▼' : '▲') : '⇅'}
            </span>
            <span className="sr-only">
              {active
                ? effectiveSort.dir === 'desc'
                  ? '目前由高到低排序，按下改為由低到高'
                  : '目前由低到高排序，按下改為由高到低'
                : '按下以此欄排序'}
            </span>
          </button>
        ) : (
          <span title={key === 'strong_count' && strongCountStale ? '非最新交易日，此欄無法排序' : undefined}>
            {col.header}
          </span>
        )}
      </th>
    )
  }

  const captionText = `${selectedDate || '（無日期）'} 強勢股總表，目前顯示「${
    showAll ? '全部欄位' : GROUPS[group].label
  }」欄位組，共 ${sortedRows.length} 檔`

  const desktopTable = (
    // showAll 時 min-w-max 讓表格撐到內容寬度（容器才捲得動）；分組檢視維持 w-full 不捲
    <table className={`w-full ${showAll ? 'min-w-max' : ''}`}>
      <caption className="sr-only">{captionText}</caption>
      <thead className="bg-gray-50">
        <tr>
          {visibleKeys.map((k, i) =>
            renderTh(k, { sticky: !showAll, stickyLeft: showAll && i === 0 })
          )}
        </tr>
      </thead>
      {/* divide-gray-200 比 watchlist 的 gray-100 深一階，長表更容易追行；
          每 5 列加粗分隔做視線導引。刻意不做斑馬紋：gray-50 底會把 green-700 壓到 4.74、
          hover 就沒得再深，而且每兩列換底色對低視力反而更亂。 */}
      <tbody className="divide-y divide-gray-200">
        {sortedRows.map((r) => (
          <tr
            key={r.stock_id}
            className="group hover:bg-gray-50 focus-within:bg-gray-50 [&:nth-child(5n)]:border-b-2 [&:nth-child(5n)]:border-gray-300"
          >
            {visibleKeys.map((k, i) => (
              <td
                key={k}
                className={`px-4 py-3 ${alignClass(COLUMNS[k].align)} whitespace-nowrap tabular-nums ${
                  showAll && i === 0 ? 'sticky left-0 z-10 bg-white group-hover:bg-gray-50' : ''
                }`}
              >
                {COLUMNS[k].render(r, ctx)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  const mobileTable = (
    // table-fixed ＋ colgroup：auto 版面會用儲存格的 min-content 當表格下限，
    // 在 375px 下算出 507px 而把整頁撐出橫向捲動。固定欄寬才保證手機不橫捲。
    <table className="w-full table-fixed">
      <caption className="sr-only">{captionText}</caption>
      <colgroup>
        <col className="w-[30%]" />
        <col className="w-[28%]" />
        <col />
        <col className="w-[52px]" />
      </colgroup>
      {/* 表頭 sticky 掛在 <th>（不是 <thead>）：Tailwind preflight 讓 table 是
          border-collapse:collapse，掛 thead 相容性較差。top-[65px] 是 TopBar 實測高度。 */}
      <thead className="bg-gray-50">
        <tr>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 rounded-tl-lg px-2 py-3 text-left text-sm font-medium text-gray-700">
            股票
          </th>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 px-2 py-3 text-right text-sm font-medium text-gray-700">
            收盤
          </th>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 px-2 py-3 text-right text-sm font-medium text-gray-700 truncate">
            {COLUMNS[focusKey].header}
          </th>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 rounded-tr-lg px-0 py-3 text-center">
            <span className="sr-only">展開全部欄位</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {sortedRows.map((r) => {
          const open = expanded.has(r.stock_id)
          return (
            <Fragment key={r.stock_id}>
              <tr className="hover:bg-gray-50 focus-within:bg-gray-50">
                <td className="px-2 py-3">
                  <Link href={`/stock/${r.stock_id}`} className="block min-h-[44px] hover:text-blue-600">
                    <span className="block font-medium text-gray-900 truncate" title={r.stock_name || r.stock_id}>
                      {r.stock_name || r.stock_id}
                    </span>
                    <span className="block text-sm text-gray-700 tabular-nums">{r.stock_id}</span>
                  </Link>
                </td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">
                  {COLUMNS.close.render(r, ctxCompact)}
                  <span className="block text-sm">{COLUMNS.change_pct.render(r, ctxCompact)}</span>
                </td>
                <td className="px-2 py-3 text-right truncate tabular-nums">
                  {COLUMNS[focusKey].render(r, ctxCompact)}
                </td>
                <td className="px-0 py-3 text-center">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`row-${r.stock_id}-detail`}
                    onClick={() => toggleExpand(r.stock_id)}
                    className="w-11 h-11 inline-flex items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                    <span className="sr-only">
                      {open ? `收合 ${r.stock_name} 的全部欄位` : `展開 ${r.stock_name} 的全部欄位`}
                    </span>
                  </button>
                </td>
              </tr>
              {open && (
                <tr id={`row-${r.stock_id}-detail`} className="bg-gray-50">
                  <td colSpan={4} className="px-2 py-3">
                    {DETAIL_GROUPS.map((g) => (
                      <div key={g.label} className="mb-3 last:mb-0">
                        <div className="text-xs font-medium text-gray-600 mb-1">{g.label}</div>
                        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
                          {g.columns.map((k) => (
                            <Fragment key={k}>
                              <dt className="text-gray-700">{COLUMNS[k].fullName}</dt>
                              <dd className="text-right tabular-nums whitespace-nowrap">
                                {COLUMNS[k].render(r, ctx)}
                              </dd>
                            </Fragment>
                          ))}
                        </dl>
                      </div>
                    ))}
                    <Link
                      href={`/stock/${r.stock_id}`}
                      className="mt-1 inline-flex items-center min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
                    >
                      查看 K 線與籌碼 →
                    </Link>
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )

  /* ------------------------------ 畫面 ------------------------------ */

  const noTradingDay = !!data && !data.latestDate

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 容器比全站慣例的 max-w-7xl 寬：20 欄表格在 1920 螢幕上才不會白白浪費空間。
          PageHeader 也要同步換寬，否則標題會跟表格左緣差 280px。 */}
      <PageHeader
        title="強勢股總表"
        maxWidth="max-w-[1560px]"
        subtitle={
          <>
            {noTradingDay ? '尚無可用交易日' : `資料日期 ${selectedDate || '—'}`}
            ｜以表格一次比較多檔、看得到全部欄位
          </>
        }
      />

      <div className="max-w-[1560px] mx-auto px-4 py-6">
        {/* 檢視切換：表格與卡片是同一份資料的兩種呈現，所以不在手機底部導覽擠第五個圖示 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <Link
            href="/strong-stocks"
            className="inline-flex items-center min-h-[44px] px-4 rounded-full text-sm bg-white text-gray-700 border border-gray-300 hover:border-blue-400 transition-colors"
          >
            卡片檢視
          </Link>
          <span
            aria-current="page"
            className="inline-flex items-center min-h-[44px] px-4 rounded-full text-sm bg-blue-600 text-white border border-blue-600"
          >
            表格檢視
          </span>
        </div>

        {/* 月報入口：刻意**不放進上面那組「檢視切換」膠囊**——那組的語意是「同一份資料的
            兩種呈現」，而月報是不同時間粒度的彙整（一行一檔、跨整月），混進去會誤導。 */}
        <div className="mb-4">
          <Link
            href="/strong-monthly"
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg text-sm bg-white text-gray-700 border border-gray-300 hover:border-blue-400 transition-colors"
          >
            <span aria-hidden="true">🗓️</span>
            強勢月報（彙整本月所有入選，取代手工月報）
          </Link>
        </div>

        {strongCountStale && (
          <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900">
            <span aria-hidden="true">⚠️</span>
            <span>
              「強勢日」欄位固定以<strong>最近 7 個交易日</strong>計算，與所選日期（{selectedDate}）無關，
              因此此欄已停用排序並轉為灰字。
            </span>
          </div>
        )}

        {/* 快速篩選 */}
        <div className="flex flex-wrap gap-2 mb-3">
          {QUICK_FILTERS.map((q) => {
            const active =
              filter.macd === q.macd &&
              filter.minVolume === q.minVolume &&
              filter.foreignBuy === q.foreignBuy &&
              filter.streakMin === q.streakMin
            return (
              <button
                key={q.key}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setFilter((f) => ({
                    ...f,
                    macd: q.macd,
                    minVolume: q.minVolume,
                    foreignBuy: q.foreignBuy,
                    streakMin: q.streakMin,
                  }))
                }
                className={`px-4 min-h-[44px] rounded-full text-sm border transition-colors ${
                  active
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                }`}
              >
                {q.label}
              </button>
            )
          })}
        </div>

        {/* 篩選卡（恆常渲染：切日期時不可以整塊消失再長回來） */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
          <div className="flex flex-wrap gap-x-4 gap-y-3 items-center">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label htmlFor="stock-search" className="text-gray-700 text-sm shrink-0">
                搜尋
              </label>
              <input
                id="stock-search"
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="代號或名稱"
                className={`${SELECT} w-full sm:w-44`}
              />
            </div>

            {availableDates.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="date-select" className="text-gray-700 text-sm">日期</label>
                <select
                  id="date-select"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  className={SELECT}
                >
                  {availableDates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="macd-select" className="text-gray-700 text-sm">MACD</label>
              <select
                id="macd-select"
                value={filter.macd}
                onChange={(e) => setFilter((f) => ({ ...f, macd: e.target.value }))}
                className={SELECT}
              >
                <option value="all">全部</option>
                <option value="多">多頭</option>
                <option value="空">空頭</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="volume-select" className="text-gray-700 text-sm">成交量</label>
              <select
                id="volume-select"
                value={filter.minVolume}
                onChange={(e) => setFilter((f) => ({ ...f, minVolume: parseInt(e.target.value, 10) }))}
                className={SELECT}
              >
                <option value="0">不限</option>
                <option value="1000">1000張+</option>
                <option value="5000">5000張+</option>
                <option value="10000">1萬張+</option>
              </select>
            </div>

            {industries.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="industry-select" className="text-gray-700 text-sm">產業</label>
                <select
                  id="industry-select"
                  value={filter.industry}
                  onChange={(e) => setFilter((f) => ({ ...f, industry: e.target.value }))}
                  className={`${SELECT} max-w-[18ch]`}
                >
                  <option value="all">全部產業</option>
                  {industries.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>
            )}

            {/* 預設關閉：預設要誠實呈現有多少檔沒資料 */}
            <label className="flex items-center gap-2 min-h-[44px] lg:min-h-[36px] text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={hideNullRows}
                onChange={(e) => setHideNullRows(e.target.checked)}
                className="w-5 h-5 rounded"
              />
              隱藏無資料的列
            </label>

            {/* 檢視切換：全欄位（預設）↔ 分組。全欄位會水平捲動，捲動關在表格容器內 */}
            <button
              type="button"
              aria-pressed={showAll}
              onClick={() => setShowAll((v) => !v)}
              className={`hidden md:inline-flex items-center min-h-[44px] lg:min-h-[36px] px-4 rounded-full text-sm border transition-colors ${
                showAll
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
              }`}
            >
              {showAll ? '改用分組檢視（不捲動）' : '顯示全部欄位'}
            </button>
          </div>
        </div>

        {/* 桌機：欄位分組切換（一次最多 8 欄，不橫捲） */}
        {!showAll && (
          <div className="hidden md:flex flex-wrap gap-2 mb-3" role="group" aria-label="欄位分組">
            {GROUP_KEYS.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={group === g}
                onClick={() => setGroup(g)}
                className={`px-4 min-h-[44px] lg:min-h-[40px] rounded-full text-sm border transition-colors ${
                  group === g
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                }`}
              >
                {GROUPS[g].label}
              </button>
            ))}
          </div>
        )}

        {/* 手機：焦點欄 chip 列。
            關鍵原則——橫向捲動的是 44px 高的控制項，不是資料格。
            點不同顆＝換第 3 欄並依該欄由大到小；點同一顆＝翻轉方向。 */}
        <div className="md:hidden mb-3">
          <div id="focus-label" className="text-sm text-gray-700 mb-1">
            比較欄位（點選即排序）
          </div>
          <div
            className="-mx-4 px-4 pb-1 flex gap-2 overflow-x-auto snap-x"
            role="group"
            aria-labelledby="focus-label"
          >
            {MOBILE_FOCUS_KEYS.filter((k) => !(k === 'strong_count' && strongCountStale)).map((k) => {
              const on = focusKey === k
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSort(k)}
                  className={`snap-start shrink-0 px-4 min-h-[44px] rounded-full text-sm border transition-colors ${
                    on
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {COLUMNS[k].header}
                  {on && <span aria-hidden="true"> {effectiveSort.dir === 'desc' ? '▼' : '▲'}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* 欄位說明：刻意放在表格「上方」（任何捲動容器之外）。
            InfoTip 的泡泡是 `position: fixed`（見 InfoTip.tsx 檔頭）：**不會**再把水平捲軸撐長，
            但會被祖先的 `[contain:paint]`／`overflow` 裁切，所以仍然一律放在捲動容器之外。
            另外 20 顆 32px 的 ⓘ 放進表頭也會多出 640px 寬度負擔。 */}
        <details className="bg-white rounded-lg shadow-sm mb-4">
          <summary className="min-h-[44px] flex items-center px-4 text-sm font-medium text-gray-700 cursor-pointer">
            欄位說明（單位與計算方式）
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm text-gray-700 mb-3">
              <span aria-hidden="true">{DASH}</span>
              <span className="sr-only">破折號</span>
              　表示資料來源未涵蓋此股此欄（多為上櫃或新掛牌），
              <strong>不是 0</strong>。法人買賣超與連續天數的 0 則是真的 0。
              <InfoTip title="漲跌幅怎麼算">
                （收盤 − 前一交易日收盤）÷ 前一交易日收盤。沒有昨收資料時才退回以當日開盤價為基準；不是「收盤 − 開盤」。
              </InfoTip>
            </p>
            <dl className="grid md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[...FIXED_KEYS, ...ALL_DATA_KEYS].map((k) => (
                <div key={k} className="flex flex-col sm:flex-row sm:gap-2">
                  <dt className="font-medium text-gray-900 whitespace-nowrap">{COLUMNS[k].fullName}</dt>
                  <dd className="text-gray-700">{COLUMNS[k].desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>

        {/* 統計列：篩選/排序造成筆數變動時播報 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-sm" aria-live="polite">
          <span className="text-gray-700">
            篩選 <span className="font-bold text-gray-900 tabular-nums">{sortedRows.length}</span> 檔 ／ 當日{' '}
            <span className="font-medium text-gray-900 tabular-nums">{totalCount}</span> 檔
          </span>
          <span className="text-gray-700">{sortSummary}</span>
          {sortNotice && <span className="text-amber-900">{sortNotice}</span>}
        </div>

        {/* 結果區三元鏈：篩選列與分組切換恆常渲染，只有這裡換 */}
        {loading ? (
          <TableSkeleton rows={12} cols={visibleKeys.length} />
        ) : error ? (
          <ErrorState message="無法取得強勢股資料" onRetry={() => fetchData(selectedDate || undefined)} />
        ) : noTradingDay ? (
          <EmptyState icon="📅" title="尚無可用交易日" description="資料尚未收集完成，請稍後再試" />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={data?.dataMissing ? '📅' : '🔍'}
            title={data?.dataMissing ? '這一天沒有明細資料' : '沒有符合條件的股票'}
            description={data?.dataMissing ? '請改選其他交易日' : '試著放寬搜尋、MACD／成交量／產業等條件'}
          />
        ) : (
          <>
            {/* 手機：3 欄常駐 ＋ 可展開列（展開後一次列出全部欄位），不做橫捲資料表。
                ⚠️ 這裡刻意不用 watchlist 的 overflow-hidden：overflow 非 visible 會讓卡片
                變成 sticky 表頭的參考容器，而卡片高度＝表格高度，表頭等於完全沒黏住。
                圓角改由表頭第一／最後一個 th 自己處理。 */}
            <div className="md:hidden bg-white rounded-lg shadow-sm">{mobileTable}</div>

            {/* 桌機 */}
            {showAll ? (
              <div className="hidden md:block bg-white rounded-lg shadow-sm overflow-hidden">
                <p className="px-4 py-2 text-sm text-gray-700 bg-gray-50 border-b border-gray-200">
                  ← 左右捲動查看全部欄位 →（此模式表頭不固定；若想免捲動可切換為分組檢視）
                </p>
                {/* tabIndex + role=region：否則鍵盤使用者捲不動這個容器。
                    overflow-x-auto 放在頁面內層，不可讓 body 橫捲（會跟 fixed Sidebar 錯位）。
                    ⚠️ [contain:paint] 不是裝飾：實測 Chrome 會把這個巢狀捲動容器的溢出
                    併進「根捲動區」（documentElement.scrollWidth 2489 / 視窗可橫捲 1049px），
                    即使父層已經 overflow-hidden、每一層的 scrollWidth 都等於 clientWidth。
                    加上 paint containment 後根捲動區才回到 1440。移掉它整頁就會又橫捲。 */}
                <div
                  className="overflow-x-auto [contain:paint]"
                  role="region"
                  tabIndex={0}
                  aria-label="全部欄位表格，可左右捲動"
                >
                  {desktopTable}
                </div>
              </div>
            ) : (
              /* 同上：不可加 overflow-hidden，否則 sticky 表頭會黏在卡片而不是視窗。
                 ⚠️ 實測：分組表格的天生寬度約 1113px（8 欄 × px-4 + nowrap）。
                 視窗 < 1128px 時若沒有捲動容器，溢出會落到「根捲動區」→ 整頁橫捲，
                 而 Sidebar 是 fixed 不會跟著捲 → 直接蓋住第一欄的股名與代號。
                 實測 768/900/1024 分別溢出 345/213/89px，1128 以上為 0。
                 解法：xl(1280) 以下把溢出關進表格自己的捲動容器（此時 sticky 表頭失效，
                 屬可接受的降級）；xl 以上還原成無容器，sticky 表頭照常運作。
                 改這裡前請先用 documentElement.scrollWidth 對 768/1024/1280 量一次。 */
              <div className="hidden md:block bg-white rounded-lg shadow-sm">
                <div
                  className="overflow-x-auto [contain:paint] xl:overflow-x-visible xl:[contain:none]"
                  role="region"
                  tabIndex={0}
                  aria-label="強勢股總表，視窗較窄時可左右捲動"
                >
                  {desktopTable}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
