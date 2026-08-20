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
1. GitHub Actions 每交易日 → `daily_collector` 抓 FinMind（股價 / 三大法人 / 外資持股 / 當沖 / 指數）
2. 寫 Firestore：`daily_data/{date}/chunks`（每日全市場，**只保留近幾天**）、`strong_stocks/{date}`（~100 天）、`market_index/{TAIEX,TX}`（history 陣列）、`metadata/{latest_date, available_dates}`
3. 前端讀 Firestore；**但個股 K 線改打 FinMind REST（`lib/finmind.ts`，單股完整歷史，繞過 Firestore）**、MACD 由前端 `lib/indicators.ts` 自算

## 個股頁功能與全站搜尋（2026-08 擴充，皆前端；收集器/排程未動）
個股頁 `app/stock/[id]/`（`StockDetailClient.tsx`）：
- **當日當沖比例**：資訊卡片一格，= `day_trading_volume / volume`（當沖量早已由 collector 抓 `TaiwanStockDayTrading` 存進 daily_data）。技術圖「指標」下拉多一項 **當沖比例**（子圖畫每日 %）；歷史當沖量由 `lib/finmind.ts` 的 `fetchStockDayTrading()` 抓 FinMind、在 `stock-data.ts` 併入 K 線 `history`。大盤圖無此欄位 → `CandleChart` 以 `hasDayTrade` 自動隱藏該選項。
- **三大法人趨勢圖**：`components/InstitutionalChart.tsx`（獨立 lightweight-charts 折線，**刻意不併進 K 線子圖**以避開多子圖 priceScale 對齊坑）。資料 client 端 lazy 打 `app/api/stock/[id]/institutional/route.ts`（回 `{ data, holdings }`）。**兩模式切換**：
  - **買賣超**：`fetchInstitutionalHistory()`（FinMind `TaiwanStockInstitutionalInvestorsBuySell`）累計買賣超。定義**比照收集器**：外資=`Foreign_Investor`、投信=`Investment_Trust`、自營=`Dealer_self`+`Dealer_Hedging`，`(buy−sell)/1000` 後 **`Math.trunc`**（對齊 `_process_institutional_data`+firebase_writer `.astype(int)`；用 `Math.round` 會差 1 張）。
  - **外資持股**：`fetchForeignShareholding()`（FinMind `TaiwanStockShareholding.ForeignInvestmentShares÷1000`）畫**外資實際持股張數**（官方申報的絕對持有量，非買賣超累加）。⚠️ **只有外資有逐檔官方持股**，投信/自營無此資料 → 不做「持股」模式，只在買賣超顯示。
- **技術分析圖 `CandleChart.tsx`（2026-08 大改；`StockChart`個股·張 / `IndexChart`大盤·億/口 共用）**：
  - **架構**：不再是「三張獨立 chart 疊 + 動態同步右軸寬」的舊脆弱做法。改為 **1 張主圖（K線+MA+布林+成交量半透明疊底）＋ 每個指標各一張同步子圖**（指標**多選 ≤2**）。對齊靠 **固定右軸寬 68px（`AXIS_WIDTH`）+ 邏輯範圍同步（`subscribeVisibleLogicalRangeChange`）+ 十字線同步** → 天生對齊，**已移除 requestAnimationFrame/ResizeObserver 喬寬的舊 hack**。
  - ⚠️ **各子圖系列必須保留完整時間軸**（暖身期 null 用 whitespace `{time}` 佔位，用 `toLineWS`／histogram 亦然；**勿用會濾 null 的 `toLineData` 或 `.filter`**）。否則 MACD 等指標系列從第 ~33 根才開始 → 子圖時間軸起點與主圖不一致 → 用 logical index 同步時錯位 → **K 棒與 MACD 柱水平對不上**（2026-08-13 踩到並修）。主圖有 K 線錨定完整範圍故 MA/BB 可濾；指標子圖沒錨定，務必用 whitespace。
  - **互動**：開啟 `handleScroll/handleScale`（滾輪縮放 + 拖曳平移）；`3M/6M/1Y/2Y` 改用 `setVisibleLogicalRange`（bar 索引，避開「非交易日字串讓 `setVisibleRange` 失效 → 退回 fitContent 顯示全 5 年」的坑）。全量資料載入、指標用完整資料算，顯示範圍靠邏輯範圍而非 slice。
  - **視覺**：左上讀值整合一份（日期/收含漲跌%/量 + 有開的 MA/布林/各指標值）；最新價水平線 + 價籤；成交量半透明疊主圖底部（`vol` overlay 價軸）；版面 preset（價格為主/均衡/指標為主）調主圖佔比。
  - ⚠️ **為何不用「單圖多價軸(架構B)」**：一張圖共用一條右軸會把價格外插到指標帶、出現 `-250/-500` 負價標籤 → 才改成「主圖 + 每指標一張同步子圖」（各軸乾淨）。
