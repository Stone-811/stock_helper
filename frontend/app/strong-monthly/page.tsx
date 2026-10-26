'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '../../components/states'
import { NullCell, TbdCell, TableScroll } from '../../components/table'
import { SELECT, alignClass, justifyClass, type ColDef } from '../../lib/table'
import {
  DASH,
  DEFAULT_TRUST_WINDOW,
  TRUST_WINDOWS,
  compareNullLast,
  fmtDayList,
  fmtNum,
  fmtSigned,
  isTrustShort,
  parseTrustWindow,
  signColor,
  type TrustWindow,
} from '../../lib/format'
// ⚠️ 只能 import type：lib/monthly-report 會 import firebase-admin，
// 一旦從它取用執行期的值，client bundle 就會把 Admin SDK 拉進來（建置直接失敗）。
// 因此 TRUST_WINDOWS 等常數放在 lib/format.ts（純函式，server/client 共用）。
import type { MonthlyReportRow } from '../../lib/monthly-report'

/* ------------------------------------------------------------------ *
 * 強勢月報（取代業主每月手工維護的 Word《強勢商品篩選》）
 *
 * 2026-10-26 業主要求「月報頁面改成 Word 檔的樣子」，在聊天裡逐題確認：
 *  - 網頁照 Word 排（不另做 .docx 下載）：標題「西元YYYY年MM月份【強勢商品篩選】」、
 *    兩層表頭（籌碼＝外資／投信、技術分析＝MACD／KD／均線）、商品寫成「1560中砂」、依代號排序。
 *  - 當月曾經強勢的全部列出（不做業主的手挑、不分 A／非 A 兩份名單）。
 *  - 數字一律取「最新一個交易日」（過完的月份＝月底那天），全表同一天。
 *  - 收盤價漲停＝紅字（只標收盤價；Word 的 10 日均價紅字、底色是業主私人記號，不做）。
 *  - 最後一欄 Word 表頭寫「月營收」，內容其實是強勢日 → 叫「強勢日」。
 *  - 篩選保留，所有說明收進一顆「說明」按鈕。
 *  - 手機也是同一張表格（左右滑），不再是摘要列＋展開。
 *
 * ⚠️ 絕不可讓溢出落到根捲動區：Sidebar 是 fixed left-0，整頁橫捲會讓它蓋住第一欄
 * （原總表 2026-09 踩過，實測 768px 溢出 345px）。橫向與縱向捲動**全部關在 TableScroll 裡**，
 * 表頭才能用「相對捲動容器」的 sticky 固定住——700 列的表沒有固定表頭是不能用的。
 *
 * ⚠️ 兩個「待定義」欄位（KD／均線）保留欄位位置並顯示「待定義」，
 * **絕不可自己猜一個定義填進去**。它們與 null 的「—」在視覺上刻意分開：
 * 「—」是這一檔沒有這筆資料（資料問題）、「待定義」是整欄還沒有規則（規格問題）。
 * ------------------------------------------------------------------ */

interface MonthlyResponse {
  month: string
  rows: MonthlyReportRow[]
  availableMonths: string[]
  latestDate: string | null
  /** 2026-10-26 新增；舊版快取的回應沒有這個欄位 → 一律當成不知道 */
  baseDate?: string | null
  coverage: { from: string; to: string; tradingDays: number } | null
  partialMonth: boolean
  foreignHoldUnavailable: boolean
  dataMissing: boolean
  requestedMonth: string | null
  count: number
}

/**
 * ⚠️ 回應的形狀 2026-10-26 改過（數字基準日、漲停）。route 有 s-maxage=1800 ＋
 * stale-while-revalidate=3600，CDN 上的舊回應最多還會被送一個半小時；
 * 網址多帶這個參數＝不同的快取鍵，上版後立刻拿到新形狀。route 不讀它。
 */
const API_VERSION = '2'

/** 業主人工月報的筆數，**逐月**記錄：82 是 2026-09 那一份的數字。沒有對照資料的月份不可沿用 */
const MANUAL_REPORT_COUNT: Record<string, number> = { '2026-09': 82 }

type MKey =
  | 'firstDate' | 'stock' | 'close' | 'volume'
  | 'foreignHold' | 'trustNet' | 'ma5' | 'ma10'
  | 'macd' | 'kd' | 'maPattern' | 'strongDays'

/* ----------------------------- 儲存格 ----------------------------- */

/** YYYY-MM-DD → MM/DD（月份已由報表標題決定，欄內不重複月份年份） */
const fmtMd = (d: string) => (d.length >= 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : d)

const numCell = (v: number | null, digits = 0) =>
  v == null ? <NullCell /> : <span className="text-gray-900">{fmtNum(v, digits)}</span>

/* ------------------------------ 欄位 registry ------------------------------ *
 * 順序＝業主 Word 月報的 12 欄順序，不可重排。
 * header／subHeader 是表頭；fullName／desc 給「說明」裡的欄位定義（業主看的，寫白話）。
 *
 * 籌碼(投信) 欄的視窗（近 5/10/20 日）可切換，表頭與說明都要跟著變——
 * 否則使用者換成 5 日，表頭卻還寫 20 日。所以這是吃參數的工廠函式。
 * ------------------------------------------------------------------------- */

