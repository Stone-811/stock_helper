/* ------------------------------------------------------------------ *
 * 強勢股頁（page.tsx）的欄位定義：列型別、儲存格、22 欄 registry、分組、快速篩選、排序工具。
 * 這裡全部沒有 state；頁面只放資料抓取、狀態與版面。
 *
 * 每欄的 null／0 語意寫在 desc（「欄位說明」區直接顯示給業主看），要改某欄的缺值顯示只看這個檔。
 * 2026-11-06 由 page.tsx 原樣搬出：欄位內容、顯示與排序都不變，只有成交額、當沖比、MACD 底色
 * 改呼叫 lib/format.ts 的同一份公式（與 StockCard 共用）。同一資料夾的非 page 檔不會變成網址
 * （App Router 只認 page／route 等特殊檔名）。
 * ------------------------------------------------------------------ */

import Link from 'next/link'
import {
  DASH,
  fmtNum,
  fmtPct,
  fmtSigned,
  fmtTradingValue,
  computeChange,
  changeColor,
  signColor,
  tradingValueOf,
  dayTradingRatioOf,
  macdBadgeClass,
} from '../../lib/format'
import { NullCell } from '../../components/table'
import { sortRows, type ColDef } from '../../lib/table'
import type { StrongStock } from '../../lib/firebase'

/** ⚠️ 刻意不 import lib/firebase.ts 的 StrongStock：
 *  那個型別把下列 4 欄宣告成非空 number，但 API 會原樣送 null
 *  （firebase_writer.py 的 _opt_num 明確寫 None），
 *  `stock.foreign_hold_ratio.toFixed(2)` 會編譯得過、上線後 TypeError 白畫面。 */
/** 直接由共用型別衍生，避免同一份 payload 有兩套會各自漂移的宣告。
 *  Omit 掉 date：firebase_writer._convert_stock_row 並不寫入 date 欄位，
 *  /api/strong-stocks 也不補，所以 DailyStock.date 對這份 payload 而言不成立。
 *  可為 null 的 4 個欄位（當沖量、外資三比例）的語意見 lib/firebase.ts 的註解。 */
export type StrongTableRow = Omit<StrongStock, 'date'>