- ⚠️ 個股頁現有 **3 支 FinMind 呼叫**：K 線 + 當沖（server-side，`getStockData`）+ 法人（client lazy API route）。都 `next: { revalidate: 300 }`。

**全站置頂搜尋列**：`components/TopBar.tsx` 放進 `MainContent`（每頁皆顯示含首頁，手機左側留 hamburger 空間）。搜尋（代碼/名稱，Server Action `app/actions/stocks.ts::searchStocks`，已同時比對 stock_id 與 stock_name）已從各頁 header 移除、集中於此；**各頁 header 一律改為非 sticky**（原 `sticky top-0 z-10`），避免與置頂列（`sticky top-0 z-30`）雙重固定重疊。

## 前端 UI / RWD 慣例（2026-08-13）
- **手機版一律用 Tailwind `md:` 斷點做「桌機常駐／手機收合」**（不做 JS 量視窗）：
  - `CandleChart`：版面 preset + 疊加(MA/布林/量) 藏進「**⚙️ 更多**」（`moreOpen` state；切換鈕 `md:hidden`；該區 `${moreOpen?'flex':'hidden'} md:flex`）；主列只留 週期/區間/指標。legend 的 MA/指標值用 `hidden md:contents` 手機隱藏（只留 日期/收/量）。觸控目標 `min-h-[40px] md:min-h-[34/30px]`、checkbox `w-4 h-4 md:w-3.5`。
  - `StockDetailClient`：三大法人明細手機預設收合（`showInst` state +「展開/收合」鈕 `md:hidden`；grid `${showInst?'grid':'hidden'} md:grid`），卡片 `p-4 md:p-6`。
  - `Sidebar`：手機標題加 `pl-10` 避開固定在 `top-4 left-4` 的 X 關閉鈕（否則壓到「台」字）。
  - 首頁 `IndexCard`：`p-4 md:p-6`、值 `text-2xl md:text-3xl`。
- **個股頁「返回」用 `router.back()`（`next/navigation`）回上一頁**，不要寫死 `href="/"`——否則從強勢股/選股/自選股/搜尋點進來按返回都跑去首頁。無瀏覽歷史（`window.history.length<=1`，直接開個股頁）才 fallback `router.push('/')`。