const makeColumns = (tw: TrustWindow): Record<MKey, ColDef<MonthlyReportRow>> => ({
  firstDate: {
    header: '日期',
    fullName: '日期',
    align: 'center',
    sortable: true,
    sortValue: (r) => r.firstDate,
    desc: '這一檔在本月「第一次」成為強勢股的日子。',
    render: (r) => (
      <span className="text-gray-900" title={r.firstDate}>
        {fmtMd(r.firstDate)}
      </span>
    ),
  },
  stock: {
    header: '商品',
    fullName: '商品',
    align: 'left',
    sortable: true,
    sortValue: (r) => r.stockId,
    desc: '股票代號與名稱，跟 Word 一樣寫在一起。點一下會開個股頁。',
    render: (r) => (
      // 名稱可以換行（不截斷）：手機看不到 title 提示，截成「日月光…」等於沒寫
      <Link
        href={`/stock/${r.stockId}`}
        className="flex items-center min-h-[44px] font-medium text-gray-900 whitespace-normal [overflow-wrap:anywhere] hover:text-blue-700 hover:underline"
      >
        <span>
          <span className="tabular-nums">{r.stockId}</span>
          {r.stockName && r.stockName !== r.stockId ? r.stockName : ''}
        </span>
      </Link>
    ),
  },
  close: {
    header: '收盤價',
    fullName: '收盤價（元）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.close,
    desc: '表格上方寫的那一天的收盤價。紅字＋「漲停」＝那天收在漲停價。',
    render: (r) => {
      if (r.close == null) return <NullCell title="這一天沒有這檔的交易資料（例如暫停交易）" />
      // 紅字之外一定要有「漲停」兩個字：不可只用顏色表達意思（視力不佳者分不出）
      return r.limitUp ? (
        <span className="font-bold text-red-700">
          {fmtNum(r.close, 2)}
          <span className="block text-sm font-medium">漲停</span>
        </span>
      ) : (
        <span className="text-gray-900">{fmtNum(r.close, 2)}</span>
      )
    },
  },
  volume: {
    header: '成交量',
    fullName: '成交量（張）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.volume,
    desc: '表格上方寫的那一天的成交量。0 是真的沒有成交，「—」是沒有資料。',
    render: (r) => numCell(r.volume),
  },
  foreignHold: {
    header: '外資',
    subHeader: '持股張數',
    fullName: '籌碼・外資（持股張數）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.foreignHoldShares,
    desc: '外資手上持有的張數（官方申報）。▲ 比前一個交易日多、▽ 比前一個交易日少、「持平」是一樣多。約 15% 的股票（多半是上櫃、新上市）沒有這筆資料，顯示「—」不是 0。',
    render: (r) => {
      if (r.foreignHoldShares == null) return <NullCell />
      const dir = r.foreignHoldDir
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▽' : null
      // 漲紅跌綠；跌用 green-700（green-600 白底只有 3.22 對比、不過 AA）
      const cls = dir === 'up' ? 'text-red-600' : dir === 'down' ? 'text-green-700' : 'text-gray-900'
      return (
        <span className={cls}>
          {arrow && <span aria-hidden="true">{arrow}</span>}
          {fmtNum(r.foreignHoldShares)}
          <span className="sr-only">
            {dir === 'up' ? '，比前一交易日增加' : dir === 'down' ? '，比前一交易日減少' : ''}
          </span>
          {/* 只有「沒箭頭」的兩種情況要寫字，否則持平與「沒有前一天可比」看起來一模一樣 */}
          {dir === 'flat' && <span className="block text-sm text-gray-700">持平</span>}
          {dir == null && <span className="block text-sm text-gray-700">無前日可比</span>}
        </span>
      )
    },
  },
  /**
   * ⚠️ 語意警告（本欄與業主月報不同，是全表最容易被誤讀的一欄）
   * 業主月報這一欄原本是「投信持股張數」（存量），但沒有可靠來源（見 lib/format.ts 的
   * TRUST_WINDOWS 註解）。本欄是「近 N 個交易日買賣超**累計**」（流量），業主 2026-10-26 同意維持。
   * 表頭第二行一定要寫出「買賣超累計」與期間，不要為了排版縮成「投信」兩個字。
   */
  trustNet: {
    header: '投信',
    subHeader: `近${tw}日買賣超累計`,
    fullName: `籌碼・投信（近 ${tw} 個交易日買賣超累計，張）`,
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.trustNet?.[tw]?.sum ?? null,
    desc: `到表格上方那一天為止，往前 ${tw} 個交易日投信「買進－賣出」加起來的張數。紅色是買超、綠色是賣超。⚠️ 這不是投信手上持有多少張——網站拿不到可靠的投信持股資料，所以跟 Word 那一欄不能直接對照。上方「投信累計」可以改成 5 或 10 日。`,
    render: (r) => {
      const t = r.trustNet?.[tw]
      // days === 0：這一檔在整段期間內連一天明細都沒有 → 真的無資料
      if (!t || t.sum == null) {
        return <NullCell title={`這一檔往前 ${tw} 個交易日內沒有任何一天的資料`} />
      }
      const short = isTrustShort(t)
      return (
        <span className={signColor(t.sum)}>
          {t.sum === 0 ? '0' : fmtSigned(t.sum)}
          <span className="sr-only">
            張，近 {tw} 個交易日投信買賣超累計
            {t.sum > 0 ? '（買超）' : t.sum < 0 ? '（賣超）' : '（淨額為零）'}
            {short ? `，資料不足 ${tw} 日，實際只有 ${t.days} 個交易日` : ''}
          </span>
          {/* 截短一定要看得見，否則就是默默少算 */}
          {short && (
            <span aria-hidden="true" className="block text-sm font-normal text-amber-800">
              ⚠ 只有 {t.days} 日
            </span>
          )}
        </span>
      )
    },
  },
  ma5: {
    header: '5日均價',
    fullName: '5日均價（元）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.ma5,
    desc: '到表格上方那一天為止，最近 5 個交易日收盤價的平均。中間缺任何一天就顯示「—」，不會拿較少天數的平均充數。',
    render: (r) => numCell(r.ma5, 2),
  },
  ma10: {
    header: '10日均價',
    fullName: '10日均價（元）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.ma10,
    desc: '到表格上方那一天為止，最近 10 個交易日收盤價的平均。中間缺任何一天就顯示「—」。',
    render: (r) => numCell(r.ma10, 2),
  },
  macd: {
    header: 'MACD',
    fullName: '技術分析・MACD',
    align: 'center',
    sortable: false,
    sortValue: (r) => r.macdStatus,
    desc: '目前顯示網站算好的「多／空」（MACD 柱狀體在 0 以上＝多）。Word 的「+↗／–↗／↗」記法還沒確認對應方式，所以先不排序。',
    render: (r) => {
      const m = r.macdStatus
      if (!m || m === '-') return <NullCell title="資料天數不夠，算不出 MACD" />
      const cls =
        m === '多' ? 'bg-red-100 text-red-700' : m === '空' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
      return (
        <span className={`inline-flex items-center min-h-[28px] px-2 rounded text-sm font-medium ${cls}`}>
          {m}
        </span>
      )
    },
  },
  kd: {
    header: 'KD',
    fullName: '技術分析・KD',
    align: 'center',
    sortable: false,
    tbd: true,
    sortValue: () => null,
    desc: '待定義：等你提供「+↗／–↗／↗」的判斷方式再接上。',
    render: () => <TbdCell reason="KD 的「+↗／–↗／↗」記法還沒定義" />,
  },
  maPattern: {
    header: '均線',
    fullName: '技術分析・均線',
    align: 'center',
    sortable: false,
    tbd: true,
    sortValue: () => null,
    desc: '待定義：等你提供「四海遊龍／三陽開泰／糾結」的判斷方式再接上。',
    render: () => <TbdCell reason="「四海遊龍／三陽開泰／糾結」的判斷方式還沒定義" />,
  },
  strongDays: {
    header: '強勢日',
    fullName: '強勢日',
    align: 'left',
    sortable: true,
    sortValue: (r) => r.strongDays.length,
    desc: '本月每一次成為強勢股的「日」（例：18、21、23 日都強勢 → 18, 21, 23）。Word 這一欄的表頭寫「月營收」，內容其實就是這個，所以改叫「強勢日」。按表頭排序是依天數多寡。',
    render: (r) => (
      <span className="text-gray-900 whitespace-normal break-words">
        {fmtDayList(r.strongDays)}
        <span className="sr-only">，共 {r.strongDays.length} 天</span>
      </span>
    ),
  },
})

