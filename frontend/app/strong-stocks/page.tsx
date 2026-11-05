'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader, TableSkeleton, CardGridSkeleton, EmptyState, ErrorState } from '../../components/states'
import InfoTip from '../../components/InfoTip'
import StockCard from '../../components/StockCard'
import { DASH } from '../../lib/format'
import { SELECT, alignClass, justifyClass, industriesOf, matchesStockQuery, normalizeQuery } from '../../lib/table'
import { useLatestRequest } from '../../lib/use-latest-request'
// 欄位定義（列型別、22 欄 registry、分組、快速篩選、排序工具）在同資料夾的 columns.tsx：沒有 state，改欄位只看那個檔
import {
  COLUMNS,
  FIXED_KEYS,
  GROUPS,
  GROUP_KEYS,
  ALL_DATA_KEYS,
  DETAIL_GROUPS,
  MOBILE_FOCUS_KEYS,
  CARD_HIDDEN_KEYS,
  QUICK_FILTERS,
  DEFAULT_SORT,
  sortRowsBy,
  sortSummaryOf,
  hasNullIn,
  type ColKey,
  type GroupKey,
  type RenderCtx,
  type SortState,
  type StrongTableResponse,
} from './columns'

/* ------------------------------------------------------------------ *
 * 強勢股（卡片／表格兩種檢視，2026-10-26 由 /strong-stocks 卡片頁與 /strong-table 總表合併）
 *
 * 兩頁原本讀同一支 /api/strong-stocks，只差呈現方式；業主要求合併成一頁、上方切換。
 * 日期、搜尋、快速篩選、MACD／成交量／產業、排序、統計列、舊日期警示由兩種檢視共用，
 * 切換不打 API、條件與順序不變。表格專屬：隱藏無資料的列、全部欄位／分組、手機展開列。
 * 卡片的排序用「排序依據」按鈕列（與表格手機版的比較欄位同一份清單），預設漲跌幅由大到小。
 * 舊網址 /strong-table 由 next.config.ts 轉到 /strong-stocks?view=table。
 *
 * ⚠️ 切換檢視只用按鈕＋history.replaceState 改網址，不用 router.push／useSearchParams：
 *    Next 16 同一路由只換 search 不會重新掛載（layout-router 的 cache key 不含 search params），
 *    掛載時讀一次網址的 ?view 就好；useSearchParams 不包 Suspense 會讓正式建置失敗。
 *
 * 表格版面取捨：寧可一次少看幾欄，也不縮字級、不擠行高。
 * 全部欄位一次全上（22 欄）在本站 @theme 放大後的 text-sm(15.2px) 下總寬約 2,000px，
 * 桌機必然橫捲；溢出關在表格自己的捲動容器（[contain:paint]），整頁不橫捲。
 * 「改用分組檢視」一次只顯示固定 3 欄＋一組 4~5 欄，桌機寬度內不捲動。
 * ------------------------------------------------------------------ */

const STORAGE_KEY = 'strong-stocks-state' // 篩選、排序、主動選的舊日期：同一個分頁內保留（從個股頁返回）
const VIEW_KEY = 'strong-stocks-view'     // 卡片／表格：長期記住（localStorage，手機與電腦各自記）

type View = 'cards' | 'table'
const isView = (v: unknown): v is View => v === 'cards' || v === 'table'

/* ------------------------------ 頁面 ------------------------------ */