### P0 UI/UX 改版（2026-08-18，已上線；以下取代上方部分 2026-08-13 慣例）
- **導覽**：手機主導覽改 **Bottom Nav**（`components/MobileBottomNav.tsx`，`md:hidden` fixed bottom、首頁/強勢/選股/自選、safe-area、active 藍、≥56px），掛在 `layout.tsx`；`MainContent` 補底部留白 `pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0`。`Sidebar` 桌機常駐不變；手機抽屜只留帳號(AuthButton)/資料來源（主導覽已移除：`nav` 加 `hidden md:block`），☰ 從 Sidebar 浮動鈕移進 `TopBar`，靠 window 事件 `toggle-mobile-menu` 開關（同 `sidebar-collapse-change` 模式）。
- **Header 去雙層**：舊「全域 `TopBar` + 每頁 `<header bg-white shadow-sm>`」= 雙層。各頁改用 `states.tsx` 的 **`PageHeader`**（輕量標題、非白底 shadow bar）；`TopBar` 降高去 shadow、移除浮動漢堡的 `pl-16`。
- **搜尋**：`StockSearchOptimized` 已是 instant（debounce/dropdown/鍵盤/點外關閉），**移除了「查詢」按鈕**。
- **個股頁 header**：`← [名稱大] [代碼灰] … [☆加入自選] [🔔到價提醒]`；`WatchlistButton`（**原死碼、現已啟用**）接既有 `user_watchlists` 後端。股價階層：大字價格 `text-4xl md:text-5xl` + `▲▼` 漲跌 + 次要「日期·成交量」；金融數字加 `tabular-nums`。
- **CandleChart**：① 區間加 `1M`；②「⚙️ 更多」→「⚙️ 圖表設定」；③ 指標改**單選底線 Tabs**（`indicator` 單值，非陣列；`MAX_INDICATORS`/`toggleIndicator`/多選已移除）；④ **當沖移出技術圖**（`Indicator` 不再有 `daytrade`）。觸控 `min-h-[44px]`。
- **當沖改屬籌碼**：`InstitutionalChart` 新增 `Mode='daytrade'` +「當沖」tab，資料由 `StockDetailClient` 用 K 線 history 算出 `dayTrade=[{date,ratio}]` 傳入（籌碼圖本身不 fetch 當沖）；`hasDayTrade` 才顯示該 tab。
- **狀態元件**（`components/states.tsx`）：`PageHeader` / `CardGridSkeleton` / `ChartSkeleton` / `EmptyState` / `ErrorState(onRetry)`。首頁/強勢/選股/自選：載入→骨架、空→EmptyState、錯→ErrorState+重新載入（各頁補了 `error` state；screener 用 `reloadNonce` 重觸發 useEffect）。
### 首頁 Dashboard 與 P1（2026-08-18/19，已上線）
- **首頁＝市場 Dashboard**（`app/page.tsx`）四區：今日市場（加權指數）／🔥今日強勢股（`/api/strong-stocks` 取 top6、依漲幅排序、重用 `StockCard`）／⭐我的自選（登入才有，讀 `/api/quotes`）／指數走勢（原本的 加權·台指期 `IndexCard`＋`IndexChart`）。
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