/** 欄位順序＝Word 月報順序。改這個陣列就等於改表格，不要在 JSX 裡另外排一份 */
const COL_ORDER: MKey[] = [
  'firstDate', 'stock', 'close', 'volume', 'foreignHold', 'trustNet',
  'ma5', 'ma10', 'macd', 'kd', 'maPattern', 'strongDays',
]

/** Word 的兩層表頭：這幾欄在第一層合併成一格，欄名寫在第二層 */
const GROUPS: { label: string; keys: MKey[] }[] = [
  { label: '籌碼', keys: ['foreignHold', 'trustNet'] },
  { label: '技術分析', keys: ['macd', 'kd', 'maPattern'] },
]
const GROUP_OF = new Map<MKey, (typeof GROUPS)[number]>(GROUPS.flatMap((g) => g.keys.map((k) => [k, g] as const)))

/** 給 sessionStorage 還原時驗證排序鍵 */
const COL_KEY_SET = new Set<string>(COL_ORDER)

/**
 * 欄寬（px）。用 table-fixed + colgroup 寫死，原因：
 *  ⚠️ 量過表頭：「近20日買賣超累計」（14px）要 156、「10日均價 ⇅」（16px）要 116，
 *  再窄就折行，兩層表頭會被撐到 130px 高（手機半個畫面都是表頭）。
 *  (a) 左側欄要 sticky，left 值只有在欄寬確定時才對得準；
 *  (b) auto 版面會用儲存格 min-content 當表格下限，寬度無法預測。
 * ⚠️ firstDate 的 92 同時寫死在商品欄的 `md:left-[92px]`（Tailwind 只認字面字串），兩處要一起改。
 */
