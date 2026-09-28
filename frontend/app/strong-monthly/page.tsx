'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, TableSkeleton, EmptyState, ErrorState } from '../../components/states'
import InfoTip from '../../components/InfoTip'
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
  trustWindowLabel,
  type TrustWindow,
} from '../../lib/format'
// ⚠️ 只能 import type：lib/monthly-report 會 import firebase-admin，
// 一旦從它取用執行期的值，client bundle 就會把 Admin SDK 拉進來（建置直接失敗）。
// 因此 TRUST_WINDOWS 等常數放在 lib/format.ts（純函式，server/client 共用）。
import type { MonthlyReportRow } from '../../lib/monthly-report'

/* ------------------------------------------------------------------ *
 * 強勢月報（取代業主每月手工維護的 Word《強勢商品篩選》）
 *
 * 版面核心取捨，與 /strong-table 刻意相反：
 * 總表的價值是「同一天多檔比較，欄位可任意取捨」，所以它把 20 欄拆成分組 tab。
 * 月報的價值是「一張與 Word 同構的 12 欄表」——拆 tab 會毀掉可對照性，
 * 所以 12 欄全上、日期與商品兩欄釘在左側、橫向與縱向捲動**全部關在表格自己的容器裡**。
 *
 * ⚠️ 絕不可讓溢出落到根捲動區：Sidebar 是 fixed left-0，整頁橫捲會讓它蓋住第一欄
 * （總表上週踩過，實測 768px 溢出 345px）。容器同時開縱向捲動，換來的好處是
 * 表頭可以用「相對捲動容器」的 sticky top-0 固定住——631 列的表沒有固定表頭是不能用的。
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
  coverage: { from: string; to: string; tradingDays: number } | null
  partialMonth: boolean
  foreignHoldUnavailable: boolean
  dataMissing: boolean
  requestedMonth: string | null
  count: number
}

/** 業主人工月報 2026-09 的筆數，用來讓頁面誠實揭露「自動產生 vs 手工」的落差 */
// 人工 Word 月報的筆數，**逐月**記錄：82 是 2026-09 那一份的數字。
// 沒有對照資料的月份不可沿用（原本無條件印 82，切到 8/7 月會憑空斷言一個不存在的事實）。
const MANUAL_REPORT_COUNT: Record<string, number> = { '2026-09': 82 }

interface Ctx {
  /** 手機摘要列：省略次要的第二行 */
  compact: boolean
}

type MKey =
  | 'firstDate' | 'stock' | 'close' | 'volume'
  | 'foreignHold' | 'trustNet' | 'ma5' | 'ma10'
  | 'macd' | 'kd' | 'maPattern' | 'strongDays'

/* ----------------------------- 儲存格 ----------------------------- */

/** YYYY-MM-DD → MM/DD（月份已由報表標題決定，欄內不重複月份年份） */
const fmtMd = (d: string) => (d.length >= 10 ? `${d.slice(5, 7)}/${d.slice(8, 10)}` : d)

const numCell = (v: number | null, digits = 0, cls = 'text-gray-900') =>
  v == null ? <NullCell /> : <span className={cls}>{fmtNum(v, digits)}</span>

/* ------------------------------ 欄位 registry ------------------------------ *
 * 順序＝業主 Word 月報的 12 欄順序，不可重排。
 * fullName 同時服務「欄位說明」區與手機展開列；desc 寫定義與缺值語意。
 *
 * ⚠️ 2026-09-28 從 const 改成工廠函式：籌碼(投信) 欄的視窗（近 5/10/20 日）可切換，
 * 而 header / subHeader / fullName / desc 都必須跟著變——否則使用者換成 5 日，
 * 表頭卻還寫 20 日，等於把錯的語意釘在畫面上。單一定義來源的原則不變，
 * 只是這個來源現在吃一個參數。
 * ------------------------------------------------------------------------- */

