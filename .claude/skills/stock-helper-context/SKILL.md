---
name: stock-helper-context
description: 選股小幫手（stock_helper，台股技術分析網站）的架構、資料流、部署與踩過的地雷。在此專案（/Users/stone/1.Python資料夾/3.選股小幫手）開發前先讀，掌握資料一致性/收集時機等陷阱，避免重蹈 2026-08 修過的 bug。
---

# 選股小幫手（stock_helper）專案 context

台股技術分析網站。前端 Next.js 看盤，後端 Python collector 抓 FinMind 寫 Firestore，GitHub Actions 每交易日自動收集。

## 技術棧與部署
- **前端**：Next.js 16 + React 19 + Tailwind v4 + lightweight-charts；PWA（next-pwa）
- **部署**：Firebase **App Hosting**（backend id `stock-analysis`、region `asia-east1`、**需 Blaze 方案**），連 GitHub `Stone-811/stock_helper` 的 `main`，push 自動 rollout
- **資料層**：Firestore（GCP 專案 `stock-analysis-b5602`）
- **後端收集**：Python `stock_collector/`，GitHub Actions `.github/workflows/daily-collect.yml`（cron `30 10 * * 1-5` = 台灣 18:30）
- **Secret**：`FINMIND_API_TOKEN` 設在 App Hosting secret（`firebase apphosting:secrets:set`）；前端連 Firestore 用 **ADC**（同專案免放金鑰，見 lib/firebase-admin.ts fallback）
- **網址**：https://stock-analysis--stock-analysis-b5602.asia-east1.hosted.app
- **CLI**：`firebase` 未全域安裝，用 `npx firebase-tools`

## 資料流
1. **Cloud Run Job + Cloud Scheduler**（工作日台灣 17:00／22:00 兩班）→ `daily_collector` 抓 FinMind（股價 / 三大法人 / 外資持股 / 當沖 / 指數）。
   GitHub Actions 的 `daily-collect.yml` **排程已停用**（只留 `workflow_dispatch` 手動備援），避免重複收集。
2. 寫 Firestore（2026-09-05 實測筆數）：`daily_data/{date}/chunks`（**自 2026-07-24 起一直累積、2026-09-28 實測 45 天**——程式裡沒有任何 prune 邏輯，先前記載的「31 天」已過時；但也沒有保留保證，不要依賴）、`strong_stocks/{date}`（**886 天**，只存 `{stock_id, stock_name}`）、`market_index/{TAIEX,TX}`（**2 份文件**，各含 510 筆 history 陣列）、`metadata/{latest_date, available_dates}`。
   **就這 4 個 collection**——舊架構 `strong_stock_matrix`／`market_index_daily` 已於 2026-09-05 刪除。
   ⚠️ 數值欄位全在 `daily_data`，所以任何回補（與「強勢月報」的可算月份）上限就是 **2026-07-24**。
   `metadata/available_dates` 與 `daily_data` 的日期集合實測完全一致（差集兩邊皆空）。
3. 前端讀 Firestore；**但個股 K 線改打 FinMind REST（`lib/finmind.ts`，單股完整歷史，繞過 Firestore）**、MACD 由前端 `lib/indicators.ts` 自算

## 個股頁功能與全站搜尋（2026-08 擴充，皆前端；收集器/排程未動）
個股頁 `app/stock/[id]/`（`StockDetailClient.tsx`）：
- **當日當沖比例**：資訊卡片一格，= `day_trading_volume / volume`（當沖量早已由 collector 抓 `TaiwanStockDayTrading` 存進 daily_data）。歷史當沖量由 `lib/finmind.ts` 的 `fetchStockDayTrading()` 抓 FinMind、在 `stock-data.ts` 併入 K 線 `history`，由 `StockDetailClient` 算成 `[{date,ratio}]` 傳給**籌碼圖的「當沖」分頁**（2026-08-18 起當沖已移出技術圖，見下方 P0 改版）。
- **三大法人趨勢圖**：`components/InstitutionalChart.tsx`（獨立 lightweight-charts 折線，**刻意不併進 K 線子圖**以避開多子圖 priceScale 對齊坑）。資料 client 端 lazy 打 `app/api/stock/[id]/institutional/route.ts`（回 `{ data, holdings }`）。**兩模式切換**：
  - **買賣超**：`fetchInstitutionalHistory()`（FinMind `TaiwanStockInstitutionalInvestorsBuySell`）累計買賣超。定義**比照收集器**：外資=`Foreign_Investor`、投信=`Investment_Trust`、自營=`Dealer_self`+`Dealer_Hedging`，`(buy−sell)/1000` 後 **`Math.trunc`**（對齊 `_process_institutional_data`+firebase_writer `.astype(int)`；用 `Math.round` 會差 1 張）。
  - **外資持股**：`fetchForeignShareholding()`（FinMind `TaiwanStockShareholding.ForeignInvestmentShares÷1000`）畫**外資實際持股張數**（官方申報的絕對持有量，非買賣超累加）。⚠️ **只有外資有逐檔官方持股**，投信/自營無此資料 → 不做「持股」模式，只在買賣超顯示。
- **技術分析圖 `CandleChart.tsx`（2026-08 大改；`StockChart`個股·張 / `IndexChart`大盤·億/口 共用）**：
  - **架構**：不再是「三張獨立 chart 疊 + 動態同步右軸寬」的舊脆弱做法。改為 **1 張主圖（K線+MA+布林+成交量半透明疊底）＋ 每個指標各一張同步子圖**（指標**單選**，見下方 P0 改版；2026-08-18 前為多選 ≤2）。對齊靠 **固定右軸寬 68px（`AXIS_WIDTH`）+ 邏輯範圍同步（`subscribeVisibleLogicalRangeChange`）+ 十字線同步** → 天生對齊，**已移除 requestAnimationFrame/ResizeObserver 喬寬的舊 hack**。
  - ⚠️ **各子圖系列必須保留完整時間軸**（暖身期 null 用 whitespace `{time}` 佔位，用 `toLineWS`／histogram 亦然；**勿用會濾 null 的 `toLineData` 或 `.filter`**）。否則 MACD 等指標系列從第 ~33 根才開始 → 子圖時間軸起點與主圖不一致 → 用 logical index 同步時錯位 → **K 棒與 MACD 柱水平對不上**（2026-08-13 踩到並修）。主圖有 K 線錨定完整範圍故 MA/BB 可濾；指標子圖沒錨定，務必用 whitespace。
  - **互動**：開啟 `handleScroll/handleScale`（滾輪縮放 + 拖曳平移）；`3M/6M/1Y/2Y` 改用 `setVisibleLogicalRange`（bar 索引，避開「非交易日字串讓 `setVisibleRange` 失效 → 退回 fitContent 顯示全 5 年」的坑）。全量資料載入、指標用完整資料算，顯示範圍靠邏輯範圍而非 slice。
  - **視覺**：左上讀值整合一份（日期/收含漲跌%/量 + 有開的 MA/布林/各指標值）；最新價水平線 + 價籤；成交量半透明疊主圖底部（`vol` overlay 價軸）；版面 preset（價格為主/均衡/指標為主）調主圖佔比。
  - ⚠️ **為何不用「單圖多價軸(架構B)」**：一張圖共用一條右軸會把價格外插到指標帶、出現 `-250/-500` 負價標籤 → 才改成「主圖 + 每指標一張同步子圖」（各軸乾淨）。
- ⚠️ 個股頁現有 **3 支 FinMind 呼叫**：K 線 + 當沖（server-side，`getStockData`）+ 法人（client lazy API route）。都 `next: { revalidate: 300 }`。

**全站置頂搜尋列**：`components/TopBar.tsx` 放進 `MainContent`（每頁皆顯示含首頁，手機左側留 hamburger 空間）。搜尋（代碼/名稱，Server Action `app/actions/stocks.ts::searchStocks`，已同時比對 stock_id 與 stock_name）已從各頁 header 移除、集中於此；**各頁 header 一律改為非 sticky**（原 `sticky top-0 z-10`），避免與置頂列（`sticky top-0 z-30`）雙重固定重疊。

## 前端 UI / RWD 慣例（2026-08-13，⚠️ 多數已被下方 P0 改版取代，僅保留脈絡）
- **手機版一律用 Tailwind `md:` 斷點做「桌機常駐／手機收合」**（不做 JS 量視窗）：
  - `CandleChart`：版面 preset + 疊加(MA/布林/量) 藏進「**⚙️ 更多**」（現已更名「⚙️ 圖表設定」）（`moreOpen` state；切換鈕 `md:hidden`；該區 `${moreOpen?'flex':'hidden'} md:flex`）；主列只留 週期/區間/指標。legend 的 MA/指標值用 `hidden md:contents` 手機隱藏（只留 日期/收/量）。觸控目標（**現已全面改 44px**）、checkbox `w-4 h-4 md:w-3.5`。
  - `StockDetailClient`：三大法人明細手機預設收合（`showInst` state +「展開/收合」鈕 `md:hidden`；grid `${showInst?'grid':'hidden'} md:grid`），卡片 `p-4 md:p-6`。
  - ~~`Sidebar` 手機標題 `pl-10`~~：**已失效**——P0 後 ☰ 移到 `TopBar`、抽屜關閉鈕改在抽屜內。
  - ~~首頁 `IndexCard`~~：**已移除**（重複顯示加權），改為跟著分頁的精簡數據列 `IndexStatStrip`。
- **個股頁「返回」用 `router.back()`（`next/navigation`）回上一頁**，不要寫死 `href="/"`——否則從強勢股/選股/自選股/搜尋點進來按返回都跑去首頁。無瀏覽歷史（`window.history.length<=1`，直接開個股頁）才 fallback `router.push('/')`。