const COL_W: Record<MKey, number> = {
  firstDate: 92, stock: 150, close: 112, volume: 108, foreignHold: 136, trustNet: 156,
  ma5: 112, ma10: 116, macd: 84, kd: 96, maPattern: 96, strongDays: 180,
}
const TOTAL_W = COL_ORDER.reduce((s, k) => s + COL_W[k], 0)

/**
 * 釘住的欄：商品欄所有寬度都釘（橫捲時一定看得到「這一列是哪一檔」）；
 * 日期欄只在 md 以上釘——手機 390px 兩欄都釘會吃掉 242px，只剩 150px 能左右滑。
 */
// 商品欄右緣的分隔線：橫捲時下一欄被蓋住一半，沒有線會看到「5」「2」這種半個字。
// ⚠️ 不能用 border（border-collapse 下 sticky 格的 border 不跟著黏），box-shadow 在這張表
// Chrome 也畫不出來（2026-10-26 實測 computed style 有、截圖沒有）→ 用 ::after 畫一條 2px 的線
const STICKY_EDGE = "after:content-[''] after:absolute after:top-0 after:bottom-0 after:right-0 after:w-0.5 after:bg-gray-400"
const STICKY_TH: Partial<Record<MKey, string>> = {
  firstDate: 'md:left-0 md:z-30',
  stock: `left-0 md:left-[92px] z-30 ${STICKY_EDGE}`,
}
const STICKY_TD: Partial<Record<MKey, string>> = {
  firstDate: 'md:sticky md:left-0 md:z-10 bg-white group-hover:bg-gray-50',
  stock: `sticky left-0 md:left-[92px] z-10 bg-white group-hover:bg-gray-50 ${STICKY_EDGE}`,
}

/** 第一層表頭的高度。第二層的 sticky top 要剛好接在它下面，兩個數字一定要一致 */
const HEAD1_H = 48

const STORAGE_KEY = 'strong-monthly-word' // 2026-10-26 改版：舊 key 存的是「依日期排序」，不可沿用
const LEGACY_STORAGE_KEYS = ['strong-monthly-view']

/** 預設排序＝股票代號由小到大：與業主的 Word 月報相同 */
const DEFAULT_SORT: { key: MKey; dir: 'asc' | 'desc' } = { key: 'stock', dir: 'asc' }

const monthLabel = (m: string) => (m.length === 7 ? `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月` : m)
/** Word 的標題：「西元2026年09月份【強勢商品篩選】」（月份補零，照 Word） */
const wordTitle = (m: string) => (m.length === 7 ? `西元${m.slice(0, 4)}年${m.slice(5, 7)}月份【強勢商品篩選】` : '強勢月報')
/** 同一個標題給 <h1> 用：兩段各自不斷行，手機只會在「月份」與「【」之間換行（不會剩「選】」一行） */
const wordTitleNode = (m: string) =>
  m.length === 7 ? (
    <>
      <span className="inline-block">西元{m.slice(0, 4)}年{m.slice(5, 7)}月份</span>
      <span className="inline-block">【強勢商品篩選】</span>
    </>
  ) : (
    '強勢月報'
  )

/* ------------------------------ 頁面 ------------------------------ */