const makeColumns = (tw: TrustWindow): Record<MKey, ColDef<MonthlyReportRow, Ctx>> => ({
  firstDate: {
    header: '日期',
    fullName: '日期（當月第一次入選強勢股的日子）',
    align: 'left',
    sortable: true,
    sortValue: (r) => r.firstDate,
    desc: '該檔在本月「第一次」被納入強勢股的交易日。⚠️ 注意這一欄與右側數值欄的基準日不同——數值一律取「最後一次強勢日」。',
    render: (r) => (
      <span className="text-gray-900" title={r.firstDate}>
        {fmtMd(r.firstDate)}
      </span>
    ),
  },
  stock: {
    header: '商品',
    fullName: '商品（股票代號與名稱）',
    align: 'left',
    sortable: true,
    sortValue: (r) => r.stockId,
    desc: '點擊可前往個股頁查看 K 線與籌碼。排序依股票代號。',
    render: (r) => (
      <Link href={`/stock/${r.stockId}`} className="block min-h-[44px] hover:text-blue-600">
        <span className="block font-medium text-gray-900 truncate" title={r.stockName || r.stockId}>
          {r.stockName || r.stockId}
        </span>
        <span className="block text-sm text-gray-700 tabular-nums">{r.stockId}</span>
      </Link>
    ),
  },
  close: {
    header: '收盤價',
    fullName: '收盤價（元，取最後一次強勢日）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.close,
    desc: '業主已確認，且是本表唯一有實證的基準日規則：收盤價取「最後一次強勢日」當天的收盤。驗證方式是取人工月報中「當月入選超過一天」因而可分辨的 23 筆，逐日比對收盤價——23/23 吻合最後一次、0/23 吻合第一次。（只入選一天的列 first＝last，無法用來分辨，故不計入分母。）',
    render: (r, ctx) => (
      <>
        {numCell(r.close, 2, 'font-medium text-gray-900')}
        {!ctx.compact && (
          <span className="block text-xs font-normal text-gray-700" title={`基準日 ${r.lastDate}`}>
            {fmtMd(r.lastDate)}
          </span>
        )}
      </>
    ),
  },
  volume: {
    header: '成交量',
    fullName: '成交量（張，取最後一次強勢日）',
    align: 'right',
    sortable: true,
    sortValue: (r) => r.volume,
    desc: '⚠️ 基準日未確認。本表取「最後一次強勢日」，但與人工月報逐列對帳的結果是：可比的 13 筆中，吻合最後一次只有 1 筆、吻合第一次 6 筆、吻合 2026-09-21（與入選日無關的某一天）6 筆。人工月報這一欄看起來是「填表當天的快照」而非某個固定規則。此欄的 0 是真的 0，不是缺資料。',
    render: (r) => numCell(r.volume),
  },
  foreignHold: {
    header: '籌碼(外資)',
    fullName: '籌碼(外資)：外資累積持股張數（取最後一次強勢日）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.foreignHoldShares,
    desc: '外資官方申報的累積持股張數（不是買賣超累加）。▲ 較前一個交易日增加、▽ 減少。⚠️ 業主月報寫的是「較前次」，但未確認「前次」是前一交易日還是該檔上一個強勢日（實測 45.5% 的檔當月只入選 1 天，月內沒有前次可比），目前一律以「前一交易日」為基準；另外業主記法只有增／減兩種，實測日間有 9.6% 真的持平，本表誠實顯示「持平」。FinMind 未涵蓋此股（約 15%，多為上櫃／新掛牌）時顯示「—」，不是 0。',
    render: (r, ctx) => {
      if (r.foreignHoldShares == null) return <NullCell />
      const dir = r.foreignHoldDir
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▽' : null
      // 漲紅跌綠；跌用 green-700（green-600 白底只有 3.22 對比、不過 AA）
      const cls = dir === 'up' ? 'text-red-600' : dir === 'down' ? 'text-green-700' : 'text-gray-900'
      return (
        <span className={cls}>
          {arrow && <span aria-hidden="true">{arrow} </span>}
          {fmtNum(r.foreignHoldShares)}
          <span className="sr-only">
            {dir === 'up' ? '，較前一交易日增加' : dir === 'down' ? '，較前一交易日減少' : ''}
          </span>
          {!ctx.compact && (
            <span className="block text-xs font-normal text-gray-700">
              {dir === 'flat'
                ? '持平'
                : dir == null
                  ? <span title="沒有前一交易日的外資持股可比較">無可比基準</span>
                  : `前次 ${fmtNum(r.foreignHoldPrev)}`}
            </span>
          )}
        </span>
      )
    },
  },
  /**
   * ⚠️ 語意警告（本欄與業主月報不同，是全表最容易被誤讀的一欄）
   *
   * 業主月報這一欄原本是「投信累積持股張數」（存量），但那個數字沒有可靠來源
   * （理由與實測漂移數字見 lib/format.ts 的 TRUST_WINDOWS 註解）。
   * 本欄改成 100% 準確的「近 N 個交易日買賣超**累計**」（流量）。
   *
   * 因此表頭（header + subHeader）、fullName、desc、螢幕報讀文字**四處都要寫明「累計」
   * 與期間**，並且都要出現「不是持股」這句話。不要為了排版把哪一處簡化成「投信」兩個字。
   */
  trustNet: {
    header: '投信買賣超累計',
    subHeader: trustWindowLabel(tw),
    fullName: `籌碼(投信)：近 ${tw} 個交易日投信買賣超累計（張，期間內買進−賣出的淨額，不是持股張數）`,
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.trustNet?.[tw]?.sum ?? null,
    desc: `近 ${tw} 個交易日（含基準日本身，基準日＝該檔當月最後一次強勢日）投信買賣超的累計張數：期間內每天「買進−賣出」相加。⚠️ 這是一段期間的流量，不是手上持有多少張——業主月報原本那一欄是「累積持股張數」，但 FinMind 105 個資料集只有外資有逐檔官方持股申報（外資有投資上限須申報，投信沒有），投信投顧公會月報只揭露每檔基金前十大持股（加總只得下限），而「錨點＋每日買賣超累加」的推估實測會嚴重漂移（宏齊一個月 −43%、友達半年 −34%），故改用這個語意明確且 100% 準確的指標。視窗可在上方切換 5／10／20 日。正值（買超）紅、負值（賣超）綠，0 是真的 0（期間淨額為零）。只有「期間內完全沒有任何一天明細」才顯示「—」；期間內若有幾天沒有該檔明細（新掛牌或交易稀少的個股），或往前撞到明細資料起點，會標示「資料不足 ${tw} 日，實際 M 日」，缺的天數不會被當成 0 混進累計，也不會默默少算。`,
    render: (r, ctx) => {
      const t = r.trustNet?.[tw]
      // days === 0：這一檔在整段期間內連一天明細都沒有 → 真的無資料
      if (!t || t.sum == null) {
        return <NullCell title={`此檔在基準日往前 ${tw} 個交易日內沒有任何一天的明細資料`} />
      }
      const short = isTrustShort(t)
      return (
        <span className={signColor(t.sum)}>
          {fmtSigned(t.sum)}
          <span className="sr-only">
            張，近 {tw} 個交易日投信買賣超累計
            {t.sum > 0 ? '（買超）' : t.sum < 0 ? '（賣超）' : '（淨額為零）'}
            {short ? `，資料不足 ${tw} 日，實際只用了 ${t.days} 個交易日` : ''}
          </span>
          {short ? (
            // 截短一定要看得見（手機摘要列也不例外），否則就是默默少算
            <span
              className="block text-xs font-normal text-amber-800"
              title={`實際只累加到 ${t.from} ~ ${t.to} 之間有明細的 ${t.days} 個交易日（該檔在這段期間內有幾天沒有明細，或往前撞到明細資料起點 2026-07-24）。缺的天數不會被當成 0 混進累計。`}
            >
              ⚠ 資料不足 {tw} 日，實際 {t.days} 日
            </span>
          ) : (
            !ctx.compact && (
              <span className="block text-xs font-normal text-gray-700">
                {t.from ? `${fmtMd(t.from)}–${fmtMd(t.to)} 共 ${t.days} 日` : `共 ${t.days} 日`}
              </span>
            )
          )}
        </span>
      )
    },
  },
  ma5: {
    header: '5日均價',
    fullName: '5 日均價 MA5（元，以最後一次強勢日為基準）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.ma5,
    desc: '⚠️ 基準日未確認。本表取「最後一次強勢日」往前含當日共 5 個交易日的收盤均價，但人工月報實測為：吻合最後一次 2 筆、第一次 11 筆、2026-09-21 共 9 筆——看起來是填表當天的快照。期間內只要有一天沒有明細就回「—」，絕不用較少天數的平均充數。',
    render: (r) => numCell(r.ma5, 2),
  },
  ma10: {
    header: '10日均價',
    fullName: '10 日均價 MA10（元，以最後一次強勢日為基準）',
    align: 'right',
    sortable: true,
    nullable: true,
    sortValue: (r) => r.ma10,
    desc: '⚠️ 基準日未確認。本表取「最後一次強勢日」往前含當日共 10 個交易日的收盤均價，但人工月報實測為：吻合最後一次 2 筆、第一次 11 筆、2026-09-21 共 10 筆。期間內只要有一天沒有明細就回「—」。',
    render: (r) => numCell(r.ma10, 2),
  },
  macd: {
    header: 'MACD',
    fullName: 'MACD 狀態（多／空）【記法待確認】',
    align: 'center',
    sortable: false,
    sortValue: (r) => r.macdStatus,
    desc: '【記法待確認】目前顯示收集器算好的 MACD 柱狀體方向：「多」為柱體正、「空」為負，與強勢股總表同一來源。⚠️ 業主月報用的是「+↗ / –↗ / ↗」記法（疑似同時表達柱體正負與方向），對應規則尚未確認，因此此欄不排序。',
    render: (r) => {
      const m = r.macdStatus
      if (!m) return <NullCell />
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
    fullName: 'KD【待定義】',
    align: 'center',
    sortable: false,
    tbd: true,
    sortValue: () => null,
    desc: '【待定義】業主月報用「+↗ / –↗ / ↗」記法，判定規則尚未提供。技術上 KD 算得出來，但它是遞迴平滑、對起算點極敏感——實測同一天用 45 天資料算 vs 用 12 天算，某檔 D 值 77.31 → 62.82，超買超賣判讀完全相反。所以正確做法是比照 MACD 由收集器用完整歷史算好再寫入，不在此頁用短視窗現算。',
    render: () => <TbdCell reason="業主的 KD 記法（+↗ / –↗ / ↗）尚未定義；短視窗現算會失真，需由收集器以完整歷史計算" />,
  },
  maPattern: {
    header: '均線',
    fullName: '均線型態（四海遊龍／三陽開泰／糾結）【待定義】',
    align: 'center',
    sortable: false,
    tbd: true,
    sortValue: () => null,
    desc: '【待定義】業主自創的三種分類，判定條件（看哪幾條均線、要間隔多少才算不糾結、用當日還是一段期間）尚未提供。保留欄位待補。',
    render: () => <TbdCell reason="「四海遊龍／三陽開泰／糾結」的判定條件業主尚未提供" />,
  },
  strongDays: {
    header: '當月強勢日期',
    fullName: '當月強勢日期（該檔本月所有入選日的「日」）',
    align: 'left',
    sortable: true,
    sortValue: (r) => r.strongDays.length,
    desc: '本月每一次入選強勢股的日期，只列「日」（例：9 月 4 日與 10 日入選 → 4, 10）。排序依入選天數多寡。',
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

/** 給 sessionStorage 還原時驗證排序鍵：不可用 COLUMNS（那是 render 期才建的） */
const COL_KEY_SET = new Set<string>(COL_ORDER)

/**
 * 桌機欄寬（px）。用 table-fixed + colgroup 寫死，而不是交給 auto 版面，原因有兩個：
 *  (a) 前兩欄要 sticky left，而 `left-[Npx]` 只有在欄寬確定時才對得準；
 *  (b) auto 版面會用儲存格 min-content 當表格下限，寬度無法預測。
 */
// ⚠️ trustNet 給 172px：表頭是「投信買賣超累計 / 近 20 日累計」兩行，
// 壓窄會逼得只能寫「投信」兩個字，那正是這一欄最不能發生的事（會被讀成持股）。
const COL_W: Record<MKey, number> = {
  firstDate: 92, stock: 152, close: 104, volume: 108, foreignHold: 148, trustNet: 172,
  ma5: 104, ma10: 104, macd: 92, kd: 104, maPattern: 116, strongDays: 210,
}
const TOTAL_W = COL_ORDER.reduce((s, k) => s + COL_W[k], 0)
/** 釘住左側兩欄（日期＋商品）：橫捲時仍看得到「這一列是哪一檔」 */
const STICKY_LEFT: Partial<Record<MKey, number>> = { firstDate: 0, stock: COL_W.firstDate }

/** 手機第 3 欄的候選（焦點欄 chip）。橫向捲動的是 44px 高的控制項，不是資料格。
 *  'firstDate' 放第一個：它是預設排序鍵，否則預設被按下的那顆 chip 會落在捲動區外看不到。
 *  兩個「待定義」欄不列入（點了也沒有值可比較）。 */
const MOBILE_FOCUS_KEYS: MKey[] = ['firstDate', 'volume', 'foreignHold', 'trustNet', 'ma5', 'ma10', 'strongDays']

/** 手機展開列：一次列出全部 12 欄（含兩個「待定義」欄，不可為了省空間把它們藏掉） */
const DETAIL_KEYS: MKey[] = COL_ORDER

const STORAGE_KEY = 'strong-monthly-view' // 形狀與 'strong-table-view' 不同，刻意不共用

/** 預設排序＝第一次入選日，由舊到新：與 Word 月報的閱讀順序一致 */
const DEFAULT_SORT: { key: MKey; dir: 'asc' | 'desc' } = { key: 'firstDate', dir: 'asc' }

const monthLabel = (m: string) => (m.length === 7 ? `${m.slice(0, 4)} 年 ${Number(m.slice(5, 7))} 月` : m)

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
   * ⚠️ 切換**不重新請求**：API 一次回傳 5/10/20 三個視窗（同一份已載入的日資料算出來），
   * 冷算要數十秒，讓使用者為了換視窗再等一輪是不可接受的。
   */
  const [trustWindow, setTrustWindow] = useState<TrustWindow>(DEFAULT_TRUST_WINDOW)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const monthTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* --------------------------- 資料抓取 --------------------------- */

  const fetchData = async (m?: string) => {
    setLoading(true)
    setError(false)
    try {
      const url = m ? `/api/strong-monthly?month=${encodeURIComponent(m)}` : '/api/strong-monthly'
      const res = await fetch(url)
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
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const f = JSON.parse(raw)
        if (typeof f.month === 'string' && /^\d{4}-\d{2}$/.test(f.month)) {
          savedMonth = f.month
          setMonth(f.month)
        }
        // 驗證 key 仍存在於現行 registry：否則日後改欄名，舊 storage 會讓比較器
        // 拿到 undefined、整表看起來沒排序卻不報錯
        if (
          f.sort &&
          typeof f.sort.key === 'string' &&
          COL_KEY_SET.has(f.sort.key) &&
          (f.sort.dir === 'asc' || f.sort.dir === 'desc')
        ) {
          setSort({ key: f.sort.key as MKey, dir: f.sort.dir })
        }
        // 舊 storage 可能沒有這個欄位，或存了不合法的數字 → parseTrustWindow 一律收斂成預設 20
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
  }, []) // 僅在掛載時還原一次（與 /strong-table、/screener 的 ready 閘門模式一致）

  useEffect(() => {
    if (!ready) return
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ month, sort, query, industry, minDays, trustWindow })
      )
    } catch {}
  }, [ready, month, sort, query, industry, minDays, trustWindow])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim().toLowerCase()), 200)
    return () => clearTimeout(t)
  }, [query])

  // 換月份：先切骨架讓使用者看到反應，再 debounce 400ms 發請求。
  // 一次請求要掃約 30 個交易日（冷算實測 ~33 秒），快速來回切換非常昂貴。
  const handleMonthChange = (m: string) => {
    setMonth(m)
    setLoading(true)
    setError(false)
    if (monthTimer.current) clearTimeout(monthTimer.current)
    monthTimer.current = setTimeout(() => fetchData(m), 400)
  }

  /* --------------------------- 衍生狀態 --------------------------- */

  /** 欄位定義吃 trustWindow（投信欄的表頭／說明／排序值都要跟著視窗變） */
  const COLUMNS = useMemo(() => makeColumns(trustWindow), [trustWindow])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const availableMonths = data?.availableMonths ?? []

  const industries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.industry).filter(Boolean) as string[])).sort(),
    [rows]
  )

  // 兩個「待定義」欄不可拿來排序（sortValue 恆為 null，排了等於沒排）
  const effectiveSort = useMemo(
    () => (COLUMNS[sort.key]?.sortable ? sort : DEFAULT_SORT),
    [COLUMNS, sort]
  )

  const focusKey: MKey = MOBILE_FOCUS_KEYS.includes(effectiveSort.key) ? effectiveSort.key : 'volume'

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
    const col = COLUMNS[effectiveSort.key] ?? COLUMNS.firstDate
    // 一律複製再排：這裡是瀏覽器端的 JSON.parse 產物，但保持與總表同一習慣
    return [...filteredRows].sort((a, b) => {
      const c = compareNullLast(col.sortValue(a), col.sortValue(b), effectiveSort.dir)
      if (c !== 0) return c
      return a.stockId.localeCompare(b.stockId) // 同值時穩定排序
    })
  }, [COLUMNS, filteredRows, effectiveSort])

  const nullCount = useMemo(() => {
    const col = COLUMNS[effectiveSort.key] ?? COLUMNS.firstDate
    return sortedRows.filter((r) => col.sortValue(r) == null).length
  }, [COLUMNS, sortedRows, effectiveSort.key])

  const sortSummary = `已依「${COLUMNS[effectiveSort.key]?.fullName ?? ''}」${
    effectiveSort.dir === 'desc' ? '由大到小' : '由小到大'
  }排序，共 ${sortedRows.length} 檔${nullCount > 0 ? `，其中 ${nullCount} 檔無資料排在最後` : ''}`

  /**
   * 投信累計視窗被截短的列數（往前撞到明細資料起點）。
   * 伺服器端的日期窗已保證能覆蓋 20 日視窗，所以正常月份是 0；
   * 但最舊的月份（月初就是 daily_data 起點）仍會有列被截短 → 頁面必須說出來。
   */
  const trustShortCount = useMemo(
    () => rows.filter((r) => isTrustShort(r.trustNet?.[trustWindow])).length,
    [rows, trustWindow]
  )

  // 只有兩態（desc ⇄ asc）：多一個看不見的狀態對視力不佳者是負擔
  const toggleSort = (key: MKey) => {
    if (!COLUMNS[key].sortable) return
    setSort(
      effectiveSort.key === key
        ? { key, dir: effectiveSort.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'stock' || key === 'firstDate' ? 'asc' : 'desc' }
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

  const ctx: Ctx = { compact: false }
  const ctxCompact: Ctx = { compact: true }

  /* --------------------------- 表格片段 --------------------------- */

  const renderTh = (key: MKey) => {
    const col = COLUMNS[key]
    const active = effectiveSort.key === key
    const left = STICKY_LEFT[key]
    // sticky 掛在 <th>（不是 <thead>）：Tailwind preflight 讓 table 是 border-collapse:collapse。
    // top-0 是相對「捲動容器」（TableScroll 開了 overflow-y），不是相對視窗。
    // 容器有 [contain:paint]（獨立的 stacking context），所以這裡的 z 不會與 TopBar 的 z-30 打架。
    const stickyCls =
      left === undefined
        ? 'sticky top-0 z-10 bg-gray-50'
        : `sticky top-0 z-20 bg-gray-50`
    return (
      <th
        key={key}
        scope="col"
        aria-sort={col.sortable ? (active ? (effectiveSort.dir === 'desc' ? 'descending' : 'ascending') : 'none') : undefined}
        style={left === undefined ? undefined : { left }}
        className={`px-3 py-3 ${alignClass(col.align)} text-sm font-medium text-gray-700 whitespace-nowrap ${stickyCls}`}
      >
        {col.sortable ? (
          <button
            type="button"
            onClick={() => toggleSort(key)}
            className={`w-full min-h-[44px] lg:min-h-[36px] flex items-center gap-1 ${justifyClass(col.align)} rounded hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500`}
          >
            {/* subHeader 存在時排成兩行：參數（近 N 日累計）必須跟欄名一起看到 */}
            <span className={col.subHeader ? 'flex flex-col items-end leading-tight' : undefined}>
              <span>{col.header}</span>
              {col.subHeader && (
                <span className="text-xs font-normal text-gray-700">{col.subHeader}</span>
              )}
            </span>
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
          <span
            className="flex items-center gap-1"
            title={col.tbd ? '業主尚未提供此欄的判定規則，無法排序' : '此欄記法待確認，暫不排序'}
          >
            {col.header}
            <span aria-hidden="true" className="text-amber-700">*</span>
            <span className="sr-only">（{col.tbd ? '待定義' : '記法待確認'}，無法排序）</span>
          </span>
        )}
      </th>
    )
  }

  const captionText = `${monthLabel(month)} 強勢月報，共 ${sortedRows.length} 檔，欄位順序與人工月報一致`

  const desktopTable = (
    // table-fixed + colgroup 寫死欄寬：sticky 左欄的 left 值要對得準，就不能讓 auto 版面決定寬度
    <table className="table-fixed border-collapse" style={{ minWidth: TOTAL_W, width: TOTAL_W }}>
      <caption className="sr-only">{captionText}</caption>
      <colgroup>
        {COL_ORDER.map((k) => (
          <col key={k} style={{ width: COL_W[k] }} />
        ))}
      </colgroup>
      <thead>
        <tr>{COL_ORDER.map((k) => renderTh(k))}</tr>
      </thead>
      {/* divide-gray-200 幫助追行；每 5 列加粗做視線導引。
          刻意不做斑馬紋：gray-50 底會把 green-700 壓到 4.74、hover 就沒得再深。 */}
      <tbody className="divide-y divide-gray-200">
        {sortedRows.map((r) => (
          <tr
            key={r.stockId}
            className="group hover:bg-gray-50 focus-within:bg-gray-50 [&:nth-child(5n)]:border-b-2 [&:nth-child(5n)]:border-gray-300"
          >
            {COL_ORDER.map((k) => {
              const left = STICKY_LEFT[k]
              return (
                <td
                  key={k}
                  style={left === undefined ? undefined : { left }}
                  className={`px-3 py-3 align-top ${alignClass(COLUMNS[k].align)} tabular-nums ${
                    k === 'strongDays' ? '' : 'whitespace-nowrap'
                  } ${left === undefined ? '' : 'sticky z-10 bg-white group-hover:bg-gray-50'}`}
                >
                  {COLUMNS[k].render(r, ctx)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )

  const mobileTable = (
    // table-fixed ＋ colgroup：auto 版面會用儲存格 min-content 當表格下限，
    // 在 375px 下會把整頁撐出橫向捲動。固定欄寬才保證手機不橫捲。
    <table className="w-full table-fixed">
      <caption className="sr-only">{captionText}</caption>
      {/* ⚠️ 第 3 欄（焦點欄）要放得下最寬的數值：投信累計實測最大 "+168,836"（8 字元，
          375px 下約 90px 含左右 padding）。原本 34%/26% 只留約 98px 給第 3 欄，
          會把數字截成「+168,8…」——一個被截斷的金額比沒有還糟。改成 31%/23% 後約 120px。 */}
      <colgroup>
        <col className="w-[31%]" />
        <col className="w-[23%]" />
        <col />
        <col className="w-[48px]" />
      </colgroup>
      <thead className="bg-gray-50">
        <tr>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 rounded-tl-lg px-2 py-3 text-left text-sm font-medium text-gray-700">
            商品
          </th>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 px-2 py-3 text-right text-sm font-medium text-gray-700">
            收盤價
          </th>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 px-2 py-3 text-right text-sm font-medium text-gray-700">
            {/* 焦點欄的參數（近 N 日）在手機上同樣要看得到，不可只留「投信買賣超累計」。
                表頭允許換行（不 truncate）：欄名被截成「投信買…」等於沒說清楚是累計還是持股。 */}
            <span className="block leading-tight break-words">{COLUMNS[focusKey].header}</span>
            {COLUMNS[focusKey].subHeader && (
              <span className="block text-xs font-normal text-gray-700 leading-tight">
                {COLUMNS[focusKey].subHeader}
              </span>
            )}
          </th>
          <th scope="col" className="sticky top-[65px] z-10 bg-gray-50 rounded-tr-lg px-0 py-3 text-center">
            <span className="sr-only">展開全部欄位</span>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {sortedRows.map((r) => {
          const open = expanded.has(r.stockId)
          return (
            <Fragment key={r.stockId}>
              <tr className="hover:bg-gray-50 focus-within:bg-gray-50">
                <td className="px-2 py-3">
                  <Link href={`/stock/${r.stockId}`} className="block min-h-[44px] hover:text-blue-600">
                    <span className="block font-medium text-gray-900 truncate" title={r.stockName || r.stockId}>
                      {r.stockName || r.stockId}
                    </span>
                    <span className="block text-sm text-gray-700 tabular-nums">{r.stockId}</span>
                  </Link>
                </td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">
                  {COLUMNS.close.render(r, ctxCompact)}
                  {/* 第 3 欄就是「日期」時不重複顯示（那欄已經是同一個值） */}
                  {focusKey !== 'firstDate' && (
                    <span className="block text-sm text-gray-700">{fmtMd(r.firstDate)} 起</span>
                  )}
                </td>
                {/* overflow-hidden 保底（table-fixed 下超寬內容會溢出欄），但不加 truncate：
                    寧可讓極端值自己換行，也不要把金額切掉尾數 */}
                <td className="px-2 py-3 text-right overflow-hidden tabular-nums">
                  {COLUMNS[focusKey].render(r, ctxCompact)}
                </td>
                <td className="px-0 py-3 text-center">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`row-${r.stockId}-detail`}
                    onClick={() => toggleExpand(r.stockId)}
                    className="w-11 h-11 inline-flex items-center justify-center rounded-full text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                    <span className="sr-only">
                      {open ? `收合 ${r.stockName} 的全部欄位` : `展開 ${r.stockName} 的全部欄位`}
                    </span>
                  </button>
                </td>
              </tr>
              {open && (
                <tr id={`row-${r.stockId}-detail`} className="bg-gray-50">
                  <td colSpan={4} className="px-2 py-3">
                    <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
                      {DETAIL_KEYS.map((k) => (
                        <Fragment key={k}>
                          <dt className="text-gray-700">{COLUMNS[k].fullName}</dt>
                          <dd className="text-right tabular-nums">{COLUMNS[k].render(r, ctx)}</dd>
                        </Fragment>
                      ))}
                      <dt className="text-gray-700">產業別</dt>
                      <dd className="text-right">{r.industry || <NullCell />}</dd>
                    </dl>
                    <Link
                      href={`/stock/${r.stockId}`}
                      className="mt-3 inline-flex items-center min-h-[44px] px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
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

  const noMonth = !!data && data.availableMonths.length === 0
  const monthMissing = !!data && data.dataMissing

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 容器與 PageHeader 必須同寬，否則標題會跟表格左緣差一大截 */}
      <PageHeader
        title="強勢月報"
        maxWidth="max-w-[1560px]"
        subtitle={
          <>
            {monthLabel(month || data?.month || '')} 彙整
            {data?.coverage && (
              <>
                ｜統計至 {data.coverage.to}（本月已收集 {data.coverage.tradingDays} 個交易日）
              </>
            )}
            ｜共 {rows.length} 檔｜欄位與人工月報《強勢商品篩選》一致
          </>
        }
      />

      <div className="max-w-[1560px] mx-auto px-4 py-6">
        {/* 頁內互連：月報與「今日」兩頁的時間粒度不同，刻意不混進 strong-table 的
            「卡片檢視／表格檢視」那組膠囊（那組語意是同一份資料的兩種呈現）。 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <span
            aria-current="page"
            className="inline-flex items-center min-h-[44px] px-4 rounded-full text-sm bg-blue-600 text-white border border-blue-600"
          >
            🗓️ 當月彙整
          </span>
          <Link
            href="/strong-stocks"
            className="inline-flex items-center min-h-[44px] px-4 rounded-full text-sm bg-white text-gray-700 border border-gray-300 hover:border-blue-400 transition-colors"
          >
            今日強勢股（卡片）
          </Link>
          <Link
            href="/strong-table"
            className="inline-flex items-center min-h-[44px] px-4 rounded-full text-sm bg-white text-gray-700 border border-gray-300 hover:border-blue-400 transition-colors"
          >
            今日強勢股（總表）
          </Link>
        </div>

        {/* ⚠️ 規格落差：自動產生的母體是「當月曾入選網站強勢股」，與業主人工月報的筆數差很多。
            這不是 bug，也不該由程式自己補一個篩選條件把它壓下來——先讓業主看到差異。 */}
        {!loading && !error && rows.length > 0 && (
          <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900">
            <span aria-hidden="true">⚠️</span>
            <div>
              本表母體為「本月曾入選網站強勢股」共 <strong className="tabular-nums">{rows.length}</strong> 檔
              {MANUAL_REPORT_COUNT[month] !== undefined ? (
                <>
                  ，而人工月報本月為 <strong className="tabular-nums">{MANUAL_REPORT_COUNT[month]}</strong> 筆
                </>
              ) : (
                <>（本月沒有可對照的人工月報）</>
              )}
              ，<strong>篩選條件的差異尚待確認</strong>。
              網站現行強勢條件為：多頭排列（收盤 &gt; MA5 &gt; MA20 &gt; MA60）＋ MACD 為正 ＋ 成交量 &gt; 500 張 ＋ 外資或投信買超 &gt; 1000 張。
              <InfoTip title="為什麼筆數差這麼多">
                網站條件跑一天平均就有 72 檔入選（實測最少 23、最多 131），整月聯集自然遠大於人工月報。
                ⚠️ 但兩者<strong>不是包含關係</strong>：逐列比對 2026-09 的人工月報後發現，
                人工那 82 筆並非本表的子集，篩選邏輯本身就不同，不只是母體大小的差別。
                在業主確認條件（是否另有額外條件、是否只取每天前 N 名、Word 的 15 個表格是否為某種分組）之前，
                本頁刻意不自行加篩選，以免把「猜的定義」變成事實。
              </InfoTip>
            </div>
          </div>
        )}

        {/* ⚠️ 語意變更公告：業主月報那一欄是「持股」，本表是「買賣超累計」。
            這是全表最容易被誤讀的一點，所以獨立一塊 amber 框而不是塞進下面的 details。 */}
        {!loading && !error && rows.length > 0 && (
          <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-900">
            <span aria-hidden="true">⚠️</span>
            <div>
              「籌碼(投信)」欄已從<strong>待定義</strong>改為
              <strong>近 {trustWindow} 個交易日投信買賣超累計（張）</strong>。
              這是一段期間的<strong>流量</strong>（買進 − 賣出的淨額相加），
              <strong>不是</strong>業主月報原本那一欄的「累積持股張數」（存量），兩者不可互相對照。
              視窗可在下方「投信累計」切換（5／10／20 日，預設 20 日）。
              <InfoTip title="為什麼不做「投信累積持股張數」">
                沒有可靠來源：FinMind 全部 105 個資料集只有外資有逐檔官方持股
                （外資有投資上限須申報，投信沒有）；投信投顧公會月報只揭露「每檔基金前十大持股」
                與「季占淨值 1% 以上」，屬部分揭露，加總只得下限；商業資料商的數字本身就是推估。
                用「公會錨點＋每日買賣超累加」的漂移實測：台積電一年 +0.89%、聯電 +5.55% 還算可用，
                但宏齊<strong>一個月就 −43%</strong>、友達半年 −34%，而強勢股正好多是中小型股。
                因此改用 100% 準確、語意明確的流量指標。
              </InfoTip>
            </div>
          </div>
        )}

        {/* 兩個待定義欄位 + 兩個待確認記法：集中說明，避免業主誤以為功能壞了 */}
        <details className="mb-4 bg-white rounded-lg shadow-sm">
          <summary className="min-h-[44px] flex items-center px-4 text-sm font-medium text-amber-900 cursor-pointer">
            ⚠️ 有 2 欄「待定義」、2 欄記法待確認（點開看清單）
          </summary>
          <div className="px-4 pb-4 text-sm text-gray-700">
            <p className="mb-2">
              下列欄位<strong>保留在表上但不填值</strong>，儲存格顯示
              <span className="mx-1 inline-flex items-center px-2 rounded border border-dashed border-amber-400 bg-amber-50 text-amber-900">待定義</span>
              ，等業主補規則就能接上。與「
              <span aria-hidden="true">{DASH}</span>
              <span className="sr-only">破折號</span>
              」（這一檔沒有這筆資料）意義不同。
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>KD</strong>：業主的「+↗ / –↗ / ↗」記法未定義。另外 KD 是遞迴平滑，短視窗現算會失真（實測某檔 D 值差 14.5 點、超買超賣判讀相反），正解是由收集器用完整歷史算好。</li>
              <li><strong>均線</strong>：「四海遊龍／三陽開泰／糾結」的判定條件未提供。</li>
              <li><strong>MACD</strong>（已填值）：目前顯示收集器算好的「多／空」，但與業主的「+↗ / –↗」記法對應關係未確認，故此欄不排序。</li>
              <li><strong>籌碼(外資) 的三角形</strong>（已填值）：目前以「前一個交易日」為比較基準。業主月報寫的是「較前次」，但未說明是前一交易日還是該檔上一個強勢日；且業主記法只有增／減，實測日間有 9.6% 真的持平，本表顯示「持平」。</li>
              <li><strong>籌碼(投信)</strong>（已改為填值）：不再是「待定義」，但<strong>語意與業主月報不同</strong>——本表是「近 {trustWindow} 日買賣超累計（流量）」而非「累積持股張數（存量）」。若業主能提供持股數字的來源，這一欄可以再換回去。</li>
            </ul>
          </div>
        </details>

        {data?.partialMonth && (
          <div className="mb-4 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 text-sm text-blue-900">
            <span aria-hidden="true">ℹ️ </span>
            明細資料（收盤／成交量／均價）自 <strong>2026-07-24</strong> 起才有，本月月初的均線暖身期不足，
            部分列的 5／10 日均價會顯示「<span aria-hidden="true">{DASH}</span>
            <span className="sr-only">無資料</span>」。<strong>不會拿較少天數的平均充當 MA10。</strong>
          </div>
        )}

        {/* 投信累計視窗被截短：必須在頁面層明講有幾檔，而不是只靠每一格的小字 */}
        {!loading && !error && trustShortCount > 0 && (
          <div className="mb-4 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 text-sm text-blue-900">
            <span aria-hidden="true">ℹ️ </span>
            本月有 <strong className="tabular-nums">{trustShortCount}</strong> 檔的投信累計
            <strong>不足 {trustWindow} 個交易日</strong>：這些個股在期間內有幾天沒有明細
            （多為新掛牌或交易稀少的上櫃股），或基準日往前撞到明細資料的起點 2026-07-24。
            這些列在數字下方標示「⚠ 實際 M 日」，<strong>不會把缺的那幾天當成 0 混進累計</strong>。
            縮小視窗（近 5／10 日）通常可以取得完整視窗。
          </div>
        )}

        {data?.foreignHoldUnavailable && rows.length > 0 && (
          <div className="mb-4 bg-blue-50 border border-blue-300 rounded-lg px-4 py-3 text-sm text-blue-900">
            <span aria-hidden="true">ℹ️ </span>
            本月「籌碼(外資)」整欄無值：外資持股張數自 <strong>2026-09-01</strong> 起才開始收集，
            更早的日期連這個欄位都不存在。這與「待定義」欄位的原因不同（那是規則未定，這是資料尚未收集）。
          </div>
        )}

        {/* 篩選卡（恆常渲染：換月份時不可以整塊消失再長回來） */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
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

            {/* 投信累計視窗：切換不重新請求（API 一次回傳 5/10/20）
                ⚠️ min-w-0 + max-w 不可省：select 的固有寬度來自最長選項
                「近 20 個交易日（約一個月）」，不收縮就會把整頁撐出橫捲
                （實測 375px 溢出 37px、390px 溢出 22px），連帶 fixed 導覽錯位、
                右側 InfoTip 整顆落到畫面外點不到。改動後請用
                documentElement.scrollWidth === clientWidth 對 375/390/768 重量一次。 */}
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
                  <option key={n} value={n}>
                    近 {n} 個交易日{n === 20 ? '（約一個月）' : ''}
                  </option>
                ))}
              </select>
              <InfoTip title="這一欄是「買賣超累計」，不是「持股張數」">
                「籌碼(投信)」欄顯示的是<strong>近 N 個交易日投信買進減賣出的淨額累計（張）</strong>，
                是一段期間的<strong>流量</strong>，<strong>不是</strong>投信手上持有多少張（存量）。
                業主月報原本那一欄是「累積持股張數」，但 FinMind 只有外資有逐檔官方持股申報
                （外資有投資上限須申報，投信沒有），公會月報只揭露每檔基金前十大持股，
                而「錨點＋每日買賣超累加」的推估實測會嚴重漂移（宏齊一個月 −43%、友達半年 −34%，
                而強勢股正好多是中小型股），所以改用這個 100% 準確、語意明確的指標。
                終點與收盤價／成交量／均價同樣是該檔<strong>當月最後一次強勢日</strong>。
                視窗上限 20 日：明細資料目前只有 45 個交易日。
              </InfoTip>
            </div>

            {/* ⚠️ 這是「檢視輔助」，不是業主的篩選條件——預設不限，絕不預設成某個值
                去假裝那就是人工月報的 82 筆 */}
            <div className="flex items-center gap-2">
              <label htmlFor="monthly-mindays" className="text-gray-700 text-sm">入選天數</label>
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
              <InfoTip title="入選天數只是檢視輔助">
                用來快速縮小 {rows.length} 檔的清單，<strong>不是</strong>業主月報的篩選條件。
                業主的條件確認前，預設一律「不限」。
              </InfoTip>
            </div>
          </div>
        </div>

        {/* 手機：焦點欄 chip 列。橫向捲動的是 44px 高的控制項，不是資料格。
            兩個「待定義」欄不列入（點了也沒有值可比較）。 */}
        <div className="md:hidden mb-3">
          <div id="monthly-focus-label" className="text-sm text-gray-700 mb-1">
            比較欄位（點選即排序）
          </div>
          <div className="-mx-4 px-4 pb-1 flex gap-2 overflow-x-auto snap-x" role="group" aria-labelledby="monthly-focus-label">
            {MOBILE_FOCUS_KEYS.map((k) => {
              const on = focusKey === k
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSort(k)}
                  className={`snap-start shrink-0 px-4 min-h-[44px] rounded-full text-sm border transition-colors ${
                    on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {COLUMNS[k].header}
                  {COLUMNS[k].subHeader && (
                    <span className="text-xs"> {COLUMNS[k].subHeader}</span>
                  )}
                  {on && <span aria-hidden="true"> {effectiveSort.dir === 'desc' ? '▼' : '▲'}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* 欄位說明：刻意放在表格「上方」（任何捲動容器之外）——InfoTip 的泡泡是一般
            absolute，放進 overflow 容器會被裁切、還會把水平捲軸撐長，z-index 救不了。 */}
        <details className="bg-white rounded-lg shadow-sm mb-4">
          <summary className="min-h-[44px] flex items-center px-4 text-sm font-medium text-gray-700 cursor-pointer">
            欄位說明（12 欄的定義、單位與基準日）
          </summary>
          <div className="px-4 pb-4">
            <p className="text-sm text-gray-700 mb-3">
              ⚠️ 本表<strong>同一列有兩個基準日</strong>：「日期」欄是當月<strong>第一次</strong>入選日，
              而收盤價取當月<strong>最後一次</strong>入選日（業主已確認、23/23 實證）；成交量／籌碼／均價本表也取最後一次，但<strong>基準日尚未確認</strong>（人工月報那幾欄實測是「填表當天的快照」，多集中在 09/21、09/22）。
              其中「籌碼(投信)」是<strong>一段期間的累計</strong>（往前 {trustWindow} 個交易日），
              終點才是最後一次入選日；其餘各欄都是那一天的單日值。
              <span aria-hidden="true"> {DASH} </span>
              <span className="sr-only">破折號</span>
              表示資料來源未涵蓋此股此欄，<strong>不是 0</strong>。
            </p>
            <dl className="grid md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {COL_ORDER.map((k) => (
                <div key={k} className="flex flex-col sm:flex-row sm:gap-2">
                  <dt className="font-medium text-gray-900">{COLUMNS[k].fullName}</dt>
                  <dd className="text-gray-700">{COLUMNS[k].desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>

        {/* 統計列 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-sm" aria-live="polite">
          <span className="text-gray-700">
            篩選 <span className="font-bold text-gray-900 tabular-nums">{sortedRows.length}</span> 檔 ／ 本月{' '}
            <span className="font-medium text-gray-900 tabular-nums">{rows.length}</span> 檔
          </span>
          <span className="text-gray-700">{sortSummary}</span>
        </div>

        {/* 結果區：篩選列與說明區恆常渲染，只有這裡換 */}
        {loading ? (
          <>
            <p className="mb-2 text-sm text-gray-700" role="status">
              正在彙整整月資料（需讀取約 37 個交易日的明細，首次產生可能要數十秒）…
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
            description="收盤價、成交量與均價都來自每日明細（daily_data），目前最早只到 2026-07-24。請改選其他月份。"
          />
        ) : sortedRows.length === 0 ? (
          <EmptyState
            icon={rows.length === 0 ? '📅' : '🔍'}
            title={rows.length === 0 ? '本月尚無入選紀錄' : '沒有符合條件的商品'}
            description={rows.length === 0 ? '本月還沒有股票符合強勢股條件' : '試著放寬搜尋、產業或入選天數條件'}
          />
        ) : (
          <>
            {/* 手機：3 欄常駐 ＋ 可展開列（展開後一次列出全部 12 欄），不做橫捲資料表。
                ⚠️ 不可加 overflow-hidden：overflow 非 visible 會讓卡片變成 sticky 表頭的
                參考容器，而卡片高度＝表格高度，表頭等於完全沒黏住。 */}
            <div className="md:hidden bg-white rounded-lg shadow-sm">{mobileTable}</div>

            {/* 桌機：12 欄天生約 1400px，任何常見視窗都會溢出 →
                一律把橫向與縱向都關在表格自己的捲動容器裡（不做 xl 以上放行的斷點），
                換得的好處是表頭可以相對容器 sticky，631 列也追得到欄名。 */}
            <div className="hidden md:block bg-white rounded-lg shadow-sm">
              <p className="px-4 py-2 text-sm text-gray-700 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                ← 左右捲動查看 12 欄 →　表頭與左側「日期／商品」兩欄會固定不動。
                標「<span className="text-amber-700" aria-hidden="true">*</span>」的欄位待業主定義，無法排序。
              </p>
              <TableScroll label="強勢月報表格，可左右與上下捲動" maxHeight="72vh">
                {desktopTable}
              </TableScroll>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