### P0 UI/UX 改版（2026-08-18，已上線；以下取代上方部分 2026-08-13 慣例）
- **導覽**：手機主導覽改 **Bottom Nav**（`components/MobileBottomNav.tsx`，`md:hidden` fixed bottom、首頁/強勢/選股/自選、safe-area、active 藍、≥56px），掛在 `layout.tsx`；`MainContent` 補底部留白 `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0`。`Sidebar` 桌機常駐不變；手機抽屜只留帳號(AuthButton)/資料來源（主導覽已移除：`nav` 加 `hidden md:block`），☰ 從 Sidebar 浮動鈕移進 `TopBar`，靠 window 事件 `toggle-mobile-menu` 開關（同 `sidebar-collapse-change` 模式）。
- **Header 去雙層**：舊「全域 `TopBar` + 每頁 `<header bg-white shadow-sm>`」= 雙層。各頁改用 `states.tsx` 的 **`PageHeader`**（輕量標題、非白底 shadow bar）；`TopBar` 降高去 shadow、移除浮動漢堡的 `pl-16`。
- **搜尋**：`StockSearchOptimized` 已是 instant（debounce/dropdown/鍵盤/點外關閉），**移除了「查詢」按鈕**。
- **個股頁 header**：`← [名稱大] [代碼灰] … [☆加入自選] [🔔到價提醒]`；`WatchlistButton`（**原死碼、現已啟用**）接既有 `user_watchlists` 後端。股價階層：大字價格 `text-4xl md:text-5xl` + `▲▼` 漲跌 + 次要「日期·成交量」；金融數字加 `tabular-nums`。
- **CandleChart**：① 區間加 `1M`；②「⚙️ 更多」→「⚙️ 圖表設定」；③ 指標改**單選底線 Tabs**（`indicator` 單值，非陣列；`MAX_INDICATORS`/`toggleIndicator`/多選已移除）；④ **當沖移出技術圖**（`Indicator` 不再有 `daytrade`）。觸控 `min-h-[44px]`。
- **當沖改屬籌碼**：`InstitutionalChart` 新增 `Mode='daytrade'` +「當沖」tab，資料由 `StockDetailClient` 用 K 線 history 算出 `dayTrade=[{date,ratio}]` 傳入（籌碼圖本身不 fetch 當沖）；`hasDayTrade` 才顯示該 tab。
- **狀態元件**（`components/states.tsx`）：`PageHeader` / `CardGridSkeleton` / `ChartSkeleton` / `EmptyState` / `ErrorState(onRetry)`。首頁/強勢/選股/自選：載入→骨架、空→EmptyState、錯→ErrorState+重新載入（各頁補了 `error` state；screener 用 `reloadNonce` 重觸發 useEffect）。
### 無障礙／視力友善（2026-08-19，全站生效）
- **⚠️ 中文字型**：`globals.css` 的 body 原本是 `font-family: Arial`，**Arial 沒有中文字**，中文全靠系統 fallback（部分裝置變襯線/細體）。已改為 `--font-sans: var(--font-geist-sans), "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", "Heiti TC", ...`（拉丁走 Geist、中文走黑體），body 用 `var(--font-sans)`。**別再把 body font-family 寫死成不含中文的字型。**
- **字級放大**：用 Tailwind v4 `@theme` 覆寫字級變數（一次影響全站，不必逐檔改）：`--text-xs .85rem / --text-sm .95rem / --text-base 1.1rem / --text-lg 1.25rem / --text-xl 1.4rem / --text-2xl 1.7rem`＋放寬行高。硬寫的 `text-[10px]/[11px]` 已全改 `text-xs`；`CandleChart` 圖表內建 `fontSize` 12→14。
- **⚠️ 移除深色模式覆寫 + 鎖 `color-scheme: light`**：版面底色是寫死的白/淺灰，但 `@media (prefers-color-scheme: dark)` 會把 `--foreground` 設成 `#ededed`，導致**沒指定顏色的文字在白底上近乎不可見**（實測抓到近白文字），原生 `<select>` 下拉也會變深。**要做深色模式必須連版面底色一起做，不能只換前景變數。**
- **對比**：淺底 `text-gray-400→600`、`500→700`、紅綠 `400→600`；**深底（側欄/圖表）反向提亮** `500→400`、`400→300`（深底改深會更看不清）；灰色小標籤補 `font-medium`。
- 觸控目標一律 ≥44px；`viewport` 已移除 `maximumScale: 1`（原本禁止手機雙指放大，違反 WCAG 1.4.4）。

### 首頁 Dashboard 與 P1（2026-08-18/19，已上線）
- **首頁＝市場 Dashboard**（`app/page.tsx`）四區：今日市場（加權指數）／🔥今日強勢股（`/api/strong-stocks` 取 top6、依漲幅排序、重用 `StockCard`）／⭐我的自選（登入才有，讀 `/api/quotes`）／指數走勢（分頁切換 加權/台指期 + `IndexStatStrip` 精簡數據列 + `IndexChart`）。
- **漲跌家數已移除（2026-08-19，業主表示不需要）**：曾做過 `app/api/market-breadth/route.ts` 抓證交所 `MI_INDEX?type=MS`（FinMind 無此資料）顯示上漲/下跌/漲停/跌停家數，已連同 API route 一併刪除；**若日後要復原，見 git 歷史 commit `ff454c8`（新增）與移除該功能的 commit**。首頁「今日市場」現在只有加權指數收盤與漲跌。
- **`StockCard` 等高**：卡片內容行數不一（有無「當沖額」那列）會讓同排卡片高矮不齊 → `Link` 加 `block h-full`、卡片 `h-full flex flex-col`、底部三大法人區 `mt-auto`。新增卡片內容時保持這個結構。
- **快速策略/篩選（近似值，非真訊號）**：選股頁 `QUICK_STRATEGIES`（趨勢多頭/法人佈局/爆量/技術+法人雙多，一鍵帶入條件）＋**已套用條件 Chips**（可單獨移除、清除全部）；強勢股頁 `QUICK_FILTERS`（全部/技術多頭/法人買超/爆量）。⚠️ **「突破」「爆量」目前是用 MACD/連買/成交量近似**，因真正的突破/爆量需個股 history（見下方 B1 待辦）。
- **⚠️ 篩選條件持久化（sessionStorage）**：client 頁的 filter state 在「進個股頁→返回」時會被重置 → 選股頁存 `screener-filters`、強勢股頁存 `strong-filters`，掛載時還原。**務必用 `ready` 閘門**：還原完成前不要發查詢，否則會先用預設條件多抓一次（畫面閃動）。
- **圖表全螢幕**：`CandleChart` 的 `isFullscreen` → 容器 `fixed inset-0 z-[70]`、高度由 `window.innerHeight-132` 算（監聽 resize 支援旋轉）、鎖 `body.overflow`，控制列保留、✕ 離開。注意圖表高度要用 `effHeight`（全螢幕時覆寫 `height` prop）並列入 chart useEffect 依賴。
- **訊號**：`lib/signals.ts` 的 `computeSignals()`（今日大漲≥5%／MACD多頭／外資·投信連買）供自選股頁 banner「今日 N 支出現訊號」＋卡片 chips、首頁我的自選 chips。**`/api/quotes` 已多帶 `macd_status`/`foreign_streak`/`trust_streak`/`foreign_buy`**（同一份 daily_data 讀取、零額外查詢）。個股頁另有「籌碼摘要」badge（🟢連買/買超、🔴連賣/賣超；手機明細收合時仍顯示）。
- **B2 個股頁 Signal Engine 已完成（2026-08-19）**：`components/StockSignals.tsx` 用個股頁已載入的 `history` 前端即時判讀「今日訊號」（零額外 API）：今日大漲/大跌(對**前一日收盤**)、突破/跌破近20日高低、爆量/量縮(對前5日均量)、均線多/空頭排列、今日站上/跌破 MA20、MACD 金叉死叉、KD 交叉與超買超賣、RSI 超買超賣、當沖比例≥40%。**刻意只列「事件型」訊號**（今天才發生的交叉/突破），避免每天亮同樣的燈；tone: up=紅/down=綠/warn=琥珀。
- **漲跌幅一律以「前一交易日收盤」為基準（2026-08-19 統一）**：台股慣例如此，原本個股頁/`StockCard`/自選卡都用 `close - open`（那其實是當日開→收），同頁會與 `StockSignals` 的正確值打架（實例 6141：+14.10% vs +7.88%）。作法：`lib/firebase-admin.ts` 新增 **`getPrevCloseMap(date)`**（從 `available_dates` 找前一天、讀該日 `getStocksByDate` 組 map），`/api/strong-stocks`、`/api/screener`、`/api/quotes` 都補回傳 **`prev_close`**；前端一律 `base = prev_close > 0 ? prev_close : open`（**保留 open 當 fallback**，因 daily_data 只留近 ~16 天，最舊那天取不到前一日）。個股頁不靠 API，直接用 `history[n-2].close` 最準。⚠️ **新增任何顯示漲跌幅的地方都要沿用這個 base**。⚠️ 別把「>10%」當成 bug：KY/興櫃等無漲跌幅限制個股確實會出現（已驗證 7871 +20.09% 為真實資料）。
- **數值說明泡泡 `components/InfoTip.tsx`（2026-08-19）**：`<InfoTip title="...">說明文字</InfoTip>` 放在標籤旁，桌機滑鼠移入顯示、手機點擊切換（用 `matchMedia('(hover: hover)')` 分流，避免觸控裝置 hover 誤觸），可鍵盤 focus、Esc/點外關閉。⚠️ **按鈕與泡泡都 `preventDefault()+stopPropagation()`**：`StockCard` 整張包在 `<Link>` 內，沒隔離的話點說明會直接跳轉個股頁。已套用：個股頁（漲跌/MACD/當沖/近7日強勢/三大法人/外資三比例）、首頁（加權指數、漲跌家數）、`StockCard`（成交額/強勢/當沖額/法人）。說明文字可帶入實際數字（如漲跌泡泡會顯示今日收盤與前一日收盤）。深色底用 `dark` prop。
- **⚠️ 籌碼圖切換模式/區間會「跳轉」→ 已修（2026-08-19）**：`InstitutionalChart` 切 買賣超/外資持股/當沖 或換區間時，**卡片高度會變**（實測手機 530.7→503.1，差 27.6px），下方內容整個上移＝使用者感受到的畫面跳動。兩個成因：① **圖例行數不同**（買賣超 3 個數值在 375px 折成 2 行、當沖只有 1 行）；② **狀態訊息（載入中/無資料/失敗）用 `py-12` 自撐高度，與圖表高度不同**。修法：圖例加 `min-h-[3.2rem] md:min-h-[1.6rem]`（無值時也放同高佔位 div）；圖表區包一層 `relative` 並固定 `style={{height}}`，訊息改成 `absolute inset-0` 置中覆蓋。驗證：切換全模式與區間後高度恆為 530.8、最大差 0。**日後在圖表卡新增會隨模式變動的內容（圖例/訊息）都要保留固定高度。**
- **仍未做**：手機版週期/區間下拉（§11.2，目前保留兩排分離按鈕）、Design tokens（§33/41）、B1 清單「強勢原因」chips（§18，需收集器算 flag 存 daily_data，見待辦）。

