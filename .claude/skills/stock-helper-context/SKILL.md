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
- **三大法人累計買賣超趨勢圖**：`components/InstitutionalChart.tsx`（獨立 lightweight-charts 折線，**刻意不併進 K 線子圖**以避開多子圖 priceScale 對齊坑）。資料 client 端 lazy 打 `app/api/stock/[id]/institutional/route.ts` → `fetchInstitutionalHistory()`（FinMind `TaiwanStockInstitutionalInvestorsBuySell`）。買賣超定義**比照收集器**：外資=`Foreign_Investor`、投信=`Investment_Trust`、自營=`Dealer_self`+`Dealer_Hedging`，`(buy−sell)/1000` 後 **`Math.trunc`**（對齊 `_process_institutional_data` + firebase_writer 的 `.astype(int)`，最新日才與法人數字卡片一致；用 `Math.round` 會差 1 張）。
- **技術分析圖 `CandleChart.tsx`（2026-08 大改；`StockChart`個股·張 / `IndexChart`大盤·億/口 共用）**：
  - **架構**：不再是「三張獨立 chart 疊 + 動態同步右軸寬」的舊脆弱做法。改為 **1 張主圖（K線+MA+布林+成交量半透明疊底）＋ 每個指標各一張同步子圖**（指標**多選 ≤2**）。對齊靠 **固定右軸寬 68px（`AXIS_WIDTH`）+ 邏輯範圍同步（`subscribeVisibleLogicalRangeChange`）+ 十字線同步** → 天生對齊，**已移除 requestAnimationFrame/ResizeObserver 喬寬的舊 hack**。
  - ⚠️ **各子圖系列必須保留完整時間軸**（暖身期 null 用 whitespace `{time}` 佔位，用 `toLineWS`／histogram 亦然；**勿用會濾 null 的 `toLineData` 或 `.filter`**）。否則 MACD 等指標系列從第 ~33 根才開始 → 子圖時間軸起點與主圖不一致 → 用 logical index 同步時錯位 → **K 棒與 MACD 柱水平對不上**（2026-08-13 踩到並修）。主圖有 K 線錨定完整範圍故 MA/BB 可濾；指標子圖沒錨定，務必用 whitespace。
  - **互動**：開啟 `handleScroll/handleScale`（滾輪縮放 + 拖曳平移）；`3M/6M/1Y/2Y` 改用 `setVisibleLogicalRange`（bar 索引，避開「非交易日字串讓 `setVisibleRange` 失效 → 退回 fitContent 顯示全 5 年」的坑）。全量資料載入、指標用完整資料算，顯示範圍靠邏輯範圍而非 slice。
  - **視覺**：左上讀值整合一份（日期/收含漲跌%/量 + 有開的 MA/布林/各指標值）；最新價水平線 + 價籤；成交量半透明疊主圖底部（`vol` overlay 價軸）；版面 preset（價格為主/均衡/指標為主）調主圖佔比。
  - ⚠️ **為何不用「單圖多價軸(架構B)」**：一張圖共用一條右軸會把價格外插到指標帶、出現 `-250/-500` 負價標籤 → 才改成「主圖 + 每指標一張同步子圖」（各軸乾淨）。
- ⚠️ 個股頁現有 **3 支 FinMind 呼叫**：K 線 + 當沖（server-side，`getStockData`）+ 法人（client lazy API route）。都 `next: { revalidate: 300 }`。

**全站置頂搜尋列**：`components/TopBar.tsx` 放進 `MainContent`（每頁皆顯示含首頁，手機左側留 hamburger 空間）。搜尋（代碼/名稱，Server Action `app/actions/stocks.ts::searchStocks`，已同時比對 stock_id 與 stock_name）已從各頁 header 移除、集中於此；**各頁 header 一律改為非 sticky**（原 `sticky top-0 z-10`），避免與置頂列（`sticky top-0 z-30`）雙重固定重疊。

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
11. **`market_index/{id}` 的 history 項目不帶 `index_id`**：`IndexChart` 原本用 `data[0].index_id` 判斷 TAIEX/TX 來決定成交量單位（億/口），但 history 內沒有 index_id → 恆為 `undefined` → `isTaiex` 恆 false → **加權指數成交量被誤標成「口」**（應為「億」）。已修：**由父層 `page.tsx` 明確傳 `indexId` prop**（`activeData.index_id`），IndexChart 以它為準、`data[0]` 只當 fallback。

## 已修 bug 清單（2026-08 本次 session，均已部署）
**前端**：A2 週/月K 區間鈕單位、A3 月K MACD 暖身（K 線抓 5 年）、B1 個股頁日期錯位、B2 找不到時假 0（改顯示「—」）、B3 強勢股 dataMissing 提示、B4 最新日統一、MACD 卡片 vs 圖表一致（指標用完整資料算）、PWA 快取 24h→60s。
**後端**：C1 輔助資料整批 0 警示、C2 驗證改當日切片、C3 latest_date 不倒退、C4 Firestore 寫入失敗醒目、C6 指數 upsert、C7 MACD 改本地年度檔計算（`add_macd_from_archive`，零 API）。

## 待辦（尚未修，附具體修法）
- **C5 available_dates 以 daily_data 為準**：目前由 `write_strong_stock_matrix` 從強勢矩陣日期產生（firebase_writer.py:307-311），與 daily_data 覆蓋天數不一致，且「某日 0 強勢股」會讓該日消失。修法：改由 `daily_data` 實際存在日期產生，或取交集；允許「0 強勢股但有資料」的日期列入。
- **C3 增量回補中間缺口**：`get_missing_dates`（daily_collector.py:85-101）只從 `latest_date+1` 往後找，中間某天失敗後補不回；且 `get_latest_date_from_db` 查的是**舊架構** collection（`daily_stocks` / `market_index_daily`，Python 已不寫入）。修法：改用「過去 N 天交易日全集 − 已存在日期集合」，並改查新架構 `daily_data` / `market_index` 的日期。
- **A1 列表 vs 個股 MACD 完全統一**：C7 後 Firestore `macd_status` 已有值（列表可用），但個股頁仍前端算，資料源不同、極臨界日可能小差異。要完全一致需二選一單一來源。
- **安全**：`service-account.json` 私鑰會被 bundle 進 `.next`（本機建置產物，已 gitignore）；建議輪替金鑰、production 一律用環境變數 `FIREBASE_SERVICE_ACCOUNT_KEY` 注入而非 `require` 讀檔。

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
# 前端建置
cd frontend && npm run build
# 部署 Firestore rules/indexes（前端部署走 App Hosting 自動 rollout）
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project stock-analysis-b5602
```
查 Firestore 現況：用 `frontend/service-account.json` + `firebase-admin` 寫小 script（metadata/latest_date、daily_data/{date}/chunks）。