export interface StrongTableResponse {
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

export interface RenderCtx {
  /** 所選日期不是最新交易日 → strong_count 是錯的（見 page.tsx 的 strongCountStale 說明） */
  strongCountStale: boolean
  /** 手機摘要列：省略次要的第二行 */
  compact: boolean
  /** 手機第 3 欄：省略漲跌幅前的 ▲▼。375 寬時這欄內容只剩約 76px（360 寬約 70px），
   *  「▲ 」就佔約 20px，會把「+9.98%」「+10.00%」擠成省略號——被截斷的數字比少一個箭頭更糟。
   *  方向仍由正負號＋紅綠表達。只影響漲跌幅，其他欄位的 render 不看這個旗標。 */
  noArrow?: boolean
}

/* --------------------------- 衍生值計算 --------------------------- *
 * 成交額、當沖比的公式在 lib/format.ts（tradingValueOf／dayTradingRatioOf），與 StockCard 共用：
 * 卡片檢視依「當沖比」排序時，同一張卡片上「排序：當沖比例」與「當沖額（x%）」是同一份公式。
 * ⚠️ 當沖量是 null 時當沖比回 null，**不可回 0%**。 */

const numCell = (v: number | null | undefined, digits = 0, cls = 'text-gray-900') =>
  v == null ? <NullCell /> : <span className={cls}>{fmtNum(v, digits)}</span>

// 0 寫「0」（不寫「+0」）：與卡片同一頁、同一種寫法
const signedCell = (v: number | null | undefined) =>
  v == null ? <NullCell /> : <span className={signColor(v)}>{v === 0 ? '0' : fmtSigned(v)}</span>

const pctCell = (v: number | null | undefined, digits = 2, cls = 'text-gray-900') =>
  v == null ? <NullCell /> : <span className={cls}>{fmtPct(v, digits)}</span>

/** 連買／連賣：0 顯示「0」，只有 undefined 才是「—」。⚠️ 收集程式目前把缺法人資料也寫成 0（streak.py fillna(0)），
 *  所以這裡的 0 分不出「真的無連續」與「沒資料」；根治要改收集器寫 null。 */
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

export type ColKey =
  | 'stock' | 'close' | 'change_pct'
  | 'macd_status' | 'strong_count' | 'volume' | 'foreign_buy' | 'industry'
  | 'open' | 'high' | 'low' | 'prev_close'
  | 'trading_value' | 'day_trading_volume' | 'day_trading_ratio'
  | 'trust_buy' | 'dealer_buy' | 'foreign_streak' | 'trust_streak'
  | 'foreign_hold_ratio' | 'foreign_remain_ratio' | 'foreign_limit_ratio'

export const COLUMNS: Record<ColKey, ColDef<StrongTableRow, RenderCtx>> = {
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
      const arrow = ctx.noArrow ? '' : dir === 'up' ? '▲' : dir === 'down' ? '▼' : ''
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
      // 「-」是天數不夠算不出來，跟卡片一樣顯示「—」（無資料一律「—」）
      const label = m === '多' || m === '空' ? m : DASH
      const cls = macdBadgeClass(m)
      return (
        <span className={`inline-flex items-center min-h-[28px] px-2 rounded text-sm font-medium ${cls}`}>
          {label}
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
    desc: '外資當日買進 − 賣出。正數（紅）買超、負數（綠）賣超。⚠️ 0 也可能是當天沒有法人資料（收集程式目前把缺漏寫成 0）。',
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
    sortValue: (r) => tradingValueOf(r.volume, r.close),
    desc: '成交量（張）× 收盤價 × 1000 股。顯示級距在「9999萬」之後會跳為「1.00億」。排序依原始金額，不是依顯示文字。',
    render: (r) => {
      const v = tradingValueOf(r.volume, r.close)
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
    desc: '「—」＝這天交易所沒有公布這檔的當沖數字：興櫃股、處置股（處置期間依規定不得現股當沖）、沒有融資融券資格的股票都不是當沖標的。處置結束的下一個交易日就會恢復。',
    render: (r) => numCell(r.day_trading_volume),
  },
  day_trading_ratio: {
    header: '當沖比',
    fullName: '當沖比例（當沖量 ÷ 成交量，%）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => dayTradingRatioOf(r.day_trading_volume, r.volume),
    desc: '當沖量 ÷ 成交量。當沖量無資料時整格顯示「—」，不會顯示 0%。比例偏高（≥30%）以粗體標示，代表短線交易熱絡。',
    render: (r) => {
      const v = dayTradingRatioOf(r.day_trading_volume, r.volume)
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
    desc: '投信當日買進 − 賣出。⚠️ 0 也可能是當天沒有法人資料（收集程式目前把缺漏寫成 0）。',
    render: (r) => signedCell(r.trust_buy),
  },
  dealer_buy: {
    header: '自營',
    fullName: '自營商買賣超（張，含自行買賣與避險）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.dealer_buy ?? null,
    desc: '自營商當日買進 − 賣出，含自行買賣與避險。⚠️ 0 也可能是當天沒有法人資料。',
    render: (r) => signedCell(r.dealer_buy),
  },
  foreign_streak: {
    header: '外資連續',
    fullName: '外資連續買賣超天數',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.foreign_streak ?? null,
    desc: '正數為連續買超天數、負數為連續賣超天數。「0」＝今日無連續，或缺法人資料（收集程式目前把缺漏寫成 0）；「—」＝舊資料沒有這個欄位。',
    render: (r) => streakCell(r.foreign_streak),
  },
  trust_streak: {
    header: '投信連續',
    fullName: '投信連續買賣超天數',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.trust_streak ?? null,
    desc: '同「外資連續」：0 是無連續或缺法人資料，「—」是無此欄資料。',
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

export const FIXED_KEYS: ColKey[] = ['stock', 'close', 'change_pct']

export const GROUPS = {
  overview: { label: '總覽', columns: ['macd_status', 'strong_count', 'volume', 'foreign_buy', 'industry'] as ColKey[] },
  price: { label: '價格', columns: ['open', 'high', 'low', 'prev_close'] as ColKey[] },
  liquidity: { label: '量能', columns: ['volume', 'trading_value', 'day_trading_volume', 'day_trading_ratio'] as ColKey[] },
  institution: { label: '法人買賣超', columns: ['foreign_buy', 'trust_buy', 'dealer_buy', 'foreign_streak', 'trust_streak'] as ColKey[] },
  holding: { label: '外資持股', columns: ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio'] as ColKey[] },
} as const

export type GroupKey = keyof typeof GROUPS
export const GROUP_KEYS = Object.keys(GROUPS) as GroupKey[]

/** 「顯示全部欄位」用：去重後的全部資料欄 */
export const ALL_DATA_KEYS: ColKey[] = Array.from(
  new Set(GROUP_KEYS.flatMap((g) => GROUPS[g].columns))
)

/** 手機展開列：一次列出全部欄位，刻意去重並重新編組（不照桌機分頁走） */
export const DETAIL_GROUPS: { label: string; columns: ColKey[] }[] = [
  { label: '價格', columns: ['close', 'change_pct', 'open', 'high', 'low', 'prev_close'] },
  { label: '量能', columns: ['volume', 'trading_value', 'day_trading_volume', 'day_trading_ratio'] },
  { label: '法人買賣超', columns: ['foreign_buy', 'trust_buy', 'dealer_buy', 'foreign_streak', 'trust_streak'] },
  { label: '外資持股', columns: ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio'] },
  { label: '其他', columns: ['macd_status', 'industry', 'strong_count'] },
]

/** 手機第 3 欄的候選（焦點欄 chip）。橫向捲動的是 44px 高的控制項，不是資料格。
 *  漲跌幅排第一顆：它是預設排序（DEFAULT_SORT）。少了這顆，手機一開始亮的會是別顆
 *  （看起來像依成交量排、實際卻依漲跌幅排），而且只要點過任何一顆就回不到依漲跌幅排序
 *  ——桌機可以點表頭，手機沒有表頭可點。 */
export const MOBILE_FOCUS_KEYS: ColKey[] = [
  'change_pct', 'volume', 'trading_value', 'day_trading_ratio', 'foreign_buy', 'trust_buy',
  'dealer_buy', 'foreign_streak', 'foreign_hold_ratio', 'strong_count',
]

export const QUICK_FILTERS = [
  { key: 'all', label: '全部', macd: 'all', minVolume: 0, foreignBuy: false, streakMin: 0 },
  { key: 'tech', label: '技術多頭', macd: '多', minVolume: 0, foreignBuy: false, streakMin: 0 },
  { key: 'foreign', label: '法人買超', macd: 'all', minVolume: 0, foreignBuy: true, streakMin: 0 },
  { key: 'volume', label: '爆量', macd: 'all', minVolume: 10000, foreignBuy: false, streakMin: 0 },
  { key: 'streak', label: '外資連買 3 日以上', macd: 'all', minVolume: 0, foreignBuy: false, streakMin: 3 },
] as const

export type SortState = { key: ColKey; dir: 'asc' | 'desc' }

/** 「排序依據」裡卡片上本來看不到的欄位：依它們排序時，每張卡片多一行顯示該值 */
export const CARD_HIDDEN_KEYS: ColKey[] = ['volume', 'day_trading_ratio', 'foreign_streak', 'foreign_hold_ratio']

export const DEFAULT_SORT: SortState = { key: 'change_pct', dir: 'desc' }

/** 任一指定欄位「無資料」（sortValue 為 null）就回 true —— 給「隱藏無資料的列」用 */
export const hasNullIn = (r: StrongTableRow, keys: ColKey[]) =>
  keys.some((k) => COLUMNS[k].sortValue(r) == null)

// 排序一律在前端做：瀏覽器拿到的是 JSON.parse 出來的全新物件，怎麼 sort 都安全。
// （伺服器端 getStocksByDate 的回傳陣列是跨請求共用的 process 級記憶體，
//   對它 sort/reverse 會汙染 dayCache 五分鐘並影響 /api/screener 與個股頁。）
export const sortRowsBy = (list: StrongTableRow[], s: SortState) => {
  const col = COLUMNS[s.key] ?? COLUMNS.change_pct
  return sortRows(list, col.sortValue, s.dir, (r) => r.stock_id) // 同值依代號（lib/table.ts，與月報共用）
}

/** 統計列的排序說明（含「幾檔無資料排在最後」） */
export const sortSummaryOf = (sorted: StrongTableRow[], s: SortState) => {
  const col = COLUMNS[s.key] ?? COLUMNS.change_pct
  const nullCount = sorted.filter((r) => col.sortValue(r) == null).length
  return `已依「${COLUMNS[s.key]?.fullName ?? ''}」${
    s.dir === 'desc' ? '由大到小' : '由小到大'
  }排序，共 ${sorted.length} 檔${nullCount > 0 ? `，其中 ${nullCount} 檔無資料排在最後` : ''}`
}