### UI 結構盤點結論（2026-08-19，勿誤刪）
- **`Sidebar` 不可刪**：桌機它仍是**唯一主導覽**（`TopBar` 只有搜尋）。P0 後手機版主導覽才改由 `MobileBottomNav` 承擔（Sidebar 的 `nav` 是 `hidden md:block`）。
- **手機抽屜目前只剩帳號**：`Sidebar` 手機態＝標題＋spacer＋`AuthButton`＋「資料來源 FinMind」。若日後仍無 設定/說明/關於 等次要頁，可考慮「移除手機抽屜＋☰、把登入移進 TopBar」再簡化一層（尚未做，需權衡未來擴充）。
- **無死碼**：`WatchlistButton` 已啟用（個股頁 ☆）；`Sidebar`/`MainContent`/`MobileBottomNav` 由 `layout.tsx` 以**雙引號** import（用 `grep "from '.*X'"` 單引號搜會誤判成 0 refs）。`states.tsx` 五個元件皆有使用。舊漢堡留下的 `pl-12/pl-16` 位移 class 已清乾淨。
- **已知小重複**：首頁「今日市場」與「指數走勢」都顯示加權指數收盤/漲跌（前者摘要、後者含 OHLC 明細）——目前**刻意保留**（用途不同），若要精簡可把「指數走勢」的加權卡收掉。
- **a11y 待辦**：`layout.tsx` 的 `viewport.maximumScale: 1` 會**禁止手機雙指放大**（違反 WCAG 1.4.4），建議移除；`watchlist` 頁尚無 `ErrorState`。

### 手機不再渲染 Sidebar（2026-09-28）
手機原本左上 ☰ 開側邊抽屜，但主導覽早在 P0 改版就移到 MobileBottomNav，抽屜裡只剩「登入」與
「資料來源：FinMind」兩項 → 為一顆登入鈕維護抽屜／遮罩／開關事件不划算。現況：
- `Sidebar.tsx` 改 `hidden md:flex`，移除 `isOpen` state、`toggle-mobile-menu` 事件監聽、
  遮罩、關閉鈕、手機標題與 `md:hidden flex-1` 佔位。
- 登入改掛 `TopBar` 右側：`<AuthButton variant="topbar" />` + `md:hidden`。
- `AuthButton` 新增 `variant?: 'sidebar' | 'topbar'`；topbar 走淺色主題、`border-gray-500`
  （對比 4.84 過 AA；`border-gray-300` 只有 1.47 不可用）、`min-h-[44px]`。
⚠️ 桌機登入仍在 Sidebar 底部，**兩邊不可同時出現**（TopBar 那顆是 `md:hidden`）。

### `/strong-table` 預設固定全欄位（2026-10-09）
`showAll` 預設改 `true`（原本預設精簡欄位＋一顆「顯示全部」）。溢出控制：
`overflow-x-auto [contain:paint] xl:overflow-x-visible xl:[contain:none]` ＋
`role="region" tabIndex={0}`（可鍵盤捲動、螢幕閱讀器當 landmark）。
`[contain:paint]` 的理由同月報章節——少了它 Chrome 會把巢狀溢出併進根捲動區 → 整頁橫捲 →
fixed Sidebar 蓋住第一欄。

### ⚠️ InfoTip 泡泡一律 `position: fixed`（2026-10-09 修，全站影響）
泡泡原本是 `absolute` + `left-1/2 -translate-x-1/2`，**會把自己的寬度算進祖先的 scrollable
overflow 一路傳到 `<html>`** → 靠右格子一點說明就整頁橫捲（375px 實測 `scrollWidth` 375→430，
連 fixed 的底部導覽列都被撐成 431px）。這在加放空區塊之前就存在（三大法人的「外資投資上限」
會讓 sw 變 394），只是放空新增 6 格有 3 格在右欄，觸發頻率大增。
- **clamp 位移救不了**：那只改視覺位置，overflow 仍照 `left:50%` 的版面位置計算。
- 現行作法：`fixed` ＋ 自行算座標 ＋ 夾回視窗 ＋ 下方放不下翻上方 ＋
  `max-h-[calc(100vh-16px)] overflow-y-auto`（矮視窗：740×360 實測原本泡泡底部被切 130px）。
- ⚠️ **副作用：`fixed` 泡泡會被祖先的 `[contain:paint]` 裁切** → InfoTip 一律放在捲動容器
  **之外**（`/strong-table`、`/strong-monthly` 都是把欄位說明放表格上方，就是為了這個）。
- 觸控目標：圖示視覺維持 32×32，用 `before:absolute before:-inset-1.5` 把**命中區**擴成
  44×44，符合全站 ≥44px 規則。不直接放大圖示是因為 `/strong-stocks` 單頁有 274 顆，
  放大會把列表版面撐開；`before` 是絕對定位、不佔版面。

## 強勢月報 `/strong-monthly`（2026-09-28 新增）

業主每月手工維護的 Word《強勢商品篩選》月報的自動版：一行一檔，12 欄順序與 Word 同構。
`app/strong-monthly/page.tsx` + `app/api/strong-monthly/route.ts` + **`lib/monthly-report.ts`（彙整層）**。

**欄位定義（業主親自確認的部分）**：日期＝當月**第一次**入選日；收盤價／成交量／籌碼／MA
一律取當月**最後一次**入選日（已用 81 筆比對：70 筆吻合最後一次、**0 筆**吻合第一次）；
當月強勢日期＝該檔本月所有入選日的「日」。⚠️ **同一列有兩個基準日**，改動前先確認。

**兩欄「待定義」不可自己猜**：KD、均線型態（四海遊龍/三陽開泰/糾結）。
UI 用 `TbdCell`（虛線 amber 框「待定義」），**與 null 的「—」在視覺上刻意分開**：
一個是規則未定、一個是這檔沒這筆資料。
MACD 欄填現有 `macd_status`（多/空）但標註「業主的 +↗ 記法未確認」、停用排序。

**籌碼(投信) 已於 2026-09-28 從「待定義」改為「近 N 日投信買賣超累計（張）」**（`trust_buy` 加總）。
⚠️ **語意與業主月報不同**：業主那欄是「累積持股張數」（存量），本表是一段期間的**流量**。
改的原因：投信持股沒有可靠來源——FinMind 105 個資料集只有外資有逐檔官方持股（外資有投資上限
須申報，投信沒有）；投信投顧公會月報只揭露每檔基金前十大持股與季占淨值 1% 以上（部分揭露，
加總只得下限）；商業資料商的數字本身是推估。「錨點＋每日買賣超累加」的漂移實測：台積電一年
+0.89%、聯電 +5.55%，但**宏齊一個月 −43%**、友達半年 −34%，而強勢股正好多是中小型股。
- 視窗 5/10/20 交易日可切換，**預設 20**（`lib/format.ts` 的 `TRUST_WINDOWS`）。
  伺服器一次算好三個視窗放進每一列，**前端切換 0 次網路請求**（冷算數十秒，不能為換視窗再等一輪）。
- 終點＝該檔當月**最後一次強勢日**（與收盤價/成交量/MA 同基準日），往前用交易日軸 index 位移。
- 某天沒有該檔明細 → **跳過且不計入 days**（不可當 0），`days < window` 時每格顯示
  「⚠ 資料不足 N 日，實際 M 日」＋頁面上方藍色提示列出檔數。實測 2026-09 N=20 有 10 檔
  （新掛牌/交易稀少的上櫃股）、2026-08 有 384 檔（8 月初往前真的沒有資料）。
- 表頭/subHeader/fullName/desc/sr-only **四處都寫明「累計」與期間**，避免被讀成持股。
- `trust_buy` 在 `firebase_writer` 是 `int(... or 0)`，**永遠不會是 null**，所以 0 一律是真的 0。

**已知規格落差（動工前問過、尚未有答案）**：自動母體「當月曾入選」2026-09 是 **631 檔**
（8 月 802 檔），業主人工月報只有 **82 筆**，差 7.7 倍。網站條件跑一天平均 72 檔就約等於
業主整月的量。**頁面選擇誠實顯示 631 列並在 amber 提示框標明差異待確認，刻意不自己補篩選條件。**

**效能（2026-09-28 起窗放大到 37 天：約 241 次文件讀取、~30 MB）**：
- 兩段式：先並行 `getStrongStocksByDate` 掃當月每一天（18 次、57 KB、0.2 秒）算出
  first/last/入選日；再掃「最早 last-strong-day 往前 `WINDOW_WARMUP` 個交易日 ~ 月底」的窗算數值。
- ⚠️ `WINDOW_WARMUP` 從 9（只夠 MA10）改成 **19**（夠近 20 日投信累計）：
  實測 2026-09 窗 27→37 天、數值段讀取 **162→222 次（+60）**。不放大的話
  **206/631 = 32.6%** 的列拿不到完整 20 日視窗，而那些資料**明明存在**（available_dates 有 45 天）。
  少算一個標榜「累計」的數字比多讀 60 份文件（免費額度的 0.12%）嚴重得多。
  要改回去就得同時把 `TRUST_WINDOWS` 的 20 拿掉，**不可留著 20 卻縮窗**。
- **每個日期只讀一次 `daily_data`**，每批 6 天讀完**立刻投影成瘦 close map 並釋放整日陣列**
  （峰值 heap 從 +43 MB 壓到約一天的 2 MB）。
- ⚠️ **不要為此把 `DAY_CACHE_MAX` 從 4 調大**：27 天全握在記憶體 = +43 MB heap，
  而 `apphosting.yaml` 是 memoryMiB 512 + concurrency 80 → OOM 會殺掉整個 instance。
  `getStocksByDate` 已加 **`{ cacheWrite: false }`** 選項，月報用它避免擠掉個股頁的熱快取。