export default function StrongMonthlyPage() {
  const [data, setData] = useState<MonthlyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false) // 還原完成前不存檔，也避免用預設條件多抓一次

  const [month, setMonth] = useState('')
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [industry, setIndustry] = useState('all')
  const [minDays, setMinDays] = useState(0)
  /**
   * 投信買賣超累計的視窗（交易日數）。
   * ⚠️ 切換**不重新請求**：API 一次回傳 5/10/20 三個視窗，冷算要數十秒。
   */
  const [trustWindow, setTrustWindow] = useState<TrustWindow>(DEFAULT_TRUST_WINDOW)

  const monthTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* --------------------------- 資料抓取 --------------------------- */

  const fetchData = async (m?: string) => {
    setLoading(true)
    setError(false)
    try {
      const qs = new URLSearchParams({ v: API_VERSION })
      if (m) qs.set('month', m)
      const res = await fetch(`/api/strong-monthly?${qs}`)
      if (!res.ok) throw new Error('http')
      const json: MonthlyResponse = await res.json()
      setData(json)
      // API 對不在白名單的月份是「靜默退回最新月」，所以一律以回應的 month 為準
      setMonth(json.month || '')
    } catch (e) {
      console.error('Failed to fetch monthly strong report:', e)
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // 還原視圖狀態（sessionStorage）→ 從個股頁返回時保留
  useEffect(() => {
    let savedMonth: string | undefined
    try {
      for (const k of LEGACY_STORAGE_KEYS) sessionStorage.removeItem(k)
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const f = JSON.parse(raw)
        if (typeof f.month === 'string' && /^\d{4}-\d{2}$/.test(f.month)) {
          savedMonth = f.month
          setMonth(f.month)
        }
        // 驗證 key 仍存在於現行 registry：否則日後改欄名，舊 storage 會讓比較器拿到 undefined
        if (
          f.sort &&
          typeof f.sort.key === 'string' &&
          COL_KEY_SET.has(f.sort.key) &&
          (f.sort.dir === 'asc' || f.sort.dir === 'desc')
        ) {
          setSort({ key: f.sort.key as MKey, dir: f.sort.dir })
        }
        if (f.trustWindow !== undefined) setTrustWindow(parseTrustWindow(f.trustWindow))
        if (typeof f.query === 'string') {
          setQuery(f.query)
          setDebouncedQuery(f.query.trim().toLowerCase())
        }
        if (typeof f.industry === 'string') setIndustry(f.industry)
        if (typeof f.minDays === 'number') setMinDays(f.minDays)
      }
    } catch {}
    // setState 是非同步的，fetch 讀不到剛 set 的 state → 把 savedMonth 當參數直接傳進去
    fetchData(savedMonth)
    setReady(true)
    return () => {
      if (monthTimer.current) clearTimeout(monthTimer.current)
    }
  }, []) // 僅在掛載時還原一次（與 /strong-stocks、/screener 的 ready 閘門模式一致）

  useEffect(() => {
    if (!ready) return
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ month, sort, query, industry, minDays, trustWindow }))
    } catch {}
  }, [ready, month, sort, query, industry, minDays, trustWindow])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [query])

  // 換月份：先切骨架讓使用者看到反應，再 debounce 400ms 發請求（冷算要數十秒，快速來回切換很貴）
  const handleMonthChange = (m: string) => {
    setMonth(m)
    setLoading(true)
    setError(false)
    if (monthTimer.current) clearTimeout(monthTimer.current)
    monthTimer.current = setTimeout(() => fetchData(m), 400)
  }

  /* --------------------------- 衍生狀態 --------------------------- */

  const COLUMNS = useMemo(() => makeColumns(trustWindow), [trustWindow])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const availableMonths = data?.availableMonths ?? []
  const baseDate = data?.baseDate ?? null
  /** 基準日的說法：本月＝最新一天；過完的月份＝月底那天 */
  const baseLabel = baseDate
    ? `${fmtMd(baseDate)}（${baseDate === data?.latestDate ? '最新交易日' : '當月最後一個交易日'}）`
    : null

  const industries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.industry).filter(Boolean) as string[])).sort(),
    [rows]
  )

  // 不能排序的欄（待定義、MACD）不可當排序鍵（sortValue 沒有意義）
  const effectiveSort = useMemo(
    () => (COLUMNS[sort.key]?.sortable ? sort : DEFAULT_SORT),
    [COLUMNS, sort]
  )

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (industry !== 'all' && r.industry !== industry) return false
      if (minDays > 0 && r.strongDays.length < minDays) return false
      if (debouncedQuery) {
        const idHit = r.stockId.toLowerCase().startsWith(debouncedQuery)
        const nameHit = (r.stockName || '').toLowerCase().includes(debouncedQuery)
        if (!idHit && !nameHit) return false
      }
      return true
    })
  }, [rows, industry, minDays, debouncedQuery])

  const sortedRows = useMemo(() => {
    const col = COLUMNS[effectiveSort.key] ?? COLUMNS.stock
    return [...filteredRows].sort((a, b) => {
      const c = compareNullLast(col.sortValue(a), col.sortValue(b), effectiveSort.dir)
      if (c !== 0) return c
      return a.stockId.localeCompare(b.stockId) // 同值時穩定排序
    })
  }, [COLUMNS, filteredRows, effectiveSort])

  const nullCount = useMemo(() => {
    const col = COLUMNS[effectiveSort.key] ?? COLUMNS.stock
    return sortedRows.filter((r) => col.sortValue(r) == null).length
  }, [COLUMNS, sortedRows, effectiveSort.key])

  const sortName = (k: MKey) => {
    const g = GROUP_OF.get(k)
    return g ? `${g.label}・${COLUMNS[k].header}` : COLUMNS[k].header
  }
  const sortSummary =
    effectiveSort.key === 'stock' && effectiveSort.dir === 'asc'
      ? '依股票代號排序（同 Word）'
      : `依「${sortName(effectiveSort.key)}」${effectiveSort.dir === 'desc' ? '由大到小' : '由小到大'}排序${
          nullCount > 0 ? `，${nullCount} 檔無資料排在最後` : ''
        }`

  /** 投信累計視窗被截短的列數（多為新掛牌、交易稀少，或撞到明細資料起點 2026-07-24） */
  const trustShortCount = useMemo(
    () => rows.filter((r) => isTrustShort(r.trustNet?.[trustWindow])).length,
    [rows, trustWindow]
  )

  /** 「說明」裡的資料提醒：有幾則就在按鈕上寫幾則，業主不點開也知道這個月有狀況 */
  const notices: string[] = []
  if (data?.partialMonth)
    notices.push('每日明細自 2026-07-24 起才有，這個月有些股票的 5／10 日均價天數不夠，顯示「—」。不會拿較少天數的平均充數。')
  if (trustShortCount > 0)
    notices.push(`有 ${trustShortCount} 檔的投信累計不足 ${trustWindow} 個交易日（多半是新上市或交易很少的股票），數字下方會標「⚠ 只有 N 日」，缺的天數不會當成 0。`)
  if (data?.foreignHoldUnavailable && rows.length > 0)
    notices.push('這個月「外資」整欄沒有資料：外資持股張數自 2026-09-01 起才開始收集。')

  // 只有兩態（第一次點：代號／日期由小到大，其他由大到小；再點反轉）
  const toggleSort = (key: MKey) => {
    if (!COLUMNS[key].sortable) return
    setSort(
      effectiveSort.key === key
        ? { key, dir: effectiveSort.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'stock' || key === 'firstDate' ? 'asc' : 'desc' }
    )
  }

  /* --------------------------- 表格片段 --------------------------- */

  /**
   * 一格表頭。row1＝第一層（不屬於群組的欄 rowSpan 2、群組名稱 colSpan），row2＝群組底下的欄。
   * sticky 掛在 <th>：top 是相對 TableScroll（開了 overflow-y），不是相對視窗。
   * 容器有 [contain:paint]（獨立的 stacking context），這裡的 z 不會與 TopBar 打架。
   */
  const renderTh = (key: MKey, level: 1 | 2) => {
    const col = COLUMNS[key]
    const active = effectiveSort.key === key
    const top = level === 1 ? 'top-0' : ''
    return (
      <th
        key={key}
        scope="col"
        rowSpan={level === 1 ? 2 : undefined}
        aria-sort={col.sortable ? (active ? (effectiveSort.dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
        style={level === 2 ? { top: HEAD1_H } : undefined}
        className={`sticky ${top} z-20 ${STICKY_TH[key] ?? ''} bg-white px-2 py-1 ${alignClass(
          col.align === 'left' && key !== 'stock' ? 'left' : 'center'
        )} align-middle text-base font-medium text-gray-900 border-b-2 border-gray-500`}
      >
        {col.sortable ? (
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className={`w-full min-h-[44px] flex items-center gap-1 ${justifyClass(
              key === 'stock' ? 'left' : 'center'
            )} rounded hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            {/* 排序箭頭跟欄名在同一行、第二行只放小字：箭頭放在兩行旁邊會多吃 16px，逼得小字折成三行 */}
            <span className="flex flex-col items-center leading-tight whitespace-nowrap">
              <span>
                {col.header}
                <span aria-hidden="true" className={`ml-1 text-xs ${active ? 'text-blue-700' : 'text-gray-500'}`}>
                  {active ? (effectiveSort.dir === 'desc' ? '▼' : '▲') : '⇅'}
                </span>
              </span>
              {col.subHeader && <span className="text-sm font-normal text-gray-700">{col.subHeader}</span>}
            </span>
            <span className="sr-only">
              {active
                ? effectiveSort.dir === 'desc'
                  ? '，目前由大到小排序，按下改為由小到大'
                  : '，目前由小到大排序，按下改為由大到小'
                : '，按下以此欄排序'}
            </span>
          </button>
        ) : (
          <span className="inline-flex items-center min-h-[44px]">{col.header}</span>
        )}
      </th>
    )
  }

  const captionText = `${wordTitle(month)}，共 ${sortedRows.length} 檔${baseLabel ? `，數字為 ${baseLabel}` : ''}`

  const table = (
    // ⚠️ border-separate（不是 collapse）：collapse 下格線屬於表格、不屬於儲存格，
    // sticky 的商品欄一黏住就把底下的格線蓋掉（實測手機每 5 列那條粗線在商品欄斷掉）。
    // separate 時每格畫自己的 border-b，格線跟著 sticky 格一起走。
    <table className="table-fixed border-separate border-spacing-0" style={{ minWidth: TOTAL_W, width: TOTAL_W }}>
      <caption className="sr-only">{captionText}</caption>
      <colgroup>
        {COL_ORDER.map((k) => (
          <col key={k} style={{ width: COL_W[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COL_ORDER.map((k) => {
            const g = GROUP_OF.get(k)
            if (!g) return renderTh(k, 1)
            if (g.keys[0] !== k) return null
            return (
              <th
                key={g.label}
                scope="colgroup"
                colSpan={g.keys.length}
                style={{ height: HEAD1_H }}
                className="sticky top-0 z-20 bg-white px-2 text-center align-middle text-base font-medium text-gray-900 border-b border-gray-300"
              >
                {g.label}
              </th>
            )
          })}
        </tr>
        <tr>
          {COL_ORDER.filter((k) => GROUP_OF.has(k)).map((k) => renderTh(k, 2))}
        </tr>
      </thead>
      {/* 列與列之間細線、每 5 列加粗一條做視線導引（Word 沒有格線，但 700 列不畫線很難追行）。
          刻意不做斑馬紋：gray-50 底會把 green-700 壓到 4.74、hover 就沒得再深。 */}
      <tbody>
        {sortedRows.map((r) => (
          <tr
            key={r.stockId}
            className="group hover:bg-gray-50 focus-within:bg-gray-50 [&:nth-child(5n)>td]:border-b-2 [&:nth-child(5n)>td]:border-gray-400"
          >
            {COL_ORDER.map((k) => (
              <td
                key={k}
                className={`px-2 py-2 align-middle border-b border-gray-200 ${alignClass(COLUMNS[k].align)} text-base tabular-nums ${
                  k === 'strongDays' || k === 'stock' ? '' : 'whitespace-nowrap'
                } ${STICKY_TD[k] ?? ''}`}
              >
                {COLUMNS[k].render(r, undefined)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  /* ------------------------------ 畫面 ------------------------------ */

  const noMonth = !!data && data.availableMonths.length === 0
  const monthMissing = !!data && data.dataMissing
  const shownMonth = month || data?.month || ''

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 容器與 PageHeader 必須同寬，否則標題會跟表格左緣差一大截 */}
      <PageHeader
        title={wordTitleNode(shownMonth)}
        maxWidth="max-w-[1560px]"
        subtitle={
          data?.coverage ? (
            <>
              本月曾經強勢的股票共 <strong className="tabular-nums">{rows.length}</strong> 檔
              {baseLabel && (
                <>
                  ｜<span className="inline-block">數字為 <strong>{baseLabel}</strong></span>
                </>
              )}
            </>
          ) : undefined
        }
      />

      <div className="max-w-[1560px] mx-auto px-4 py-4">
        {/* 篩選卡（恆常渲染：換月份時不可以整塊消失再長回來） */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-3">
          <div className="flex flex-wrap gap-x-4 gap-y-3 items-center">
            {availableMonths.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="month-select" className="text-gray-700 text-sm shrink-0">月份</label>
                <select
                  id="month-select"
                  value={month}
                  onChange={(e) => handleMonthChange(e.target.value)}
                  className={SELECT}
                >
                  {availableMonths.map((m) => (
                    <option key={m} value={m}>{monthLabel(m)}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label htmlFor="monthly-search" className="text-gray-700 text-sm shrink-0">搜尋</label>
              <input
                id="monthly-search"
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="代號或名稱"
                className={`${SELECT} w-full sm:w-44`}
              />
            </div>

            {industries.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="monthly-industry" className="text-gray-700 text-sm">產業</label>
                <select
                  id="monthly-industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className={`${SELECT} max-w-[18ch]`}
                >
                  <option value="all">全部產業</option>
                  {industries.map((ind) => (
                    <option key={ind} value={ind}>{ind}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ⚠️ 這是「檢視輔助」，不是業主的篩選條件——預設不限 */}
            <div className="flex items-center gap-2">
              <label htmlFor="monthly-mindays" className="text-gray-700 text-sm">強勢天數</label>
              <select
                id="monthly-mindays"
                value={minDays}
                onChange={(e) => setMinDays(parseInt(e.target.value, 10) || 0)}
                className={SELECT}
              >
                <option value="0">不限</option>
                <option value="2">2 天以上</option>
                <option value="3">3 天以上</option>
                <option value="5">5 天以上</option>
              </select>
            </div>

            {/* 投信累計視窗：切換不重新請求（API 一次回傳 5/10/20）
                ⚠️ min-w-0 + max-w 不可省：select 的固有寬度來自最長選項，不收縮就會把整頁撐出橫捲
                （實測 375px 溢出 37px）。改動後請用 documentElement.scrollWidth === clientWidth 重量。 */}
            <div className="flex items-center gap-2 min-w-0">
              <label htmlFor="monthly-trustwindow" className="text-gray-700 text-sm shrink-0">
                投信累計
              </label>
              <select
                id="monthly-trustwindow"
                value={trustWindow}
                onChange={(e) => setTrustWindow(parseTrustWindow(e.target.value))}
                className={`${SELECT} min-w-0 max-w-[15ch]`}
              >
                {TRUST_WINDOWS.map((n) => (
                  <option key={n} value={n}>近 {n} 個交易日</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* 業主選「說明收成一個按鈕」：所有說明（含資料提醒）都在這裡，按了才展開。
            ⚠️ 放在 TableScroll 之外：InfoTip／details 的內容不可被 [contain:paint] 裁切 */}
        <details className="bg-white rounded-lg shadow-sm mb-3">
          <summary className="min-h-[48px] flex flex-wrap items-center gap-x-2 px-4 text-base font-medium text-gray-900 cursor-pointer">
            <span>📖 說明</span>
            <span className="text-sm font-normal text-gray-700">（欄位、紅字、和 Word 的差別）</span>
            {notices.length > 0 && (
              <span className="text-sm font-medium text-amber-800">⚠ 本月有 {notices.length} 則資料提醒</span>
            )}
          </summary>
          <div className="px-4 pb-4 space-y-4 text-base text-gray-800">
            {notices.length > 0 && (
              <section>
                <h2 className="font-bold text-amber-900 mb-1">本月的資料提醒</h2>
                <ul className="list-disc pl-5 space-y-1">
                  {notices.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </section>
            )}
            <section>
              <h2 className="font-bold text-gray-900 mb-1">這張表怎麼來的</h2>
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  列出<strong>本月曾經成為網站強勢股</strong>的每一檔，一檔一列，依代號排序。
                  網站的強勢條件是四條同時成立：成交量 &gt; 500 張、漲幅 &gt; 3%（跟前一天收盤比）、
                  收盤價 &gt; 開盤價、三大法人合計買超 &gt; 0 張。
                </li>
                <li>
                  {MANUAL_REPORT_COUNT[shownMonth] !== undefined
                    ? `你的 Word 本月是自己挑的 ${MANUAL_REPORT_COUNT[shownMonth]} 列，網站沒有你的挑法，所以會多很多檔；可以用上面的搜尋、產業、強勢天數縮小範圍。`
                    : '網站不會替你挑股票，檔數會比手做的 Word 多；可以用上面的搜尋、產業、強勢天數縮小範圍。'}
                </li>
                <li>
                  <strong>數字全部是同一天的</strong>：{baseLabel ?? '最新一個交易日'}。
                  Word 是你抄寫那天的數字，網站改用最新的一天；月份過完以後就是月底那天。
                  「日期」欄則是這一檔本月第一次強勢的日子。
                </li>
                <li>
                  <strong className="text-red-700">紅字收盤價＋「漲停」</strong>＝那天收在漲停價（跟 Word 的紅字一樣，只標收盤價）。
                </li>
                <li>
                  <span aria-hidden="true">{DASH}</span>
                  <span className="sr-only">破折號</span>
                  是這一檔沒有這筆資料，<strong>不是 0</strong>；
                  <span className="mx-1 inline-flex items-center px-2 rounded border border-dashed border-amber-400 bg-amber-50 text-sm text-amber-900">待定義</span>
                  是整欄還在等你提供判斷方式（KD、均線）。
                </li>
              </ul>
            </section>
            <section>
              <h2 className="font-bold text-gray-900 mb-1">每一欄</h2>
              <dl className="grid md:grid-cols-2 gap-x-8 gap-y-2">
                {COL_ORDER.map((k) => (
                  <div key={k} className="min-w-0">
                    <dt className="font-medium text-gray-900">{COLUMNS[k].fullName}</dt>
                    <dd className="text-gray-700">{COLUMNS[k].desc}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </details>

        {/* 統計列 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-sm" aria-live="polite">
          <span className="text-gray-700">
            顯示 <span className="font-bold text-gray-900 tabular-nums">{sortedRows.length}</span> 檔 ／ 本月{' '}
            <span className="font-medium text-gray-900 tabular-nums">{rows.length}</span> 檔
          </span>
          <span className="text-gray-700">{sortSummary}</span>
        </div>

        {/* 結果區：篩選列與說明區恆常渲染，只有這裡換 */}
        {loading ? (
          <>
            <p className="mb-2 text-sm text-gray-700" role="status">
              正在彙整整月資料（首次產生可能要數十秒）…
            </p>
            <TableSkeleton rows={14} cols={COL_ORDER.length} />
          </>
        ) : error ? (
          <ErrorState message="無法取得強勢月報資料" onRetry={() => fetchData(month || undefined)} />
        ) : noMonth ? (
          <EmptyState icon="📅" title="尚無可用月份" description="資料尚未收集完成，請稍後再試" />
        ) : monthMissing ? (
          <EmptyState
            icon="📅"
            title="此月份沒有明細資料"
            description="收盤價、成交量與均價都來自每日明細，目前最早只到 2026-07-24。請改選其他月份。"
          />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={rows.length === 0 ? '📅' : '🔍'}
            title={rows.length === 0 ? '本月尚無強勢股' : '沒有符合條件的股票'}
            description={rows.length === 0 ? '本月還沒有股票符合強勢股條件' : '試著放寬搜尋、產業或強勢天數'}
          />
        ) : (
          // 業主選「手機也照 Word 表格」：所有寬度都是同一張表，左右滑看其他欄
          <div className="bg-white rounded-lg shadow-sm">
            <p className="px-3 py-2 text-sm text-gray-700 border-b border-gray-200">
              <span className="inline-block">
                <span aria-hidden="true">← </span>左右滑動看全部 12 欄<span aria-hidden="true"> →</span>
              </span>
              <span className="inline-block">（表頭和商品欄固定）</span>
            </p>
            <TableScroll label={`${wordTitle(shownMonth)}表格，可左右與上下捲動`} maxHeight="75vh">
              {table}
            </TableScroll>
          </div>
        )}
      </div>
    </div>
  )
}