## ⚠️ 關鍵地雷（2026-08 踩過並修過，改動前務必留意）
1. **收集時機**：外資持股（`taiwan_stock_shareholding`）盤後**較晚**才發布，18:30 收集常抓到空 → 靜默存 0。需事後重跑補，或把排程改到台灣 ~22:00。
2. **資料源日期不一致**：個股頁 K 線用 FinMind、法人用 Firestore，兩者「最新日」可能差一天 → 收盤與法人不同日。已修：法人改抓「與 K 線同一天」。
3. **「最新日」多來源**：`latest_date`（metadata，由 write_daily_data 寫）vs `available_dates[0]`（由 write_strong_stock_matrix 從強勢矩陣產生）vs FinMind 自己的最後一根，會各說各話。已統一以 `latest_date` 為權威。
4. **遞迴指標暖身**：MACD/KD/RSI 是 EMA 遞迴、對「資料起點」敏感，用短區間算會失真、與卡片對不上。規則：**指標一律用完整資料算**（CandleChart 重構後改為對整個 `chartData` 以 useMemo 計算、顯示範圍靠 `setVisibleLogicalRange` 控制，不再 slice 資料）。
5. **PWA 快取**：next-pwa 預設把 `/api/*` 快取 24h，使用者會看不到更新的行情。已在 next.config 改成 60s NetworkFirst。改資料相關頁記得使用者可能需硬重新整理載入新 SW。
6. **daily_data 只保留近幾天**：`available_dates` / `strong_stocks` 有 ~100 天，但 `daily_data` 沒有 → 選較舊日期時明細會空（已回 `dataMissing` 讓前端提示）。
7. **latest_date 無條件覆蓋**：collector 用 `--date` 補舊資料時會把 latest_date 倒退。已修：只在 `date >= 現值` 時更新（firebase_writer.py）。補多天時**最後一次要跑最新日**，否則 latest_date 會停在最後跑的舊日。
8. **時間週期換算**：`periodToDays` 是「交易日數」，不可拿去減聚合後的週/月 bar 數。區間篩選用「日曆天門檻」（已修）。
9. **⚠️ `strong_stock_matrix` 舊架構停更於 2024-07-03**：`getStockStrongHistory`（firebase-admin.ts）原本「先讀 `strong_stock_matrix`、有資料就用」，但該 collection 早已停更 → 「近 N 日強勢」**恆為 0**，且該 `stock_id==` + `orderBy date` 查詢還缺複合索引（噴 `FAILED_PRECONDITION`）。**已改為只讀現行 `strong_stocks/{date}`**（`getAvailableDates` + `getStrongStocksByDate`，才是最新權威來源；元素為 `{stock_id, stock_name}`）。強勢股的權威來源＝`strong_stocks/{date}` + `metadata/available_dates`，**別再用 strong_stock_matrix**。
10. **firestore.indexes.json 與實際部署有落差**：檔案仍列舊架構 `daily_stocks`/`market_index_daily`（現行架構未用）；已補 `strong_stock_matrix (stock_id,date)` 索引（改用新架構後其實已非必要，留著無害）；另 `stock_analysis_reports` 索引**已部署但不在檔案內** → `firebase deploy --only firestore:indexes --force` 會把它一併刪掉，**勿用 --force**。
11. **`market_index/{id}` 的 history 項目不帶 `index_id`／`index_name`**：(a) `IndexChart` 原本用 `data[0].index_id` 判斷 TAIEX/TX 決定成交量單位（億/口）→ 恆 undefined → `isTaiex` 恆 false → **加權成交量誤標「口」**（應「億」）。已修：**父層 `page.tsx` 明確傳 `indexId` prop**、`data[0]` 只當 fallback。(b) 同理 history 也沒 `index_name` → 首頁卡片 `index_name` 空白。已修：**market-index API route 用代號補中文名**（TAIEX→加權指數、TX→台指期）。**注意 API 有 `s-maxage=300` 快取**，改後舊回應可能還在（dev 亦然），驗證要 `fetch(..., {cache:'no-store'})` 或等 5 分鐘。
12. **⚠️ FinMind 的 TAIEX 成交量有「整段源頭缺漏」**（2026-08-15 用 TWSE 補過 2026-02 全月 12 天）：`taiwan_stock_daily(stock_id='TAIEX')`（=`TaiwanStockPrice`）某些歷史區間只回指數點位、`Trading_Volume`＝`Trading_money`＝0；collector 忠實照抄 → `market_index/TAIEX` 該段 `volume=0` → **大盤技術圖成交量直方圖空一段**（K棒/均線/MACD 正常，靠 close 算；**個股不受影響**，前端直打 FinMind live）。**重跑 `index_collector` 無效**（FinMind 就是回 0）。**決定不改 collector**（罕見事件、低維運）：需要時跑一次性工具 **`scripts/backfill_index_volume_from_twse.py`**——用證交所 **TWSE FMTQIK**（`exchangeReport/FMTQIK?response=json&date=YYYYMM01`，回整月；欄位『成交股數』＝我方 `volume`、與 FinMind `Trading_Volume` 同單位、量級 ~1e10 股；ROC 日期 +1911；用 TWSE 加權指數收盤與現有 `close` 對帳確認日期無誤）只補 `volume==0` 且 close 對得上的日期。`write_market_index` 是**單 doc + history 陣列、upsert-by-date** → 安全、總筆數/`latest_date` 不變。稽核法：讀 `market_index/{TAIEX,TX}` history 找 `volume==0`（TX 用 FinMind 期貨、通常無此問題）；日期缺口用 **TAIEX vs TX 是否一致**判斷「休市(真)vs 缺資料(假)」。補完前端 API 有 ~5 分鐘快取才反映，**資料層即時、無需重新部署**。

## 已修 bug 清單（2026-08 本次 session，均已部署）
**前端**：A2 週/月K 區間鈕單位、A3 月K MACD 暖身（K 線抓 5 年）、B1 個股頁日期錯位、B2 找不到時假 0（改顯示「—」）、B3 強勢股 dataMissing 提示、B4 最新日統一、MACD 卡片 vs 圖表一致（指標用完整資料算）、PWA 快取 24h→60s。
**後端**：C1 輔助資料整批 0 警示、C2 驗證改當日切片、C3 latest_date 不倒退、C4 Firestore 寫入失敗醒目、C6 指數 upsert、C7 MACD 改本地年度檔計算（`add_macd_from_archive`，零 API）。