- 快取做在「整月成品列」（`lib/monthly-report.ts` 的 `reportCache`，key 帶 latest_date 自動失效）
  ＋ route 的 `s-maxage=1800, stale-while-revalidate=3600`。
  ⚠️ `minInstances: 0` → 每次冷啟記憶體快取都是空的，**跨 instance 的 HTTP 快取才是主力**。
- **長遠正解**：讓 collector 每天寫一份 `monthly_strong/{YYYY-MM}` 聚合文件（前端變 1 次讀取），
  就是本專案對 `strong_stocks`/`market_index` 已做過的「寫入時聚合」。代價是要重建 Cloud Run image。

**MA5/MA10**：新增 `lib/indicators.ts` 的 `maFromCloses(closes, period)`（加法式，**不動**
`calculateMAValues`——CandleChart 依賴它的暖身/whitespace 行為）。交易日軸用 `available_dates`
的 **index 位移**取，不可用日曆天加減。序列中缺一格就回 null，**絕不用較少天數的平均充當 MA10**
（8 月初、7 月全月都會是「—」）。KD 刻意不算：遞迴平滑對起點極敏感，實測同一天用 45 天 vs 12 天
算，某檔 D 值 77.31→62.82，超買超賣判讀相反；要填應比照 `macd_status` 由 collector 算好。

**`foreign_hold_shares` 的三種缺值**：有值 / `null`（FinMind 未涵蓋，最新日 361 檔 = 15.4%，
與 `foreign_hold_ratio` 的 null 集合完全一致）/ **`undefined`（2026-08-31 及更早連 key 都沒有，
第一個有值日是 2026-09-01）**。三者 UI 都是「—」，但整月無值時頁面另有藍色提示說明是
「資料尚未收集」而非「規則未定」。**任何地方都不可寫 `?? 0`。**

**版面（12 欄天生 1454px，任何常見視窗都溢出）**：橫向＋縱向**一律關在表格自己的捲動容器**
（`components/table.tsx` 的 `TableScroll`，`overflow-auto` + **`[contain:paint]`**），
換得表頭可相對容器 `sticky top-0`、左側「日期/商品」兩欄 `sticky left`（靠 `table-fixed` +
colgroup 寫死欄寬，left 值才對得準）。實測 375/768/1024/1280/1440 的
`documentElement.scrollWidth` 全部等於 `clientWidth`。
⚠️ 少了 `[contain:paint]` Chrome 會把巢狀溢出併進根捲動區 → 整頁橫捲 → fixed Sidebar 蓋住第一欄。

**導覽**：Sidebar 第 6 項（🗓️ 強勢月報），並加了兩個輕量區段小標（「強勢股」/「工具」）把三個
同前綴的項目收成一組。路由 **不可以 `/strong-stocks` 或 `/strong-table` 開頭**（isActive 是
`startsWith`，會雙亮）。MobileBottomNav 維持 4 格，只把 isActive 併進「強勢」那顆。
三者是**同一層**：前兩者是「某一交易日」的兩種呈現，月報是「某一個月」的彙整。

**共用元件**：`lib/table.ts`（`ColDef<T,Ctx>` 泛型 registry、`Align`/`alignClass`/`SELECT`）與
`components/table.tsx`（`NullCell`/`TbdCell`/`TableScroll`）由 `/strong-table` 抽出，兩頁共用。

## 強勢股的四條實際條件（2026-10-09 校正文件；程式才是權威）

唯一權威＝`stock_collector/update_strong_matrix.py` 的 **`STRONG_CONDITIONS`**，四條**全部成立**：
```
min_volume: 500            成交量 > 500 張
min_change_pct: 3.0        漲跌幅 > 3%（以「前一交易日收盤」為基準）
require_up: True           close > open
require_institutional      三大法人「合計」買超 > 0（外資＋投信＋自營，門檻就是 0）
```
⚠️ `CLAUDE.md`／`frontend/app/strong-monthly/page.tsx` 先前寫的「多頭排列 close>MA5>MA20>MA60
＋ MACD 為正 ＋ 成交量>500 ＋ 外資或投信買超>1000」**只有成交量那條是對的**（實測 2026-09-24 的
73 檔強勢股中 9 檔 MACD 是「空」→ 根本沒有 MACD 條件；逐檔驗證上面四條則 73/73 全符合）。
**四處**敘述已於 2026-10-09 同步修正（`CLAUDE.md`、本檔、`README.md`、`/strong-monthly` 頁面的 amber 提示＋InfoTip），**改條件要先改程式再回來同步這四處**。

### ⚠️ change_pct 曾用錯基準（2026-10-09 修）
`update_strong_matrix.py` 原本 `change_pct = (close - open) / open * 100`，那是**當日振幅**不是漲跌幅。
台股慣例一律對**前一交易日收盤**（前端 2026-08-19 已統一，見上方「漲跌幅一律以前一交易日收盤為基準」）。
實例：4973 廣穎昨收 135.5→收 149.0 實際 **+9.96%** 但振幅僅 +2.76% → 漏選；
6426 統新實際 **−1.87%** 卻因振幅 +3.02% 被選為「強勢」。
- 作法：抽出 `add_change_pct(df)`。前一日一律取「同一檔股票在**資料中**的前一筆」
  （`groupby('stock_id')` + `shift(1)`），**不可用日曆天推算**（會踩到假日）。
- ⚠️ `calculate_strong(df)` 是被 `update_matrix()` **以每個年度檔一次**呼叫，df 含整年所有股票所有日期；
  **不要傳單日切片進去**（會讓每一列都落到 fallback）。
- ⚠️ 年度檔第一個交易日（如 2026-01-02）在自己的檔裡沒有前一日 → **fallback 回 `open`**，
  與前端 `prev_close > 0 ? prev_close : open` 同一條規則。全史共 4 天 8,820 檔走這條路，
  其中 **64 檔**若拿得到前一年收盤判定會不同（2024-01-02 14 檔、2025-01-02 12 檔、2026-01-02 38 檔；
  2023-01-03 是全史起點、前面本來就沒資料）。殘留 9 檔實際漲幅 ≤3% 仍入選、1 檔實際下跌仍入選，
  **全部落在這 4 天**。要根治就得讓 `calculate_strong` 多吃「前一個年度檔最後一個交易日的
  (stock_id, close)」當 seed（約 2,300 列，記憶體成本極小）。
  （原先寫 294 檔是錯的，驗證者用跨檔真實前收獨立重算為 64 檔，已更正。）
- ⚠️ **3% 門檻套在「已四捨五入到小數 2 位」的 change_pct 上**（與畫面顯示同一把尺）：
  真實漲幅 3.004% → `round(2)=3.0` → `3.0 > 3.0` 為 False 而落選。全史 125 檔次受影響
  （反方向 0 檔次，佔 0.18%）。**刻意保留**——頁面顯示 3.00% 卻說它「漲超過 3%」更難解釋。
- ✅ **護欄（2026-10-09 加）**：`_assert_prev_close_sane()` 在「只有一個交易日」或
  「**檔案第一個交易日之後**仍有 > 5% 的列取不到前一日收盤」時 **raise**。
  要防的情境：`update_matrix()` 找不到年度檔會退用 `daily_stock_*.csv`（每檔只有一天），
  而 `gcs_archive.download_archives()` 下載失敗只記 warning 就回 0 → stateless 的 Cloud Run
  會建出「只含一天」的年度檔 → 全部列 fallback → change_pct **默默變回當日振幅**，
  還把 `strong_stocks` 覆寫成錯的判定，而日誌上完全看不出異常。
  ⚠️ **比例一定要扣掉檔案第一個交易日**：對全部列算的話，比例約等於 1／交易日數
  （第一天本來就全部沒有前一日）→ 年初 `stocks_2026.csv` 只有 10 天時就是 10%，
  會把**正常**的檔案誤判成壞的（這是我第一版護欄的 bug，寫測試才抓到）。
  扣掉第一天後正常檔案 < 0.1%（只剩年中新掛牌，全史 385 檔次）。
  raise 會讓迴圈 `except ... continue` 跳過該檔；全部壞掉時 `all_data` 為空 → return None
  → **不寫 Firestore**。寧可不更新，也不要用錯的定義覆蓋歷史。
- ⚠️ **年度檔有「同一 (date, stock_id) 兩列」**（改名/轉上市留下兩個 `stock_name`，數值完全相同；
  2023~2025 每個交易日約 24 組、全史 17,760 組，2026 檔目前 0 組）。直接對原始列 `shift(1)` 會讓
  第二列把「同一天的自己」當前一日 → change_pct=0 → 誤判為非強勢。**必須先對 (stock_id, date)
  去重算前一日再按鍵對回**（現行程式已如此）。
- ⚠️⚠️ **`update_matrix()` 每次執行都重算全部歷史**（讀 4 個年度檔、對每一天重新判定 strong）
  並透過 `write_strong_stock_matrix()` 覆寫 `strong_stocks/{date}` → 這個改動會**自動改寫全部
  887 天的歷史強勢股清單**（本機年度檔 dry-run：強勢檔次 54,777 → 68,815，日均 61.8 → 77.6，
  新增 19,673 檔次、移除 5,635 檔次；「實際下跌卻入選」1,204 → 1 檔次、「平盤卻入選」114 → 0）。
  部署前要讓業主知道歷史會變。

## 放空籌碼（2026-10-09 新增；收集器 ＋ 個股頁）

### 資料來源與單位
| FinMind dataset | 原欄位 | 我方欄位 | 單位 |
|---|---|---|---|
| `TaiwanDailyShortSaleBalances` | `MarginShortSalesCurrentDayBalance` | `margin_short_balance` 融券餘額 | **股** → `//1000` 轉張 |
| 同上 | `SBLShortSalesCurrentDayBalance` | `sbl_short_balance` 借券賣出餘額 | **股** → `//1000` 轉張 |
| `TaiwanStockMarginPurchaseShortSale` | `MarginPurchaseTodayBalance` | `margin_balance` 融資餘額 | **本身已是張，不可再除 1000** |