export default function StrongStocksPage() {
  const [data, setData] = useState<StrongTableResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false) // 還原完成前不存檔，也避免用預設條件多抓一次
  const [view, setView] = useState<View>('cards')
  const [viewReady, setViewReady] = useState(false) // 決定檢視前只顯示中性骨架，不先閃卡片再跳表格
  // 只記住使用者「主動」選的舊日期，並記下當時的最新交易日：之後出了新交易日就自動回到最新一天
  //（合併前兩頁都把第一次看到的最新日存起來，隔天在同一個分頁打開會停在前一天）
  const [picked, setPicked] = useState<{ date: string; newest: string } | null>(null)
  const req = useLatestRequest() // 只採用最後一次送出的請求：慢網路時舊回應晚到，不可把資料與日期蓋回去

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

  // days 一律送整數字面值 7。route 遇到非數字會退回 7（2026-11-06 起，lib/strong-enrich.ts 呼叫前先擋 NaN），
  // 以前會讓所有 strong_count 靜默變 0 而完全不報錯。
  const fetchData = async (date?: string, newestWhenPicked?: string) => {
    const seq = req.start()
    setLoading(true)
    setError(false)
    try {
      const url = date
        ? `/api/strong-stocks?days=7&date=${encodeURIComponent(date)}`
        : '/api/strong-stocks?days=7'
      const res = await fetch(url)
      if (!res.ok) throw new Error('http')
      const json: StrongTableResponse = await res.json()
      if (!req.isLatest(seq)) return
      // 記住的舊日期之後又出了新交易日 → 回到最新一天
      // YYYY-MM-DD 可以直接比大小；用 > 而不是 !==：CDN 快取回了較舊的清單，不可誤判成出了新交易日
      if (newestWhenPicked && json.availableDates?.[0] && json.availableDates[0] > newestWhenPicked) {
        setPicked(null)
        fetchData()
        return
      }
      setData(json)
      // API 對不在白名單的日期是「靜默退回最新日」而不是回 400，
      // 所以一律以回應的 latestDate 為準，不要相信自己送出去的 date。
      setSelectedDate(json.latestDate || '')
      if (date) {
        // 以回應重算：API 退回最新日就不算「選了舊日期」；最新日以這次回應為準（開頁後收集器可能寫入了新的一天）
        const newest = json.availableDates?.[0]
        setPicked(json.latestDate === date && newest && date !== newest ? { date, newest } : null)
      }
    } catch (e) {
      if (!req.isLatest(seq)) return
      console.error('Failed to fetch strong stocks:', e)
      setError(true)
    } finally {
      if (req.isLatest(seq)) setLoading(false)
    }
  }

  // 切換檢視：不打 API、不換頁。網址同步寫 ?view=（分享、重新整理都回到同一種），長期偏好存 localStorage。
  const changeView = (v: View) => {
    setView(v)
    try { localStorage.setItem(VIEW_KEY, v) } catch {}
    try {
      const u = new URL(window.location.href)
      u.searchParams.set('view', v)
      window.history.replaceState(window.history.state, '', u)
    } catch {}
  }

  // 還原視圖狀態（sessionStorage）→ 從個股頁返回時保留
  useEffect(() => {
    // 檢視：網址 ?view= 優先（月報頁的連結、舊 /strong-table 轉址會帶），其次這台裝置上次的選擇，預設卡片
    let v: View = 'cards'
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('view')
      if (isView(fromUrl)) {
        v = fromUrl
        localStorage.setItem(VIEW_KEY, v)
      } else {
        const stored = localStorage.getItem(VIEW_KEY)
        if (isView(stored)) v = stored
      }
    } catch {}
    setView(v)
    setViewReady(true)

    let saved: { date: string; newest: string } | null = null
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        const f = JSON.parse(raw)
        if (f.picked && typeof f.picked.date === 'string' && typeof f.picked.newest === 'string' && f.picked.date) {
          saved = { date: f.picked.date, newest: f.picked.newest }
          setPicked(saved)
          setSelectedDate(saved.date)
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
          setDebouncedQuery(normalizeQuery(f.query))
        }
      }
    } catch {}
    // setState 是非同步的，fetch 讀不到剛 set 的 state → 把記住的日期當參數直接傳進去
    fetchData(saved?.date, saved?.newest)
    setReady(true)
    return () => {
      if (dateTimer.current) clearTimeout(dateTimer.current)
    }
  }, []) // 僅在掛載時還原一次（與 /screener、/strong-monthly 的 ready 閘門模式一致）

  // 視圖狀態變動即存（ready 閘門：避免第一次跑就用預設值蓋掉 storage）
  useEffect(() => {
    if (!ready) return
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ picked, group, sort, filter, hideNullRows, showAll, query })
      )
    } catch {}
  }, [ready, picked, group, sort, filter, hideNullRows, showAll, query])

  // 搜尋 debounce 200ms（純字串比對，不做中文分詞、不走 Firestore 查詢）
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(normalizeQuery(query)), 200)
    return () => clearTimeout(t)
  }, [query])

  // 切換日期：先切成骨架讓使用者看到反應，再 debounce 400ms 發請求。
  // 單次請求會吃掉伺服器端 dayCache 4 格中的 2 格（getStocksByDate ＋ getPrevCloseMap 內部再一次），
  // 快速前後切換會把命中率打到趨近 0，每次 miss 約 0.9MB Firestore 讀取。
  const handleDateChange = (date: string) => {
    const newest = data?.availableDates?.[0]
    setSelectedDate(date)
    setPicked(date && newest && date !== newest ? { date, newest } : null)
    req.cancel() // 進行中的請求作廢：等防抖這 400ms 內舊回應回來，也不可把剛選的日期蓋掉
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
   * 桌機實際生效的排序鍵。刻意在 render 期間推導、不用 useEffect + setState：
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

  /* ---- 手機：自己一套「可見欄＋排序」，不跟桌機的分組／全部欄位走 ----
   * 手機與桌機兩份表格同時在 DOM 裡、由 md: 斷點切換顯示（全站慣例：不用 JS 量視窗），
   * 但兩邊「看得到的欄」不同，所以排序、隱藏無資料的列、統計列都各算一份。 */

  // 非最新交易日時拿掉「強勢日」這顆，理由同 effectiveSort 的 (b)
  const mobileFocusKeys = useMemo(
    () => MOBILE_FOCUS_KEYS.filter((k) => !(k === 'strong_count' && strongCountStale)),
    [strongCountStale]
  )

  /**
   * 手機實際生效的排序。規則只有一條：排序鍵必須是某一顆比較欄位按鈕，否則退回預設（漲跌幅）。
   * 預設也在按鈕裡，所以「亮著的按鈕＝第 3 欄＝實際排序」恆成立，
   * sessionStorage 還原回來的值也一樣——不會出現按鈕亮 A、實際依 B 排。
   * （排序鍵不在按鈕裡，只會發生在同一分頁先在桌機寬度點了表頭、再轉回直向手機。）
   * 刻意不看桌機的 showAll／group：手機沒有分組可切，拿看不見的分組去否決手機的選擇，
   * 會變成「點了成交額卻沒反應」。
   */
  const mobileSort = useMemo(
    () => (mobileFocusKeys.includes(sort.key) ? sort : DEFAULT_SORT),
    [mobileFocusKeys, sort]
  )
  const focusKey: ColKey = mobileSort.key

  const mobileSortNotice =
    mobileSort.key === sort.key
      ? ''
      : strongCountStale && sort.key === 'strong_count'
        ? '所選日期不是最新交易日，「強勢日」欄位無法排序，已改為依漲跌幅排序'
        : `「${COLUMNS[sort.key].fullName}」不在手機的比較欄位，已改為依漲跌幅排序`

  const industries = useMemo(() => industriesOf(rows, (s) => s.industry), [rows])

  // 記住的產業不在這一天的選項裡：下拉會顯示「全部產業」，實際卻還在依舊產業篩 → 改回全部
  useEffect(() => {
    if (!data || filter.industry === 'all') return
    if (!industries.includes(filter.industry)) setFilter((f) => ({ ...f, industry: 'all' }))
  }, [data, industries, filter.industry])

  // 「隱藏無資料的列」檢查範圍＝目前可見欄 ＋ 目前排序欄
  const nullableCheckKeys = useMemo(
    () => Array.from(new Set<ColKey>([effectiveSort.key, ...visibleKeys])).filter((k) => COLUMNS[k].nullable),
    [effectiveSort.key, visibleKeys]
  )

  // 手機同一條規則，只是可見欄不同：固定欄（股票／收盤＋漲跌幅）＋第 3 欄，而第 3 欄就是排序欄。
  // ⚠️ 不可沿用桌機的 visibleKeys：showAll 預設 true → 手機會一律檢查全部 5 個可缺欄位，
  //    外資持股整欄「—」的日子一勾選就變 0 檔，而手機畫面上根本沒有那一欄，使用者看不出原因。
  const mobileNullableCheckKeys = useMemo(
    () => Array.from(new Set<ColKey>([...FIXED_KEYS, focusKey])).filter((k) => COLUMNS[k].nullable),
    [focusKey]
  )

  // 「隱藏無資料的列」以外的條件：桌機與手機共用同一份
  const baseRows = useMemo(() => {
    return rows.filter((r) => {
      if (filter.macd !== 'all' && r.macd_status !== filter.macd) return false
      if (filter.minVolume > 0 && !(r.volume >= filter.minVolume)) return false
      if (filter.industry !== 'all' && r.industry !== filter.industry) return false
      if (filter.foreignBuy && !(r.foreign_buy > 0)) return false
      if (filter.streakMin > 0 && !((r.foreign_streak ?? 0) >= filter.streakMin)) return false
      if (!matchesStockQuery(r.stock_id, r.stock_name, debouncedQuery)) return false
      return true
    })
  }, [rows, filter, debouncedQuery])

  const sortedRows = useMemo(
    () => sortRowsBy(hideNullRows ? baseRows.filter((r) => !hasNullIn(r, nullableCheckKeys)) : baseRows, effectiveSort),
    [baseRows, hideNullRows, nullableCheckKeys, effectiveSort]
  )

  const mobileSortedRows = useMemo(
    () => sortRowsBy(hideNullRows ? baseRows.filter((r) => !hasNullIn(r, mobileNullableCheckKeys)) : baseRows, mobileSort),
    [baseRows, hideNullRows, mobileNullableCheckKeys, mobileSort]
  )

  // 卡片：排序與手機表格同一條規則（排序鍵必須是「排序依據」按鈕之一，否則退回漲跌幅），
  // 所以手機上切換卡片／表格順序不變。「隱藏無資料的列」是表格欄位的概念，卡片不套用。
  const cardRows = useMemo(() => sortRowsBy(baseRows, mobileSort), [baseRows, mobileSort])
  const cardSortSummary = useMemo(() => sortSummaryOf(cardRows, mobileSort), [cardRows, mobileSort])
  const cardSortNotice =
    mobileSort.key === sort.key
      ? ''
      : strongCountStale && sort.key === 'strong_count'
        ? '所選日期不是最新交易日，「強勢日」無法排序，已改為依漲跌幅排序'
        : `「${COLUMNS[sort.key].fullName}」不在排序依據的按鈕裡，卡片改為依漲跌幅排序`


  // 還原記住的排序後，把「按下的那顆」排序按鈕捲進可見範圍：按鈕列在 375px 只露出前三、四顆，
  // 被按下的若在捲動區外，畫面上看不出現在依什麼排。只調整按鈕列自己的 scrollLeft——
  // 不可用 scrollIntoView，它會連整頁一起上下捲。
  const chipRowRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const row = chipRowRef.current
    const btn = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !btn) return
    const r = row.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    if (b.left < r.left || b.right > r.right) row.scrollLeft += b.left - r.left - 16
  }, [focusKey, mobileSort.dir, mobileSortedRows.length])

  const sortSummary = useMemo(() => sortSummaryOf(sortedRows, effectiveSort), [sortedRows, effectiveSort])
  const mobileSortSummary = useMemo(() => sortSummaryOf(mobileSortedRows, mobileSort), [mobileSortedRows, mobileSort])

  // 只有兩態（desc ⇄ asc），不做「第三次點回預設」——多一個看不見的狀態對視力不佳者是負擔。
  // current＝使用者眼前那份表格的排序（桌機 effectiveSort、手機 mobileSort）：
  // 兩者可能不同，要以畫面上亮著的那個決定「這次是翻轉方向還是換欄」。
  const toggleSort = (key: ColKey, current: SortState = effectiveSort) => {
    setSort(
      current.key === key
        ? { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
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
  const ctxFocus: RenderCtx = { strongCountStale, compact: true, noArrow: true } // 手機第 3 欄

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

  const captionText = `${selectedDate || '（無日期）'} 強勢股表格，目前顯示「${
    showAll ? '全部欄位' : GROUPS[group].label
  }」欄位組，共 ${sortedRows.length} 檔`

  const mobileCaptionText = `${selectedDate || '（無日期）'} 強勢股表格，比較欄位為「${
    COLUMNS[focusKey].fullName
  }」，共 ${mobileSortedRows.length} 檔`

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
      {/* divide-gray-200（比常見的 gray-100 深一階），長表更容易追行；
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
      <caption className="sr-only">{mobileCaptionText}</caption>
      {/* ⚠️ 欄寬依 320px 最窄手機推算：第 3 欄預設是漲跌幅，「+10.00%」約 65px。
          原本 30%／28%／52px 時 320px 下第 3 欄只剩約 53px，會被截成「+3.0…」。
          第 4 欄只放 w-11（44px）的展開鈕且 td 是 px-0，44px 剛好；第 1 欄讓出 2%，
          股名改成最多折兩行（不截斷），所以讓出的寬度不會造成更多股名被切掉。 */}
      <colgroup>
        <col className="w-[28%]" />
        <col className="w-[28%]" />
        <col />
        <col className="w-[44px]" />
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
        {mobileSortedRows.map((r) => {
          const open = expanded.has(r.stock_id)
          return (
            <Fragment key={r.stock_id}>
              <tr className="hover:bg-gray-50 focus-within:bg-gray-50">
                <td className="px-2 py-3">
                  <Link href={`/stock/${r.stock_id}`} className="block min-h-[44px] hover:text-blue-600">
                    {/* 長股名（亞德客-KY、日月光投控）折兩行而不是截成「亞德客-…」：手機看不到 title 提示 */}
                    <span className="block font-medium text-gray-900 line-clamp-2 [overflow-wrap:anywhere]" title={r.stock_name || r.stock_id}>
                      {r.stock_name || r.stock_id}
                    </span>
                    <span className="block text-sm text-gray-700 tabular-nums">{r.stock_id}</span>
                  </Link>
                </td>
                <td className="px-2 py-3 text-right whitespace-nowrap tabular-nums">
                  {COLUMNS.close.render(r, ctxCompact)}
                  {/* 第 3 欄已經是漲跌幅時不再重複一次：同一列出現兩個一樣的數字，
                      視力不佳者會以為是兩個不同指標。列高由第 1 欄的兩行決定，拿掉不會跳動。 */}
                  {focusKey !== 'change_pct' && (
                    <span className="block text-sm">{COLUMNS.change_pct.render(r, ctxCompact)}</span>
                  )}
                </td>
                <td className="px-2 py-3 text-right truncate tabular-nums">
                  {COLUMNS[focusKey].render(r, ctxFocus)}
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

  const emptyResult = (
    <EmptyState
      icon={data?.dataMissing ? '📅' : '🔍'}
      title={data?.dataMissing ? '這一天沒有明細資料' : '沒有符合條件的股票'}
      description={data?.dataMissing ? '請改選其他交易日' : '試著放寬搜尋、MACD／成交量／產業等條件'}
    />
  )
  // 手機專用：「隱藏無資料的列」只檢查第 3 欄＋排序欄，第 3 欄選到一整天都沒資料的欄位
  // （例如外資持股在 22:00 收集前整欄是「—」）時會變 0 檔。這時真正的原因是那個勾選框，
  // 提示要直接講出來，不能叫人去放寬 MACD／成交量（2026-10-22 實測 124 檔 → 0 檔）。
  const mobileEmptyResult =
    hideNullRows && baseRows.length > 0 && !data?.dataMissing ? (
      <EmptyState
        icon="🔍"
        title="勾選了「隱藏無資料的列」"
        description={`「${COLUMNS[focusKey].fullName}」這一天全部沒有資料，所以整份表格被藏起來了。取消勾選即可看到 ${baseRows.length} 檔，或改選其他比較欄位。`}
      />
    ) : emptyResult

  // 載入中、出錯、還沒有資料時顯示「—」：不可寫「當日 0 檔」，也不可在換日期時留著前一天的檔數
  const statsReady = viewReady && !loading && !error && !!data && !noTradingDay
  const statsBar = (cls: string, count: number, summary: string, notice: string) => (
    <div className={`${cls} flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-sm`} aria-live="polite">
      <span className="text-gray-700">
        篩選 <span className="font-bold text-gray-900 tabular-nums">{statsReady ? count : DASH}</span> 檔 ／ 當日{' '}
        <span className="font-medium text-gray-900 tabular-nums">{statsReady ? totalCount : DASH}</span> 檔
      </span>
      {statsReady && <span className="text-gray-700">{summary}</span>}
      {statsReady && notice && <span className="text-amber-900">{notice}</span>}
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 容器比全站慣例的 max-w-7xl 寬：20 欄表格在 1920 螢幕上才不會白白浪費空間。
          PageHeader 也要同步換寬，否則標題會跟表格左緣差 280px。 */}
      <PageHeader title="強勢股" maxWidth="max-w-[1560px]" />

      <div className="max-w-[1560px] mx-auto px-4 py-6">
        {/* 檢視切換：同一份資料的兩種呈現。按了只換呈現，不打 API、條件與順序不變。
            按下的那顆打勾＋實心，不只靠顏色分辨（業主視力不佳）。決定檢視前兩顆都不顯示按下。 */}
        <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="檢視方式">
          {([['cards', '卡片'], ['table', '表格']] as const).map(([v, label]) => {
            const on = viewReady && view === v
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => changeView(v)}
                className={`inline-flex items-center gap-2 min-h-[48px] px-6 rounded-full text-base font-semibold border-2 transition-colors ${
                  on ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-900 border-gray-500 hover:border-blue-600'
                }`}
              >
                <span aria-hidden="true">{on ? '✓' : v === 'cards' ? '▦' : '☰'}</span>
                {label}
              </button>
            )
          })}
        </div>

        {/* 大字日期卡（原卡片頁的）：資料到了以後顯示的是 API 實際回傳的日期，跟下面的資料是同一天；
            換日期的載入期間先顯示剛選的那天（下方結果區此時是骨架）。 */}
        <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <div className="text-sm text-gray-700">資料日期</div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{selectedDate || DASH}</div>
          </div>
          {availableDates.length > 0 && (
            <div className="sm:border-l sm:border-gray-300 sm:pl-6">
              <div className="text-sm text-gray-700">可選範圍</div>
              <div className="text-base text-gray-900 tabular-nums">
                {availableDates[availableDates.length - 1]} ~ {availableDates[0]}
                <span className="text-gray-700 ml-2">（{availableDates.length} 個交易日）</span>
              </div>
            </div>
          )}
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
              「強勢日」（卡片上的「強勢 N 日」）固定以<strong>最近 7 個交易日</strong>計算，
              與所選日期（{selectedDate}）無關，因此已停用排序並轉為灰字。
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
                    industry: q.key === 'all' ? 'all' : f.industry, // 「全部」＝不加任何條件
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

            {/* 預設關閉：預設要誠實呈現有多少檔沒資料。只在表格出現：卡片沒有「欄」的概念 */}
            {viewReady && view === 'table' && (
            <label className="flex items-center gap-2 min-h-[44px] lg:min-h-[36px] text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={hideNullRows}
                onChange={(e) => setHideNullRows(e.target.checked)}
                className="w-5 h-5 rounded"
              />
              隱藏無資料的列
            </label>
            )}

            {/* 檢視切換：全欄位（預設）↔ 分組。全欄位會水平捲動，捲動關在表格容器內 */}
            {viewReady && view === 'table' && (
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
            )}
          </div>
        </div>

        {/* 桌機：欄位分組切換（一次最多 8 欄，不橫捲） */}
        {viewReady && view === 'table' && !showAll && (
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
            點不同顆＝換第 3 欄並依該欄由大到小；點同一顆＝翻轉方向。
            亮哪顆、▼▲、第 3 欄一律看 mobileSort（不看桌機的 effectiveSort），三者才不會分家。 */}
        {viewReady && (
        <div className={`${view === 'table' ? 'md:hidden ' : ''}mb-3`}>
          <div id="focus-label" className="text-sm text-gray-700 mb-1">
            {view === 'cards' ? '排序依據（點選即排序，再點一次反向）' : '比較欄位（點選即排序）'}
          </div>
          <div
            ref={chipRowRef}
            className={`-mx-4 px-4 pb-1 flex gap-2 overflow-x-auto snap-x ${view === 'cards' ? 'md:mx-0 md:px-0 md:flex-wrap md:overflow-visible' : ''}`}
            role="group"
            aria-labelledby="focus-label"
          >
            {mobileFocusKeys.map((k) => {
              const on = focusKey === k
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleSort(k, mobileSort)}
                  className={`snap-start shrink-0 px-4 min-h-[44px] rounded-full text-sm border transition-colors ${
                    on
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300'
                  }`}
                >
                  {COLUMNS[k].header}
                  {on && <span aria-hidden="true"> {mobileSort.dir === 'desc' ? '▼' : '▲'}</span>}
                </button>
              )
            })}
          </div>
        </div>
        )}

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
              　表示這天沒有這筆資料，<strong>不是 0</strong>。當沖欄的「—」多半是興櫃股、處置股（處置期間不得現股當沖）或沒有融資融券資格的股票，交易所本來就不公布；其他欄多為 FinMind 未涵蓋。⚠️ 法人買賣超與連續天數例外：缺資料時目前會顯示 0（收集程式的已知問題）。
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

        {/* 統計列：篩選/排序造成筆數變動時播報。
            手機與桌機的筆數／排序可能不同（見 mobileSort），所以各一份、用 md: 切換；
            display:none 的那份不在無障礙樹裡，不會重複播報。 */}
        {view === 'cards' ? (
          statsBar('flex', cardRows.length, cardSortSummary, cardSortNotice)
        ) : (
          <>
            {statsBar('flex md:hidden', mobileSortedRows.length, mobileSortSummary, mobileSortNotice)}
            {statsBar('hidden md:flex', sortedRows.length, sortSummary, sortNotice)}
          </>
        )}

        {/* 結果區三元鏈：篩選列與分組切換恆常渲染，只有這裡換 */}
        {!viewReady ? (
          <div className="h-64 rounded-lg bg-gray-100 animate-pulse" aria-hidden="true" />
        ) : loading ? (
          view === 'cards' ? <CardGridSkeleton /> : <TableSkeleton rows={12} cols={visibleKeys.length} />
        ) : error ? (
          <ErrorState message="無法取得強勢股資料" onRetry={() => fetchData(picked?.date, picked?.newest)} />
        ) : noTradingDay ? (
          <EmptyState icon="📅" title="尚無可用交易日" description="資料尚未收集完成，請稍後再試" />
        ) : view === 'cards' ? (
          cardRows.length === 0 ? (
            emptyResult
          ) : (
            // 欄數依「扣掉側欄後的內容寬」算：卡片要至少約 300px，法人三欄的 6 位數才不會擠出欄位
            // （768 寬扣掉 256px 側欄只剩 480px，排兩欄每張只有 232px）
            <ul className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 md:gap-4" aria-label={`${selectedDate} 強勢股卡片，共 ${cardRows.length} 檔`}>
              {cardRows.map((r) => (
                <li key={r.stock_id} className="min-w-0">
                  <StockCard
                    stock={r}
                    strongCountStale={strongCountStale}
                    sortExtra={CARD_HIDDEN_KEYS.includes(focusKey) ? { label: COLUMNS[focusKey].fullName, value: COLUMNS[focusKey].render(r, ctx) } : undefined}
                  />
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            {/* 手機：3 欄常駐 ＋ 可展開列（展開後一次列出全部欄位），不做橫捲資料表。
                ⚠️ 這裡刻意不加圓角卡片常用的 overflow-hidden：overflow 非 visible 會讓卡片
                變成 sticky 表頭的參考容器，而卡片高度＝表格高度，表頭等於完全沒黏住。
                圓角改由表頭第一／最後一個 th 自己處理。
                「沒有符合條件」要手機、桌機各自判斷：兩邊隱藏無資料列的範圍不同，筆數可能一邊 0 一邊不是。 */}
            {mobileSortedRows.length === 0 ? (
              <div className="md:hidden">{mobileEmptyResult}</div>
            ) : (
              <div className="md:hidden bg-white rounded-lg shadow-sm">{mobileTable}</div>
            )}

            {/* 桌機 */}
            {sortedRows.length === 0 ? (
              <div className="hidden md:block">{emptyResult}</div>
            ) : showAll ? (
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
                  aria-label="強勢股表格，視窗較窄時可左右捲動"
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