## 待辦（尚未修，附具體修法）
- **C5 available_dates 以 daily_data 為準**：目前由 `write_strong_stock_matrix` 從強勢矩陣日期產生（firebase_writer.py:307-311），與 daily_data 覆蓋天數不一致，且「某日 0 強勢股」會讓該日消失。修法：改由 `daily_data` 實際存在日期產生，或取交集；允許「0 強勢股但有資料」的日期列入。
- **C3 增量回補中間缺口**：`get_missing_dates`（daily_collector.py:85-101）只從 `latest_date+1` 往後找，中間某天失敗後補不回；且 `get_latest_date_from_db` 查的是**舊架構** collection（`daily_stocks` / `market_index_daily`，Python 已不寫入）。修法：改用「過去 N 天交易日全集 − 已存在日期集合」，並改查新架構 `daily_data` / `market_index` 的日期。
- **A1 列表 vs 個股 MACD 完全統一**：C7 後 Firestore `macd_status` 已有值（列表可用），但個股頁仍前端算，資料源不同、極臨界日可能小差異。要完全一致需二選一單一來源。
- **安全**：`service-account.json` 私鑰會被 bundle 進 `.next`（本機建置產物，已 gitignore）；建議輪替金鑰、production 一律用環境變數 `FIREBASE_SERVICE_ACCOUNT_KEY` 注入而非 `require` 讀檔。
- **「為什麼強」兩條路（2026-08-19 規劃，皆未做）**——共同前提：突破/爆量/站上MA20/MACD金叉都要**逐檔歷史**才算得出來。
  - **B2 個股頁 Signal Engine（§37；便宜、建議先做）**：個股頁**本來就載入該檔完整 K 線 history、也已算好 MA/MACD/KD/RSI**（畫圖用）→ 直接在前端判斷即可，**零額外 API、純前端**。做一個「今日訊號」區塊列出：突破近20日高、量為5日均量 N 倍、MA5>MA10>MA20、MACD 金叉、KD/RSI 超買超賣，每條附白話解讀。**限制：只服務個股頁，清單卡片吃不到。**
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

## 清理與模組化狀態（2026-08）
**已清理死碼**：`utils.py`（844 行舊 Streamlit 死碼）→ 精簡成 `stock_collector/indicators.py`（只 get_macd_status）；`update_macd.py` 逐檔打 API 舊版；`firebase_writer.py` 3 個死讀取器；前端 `getStockHistory`/`verifyIdToken`/`getPopularStocks`/`getAllStocks`/`getUser`；requirements 的 `ta`/`tqdm`/`loguru`。
**待模組化（大重構，建議在乾淨 session 做 + 充分測試）**：
- `stock_collector/stock_collector.py`（618 行）→ 拆 `transforms.py`（純 DataFrame 轉換，可單元測試）、`fetchers.py`（4 支批次 API）、`archive.py`（年度歸檔，與 merge_daily_files 重疊可整併）
- `firebase-admin.ts`（396 行）→ 拆 init 與 queries/（stocks/strong/index 分組）
- `firebase_writer.py` → 拆 `firestore_client.py` 與 `writers.py`
**待清理（中信心，需先確認）**：`merge_daily_files.py`（已被 _append_to_yearly_archive 取代，若不再手動回補可刪）；`WatchlistButton.tsx`（孤兒元件，但可能是「加入自選」待辦）；`firebase-admin.ts` 舊架構 fallback（需確認舊 collection 已清空）。DailyStock interface **不可刪**（StrongStock 繼承它）。

## 常用指令
```bash
# 補某交易日（含法人/外資持股/當沖/指數/強勢股/MACD）
python3 -m stock_collector.daily_collector --date 2026-07-31
# 補歷史指數
python3 -m stock_collector.index_collector --days 730
# 大盤成交量缺漏補資（FinMind 缺量時改抓 TWSE；預設 dry-run，--write 才寫入）— 見地雷 #12
python3 scripts/backfill_index_volume_from_twse.py            # 稽核 + 預覽
python3 scripts/backfill_index_volume_from_twse.py --write    # 實際補
# 前端建置
cd frontend && npm run build
# 部署 Firestore rules/indexes（前端部署走 App Hosting 自動 rollout）
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project stock-analysis-b5602
```
查 Firestore 現況：用 `frontend/service-account.json` + `firebase-admin` 寫小 script（metadata/latest_date、daily_data/{date}/chunks）。