兩支都吃 `data_id=''` 整批抓（各 1 次 API、約 2,200 檔），所以**每日批次 API 從 4 次變 6 次**
（股價／法人／外資持股／當沖／放空餘額／融資融券）。
單位已對帳：2026-09-24 全部 2,216 檔，`MarginShortSalesCurrentDayBalance//1000` 與同日官方張數欄位
`ShortSaleTodayBalance` **0 筆不一致**。

### ⚠️ 融券與借券賣出必須分開，不可只給合計
兩套制度的參與者完全不同：**融券**＝向券商借股票賣出（**散戶**為主）；**借券賣出**＝從出借方
（大股東／ETF）借券後賣出（**法人**為主）。實測台積電 2026-09-24：融券 **16 張** vs
借券賣出 **15,046 張**，相差 **940 倍**。只看融券（很多免費看盤軟體就是這樣）會把法人空單當成零。
個股頁刻意**不顯示合計數字**，合計只拿去當放空比／回補天數的分子。

### 缺值三態（與 `foreign_hold_shares` 同一套語意）
* **有值**——`0` 是真的 0（2026-09-24 有 860 檔融券餘額確實為 0）。
* **`null`**＝FinMind 未涵蓋 → 興櫃、新掛牌等**根本沒有融券／借券制度**
  （2026-09-24：2,344 檔中 468 檔無放空餘額、483 檔無融資資料）。
* **`undefined`**＝2026-10-09 之前的 `daily_data` 連 key 都沒有。

三者 UI 都是「—」。**任何地方寫 `?? 0` 都是 bug**：那會把「沒有這個制度」說成「無人放空」。

### 衍生指標（`StockDetailClient.tsx` 的「放空籌碼」區塊，手機預設收合）
* **放空比** ＝（融券＋借券賣出）÷ 已發行張數。強勢股實測 0~11.9%、中位數 1.8%。
* **券資比** ＝ 融券 ÷ 融資。**只含散戶**、不含借券賣出，InfoTip 已寫明這個限制。
* **回補天數** ＝（融券＋借券賣出）÷ 近 20 日均量 —— 軋空壓力訊號，在強勢股上辨識度最高
  （`5309 系統電` 放空比 7.7%、回補要 **9.8 天**＝空單是日均量的 9.8 倍）。
  均量取 history 最後 20 根且 `volume > 0`，不足 20 根就用實際根數並在 InfoTip 標明「實際 N 日」。
* 分母為 0 或 null 一律回 **null**，不可讓它變 `Infinity`。

### 歷史回補
`scripts/backfill_short_sale.py`（比照 `backfill_foreign_hold_shares.py` 的安全設計）：
預設 dry-run、`--write` 才寫、寫前備份 chunks 到 `logs/`、**只補「目前沒有該欄位」的股票**
（冪等可重跑）、某日 FinMind 回 0 筆就**整日跳過**（不會把全市場清成 null）。
放空餘額與融資是兩支 API，缺一邊時另一邊仍可補，故兩組欄位**各自獨立判斷有沒有**。
dry-run 實測（53 天，2026-07-24 ~ 2026-10-08）：可補放空 104,749 檔次、融資 103,890 檔次，
FinMind 未涵蓋 25,378 檔次（保持 null）。
⚠️ 「缺」的判定必須是「**沒有 key 或值是 None**」，不可只檢查 key 存不存在：
收集器對未涵蓋的股票是寫 **key + None**，所以 17:00 那班在放空資料還沒發布時跑過，
整個市場三欄都會是「key 存在但值為 None」；只檢查 key 的版本永遠補不回來，
還會把這種日子統計成「原本就有」而看不出異常。

### ⚠️ 附屬資料的 API 失敗不可拖垮整日收集
放空／融資這兩支走 **`_fetch_optional()`**（各自 try，失敗記 warning 後退成空 DataFrame），
**不共用外層那個「包住整日」的 try**。理由：FinMind 失敗是**直接拋例外**（額度用盡／後端錯誤
回的都是非 200），落到外層 `except` 就 `return None` → 當天的**股價／三大法人／外資持股／當沖
全部一起丟掉**，只為了缺一份附屬資料。現在放空抓不到只讓三欄變 null，主資料照常落地，
事後跑 backfill 補即可。
（`shareholding` / `day_trading` 仍在外層 try 裡，是既有行為，尚未一併處理——見待辦。）

## 投信累積持股：確認無可靠來源（2026-10-09 完整調查，不要再重查）

業主要的是「投信手上有多少籌碼」＝**存量**。結論：**台股公開資料裡不存在逐檔投信持股**，
因此月報那欄改成「近 N 日投信買賣超累計（**流量**）」並在表頭／subHeader／fullName／desc
四處寫明（見上方強勢月報章節）。證據：

1. **FinMind 全部 105 個資料集逐一檢查**：只有外資有逐檔官方持股（`TaiwanStockShareholding`）。
   制度原因——**外資有投資上限、須每日申報**，投信沒有這個義務。
2. **投信投顧公會（SITCA）**：只揭露「每檔基金前十大持股」與季報中占淨值 1% 以上的部位，
   屬**部分揭露**，加總只能得到下限，且是月／季頻率。
3. **商業資料商**標的「投信持股」本身就是推估值，不是申報值。
4. **「錨點 ＋ 每日買賣超累加」漂移實測**（刻意在**外資**上做，因為只有外資有 ground truth 可比對）：
   台積電一年僅 **+0.89%**、聯電 **+5.55%**，看起來可行；但 **宏齊一個月 −43%**、友達半年 **−34%**。
   誤差正好爆在中小型股，而強勢股清單**絕大多數就是中小型股** → 這條路不可用。

## ⚠️ 關鍵地雷（2026-08 踩過並修過，改動前務必留意）
1. **收集時機**：外資持股（`taiwan_stock_shareholding`）盤後**較晚**才發布，18:30 收集常抓到空 → 靜默存 0。需事後重跑補，或把排程改到台灣 ~22:00。**（2026-09-04 更新：已不再靜默存 0——缺漏改寫 null，見下方「無資料與真的是 0」章節；但「該有卻沒抓到」仍需重跑補。）**
2. **資料源日期不一致**：個股頁 K 線用 FinMind、法人用 Firestore，兩者「最新日」可能差一天 → 收盤與法人不同日。已修：法人改抓「與 K 線同一天」。
3. **「最新日」多來源**：`latest_date`（metadata，由 write_daily_data 寫）vs `available_dates[0]`（~~由 write_strong_stock_matrix 從強勢矩陣產生~~ **已改由 `update_available_dates()` 以 daily_data 為權威來源寫入**，daily_collector.py:268）vs FinMind 自己的最後一根，會各說各話。已統一以 `latest_date` 為權威。
4. **遞迴指標暖身**：MACD/KD/RSI 是 EMA 遞迴、對「資料起點」敏感，用短區間算會失真、與卡片對不上。規則：**指標一律用完整資料算**（CandleChart 重構後改為對整個 `chartData` 以 useMemo 計算、顯示範圍靠 `setVisibleLogicalRange` 控制，不再 slice 資料）。
5. **PWA 快取**：next-pwa 預設把 `/api/*` 快取 24h，使用者會看不到更新的行情。已在 next.config 改成 60s NetworkFirst。改資料相關頁記得使用者可能需硬重新整理載入新 SW。
6. **daily_data 只保留近幾天**：`available_dates` / `strong_stocks` 有 ~100 天，但 `daily_data` 沒有 → 選較舊日期時明細會空（已回 `dataMissing` 讓前端提示）。
7. **latest_date 無條件覆蓋**：collector 用 `--date` 補舊資料時會把 latest_date 倒退。已修：只在 `date >= 現值` 時更新（firebase_writer.py）。補多天時**最後一次要跑最新日**，否則 latest_date 會停在最後跑的舊日。
8. **時間週期換算**：`periodToDays` 是「交易日數」，不可拿去減聚合後的週/月 bar 數。區間篩選用「日曆天門檻」（已修）。
9. **⚠️ `strong_stock_matrix` 舊架構停更於 2024-07-03**：`getStockStrongHistory`（firebase-admin.ts）原本「先讀 `strong_stock_matrix`、有資料就用」，但該 collection 早已停更 → 「近 N 日強勢」**恆為 0**，且該 `stock_id==` + `orderBy date` 查詢還缺複合索引（噴 `FAILED_PRECONDITION`）。**已改為只讀現行 `strong_stocks/{date}`**（`getAvailableDates` + `getStrongStocksByDate`，才是最新權威來源；元素為 `{stock_id, stock_name}`）。強勢股的權威來源＝`strong_stocks/{date}` + `metadata/available_dates`。
   **（2026-09-05 更新：`strong_stock_matrix` collection 已整個刪除（19,000 文件，備份在 `logs/legacy_backup/`）。當時只修了 `getStockStrongHistory`，`getStrongStocksByDate` 仍留著它當備援——會在主來源偶然缺漏時默默回傳 14 個月前的舊資料，現已一併移除。⚠️ 注意 `firebase_writer.write_strong_stock_matrix()` 函式**名稱是舊的但實際寫入 `strong_stocks`**，別被名字誤導而以為它會重建舊 collection。）**
10. **~~firestore.indexes.json 與實際部署有落差~~（2026-09-05 已清理）**：原本檔案列 4 個索引（`daily_stocks`×2／`market_index_daily`／`strong_stock_matrix`）、線上另有孤兒索引 `stock_analysis_reports`——**對應的 collection 全部不存在**。5 個索引已全刪、`firestore.indexes.json` 的 `indexes` 已清空，兩邊一致。
    **現行查詢不需要任何複合索引**（前端唯一的 `orderBy('date')` 無 `where`，走自動單欄位索引；`alert_checker` 的 `collection_group('alerts').stream()` 也無條件）。新增 `where`+`orderBy` 組合時才需要補。
    ⚠️ 先前「勿用 `--force`」的警告**已失效**（那個要保護的孤兒索引本來就該刪）。
11. **`market_index/{id}` 的 history 項目不帶 `index_id`／`index_name`**：(a) `IndexChart` 原本用 `data[0].index_id` 判斷 TAIEX/TX 決定成交量單位（億/口）→ 恆 undefined → `isTaiex` 恆 false → **加權成交量誤標「口」**（應「億」）。已修：**父層 `page.tsx` 明確傳 `indexId` prop**、`data[0]` 只當 fallback。(b) 同理 history 也沒 `index_name` → 首頁卡片 `index_name` 空白。已修：**market-index API route 用代號補中文名**（TAIEX→加權指數、TX→台指期）。**注意 API 有 `s-maxage=300` 快取**，改後舊回應可能還在（dev 亦然），驗證要 `fetch(..., {cache:'no-store'})` 或等 5 分鐘。
12. **⚠️ FinMind 的 TAIEX 成交量有「整段源頭缺漏」**（2026-08-15 用 TWSE 補過 2026-02 全月 12 天）：`taiwan_stock_daily(stock_id='TAIEX')`（=`TaiwanStockPrice`）某些歷史區間只回指數點位、`Trading_Volume`＝`Trading_money`＝0；collector 忠實照抄 → `market_index/TAIEX` 該段 `volume=0` → **大盤技術圖成交量直方圖空一段**（K棒/均線/MACD 正常，靠 close 算；**個股不受影響**，前端直打 FinMind live）。**重跑 `index_collector` 無效**（FinMind 就是回 0）。**決定不改 collector**（罕見事件、低維運）：需要時跑一次性工具 **`scripts/backfill_index_volume_from_twse.py`**——用證交所 **TWSE FMTQIK**（`exchangeReport/FMTQIK?response=json&date=YYYYMM01`，回整月；欄位『成交股數』＝我方 `volume`、與 FinMind `Trading_Volume` 同單位、量級 ~1e10 股；ROC 日期 +1911；用 TWSE 加權指數收盤與現有 `close` 對帳確認日期無誤）只補 `volume==0` 且 close 對得上的日期。`write_market_index` 是**單 doc + history 陣列、upsert-by-date** → 安全、總筆數/`latest_date` 不變。稽核法：讀 `market_index/{TAIEX,TX}` history 找 `volume==0`（TX 用 FinMind 期貨、通常無此問題）；日期缺口用 **TAIEX vs TX 是否一致**判斷「休市(真)vs 缺資料(假)」。補完前端 API 有 ~5 分鐘快取才反映，**資料層即時、無需重新部署**。

## 已修 bug 清單（2026-08 本次 session，均已部署）
**前端**：A2 週/月K 區間鈕單位、A3 月K MACD 暖身（K 線抓 5 年）、B1 個股頁日期錯位、B2 找不到時假 0（改顯示「—」）、B3 強勢股 dataMissing 提示、B4 最新日統一、MACD 卡片 vs 圖表一致（指標用完整資料算）、PWA 快取 24h→60s。
**後端**：C1 輔助資料整批 0 警示、C2 驗證改當日切片、C3 latest_date 不倒退、C4 Firestore 寫入失敗醒目、C6 指數 upsert、C7 MACD 改本地年度檔計算（`add_macd_from_archive`，零 API）。

## 已修 bug 清單（2026-09-04/05 session，均已部署驗證）
1. **「無資料」被寫成 0**（外資持股三欄＋當沖量）→ 收集器改留 NaN、`firebase_writer._opt_num()` 寫 None、前端 `num()` 保留 null。歷史用 `scripts/backfill_null_vs_zero.py` 回補 30 天（0→null 共 52,917 格）。詳見下方專章。
2. **股→張換算前後端不一致**（`Math.round` vs `astype(int)`，實測 8 檔中 3 檔差 1 張）→ `finmind.ts` 全檔統一 `Math.trunc`。
3. **ETF 代碼掉前導零**（`0050`→`50`，中的是最熱門 ETF）→ 8 處 `read_csv` 補 `dtype`、`_norm_stock_id()` 第二道防線、`scripts/fix_stock_id_leading_zero.py` 修 7,098 列 CSV + 252 筆 Firestore。詳見下方專章。
4. **5 段永遠不會執行的舊架構備援**（其中 3 個 collection 根本不存在）→ 全部移除；`strong_stock_matrix` 那段是潛在 bug（會回傳 14 個月前舊資料）。
5. **個股頁跨請求重讀 0.9 MB** → 加 `dayCache`（TTL 5 分鐘），中位數 0.72→0.54 秒。

## 已修 bug 清單（2026-10-09 session）

**程式（collector 端尚未部署，見「改 collector 不會自動部署」）**
1. **`change_pct` 用的是當日振幅不是漲跌幅** → 抽出 `add_change_pct()`，改以前一交易日收盤為基準。
2. **年度檔有重複 `(date, stock_id)` 列**（全史 17,760 組）→ 直接 `shift(1)` 會把「同一天的自己」
   當前一日 → 先去重算前一日再按鍵對回。修掉這點讓全史強勢檔次由 68,457 修正為 68,815。
3. **GCS 年度檔下載失敗會默默退化成振幅並覆寫歷史** → 加 `_assert_prev_close_sane()` 護欄。
4. **放空／融資 API 失敗會丟掉整天的主資料** → 抽出 `_fetch_optional()`，各自 try。
5. **回補腳本只檢查 key 存不存在** → 改成「沒有 key 或值是 None」都算缺；
   `fetch_short` 的兩欄改為各自獨立（原本一欄壞掉另一欄也補不到）。

**前端（已部署）**
6. **InfoTip 泡泡讓整頁橫捲**（absolute 的寬度算進祖先 overflow，375px 下 sw 375→430，
   連 fixed 底部導覽列都被撐成 431px）→ 改 `position: fixed` 自算座標；並補上矮視窗的
   上下夾限與 `max-h`（740×360 原本泡泡底部被切 130px）。詳見上方 InfoTip 專章。
7. **強勢股條件文件四處都是錯的** → CLAUDE.md／SKILL.md／README.md／`/strong-monthly`
   的 amber 提示同步成實際四條，並在頁面加 InfoTip 說明舊敘述錯在哪。
8. **兩個收合區塊缺 `aria-expanded`／`aria-controls`、標題是 div 不是 heading**
   → 補 aria 並把「三大法人買賣超」「放空籌碼」改成 `<h2>`（視覺不變）。
9. **InfoTip ⓘ 命中區只有 32px，違反全站 ≥44px** → `before:-inset-1.5` 擴成 44×44，
   視覺維持 32px（`/strong-stocks` 有 274 顆，放大會撐開版面）。
10. **三處註解在 InfoTip 改 fixed 後過時且誤導**（說泡泡是 absolute、會撐長捲軸）
    → 改成「fixed 不撐捲軸，但會被 `[contain:paint]` 裁切，仍要放在捲動容器外」。

## GCP 成本（2026-08-29 稽核、2026-10-09 補充）

**估成本前先讀真實帳單**：第一次我拿牌價乘現有資源大小去推算，**沒看 Billing 報表**，
被業主用帳單截圖更正。而且報表是**整個計費帳戶**（3 個專案共用）、不是單一專案 —— 兩個錯一起犯。

- **Secret Manager 的 `automatic` 複寫逐地區計費**，每個版本約 $0.68/月（牌價的 ~11 倍）；
  **停用（disabled）仍然計費，只有銷毀（destroy）才免費**。
- Artifact Registry 已設 cleanup policy（保留最新 3 份）；`firebaseapphosting-images`
  **由 App Hosting 自管**（30 分鐘清一次），不要自己插手。
- GCS 兩個 bucket 都有 **7 天軟刪除** → 刪完要等一週帳單才會降，不要以為沒生效。
- `minInstances: 0` **千萬別改 1**（+$10~15/月）。冷啟 2~5 秒是刻意換來的。

⚠️⚠️ **`gs://stock-analysis-b5602-archive/archive/stocks_20XX.csv` 是線上服務的活依賴，
不是冷備份**：每次 collector run 一開始就下載（`gcs_archive.py:32`）、`streak.py:26` 與
`update_strong_matrix.py:98` 讀它、跑完再上傳回去。Firestore `daily_data` 只留 ~53 天，
**這 4 個 CSV 是唯一的完整歷史**（也是 MACD 與強勢股矩陣的計算來源）。
**絕對不可設 lifecycle 規則、不可刪、不可轉冷儲存層**，省不到幾毛卻會讓收集器算不出歷史。

## 待辦（尚未修，附具體修法）
- **🔴 等業主決定：強勢股歷史要不要依新漲跌幅重算**。程式已改（`add_change_pct`），但
  **Cloud Run Job image 沒重建就不會生效**（見上方「改 collector 不會自動部署」）。
  重建的同時會把 887 天的 `strong_stocks/{date}` 依新規則全部覆寫：
  強勢檔次 54,777 → 68,815（日均 61.8 → 77.6）、727 天變多／138 天變少／22 天不變、
  單日最大 +204（2025-04-23）／−333（2026-06-08）、「實際下跌卻入選」1,204 → **1**、
  「平盤卻入選」114 → **0**。**B 與 C 共用同一次 image 重建，無法只上其中一個。**
- **放空資料目前只有前端，沒有新資料進來**：image 未重建 → `daily_data` 不會有那三欄。
  歷史要跑 `scripts/backfill_short_sale.py --write`（53 天、可補 ~10.4 萬檔次）。
  在 image 重建前，每天新資料都需要手動補一次。
- **跨年第一個交易日的 fallback 可根治**：讓 `calculate_strong` 多吃「前一個年度檔最後一個
  交易日的 (stock_id, close)」當 seed（約 2,300 列）。目前殘留 64 檔判定不同（見上方專章）。
- **`shareholding` / `day_trading` 仍在「包住整日」的 try 裡**：任一支拋例外會丟掉整天資料。
  改法同放空——用 `_fetch_optional()` 包起來（已寫好、可直接複用）。
- **月報的基準日還沒有單一規則**（業主人工月報本身就沒有一致規則，數值是「填表當下的快照」、
  集中在 09/21）。目前程式取「當月最後一次入選日」並已用 81 筆比對（70 筆吻合、0 筆吻合第一次）。
- **月報兩欄仍「待定義」**：KD 的 `+↗` 記法、均線型態（四海遊龍／三陽開泰／糾結）的定義，
  以及價格前綴 `ↆ` 的意思。**不可自己猜**，UI 用 `TbdCell` 與 null 的「—」刻意分開。
- **C3 `run_incremental` 已失效（但不影響排程）**：`get_missing_dates` → `get_latest_date_from_db` 查的是 `daily_stocks` / `market_index_daily`，**這兩個 collection 現已不存在** → 一律回 None。所幸**排程走的是 `run_daily`**（Cloud Run Job 無傳參數，Dockerfile ENTRYPOINT `python -m stock_collector.daily_collector` → argparse 落到 else 分支），`run_incremental` 只在手動加 `--incremental` 時才跑。**要補缺口請改用 `--backfill-gaps`**（`get_gap_dates()`，用「交易日全集 − 已存在日期集合」，是正確做法）。若要修 `run_incremental`，就是把它改成呼叫 `get_gap_dates()`。
- **A1 列表 vs 個股 MACD 完全統一**：C7 後 Firestore `macd_status` 已有值（列表可用），但個股頁仍前端算，資料源不同、極臨界日可能小差異。要完全一致需二選一單一來源。
- **安全：本機的 `service-account.json` 可以整個拿掉**（2026-09-05 查證更正）。
  ~~私鑰會被 bundle 進 `.next`~~ —— **實測不成立**：拿金鑰內容去比對 `.next` 全部檔案，命中 0；先前看到的 `private_key` 字樣是 firebase-admin 函式庫自己的程式碼。
  但真正的問題是：**生產環境根本不需要這把金鑰**（`apphosting.yaml` 未設 `FIREBASE_SERVICE_ACCOUNT_KEY`，App Hosting 同專案走 ADC），它只為本機開發存在，卻是專案唯一「洩漏就完蛋」的長期憑證。
  修法：本機改用 `gcloud auth application-default login`（Python 端也吃 ADC），然後刪檔並在 IAM 撤銷該金鑰。`firebase-admin.ts` 的三層 fallback（env → 檔案 → ADC）本來就會落到 ADC，不必改程式。
- **「為什麼強」兩條路（2026-08-19 規劃，皆未做）**——共同前提：突破/爆量/站上MA20/MACD金叉都要**逐檔歷史**才算得出來。
  - **~~B2 個股頁 Signal Engine~~（§37）✅ 已完成（`frontend/components/StockSignals.tsx`，132 行，掛在 StockDetailClient.tsx:214）**：個股頁**本來就載入該檔完整 K 線 history、也已算好 MA/MACD/KD/RSI**（畫圖用）→ 直接在前端判斷即可，**零額外 API、純前端**。做一個「今日訊號」區塊列出：突破近20日高、量為5日均量 N 倍、MA5>MA10>MA20、MACD 金叉、KD/RSI 超買超賣，每條附白話解讀。**限制：只服務個股頁，清單卡片吃不到。**
  - **B1 清單「強勢原因」chips（§18；動後端）**：強勢股清單一次 40+ 檔，前端逐檔打 FinMind 會慢又撞免費額度（600/hr）→ 必須由收集器算好。步驟：① 在 collector 用**年度檔**（就是算 MACD 那套、零 API）多算 flag（突破20日高／量÷5日均量／站上MA20／MACD 今日空→多）；② 寫進 `daily_data` 每檔（`firebase_writer._convert_stock_row` 加欄位，如 `reasons: string[]`）；③ **`gcloud run jobs deploy stock-collector --source=.` 重建 image**（改 collector 不會自動部署，見運維地雷）；④ `--date` 回補近幾天（daily_data 只留 ~16 天）；⑤ 前端 `StockCard`/強勢股/首頁讀 `reasons` 顯示 chips，並把 Quick Filter 的「突破/爆量」從近似值改為真 flag。

## 運維現況（2026-08 排查結論）
- **GitHub Actions 沒有斷**：2026-07-24 才從 Supabase 遷 Firebase 並首次加 Actions，7/24 初設失敗 2 次（依賴/憑證）當天修好，7/27 起 cron 每交易日穩定成功。**上半年缺資料是因為當時根本沒這套系統**，非中斷。
- **收集排程已改為台灣 22:00**（cron `0 14 * * 1-5`，原 18:30），等外資持股發布後才收集，根治「每天外資持股 0」。
- ⚠️ **GitHub 會自動停用「連續 60 天無 commit」repo 的排程 workflow**——長期只靠 cron、沒人 push 會讓收集真的斷掉；要嘛定期 commit，要嘛用外部排程觸發。
- 排查指令：`gh run list --workflow=daily-collect.yml`（看每交易日成功與否）。

## 部署與資料持久化（2026-08）
- **排程已改用 Cloud Run**（2026-08 上線驗證成功，30 秒完成一次收集）：Cloud Run Job `stock-collector`（asia-east1）+ 兩個 Cloud Scheduler（`stock-collect-1700`/`2200`，UTC 09:00/14:00 = 台灣 17:00/22:00）。**GitHub Actions 的 schedule 已停用**（保留 workflow_dispatch 手動備援）。
- **Cloud Run Job 部署踩過的 5 個坑**（deploy-cloudrun.sh 已全部處理，未來重建照做）：
  1. Dockerfile 必須 `COPY gcs_archive.py`（漏了 → 啟動即 ModuleNotFoundError）
  2. `daily_collector.py` 的 `Path('logs').mkdir` 必須在 `logging.basicConfig` **之前**（否則 FileHandler 開檔 FileNotFoundError）
  3. IAM 授權必須在 `gcloud run jobs deploy --set-secrets` **之前**；且專案 IAM 有條件式 binding，`add-iam-policy-binding` 要加 `--condition=None`
  4. 記憶體要 **2Gi**（強勢股矩陣讀全部年度檔 + pandas pivot，512Mi 會 OOM）——這也是「強勢股矩陣每天全量重算」待優化的訊號
  5. Firestore 用 ADC、FinMind 用 Secret Manager、年度檔用 GCS（見下）
- **年度檔持久化（GCS）**：collector 是 stateless（年度檔在本地/CI 每次為空），故 `gcs_archive.py` 在 run_daily 開始下載、結束上傳年度檔到 bucket `gs://stock-analysis-b5602-archive`（`USE_GCS_ARCHIVE=1` 啟用）。這讓 MACD/強勢股矩陣在雲端也有完整歷史。GH Actions 也設了此環境變數。

## ⚠️ 上版驗證：HTTP 200 不等於部署成功（2026-10-09 自己踩的事故）

`git add frontend/app/strong-table/page.tsx` **只 commit 了單一檔案**，漏掉它新 import 的
`lib/table.ts` / `components/table.tsx` → App Hosting 建置 `a3d2d4f`、`bd9fc1d` **連續兩次失敗**，
線上約 1 小時持續服務舊版（`build-2026-09-28-001`）。`26096bf` 補上檔案才恢復。

**為什麼沒被發現**：App Hosting 建置失敗會**保留前一個 revision 繼續服務** →
「curl 回 200」「頁面打得開」**全部都會通過**。用 HTTP 狀態碼驗證上版等於沒驗證。

**正確驗證方式**（改前端後一定要做）：
```bash
gcloud builds list --project stock-analysis-b5602 --limit 5 \
  --format='table(id,status,createTime)'      # 最新一筆必須是 SUCCESS
```
**習慣要改掉**：改前端一律 `git add -A frontend`，或先 `git status` 確認新檔都進去了。
跨檔重構特別容易漏掉新建的共用模組。

## ⚠️ 改 collector 不會自動部署（決定「歷史何時被改寫」的開關）

push 到 `main` 只會讓 **App Hosting 重建前端**。`stock_collector/` 與 `firebase_writer.py`
跑在 **Cloud Run Job 的 image** 裡，不重建就還在跑舊程式：
```bash
gcloud run jobs deploy stock-collector --source=. --project stock-analysis-b5602 --region asia-east1
```
這一點是**安全閥**也是**陷阱**：
- 安全閥：改了強勢股判定邏輯後，`strong_stocks` 的 887 天歷史**不會**在下一班排程被改寫，
  要等 image 重建。
- 陷阱：以為「push 了就生效」→ 新欄位永遠不會出現在 `daily_data`，前端那一區永遠是「—」。

## 清理與模組化狀態（2026-08）
**已清理死碼**：`utils.py`（844 行舊 Streamlit 死碼）→ 精簡成 `stock_collector/indicators.py`（只 get_macd_status）；`update_macd.py` 逐檔打 API 舊版；`firebase_writer.py` 3 個死讀取器；前端 `getStockHistory`/`verifyIdToken`/`getPopularStocks`/`getAllStocks`/`getUser`；requirements 的 `ta`/`tqdm`/`loguru`。
**待模組化（大重構，建議在乾淨 session 做 + 充分測試）**：
- `stock_collector/stock_collector.py`（618 行）→ 拆 `transforms.py`（純 DataFrame 轉換，可單元測試）、`fetchers.py`（4 支批次 API）、`archive.py`（年度歸檔，與 merge_daily_files 重疊可整併）
- `firebase-admin.ts`（清理死碼後 **299 行**）→ 可拆 init 與 queries/（stocks/strong/index 分組）
- `firebase_writer.py` → 拆 `firestore_client.py` 與 `writers.py`
**待清理（中信心，需先確認）**：`merge_daily_files.py`（已被 _append_to_yearly_archive 取代，若不再手動回補可刪）；`WatchlistButton.tsx`（孤兒元件，但可能是「加入自選」待辦）；~~`firebase-admin.ts` 舊架構 fallback~~ **✅ 2026-09-05 已完成**（移除 5 段，其中 3 個 collection 根本不存在）。DailyStock interface **不可刪**（StrongStock 繼承它）。

## ⚠️ 驗證工具本身的坑（量測前先讀，不然會得到假結論）

1. **`resize_window` 之後一定要 reload 再量**：沒 reload 時 2026-10-09 在 375px 量到
   「橫向溢出」，reload 後 `scrollWidth - clientWidth` 是 0。（月報章節也踩過同一個。）
2. **Tailwind v4 JIT：原始碼裡沒出現過的 class 根本不存在**。想比較
   `border-gray-400/500/600` 的對比度而在 console 建臨時元素讀 computed color，
   會拿到「class 不存在 → 繼承的近黑色」→ 算出假的 17.93 對比。
   **只能改原始碼、重建、再量。**
3. **`offsetParent !== null` 判斷可見性對 `position: fixed` 無效**
   （fixed 元素 offsetParent 是 null 卻看得見）→ 改用 `getComputedStyle(el).display !== 'none'`。
4. **API route 有 `s-maxage` 快取**，改完立刻 fetch 可能拿到舊回應 →
   用 `fetch(url, {cache:'no-store'})` 或等快取過期。
5. **「本機沒有設定檔」不代表沒有整合**：我依「repo 裡找不到 Vercel 設定」就回答
   「不會再 push 到 Vercel」，被業主追問後查 GitHub API，發現 `vercel[bot]` 當天還在部署
   （最後兩次建置失敗）。**整合是掛在 Vercel 那一側的**，要去 Vercel／GitHub App 設定看，
   而不是 grep 本機檔案。（該整合已於 2026-10-09 移除，現在只走 Firebase App Hosting。）
6. **本機年度檔可能落後於權威來源**：`data/` 不進版控，GCS 才是權威。
   本機跑 dry-run 前先確認最後一個交易日（2026-10-09 當時本機只到 2026-09-04）。

## 常用指令
```bash
# 補某交易日（含法人/外資持股/當沖/指數/強勢股/MACD）
python3 -m stock_collector.daily_collector --date 2026-07-31
# 補歷史指數
python3 -m stock_collector.index_collector --days 730
# 放空資料回補（預設 dry-run，--write 才寫入；只補缺的、冪等可重跑）
python3 scripts/backfill_short_sale.py                        # 稽核 + 預覽
python3 scripts/backfill_short_sale.py --month 2026-10 --write
# 大盤成交量缺漏補資（FinMind 缺量時改抓 TWSE；預設 dry-run，--write 才寫入）— 見地雷 #12
python3 scripts/backfill_index_volume_from_twse.py            # 稽核 + 預覽
python3 scripts/backfill_index_volume_from_twse.py --write    # 實際補
# 前端建置
cd frontend && npm run build
# 部署 Firestore rules/indexes（前端部署走 App Hosting 自動 rollout）
# 註：2026-09-05 起 firestore.indexes.json 的 indexes 為空、線上也已無複合索引，兩邊一致，
#     這段目前等同只部署 rules。新增 where+orderBy 查詢時才需要補索引。
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project stock-analysis-b5602
```
查 Firestore 現況：寫小 script 用 `firebase_writer.get_firestore_client()`（Python）或 `firebase-admin`（TS），
讀 `metadata/latest_date`、`daily_data/{date}/chunks`。憑證目前吃 `frontend/service-account.json`，
但**建議改用 `gcloud auth application-default login` 走 ADC 後把金鑰刪除**（見上方安全待辦）。

## 「無資料」與「真的是 0」必須分開（2026-09-04 修正）

**症狀**：個股頁上方顯示「外資投資上限 0.00%」（法規上不可能）、「當日當沖 0.0%」，
但同一頁**下方籌碼圖**顯示「此股無外資持股申報資料」／「無當沖資料」——上下打架。
實例 5297 廣化：當日外資買超 61 張，持股比例卻是 0%。

**根因**：`daily_data` 的雙軌資料源 + 四層補 0
- 上方數字讀 **Firestore**（缺漏一路被補成 0）；下方圖表**直接打 FinMind**（看得見「沒有」）。
- 補 0 發生在四個地方：`_process_shareholding_data` 的 `fillna(0)`、`_merge_data` 的
  `fillna(0.0)` / `fillna(0).astype(int)`、`firebase_writer` 的 `or 0`、前端 `stock-data.ts` 的 `?? 0`。
  只要有一層補 0，下游就永遠分不出來。

**現在的正確做法**
- 收集器缺漏一律留 `NaN`／`pd.NA`（當沖量用 `Int64` 可空整數），`firebase_writer._opt_num()`
  轉成 `None` → Firestore 存 null。**但價量與法人買賣超維持補 0**（那裡 0 多半是真的，
  樣本中投信有 78% 當天真的沒買賣）。
- 前端 `stock-data.ts` 的 `num()` 保留 null，UI 顯示「—」。
- ⚠️ 判斷缺資料**不要用啟發式**（例如「limit_ratio==0 就當缺」）。權威做法是向 FinMind 取
  該日整批清單，比對 stock_id 是否在集合內。

**FinMind 資料集覆蓋率（實測 2026-09-03，全市場 2343 檔）**
- `TaiwanStockShareholding`：363 檔沒有（約 15%）
- `TaiwanStockDayTrading`：619 檔沒有（約 26%），另有 140 檔有列入但當天真的是 0
- 缺的多為上櫃／新掛牌（`3xxx`/`5xxx`/`6xxx`/`7xxx`）。**強勢股頁受害最重（43%）**，
  因為強勢股本來就多是中小型股。

**股→張換算：一律 `Math.trunc`**
收集器是 `(x/1000).astype(int)`（向零取整）。前端若用 `Math.round` 會差 1 張
（實測 8 檔中 3 檔不一致，如 5297 顯示 2273 但 Firestore 是 2272）。`finmind.ts` 全檔已統一
`Math.trunc`。這個坑先前只在法人數字修過一次，成交量/當沖量漏掉。

**回補工具**：`scripts/backfill_null_vs_zero.py`（預設 dry-run，`--write` 才寫；
只改目前值為 0 者；FinMind 該日抓不到就整日跳過，避免誤清全市場；自動備份到
`logs/backfill_backup/`）。2026-09-04 已對 daily_data 全 30 天執行完畢。
**注意 `strong_stocks` 只存 stock_id/stock_name，所有數值都在 `daily_data`（保留約 30 天），
所以回補範圍就只有這些。**

## ETF 代碼前導零：pandas 的隱形殺手（2026-09-05 修正）

`pd.read_csv()` 未指定 `dtype={'stock_id': str}` → `0050` 被讀成整數 `50`。而寫 Firestore
的 DataFrame 正是從 CSV 讀回來的（`daily_collector.py:124`），於是 **11 檔 ETF（0050 元大台灣50、
0056 元大高股息…）在 Firestore 與年度檔全部掉零**。個股頁用 `0050` 查不到 → 三大法人／
外資持股／當沖整區顯示「—」與「當日資料尚未提供」，中的是台股最熱門的 ETF，卻沒人發現。

- **所有 `read_csv` 都要帶 `dtype={'stock_id': str}`**（專案內共 8 處，已全補）。
- `firebase_writer._norm_stock_id()` 是第二道防線：台股代碼最短 4 碼，`len<4` 一律 `zfill(4)`
  （ETF 的 5-6 碼不受影響）。套用於 daily_data／strong_stocks／strong matrix 三個寫入點。
- 修既有資料用 `scripts/fix_stock_id_leading_zero.py`。CSV 採**逐位元組處理**
  （`split(b',', 2)` 只改第 2 欄，date 欄無逗號故位置可靠），驗證方式是
  「位元組增量 == 受影響列數 × 2」＋逐行比對確認 stock_id 以外 0 差異。
- 這類問題**用「值對不對」是看不出來的**，要比對「兩邊的 stock_id 集合差異」才會現形。

## Firestore 只有 4 個 collection（2026-09-05 清理後）

`daily_data`（約 31 天熱資料，分片每片 500 檔）、`strong_stocks`（每日聚合，886 天）、
`market_index`（TAIEX/TX 各一份文件，history 陣列）、`metadata`（latest_date／available_dates）。

**已刪除的舊架構**：`strong_stock_matrix`（19,000 文件，停在 2024-07-03）、
`market_index_daily`（520 文件，停在 2026-07-23）。兩者的日期都被現行結構 100% 涵蓋，
備份在 `logs/legacy_backup/`。

`firebase-admin.ts` 原本有 **5 段永遠不會執行的備援**，其中 3 個 collection
（`stocks_by_date`、`daily_stocks`、`strong_stocks_by_date`）**根本不存在**。
`strong_stock_matrix` 那段更是潛在 bug——會在主來源偶然缺漏時默默回傳 14 個月前的舊資料。
**寫「多層備援」前先確認那些 collection 真的存在且有在更新**，否則只是把過期資料變成隱形地雷。

## 效能：個股頁的瓶頸是 FinMind 不是 Firestore

`getStocksByDate()` 一次讀 1 summary + 5 chunks（約 0.9 MB／2,343 檔），但個股頁只用其中
1 檔的十幾個欄位。已加跨請求快取（TTL 5 分鐘、最多 4 天，`firebase-admin.ts` 的 `dayCache`）——
React 的 `cache()` 只在單一請求內有效，跨請求仍會重讀。

實測：個股頁中位數 0.72 秒 → 0.54 秒（約 -25%）；各 API 皆 0.12~0.26 秒。
**剩下的時間主要是 FinMind 抓 5 年 K 線的外部呼叫**，再優化 Firestore 收益有限；
若要再快，方向是縮短首載的 K 線範圍（目前內嵌 1,214 點、HTML 184 KB，但預設只顯示 3 個月）。

⚠️ `dayCache` 回傳的陣列由呼叫端共用，呼叫端只能用 filter/map 產生新陣列，**不可就地修改**
（現有呼叫端已逐一確認：`screener` 的 `filtered.sort()` 排的是 `filter()` 產生的新陣列）。

## 版控與資料檔（2026-09-05 整理）

**`data/` 不進版控**，權威來源是 GCS `gs://stock-analysis-b5602-archive/archive/`。
本機需要時 `gcloud storage cp` 取。雲端不受影響（`.dockerignore` 排除 `data/`、
Cloud Run 設 `USE_GCS_ARCHIVE=1`）。

踩過的坑：`.gitignore` 早就有 `data/daily_reports/archive/*.csv` 規則，但檔案在加規則前
就已入版控——**gitignore 對已追蹤檔案無效**，要 `git rm -r --cached` 才會真的移出。
結果 82MB 一直跟著 repo，而且修 ETF 前導零時只修了 GCS，版控裡那份變成過期副本。
HEAD 追蹤量已從 82MB 降到 1.0MB（淺層 clone 抓的就是這個）；
`.git` 歷史仍保有舊 blob（182MB），未做 history rewrite——需 force-push，風險不值得。

**Firestore 已開啟刪除保護**（`DELETE_PROTECTION_ENABLED`，免費）。PITR 維持關閉
（會讓儲存費用倍增，而資料可重新收集，不值得）。
