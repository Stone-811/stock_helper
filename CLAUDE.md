# CLAUDE.md

Claude Code 處理本專案時的指引說明。

> ⭐ **改動前先讀 `.claude/skills/stock-helper-context/SKILL.md`**：
> 那裡記錄踩過的地雷與資料語意（「無資料」不可寫成 0、股→張一律 `Math.trunc`、
> 表格溢出不可讓整頁橫捲、強勢股條件的權威來源、改 collector 不會自動部署…）。
> 本檔講的是**架構與慣例**，skill 講的是**為什麼不能那樣做**。

## 專案概述

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票。

功能：
1. 大盤指數分析（加權指數 TAIEX + 台指期 TX）：首頁點「加權指數」那格打開指數走勢彈跳視窗（加權／台指期切換）
2. 每日資料收集（批次 API，6 次請求抓完全市場）
3. 批次歷史資料收集與一次性回補工具（`scripts/`）
4. 多條件選股篩選（`/screener`）
5. 強勢股分析網站：強勢股 `/strong-stocks`（上方切換卡片／表格）、月報 `/strong-monthly`
6. 個股詳情：K 線／技術指標／三大法人／放空籌碼／今日訊號
7. 到價提醒（Firebase Auth + Google OAuth；信寄到登入帳號的 email）。
   自選股 2026-11-06 拿掉（業主：「首頁、sidebar 的自選股刪除，不用這個功能」），`/watchlist` 307 轉首頁。
8. 市場溫度（2026-11-05）：大盤當沖比、融資融券餘額、台股／美股恐慌指數，卡片＋走勢圖**只放在首頁**
   （`components/MarketMoodSections.tsx`）。原本的 `/market-mood` 頁 2026-11-06 拿掉（業主選「拿掉選單那一項」），舊網址 307 轉首頁。
   資料來自證交所／櫃買／期交所／CBOE **官方**（不經 FinMind），存 `market_sentiment/`。
9. 美股三大指數（費半 SOX、S&P 500、道瓊，2026-11-05）：首頁跟加權指數四格均分；FinMind `USStockPrice`，存 `market_index/{SOX|SPX|DJI}`。
   除了 17:00／22:00 兩班，台灣週二～週六 08:30 另有一班只抓美股（`stock-collect-us-0830`，2026-11-06），台股盤中就看得到前一晚收盤。

⚠️ **已移除、文件若再提到就是過時**：基本面分析（OpenAI/Claude 生成報告，
連同 `app/analysis`、`api/analysis`、`stock_analysis_reports` collection）、
`streamlit_app/`、`utils.py`、`tailwind.config.ts`（Tailwind v4 用 `@theme`，沒有設定檔）。
根目錄的 `優化建議報告.md`（2026-08-01）整份已過時，其中 S1/S2 指的端點都不存在了。

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                              │
│              Next.js 16 + React 19 + Tailwind CSS v4            │
│            (Firebase App Hosting，push main 自動 rollout)       │
│                                                                 │
│  ┌──────────┬──────────────────────────────────────────────┐    │
│  │ Sidebar  │               主內容區                       │    │
│  │ (md 以上)│                                              │    │
│  │ 📊 首頁  │  首頁　：四個指數＋市場溫度（點加權看走勢）  │    │
│  │          │  （舊 /market-mood、/watchlist 轉首頁）      │    │
│  │ 🔥 強勢股│  強勢股：卡片／表格切換 /strong-stocks       │    │
│  │          │  （舊 /strong-table 轉到 ?view=table）       │    │
│  │ 🗓️ 月報  │  月報　：當月彙整 /strong-monthly            │    │
│  │ 🔍 選股  │  選股　：自訂條件 /screener                  │    │
│  └──────────┴──────────────────────────────────────────────┘    │
│  手機：不渲染 Sidebar，底部導覽 4 格、登入在 TopBar             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API 層                                  │
│              Next.js API Routes (App Router)                    │
│  market-index/[id] │ market-sentiment │ strong-stocks           │
│  strong-monthly │ screener │ stock/[id]/institutional           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        資料庫層                                 │
│                  Firebase Firestore + Auth                      │
│  daily_data/{date}/chunks │ strong_stocks │ market_index        │
│  market_sentiment │ metadata                                    │
│  （使用者資料：user_alerts；user_watchlists 已停用、資料保留）  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       資料收集層                                │
│     Python + FinMind API ＋ 證交所／櫃買／期交所／CBOE 官方     │
│  index_collector │ stock_collector │ sentiment_collector        │
│  update_strong_matrix │ 排程：台灣 17:00／22:00＋美股 08:30     │
└─────────────────────────────────────────────────────────────────┘
```

## 專案結構

```
選股小幫手/
├── CLAUDE.md                           # 專案指引
├── .env                                # 環境變數（API keys）
├── requirements.txt                    # Python 依賴
│
├── stock_collector/                    # 資料收集模組（套件：只支援 `python -m stock_collector.<模組>`）
│   ├── __init__.py                     # 2026-11-06 起是套件；腳本模式 python stock_collector/xxx.py 不支援
│   ├── config.py                       # FinMind API token（只剩 FINMIND_API_TOKEN、firebase_enabled）
│   ├── daily_collector.py              # 統一排程器（休市判斷、重試、缺口回補、驗證；--us-only 只抓美股）
│   ├── stock_collector.py              # 每日股票資料收集器（6 支批次 API）
│   ├── index_collector.py              # 指數資料收集器（TAIEX + TX + 美股 SOX／SPX／DJI）
│   ├── sentiment_collector.py          # 市場溫度：大盤當沖比／融資融券／臺指VIX／美股 VIX（官方來源，null-aware）
│   ├── update_strong_matrix.py         # 強勢股判定與矩陣更新（條件的唯一權威；每個年度檔前面接前一年最後 5 個交易日）
│   ├── trading_calendar.py             # 休市判斷（交易日曆＋加權指數＋證交所三方確認）
│   ├── indicators.py                   # get_macd_status：MACD 多空判斷（由已刪除的 utils.py 精簡而來）
│   ├── archive_history.py              # read_history：讀年度檔歷史，當年不到 N 個交易日就補前一年最後 N 天（update_macd、streak 共用）
│   ├── update_macd.py                  # add_macd_from_archive：用年度檔算每檔 MACD 狀態（現役，stock_collector.py 收集時呼叫）
│   ├── streak.py                       # 法人連買／連賣天數（跨年不在 1/1 歸零）
│   └── alert_checker.py                # 到價提醒檢查（收件人用 Firebase Auth 查 uid 的 email）
│
├── firebase_writer.py                  # Firestore 寫入（分片優化 + null 語意）
├── gcs_archive.py                      # 年度檔上下載 GCS（collector 是 stateless；下載不完整就整輪中止、上傳前逐日比對）
├── notify.py                           # Email 告警：send_alert；非關鍵告警走 send_nonfatal（永不 raise）；時間一律台灣時間
├── .gcloudignore                       # --source=. 打包排除清單（含 service-account*.json 等憑證）
│
├── scripts/                            # 一次性稽核／回補工具（一律預設 dry-run，--write 才寫）
│   ├── backfill_foreign_hold_shares.py # 回補外資持股五欄（null-aware、只寫交易日、可 --date）
│   ├── backfill_short_sale.py          # 回補融券／借券賣出／融資餘額
│   ├── backfill_index_volume_from_twse.py  # FinMind 缺大盤成交量時改抓 TWSE
│   ├── backfill_market_sentiment.py    # 回補市場溫度歷史（2023 起；逐日 jsonl 可 --resume；dry-run）
│   ├── dedupe_daily_data.py            # 清 daily_data 重複列與殘留分片（2026-10-22 已跑過）
│   └── backfill_incomplete_days.py     # 重收年度檔裡收得不完整的日子（只改 GCS 年度檔，不寫 daily_data）
│
├── data/                               # 本地資料存放
│   ├── daily_reports/                  # 每日報表 CSV
│   │   └── archive/                    # 年度合併存檔（自動追加）
│   │       ├── stocks_2023.csv         # 2023 年度資料（37 MB, 508,369 筆）
│   │       ├── stocks_2024.csv         # 2024 年度資料（38 MB）
│   │       ├── stocks_2025.csv         # 2025 年度資料（39 MB）
│   │       └── stocks_2026.csv         # 2026 年度資料（19 MB, 即時更新）
│   └── strong_stock_matrix/            # 強勢股矩陣
│       └── strong_stock_matrix.csv
│
├── frontend/                           # Next.js 16 前端
│   ├── apphosting.yaml                 # App Hosting 設定（minInstances: 0 是刻意的）
│   ├── app/                            # App Router 頁面
│   │   ├── layout.tsx                  # 根 Layout（Sidebar + TopBar + BottomNav）
│   │   ├── page.tsx                    # 首頁：四個指數（點加權開走勢圖）＋市場溫度
│   │   ├── strong-stocks/page.tsx      # 強勢股（上方切換卡片／表格）
│   │   ├── strong-stocks/columns.tsx   # 強勢股表格的欄位定義（22 欄 registry、分組、排序工具；沒有 state）
│   │   ├── strong-monthly/page.tsx     # 強勢月報（當月彙整）
│   │   ├── screener/page.tsx           # 自訂條件選股
│   │   ├── stock/[id]/                 # 個股詳情（page + StockDetailClient）
│   │   ├── actions/stocks.ts           # Server Action：股票搜尋
│   │   └── api/                        # market-index/[id]、market-sentiment、strong-stocks、
│   │                                   # strong-monthly、screener、stock/[id]/institutional
│   │
│   ├── components/                     # React 元件
│   │   ├── Sidebar.tsx                 # 側邊導航（hidden md:flex，手機不渲染）
│   │   ├── TopBar.tsx                  # 置頂搜尋列（手機版右側放登入）
│   │   ├── MobileBottomNav.tsx         # 手機底部導覽（4 格：首頁／強勢／月報／選股，與 Sidebar 共用 navItems）
│   │   ├── home/MarketIndexCard.tsx    # 首頁：加權＋美股三大指數四格均分；加權那格是開彈跳視窗的按鈕
│   │   ├── home/HomeMood.tsx           # 首頁：市場溫度（自己 fetch、自己失敗）
│   │   ├── IndexChartDialog.tsx        # 指數走勢彈跳視窗（原生 <dialog>，加權／台指期切換＋IndexChart）
│   │   ├── MarketMoodSections.tsx      # 市場溫度三組（卡＋走勢圖）＋說明；只有首頁用（標題固定 h3／h4）
│   │   ├── AuthButton.tsx              # Google 登入（variant: sidebar | topbar）
│   │   ├── InfoTip.tsx                 # 說明泡泡（⚠️ 一律 position: fixed）
│   │   ├── CandleChart.tsx             # K 線主圖
│   │   ├── IndexChart.tsx              # 指數技術分析圖
│   │   ├── StockChart.tsx              # 個股技術分析圖
│   │   ├── InstitutionalChart.tsx      # 三大法人籌碼圖
│   │   ├── StockSignals.tsx            # 今日訊號（純前端判定）
│   │   ├── SentimentStat.tsx / SentimentChart.tsx  # 市場溫度的指標卡與走勢圖（淺色、大字、不吃觸控捲動）
│   │   ├── MoodStats.tsx               # 當沖比、融資融券、恐慌指數的指標卡組（由 MarketMoodSections 組合，說明文字只有一份）
│   │   ├── StockCard.tsx / states.tsx / table.tsx / MainContent.tsx
│   │   ├── AlertButton.tsx             # 個股頁 🔔 到價提醒（需登入）
│   │   └── StockSearchOptimized.tsx    # 搜尋（Server Action + debounce）
│   │
│   ├── lib/                            # 共用函式庫
│   │   ├── firebase.ts                 # Client SDK + Auth（Google 登入）＋到價提醒＋型別定義
│   │   ├── firebase-admin.ts           # Admin SDK（含 dayCache）
│   │   ├── finmind.ts                  # 個股 K 線直打 FinMind REST
│   │   ├── stock-data.ts               # 個股頁資料彙整
│   │   ├── monthly-report.ts           # 月報彙整層
│   │   ├── strong-enrich.ts            # /api/strong-stocks 與 /api/screener 共用：日期規則、昨收、強勢天數（只給伺服器端）
│   │   ├── sentiment.ts                # 市場溫度型別＋Stat（最新值、前一筆、近一年最高最低）
│   │   ├── market-index.ts             # /api/market-index/[id] 的回應型別、指數點數格式
│   │   ├── candles.ts                  # K 線純函式：週／月聚合 convertToTimeFrame、子圖折線 toLineWS
│   │   ├── use-latest-request.ts       # 只採用最後一次請求的序號閘門（強勢股、月報、選股三頁共用）
│   │   ├── indicators.ts / format.ts / table.ts
│   │
│   ├── next.config.ts                  # Next.js 配置（三條 307 轉址：/strong-table→/strong-stocks?view=table、/watchlist→/、/market-mood→/）
│   ├── postcss.config.mjs              # Tailwind v4 走 PostCSS（沒有 tailwind.config.ts）
│   ├── firestore.rules                 # Firestore 安全規則（需另外部署；user_watchlists 規則刻意保留）
│   └── package.json                    # NPM 依賴
│
└── .claude/skills/stock-helper-context/SKILL.md   # ⭐ 改動前必讀：踩過的地雷與資料語意
```

⚠️ **已刪除、文件別再提**：`utils.py`、`streamlit_app/`、`frontend/Dockerfile`、
`docker-compose.yml`、`tailwind.config.ts`、`app/analysis/`、`api/analysis/`。
2026-11-06 再刪：`app/watchlist/`、`app/market-mood/`（`/watchlist`、`/market-mood` 都 307 轉首頁）、
`components/WatchlistButton.tsx`、`lib/signals.ts`、`api/quotes/`、
`api/stocks/`、`api/stock/[id]/route.ts`（子路由 `institutional` 保留）、`stock_collector/merge_daily_files.py`、
`scripts/backfill_null_vs_zero.py`、`scripts/fix_stock_id_leading_zero.py`（要看從 git 歷史撈）、`daily_collector --incremental`、
`navItems` 的 `desktopOnly`、`MarketMoodSections` 的 `level`。

## 核心模組說明

### Python 後端

| 檔案 | 職責 |
|------|------|
| firebase_writer.py | DataFrame 寫入 Firestore（分片優化）；`_opt_num` 缺漏寫 null、`_norm_stock_id` 補前導零；寫入前依代號去重、刪掉用不到的舊分片 |
| gcs_archive.py | 年度檔上下載 GCS（collector 是 stateless，年度檔是唯一完整歷史） |
| notify.py | Email 告警：`send_alert`（回傳有沒有寄出）；收集器的非關鍵告警一律走 `send_nonfatal`（永不 raise）；信件時間用 `tw_now()`（固定 +8） |
| stock_collector/daily_collector.py | 統一排程器：休市判斷、重試機制、缺口回補（`--backfill-gaps`）、資料驗證；台股休市日只抓美股；`--us-only` 只抓美股後結束 |
| stock_collector/stock_collector.py | 6 支批次 API 收集、CSV 存檔、Firestore 同步 |
| stock_collector/index_collector.py | 指數資料收集（加權指數 TAIEX + 台指期 TX + 美股三大指數）；⚠️ 回傳值只算台股（`collect_index` 用「回傳非空」判成功，美股往回抓 `US_LOOKBACK_DAYS`＝21 個日曆天幾乎永遠有列）；美股斷料檢查由 `daily_collector` 在重試範圍外呼叫，一個執行最多 1 封 |
| stock_collector/sentiment_collector.py | 市場溫度：官方當沖統計（TWTB4U／intraday/stat）、信用交易（MI_MARGN／margin/balance）、期交所 VIX 月檔、CBOE CSV；每班重抓近 3 個交易日（T+2 定案）；休市／未公布／soft-404 一律 None 不寫 0；斷料會寄非關鍵告警 |
| stock_collector/update_strong_matrix.py | **強勢股判定的唯一權威**；每次執行重算全部歷史。跨年（2026-11-06）：每個年度檔前面接上前一年最後 5 個交易日（只帶 date／stock_id／open／close、只在檔案從 1/6（含）以前開始時接、算完丟掉），新年第一個交易日也以前一日收盤為基準；跳過某個年度檔時寄非關鍵告警 |
| stock_collector/trading_calendar.py | 休市判斷：三個來源都說沒交易才跳過；任一抓不到或互相矛盾就照常收集（矛盾會寄信） |
| stock_collector/indicators.py | `get_macd_status`：MACD 多空判斷（純函式） |
| stock_collector/archive_history.py | `read_history`：讀目標日（含）以前的年度檔歷史（只讀指定欄）；當年不到 `min_days` 個交易日就補前一年最後 `min_days` 天（`update_macd`、`streak` 都用 60）。看的是全市場的天數不是每檔的，年中新掛牌的股票照舊要等滿天數 |
| stock_collector/update_macd.py | `add_macd_from_archive`：用年度檔算每檔 MACD 狀態（零 API），`stock_collector.py` 收集時呼叫——**現役，不是舊版**，刪掉會讓全站 `macd_status` 變空。歷史經 `read_history`，一開年不會整整 25 天都是「-」 |
| stock_collector/streak.py | 法人連買／連賣天數（歷史經 `read_history`，跨年的連買不在 1/1 歸零） |
| stock_collector/alert_checker.py | 到價提醒：只檢查「今天」（補舊日期不檢查）；收件人用 Firebase Auth 查 uid（取自文件路徑 `user_alerts/{uid}/alerts/{id}`）的 email，**不用**文件的 email 欄位；股名用當日 daily_data；信確實寄出才停用提醒 |
| stock_collector/config.py | FinMind API token 配置（`FINMIND_API_TOKEN`、`firebase_enabled()`） |

### Next.js 前端

| 檔案 | 職責 |
|------|------|
| app/layout.tsx | 根 Layout：Sidebar（md 以上）+ TopBar + MobileBottomNav |
| app/page.tsx | 首頁：加權指數＋美股三大指數四格均分（點加權那格開指數走勢彈跳視窗）、市場溫度全部內容（含融資融券、走勢圖）。2026-11-05 起不放今日強勢股、2026-11-06 起不放我的自選與頁面下方的指數走勢線圖 |
| components/home/MarketIndexCard.tsx | 首頁四格：container query `@min-[40rem]` 四格一排、不夠寬 2×2；美股三格各自 `?last=2`、一檔抓不到只那格「—」 |
| components/home/HomeMood.tsx | 首頁的市場溫度：自己 fetch `?days=400`、自己失敗（不可併進首頁 `load()`） |
| components/IndexChartDialog.tsx | 指數走勢彈跳視窗：原生 `<dialog>.showModal()`（焦點、Esc、背景不可點都由瀏覽器處理）；保留加權／台指期切換；線圖只在打開時掛載；背景捲動靠 `globals.css` 的 `html:has(dialog[open])` 鎖 |
| components/MarketMoodSections.tsx | 市場溫度三組（當沖比、融資融券、恐慌指數：卡＋走勢圖）＋「📖 說明」；只有首頁用（/market-mood 頁 2026-11-06 拿掉後 `level` 參數一起拿掉，標題固定 h3／h4：首頁 h1「今日市場」→ h2「🌡️ 市場溫度」→ h3 → h4）；融資融券、恐慌指數的兩張圖用 `ChartPair`（container query ≥44rem 並排，手機平板上下排） |
| app/strong-stocks/page.tsx | 強勢股：上方切換卡片／表格（2026-10-26 由卡片頁與總表合併；表格預設全欄位） |
| app/strong-stocks/columns.tsx | 強勢股表格的欄位定義（型別、儲存格、22 欄 `COLUMNS`、分組、排序工具；沒有 state，依賴 state 的 JSX 留在 page） |
| app/strong-monthly/page.tsx | 強勢月報（當月彙整，12 欄對應業主 Word 月報） |
| api/market-sentiment/route.ts | API：market_sentiment 四系列（只剩首頁在用；只有 `?days=N`，預設 400；回應＝四個系列＋`first.taivix`，沒有 latest／generatedAt；缺文件回空陣列不回 500；s-maxage=600） |
| app/screener/page.tsx | 自訂條件選股 |
| app/stock/[id]/ | 個股詳情：K 線、三大法人、放空籌碼、今日訊號、🔔 到價提醒 |
| api/market-index/[id]/route.ts | API：取得指數歷史資料（TAIEX / TX / SOX / SPX / DJI；`?last=N` 只回最後 N 筆，漲跌仍用完整資料算） |
| api/strong-stocks/route.ts | API：取得今日強勢股（含連續強勢天數；`days` 不是數字就退回 7） |
| api/strong-monthly/route.ts | API：月報彙整（s-maxage=1800） |
| api/screener/route.ts | API：自訂條件選股 |
| api/stock/[id]/institutional/route.ts | API：個股法人籌碼（`/api/stock/[id]` 本身 2026-11-06 已刪） |
| components/Sidebar.tsx | 側邊導航欄（`hidden md:flex`，**手機不渲染**）+ AuthButton；`navItems` 4 項（首頁／強勢股／強勢月報／選股），與手機底部導覽同一份 |
| components/TopBar.tsx | 置頂搜尋列；手機版右側放登入 |
| components/MobileBottomNav.tsx | 手機底部導覽（4 格：首頁／強勢／月報／選股；清單與亮燈規則共用 `Sidebar.tsx` 的 `navItems`／`isNavActive`，改一處兩邊同步；只在桌機出現的 `desktopOnly` 2026-11-06 隨市場溫度頁刪掉，兩邊項目完全相同） |
| components/InfoTip.tsx | 說明泡泡（⚠️ 一律 `position: fixed`，見 skill） |
| components/StockSignals.tsx | 今日訊號（純前端，零額外 API） |
| components/InstitutionalChart.tsx | 三大法人籌碼圖 |
| components/AuthButton.tsx | Google OAuth 登入/登出按鈕 |
| components/AlertButton.tsx | 個股頁 🔔 到價提醒（需登入；寫 `user_alerts/{uid}/alerts`） |
| components/IndexChart.tsx | 指數技術分析圖（K 線 + 成交量 + MACD/KD/RSI）；`indexId` 必填 |
| components/StockChart.tsx | 專業技術分析圖（K 線 + 成交量 + MACD/KD/RSI；當沖在籌碼圖，不在這裡） |
| components/StockSearchOptimized.tsx | 股票搜尋（Server Action + debounce） |
| components/StockCard.tsx | 股票資訊卡片（強勢股頁卡片檢視、選股頁共用；首頁已不用）；成交額／當沖比／MACD 底色的公式在 `lib/format.ts` |
| components/MainContent.tsx | 主內容區（響應式寬度調整） |
| app/actions/stocks.ts | Server Action：股票搜尋（Firestore） |
| lib/firebase.ts | Firebase Client SDK + Auth + 到價提醒（`addAlert`／`getAlertsForStock`／`removeAlert`）+ 型別定義 |
| lib/firebase-admin.ts | Firebase Admin SDK（伺服器端查詢） |
| lib/strong-enrich.ts | `/api/strong-stocks` 與 `/api/screener` 共用：哪一天（指定日在清單內才用，否則權威 latest_date）、昨收（查不到就省略 key）、強勢天數（讀取失敗回 null、不寫 0） |
| lib/use-latest-request.ts | `useLatestRequest()` 序號閘門：只採用最後一次送出的請求（強勢股、月報、選股三頁共用） |
| lib/format.ts | 共用格式化與公式：`tradingValueOf`／`dayTradingRatioOf`／`macdBadgeClass`、`computeChange`、`isLimitUp`… |
| lib/table.ts | 表格共用：`ColDef` registry、`normalizeQuery`／`matchesStockQuery`／`industriesOf`／`sortRows`（強勢股頁與月報共用） |
| lib/candles.ts | K 線純函式：`convertToTimeFrame`（週／月聚合）、`toLineWS`（子圖折線，暖身期留 whitespace） |

### K 線圖（`CandleChart`；`StockChart`／`IndexChart` 只是包一層）

使用 TradingView 開源的 **lightweight-charts**。個股頁與首頁的指數走勢彈跳視窗（點「加權指數」那格打開，
`IndexChartDialog`）共用同一個 `CandleChart`。純函式（週／月聚合 `convertToTimeFrame`、子圖折線 `toLineWS`）
在 `lib/candles.ts`（2026-11-06 從 CandleChart 搬出）。
（2026-10-22 依程式校正：本段先前寫的 TimeRange 同步、十字游標顯示開高低收／成交額／當沖、
「固定範圍無動態滑動」、16px、`#1a1a2e` 全部與程式不符。）

**控制列**：
- 週期：日K／週K／月K（預設日K）
- 區間：**1M**／3M／6M／1Y／2Y（預設 3M；只決定初始顯示範圍，**可以拖曳平移、滾輪縮放**）
- 技術指標（單選分頁）：MACD／KD／RSI（預設 MACD）
- ⚙️ 圖表設定（手機收合、桌機常駐）：版面「價格為主／均衡／指標為主」（預設均衡），
  疊加勾選 MA5／MA10／MA20／MA60／布林／量（預設 MA5、MA10、MA20、量 開）
- ⛶ 全螢幕（只能按 ✕ 離開，Esc 無效；首頁彈跳視窗裡按 Esc 會直接關掉整個視窗，2026-11-06 實測，關掉後頁面捲動正常）

**讀值**：日期、收、漲跌（%）、量，加上已勾選的 MA、布林與當前指標數值。
桌機疊在圖左上；**手機改放在控制列與圖之間的圖外讀值區**（兩欄格線，缺值顯示「—」），
不疊在圖上蓋住 K 棒（2026-10-22 起，之前手機直接隱藏這些數值）。
⚠️ 游標日期在新資料裡找不到時一律退回最後一根（換週期時殘留的游標會讓讀值整塊消失、圖往上跳）。

**週K／月K 的量**（2026-11-06 起）：有值的日子照加、缺值跳過，**整段都缺才是 null**（不畫量柱、讀值「—」）；
0 是有效值照算。不可改回 `sum + v` 或 `|| 0`。週K／月K 的 `day_trading_volume` 是期間最後一根的值、不是加總（技術圖不讀這欄）。
`CandleChart` 的 `volumeFormatter` 必填（個股「張」、加權「億」、台指期「口」）；`IndexChart` 的 `indexId` 必填。

**時間軸同步**：主圖與指標圖用 **LogicalRange** 同步（`CandleChart.tsx` 的 `subscribeVisibleLogicalRangeChange` 區塊）。
指標一律用完整資料計算（不 slice），顯示範圍靠 `setVisibleLogicalRange` 控制——
這是 SKILL.md 地雷 #4「遞迴指標暖身」的解法，**不要改回用區間切資料再算**。

**顏色**：K 棒與量柱是「收 ≥ 開」紅、「收 < 開」綠（只比同一根的開與收）；
讀值的漲跌顏色則是跟前一根收盤比，所以兩者可能不同色。

**已知限制**：設定不會記住（每次打開回預設）；換週期／區間／指標／版面時拖曳位置會被重設；
手機上手指在圖上滑會被圖表拿去拖曳、整頁不捲動（圖高 600px）。

**UI 規格**：圖表字 14px、背景 `#131722`。個股頁高度 600px、全幅寬度（跳脫 max-w-7xl）；
首頁指數彈跳視窗高度 520px，視窗手機全螢幕、桌機 `min(1200px, 95vw)`。

## Firestore 集合結構（優化版）

### daily_data/{date} - 每日股票資料（分片）

```
daily_data/
├── 2026-07-24                          # 每日摘要文件
│   ├── date: "2026-07-24"
│   ├── stock_count: 2316
│   ├── chunk_count: 5
│   └── updated_at: Timestamp
│
└── 2026-07-24/chunks/                  # 子集合：分片
    ├── chunk_0                         # 每片 500 筆股票
    │   ├── chunk_index: 0
    │   ├── count: 500
    │   └── stocks: [{ stock_id, stock_name, open, high, low, close, volume, ... }]
    ├── chunk_1
    ├── chunk_2
    ├── chunk_3
    └── chunk_4
```

**優勢**：寫入次數從 ~2,300 次降至 ~6 次（1 摘要 + 5 分片）

### strong_stocks/{date} - 每日強勢股

```
strong_stocks/
├── 2026-07-24
│   ├── date: "2026-07-24"
│   ├── count: 58
│   ├── stocks: [{ stock_id: "2330", stock_name: "台積電" }, ...]
│   └── updated_at: Timestamp
```

**優勢**：單一文件聚合，寫入從 ~100 次降至 1 次

### market_index/{index_id} - 指數資料（聚合歷史）

```
market_index/
├── TAIEX
│   ├── index_id: "TAIEX"
│   ├── index_name: "加權指數"
│   ├── latest_date: "2026-07-24"
│   ├── record_count: 550
│   ├── history: [{ date, open, high, low, close, volume }, ...]
│   └── updated_at: Timestamp
│
├── TX
│   ├── index_id: "TX"
│   ├── index_name: "台指期近月"
│   └── history: [{ date, open, high, low, close, volume, open_interest, settlement_price }, ...]
│
└── SOX / SPX / DJI                      # 美股三大指數（2026-11-05；2023-01-03 起，各約 964 筆）
    └── history: [{ date(美東), open, high, low, close, volume(SOX 永遠 null), open_interest: null, settlement_price: null }]
```
⚠️ 2026-11-05 起 `write_market_index` 缺值寫 **null**（以前 `row.get(..., 0)`）。TAIEX／TX 的未平倉／結算價是收集器自己填 0，照舊。

**優勢**：單一文件包含完整歷史，讀取從 500+ 次降至 1 次

### user_alerts/{userId}/alerts/{alertId} - 到價提醒

```
user_alerts/
└── {userId}                            # Firebase Auth uid
    └── alerts/
        └── {auto-id}
            ├── stock_id, stock_name, type, value   # type：price_above／price_below／macd_bullish／macd_bearish／foreign_streak／trust_streak
            ├── email                               # 前端照寫，但收集器不用它（收件人一律用 Auth 查 uid 的 email）
            ├── enabled: true                       # 信確實寄出後收集器改成 false＋寫 triggered_at
            └── created_at: Timestamp
```
`firestore.rules` 只驗 uid、不驗欄位，所以文件內容都當成使用者自填、不可信任（見 skill「到價提醒」）。

### user_watchlists/{userId}/stocks/{stock_id} - 自選股（⚠️ 功能 2026-11-06 拿掉）

功能已移除，**資料與 `firestore.rules` 的規則刻意保留**（業主決定資料不刪；規則部署會整份覆蓋線上版本，不要為了刪這段單獨部署）。網站已沒有任何地方讀寫它。

```
user_watchlists/
└── {userId}
    └── stocks/
        ├── 2330
        │   ├── stock_id: "2330"
        │   ├── stock_name: "台積電"
        │   └── added_at: Timestamp
        └── 2454
```

### market_sentiment/{doc_id} - 市場溫度（2026-11-05）

```
market_sentiment/
├── daytrade   history: [{ date, twse_buy_pct, twse_sell_pct, twse_shares_pct, twse_dt_shares, twse_buy_amount, twse_sell_amount,
│                          tpex_buy_pct, tpex_sell_pct, tpex_shares_pct, tpex_dt_shares, tpex_buy_amount, tpex_sell_amount }]
├── margin     history: [{ date, twse_margin_balance(仟元), twse_margin_lots, twse_short_lots, tpex_margin_balance, tpex_margin_lots, tpex_short_lots }]
├── taivix     history: [{ date, close, close_1min_avg }]           # 期交所 13:45 收盤；2026-03-02 起
└── vix        history: [{ date(美東), open, high, low, close }]    # CBOE
```
單一文件＋history 陣列、依 date **逐欄** upsert（`write_market_sentiment`：新值 None 不蓋既有值）。缺值是 null，**不是 0**。
每班 4 讀 4 寫（當沖／融資 17:00 那班官方通常還沒公布，寫 0 天是正常）。

### metadata - 系統元資料

```
metadata/
├── latest_date
│   ├── date: "2026-07-24"
│   └── updated_at: Timestamp
│
└── available_dates
    ├── dates: ["2026-07-24", "2026-07-23", ...]  # 最近 100 天
    └── updated_at: Timestamp
```

### 寫入次數優化對比

| 項目 | 優化前 | 優化後 | 節省 |
|------|--------|--------|------|
| 每日股票 | ~2,300 | ~6 | 99.7% |
| 強勢股 | ~100 | 1 | 99% |
| 指數 | 2 | 2 | - |
| 市場溫度 | — | ~8（4 文件 × 2 班） | 2026-11-05 新增 |
| **每日總計** | ~2,402 | **~17** | **99.3%** |

## 處理流程

### 每日資料收集（批次 API + 自動存檔）
```
1. 登入 FinMind API
2. 批次取得全市場資料（6 次 API，全部 data_id=''）：
   - 股價：api.taiwan_stock_daily(stock_id='')
   - 三大法人：api.taiwan_stock_institutional_investors(stock_id='')
   - 外資持股：TaiwanStockShareholding
   - 當沖：TaiwanStockDayTrading
   - 放空餘額（融券＋借券賣出）：TaiwanDailyShortSaleBalances      ← 2026-10-09 新增
   - 融資融券：TaiwanStockMarginPurchaseShortSale                  ← 2026-10-09 新增
   ⚠️ 後兩支（及未來的附屬資料）走 `_fetch_optional()`，各自 try、失敗只讓對應欄位變 null，
      不會讓整天的股價／法人資料一起丟掉。
3. 處理法人資料（長格式轉寬格式）
4. 合併股價、法人、外資持股、當沖與放空資料
5. 轉換單位（股數 → 張數，一律 //1000 向零取整）
   ⚠️ 例外：TaiwanStockMarginPurchaseShortSale 的 MarginPurchaseTodayBalance **本身已是張**
6. 計算 MACD 狀態（用年度檔；一開年當年不到 60 個交易日就補前一年最後 60 天，`archive_history.read_history`）
7. 儲存到 data/daily_reports/daily_stock_YYYYMMDD.csv（暫存）
8. 同步寫入 Firestore（分片優化，僅 ~6 次寫入）
9. 自動追加到年度檔案 archive/stocks_YYYY.csv
10. 自動刪除每日檔案（已整併，節省空間）
```

**優勢**：
- API 用量：相較逐檔抓取（約 5000 次）降至 6 次，節省 99.9%
- 儲存管理：自動追加年度檔案，無需手動合併
- 空間優化：自動刪除每日檔案，節省 37% 儲存空間

### 統一排程器（daily_collector.py）

整合所有資料收集流程，提供：
- **休市日跳過**：開頭先問 `trading_calendar.is_market_closed()`；國定假日、補假、颱風停市時
  台股不收集、不重算、不檢查提醒、不寄「收集失敗」告警、exit 0；**美股照常更新**（斷料仍會寄非關鍵告警）。
  `--backfill-gaps` 的缺口也用交易日曆算，不再把假日當缺漏。
  ⚠️ 不可改回「排除週六日」：平日也會休市，2016～2018 也有補班週六是交易日。
- **自動重試**：使用 tenacity 套件，失敗時指數退避重試（最多 3 次）。美股斷料檢查放在重試範圍外，一個執行最多寄 1 封。
- **缺口回補**：`--backfill-gaps` 用「交易日全集 − 已存在日期」找缺漏日期再補（舊的 `--incremental` 已刪除）
- **資料驗證**：確保資料筆數 >= 2000、收盤價完整度 >= 95%
- **日誌記錄**：輸出到 logs/daily_collector_YYYYMMDD.log

```python
# 重試機制範例
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=4, max=60),
    retry=retry_if_exception_type(Exception)
)
def collect_stocks(self, date=None):
    # 收集股票資料，失敗自動重試
```

### 強勢股篩選條件

**唯一權威來源＝`stock_collector/update_strong_matrix.py` 的 `STRONG_CONDITIONS`**（四條全部成立才算強勢）：

```
1. 成交量 > 500 張                                  min_volume: 500
2. 漲跌幅 > 3%（以「前一交易日收盤」為基準）          min_change_pct: 3.0
3. 收盤價 > 開盤價                                  require_up: True
4. 三大法人「合計」買超 > 0 張                       require_institutional: True
   （外資 + 投信 + 自營，門檻就是 0，不是 1000）
```

⚠️ 此處先前寫的「多頭排列 close > MA5 > MA20 > MA60 ＋ MACD 正值 ＋ 外資或投信買超 > 1000 張」
**是錯的**，四條裡只有成交量那條對得上（實測 2026-09-24 的 73 檔強勢股有 9 檔 MACD 是「空」，
證明沒有 MACD 條件；逐檔驗證上面四條則 73/73 全部符合）。改條件請改程式再回來同步這段。

⚠️ **漲跌幅基準**：原本程式寫成 `(close - open) / open`，那是**當日振幅**不是漲跌幅。
台股慣例一律以前一交易日收盤為基準（前端已於 2026-08-19 統一，見
`.claude/skills/stock-helper-context/SKILL.md`），收集器已對齊。前一日取「同一檔股票在資料中的
前一筆」（`groupby` + `shift(1)`），**不可用日曆天推算**。
年度檔是一個一個分開算的，所以 2026-11-06 起（業主同意，數字先給過）每個年度檔前面先接上**前一年最後 5 個交易日**
（只帶 date／stock_id／open／close，算完丟掉），新年第一個交易日也以前一日收盤為基準。
只剩這些情況會 fallback 回 `open`（與前端 `prev_close > 0 ? prev_close : open` 同一條規則）：
2023-01-03（全史起點、沒有前一年）、前一年的檔處理失敗、檔案不是從 1/6（含）以前開始（年中或 1 月中被截斷的檔不接），
以及年中新掛牌（或前一年最後 5 天都沒有這檔）的第一天。

⚠️ **3% 門檻是套在「四捨五入到小數 2 位」的 change_pct 上**（與畫面顯示同一把尺）：
真實漲幅 3.004% → `round(2)=3.0` → `3.0 > 3.0` 為 False 而落選，全史 125 檔次受影響（0.18%）。

⚠️ **`update_matrix()` 每次執行都會重算並覆寫全部歷史** `strong_stocks/{date}`。
改判定邏輯等於改寫全部歷史強勢股清單（2026-11-06 是 926 天）；但 **Cloud Run Job image 不重建就不會生效**
（`gcloud run jobs deploy stock-collector --source=.`），push 到 main 只重建前端。
`_assert_prev_close_sane()` 會在「只拿到單一日期」或「最早那天之後仍有 > 5% 的列取不到前一日收盤」時中止，
避免 GCS 年度檔下載失敗時默默用當日振幅覆寫歷史。例外是新年度：從 1/6 以前開始的檔前面接了前一年 5 天，
所以新年第一個交易日那晚年度檔只有一天也**不會**被擋（這是刻意的，2027-01-04 會照常寫出名單）；
被截斷的檔不接、照舊被擋。某個年度檔被擋下時其他年份照常寫入，並寄非關鍵告警「強勢股重算跳過一個年度檔」。
重算後變成 0 檔的日期會刪掉舊名單，但**只刪資料完整的日子**（`_complete_dates`：檔數 ≥ 前後中位數 90%、
法人有值 ≥ 50%）；完整的 0 檔日一次超過 max(5, 天數/100) 就整輪不寫不刪並告警（2026-10-23 起）。

### 放空資料欄位（2026-10-09 新增，單位皆為張）

| 欄位 | 來源 | 說明 |
|---|---|---|
| `margin_short_balance` | `MarginShortSalesCurrentDayBalance` ÷1000 | 融券餘額（散戶放空） |
| `sbl_short_balance` | `SBLShortSalesCurrentDayBalance` ÷1000 | 借券賣出餘額（法人放空） |
| `margin_balance` | `MarginPurchaseTodayBalance`（已是張） | 融資餘額 |

⚠️ **融券與借券賣出必須分開顯示**：台積電 2026-09-24 融券 16 張、借券賣出 15,046 張（940 倍），
只看融券會把法人空單當成零。
⚠️ 缺漏一律寫 **null** 不寫 0（興櫃等無融券／借券制度，約 20% 的股票沒有這筆資料）；
**0 是「真的沒人放空」的有效值**。歷史回補用 `scripts/backfill_short_sale.py`。

## 環境變數

### .env 檔案配置

```bash
# FinMind API
FINMIND_TOKEN=your_finmind_token

# Firebase（Python 後端用 - 擇一）
# 方式一：service-account.json 檔案（放在 frontend/ 或專案根目錄）
# 方式二：環境變數（生產環境）
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"..."}'

# Firebase（Next.js 前端用）
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBVxC5LJayAWEdQCBCZdt2-t8KD8ZwDgWM
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=stock-analysis-b5602.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=stock-analysis-b5602
```

⚠️ 生產環境（App Hosting）**不需要** `FIREBASE_SERVICE_ACCOUNT_KEY`：同專案下自動走 ADC。
`frontend/service-account.json` 只為本機開發存在，是專案唯一「洩漏就完蛋」的長期憑證——
建議改用 `gcloud auth application-default login` 後刪檔並在 IAM 撤銷（見 skill 待辦）。
AI 分析功能已移除，不再需要 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`。

## FinMind API

### 指數資料 API

```python
from FinMind.data import DataLoader
api = DataLoader()
api.login_by_token(api_token=token)

# 加權指數（TAIEX）- 使用 TaiwanStockPrice
taiex = api.taiwan_stock_daily(stock_id='TAIEX', start_date=date, end_date=date)
# 欄位：date, open, max, min, close, Trading_Volume

# 台指期（TX）- 使用 TaiwanFuturesDaily
tx = api.taiwan_futures_daily(futures_id='TX', start_date=date, end_date=date)
# 欄位：date, open, max, min, close, volume, open_interest, settlement_price
# 注意：需過濾 trading_session != 'after_market'，取近月（成交量最大）
```

### 批次 API（推薦）

```python
# 全市場股價（1 次 API）
stock_data = api.taiwan_stock_daily(stock_id='', start_date=date, end_date=date)

# 全市場法人（1 次 API）
institutional = api.taiwan_stock_institutional_investors(stock_id='', start_date=date, end_date=date)
```

### 單檔 API

```python
# 單檔股價
stock_data = api.taiwan_stock_daily(stock_id='2330', start_date, end_date)

# 單檔籌碼
institutional = api.taiwan_stock_institutional_investors(stock_id='2330', start_date, end_date)
```

**單位轉換**：API 回傳股數，需除以 1000 轉為張數

**API 限制**：600次/分鐘，使用批次 API 可大幅降低用量

## 部署方式

### 前端：Firebase App Hosting（push main 自動 rollout）

**推送到 GitHub `main` 即自動建置部署，不需手動執行任何指令。**
backend `stock-analysis`、region `asia-east1`、設定檔 `frontend/apphosting.yaml`。

⚠️ **建置失敗時 App Hosting 會保留前一個 revision 繼續服務** → 網站仍然回 200、頁面打得開。
**用 HTTP 狀態碼驗證上版等於沒驗證**，一定要查建置狀態：

```bash
gcloud builds list --project stock-analysis-b5602 --region=asia-east1 --limit 5 \
  --format='table(id,status,createTime)'
```

Firestore rules 需另外部署：

```bash
npx firebase-tools deploy --only firestore:rules --project stock-analysis-b5602
```

### 收集器：Cloud Run Job（**改程式不會自動部署**）

`stock_collector/`、`firebase_writer.py` 跑在 Cloud Run Job 的 image 裡，
push 到 main **不會**更新它。改了收集器一定要重建 image 才生效：

```bash
gcloud run jobs deploy stock-collector --source=. \
  --project stock-analysis-b5602 --region asia-east1
```

排程：Cloud Scheduler `stock-collect-1700` / `stock-collect-2200`
（UTC 09:00 / 14:00 ＝ 台灣 17:00 / 22:00，週一～週五），
另有 `stock-collect-us-0830`（2026-11-06 起，業主選「加早上 8:30 這班」）：`30 0 * * 2-6`（Etc/UTC ＝ 台灣週二～週六 08:30），
POST 同一個 run 端點、body `{"overrides":{"containerOverrides":[{"args":["--us-only"]}]}}`、服務帳號同另外兩班，
只更新美股三大指數（台股盤中首頁就看得到前一晚收盤；實測 08:40 FinMind 已有）。
⚠️ `deploy-cloudrun.sh` 只建 1700／2200 兩班，0830 是另外建的——重建排程時別漏。

- `--source=.` 的打包排除清單是 `.gcloudignore`：2026-11-06 起排除 `service-account*.json`、`*-key.json`、`*.pem`、`*.p12`、`*.key`
  （任何子目錄），金鑰不會再被上傳到 Cloud Build 的 source bucket。
- 到價提醒要用 Firebase Auth 查收件人（`firebaseauth.users.get`）：Cloud Run 預設服務帳號有 `roles/editor`、已含這個權限，
  **不需另外改 IAM**（`deploy-cloudrun.sh` 步驟 3 多加的 `roles/firebaseauth.viewer` 是給換成專用服務帳號時用的）。
  少了權限的症狀：提醒不寄也不停用，log 出現「警示收件人查詢失敗」。

## 執行指令

### Python 資料收集

⚠️ **本機跑會寫正式 Firestore，一定要 `export USE_GCS_ARCHIVE=1`**（開頭從 GCS 下載年度檔、結尾上傳）。
沒設會被 `require_authoritative_archive()` 擋下：本機 `data/daily_reports/archive` 只是某天的副本，
拿它算前一日收盤／MACD／連買天數會把錯的資料寫進正式站。只是本機實驗才設 `ALLOW_LOCAL_ARCHIVE=1`。
`--incremental` 已刪除（2026-11-06；現在帶它會被 argparse 擋下、exit 2），補缺口用 `--backfill-gaps`。
⚠️ 收集器**只支援 `python -m stock_collector.<模組>`**（`stock_collector/` 是套件）；`python stock_collector/xxx.py`
腳本模式不支援，`update_strong_matrix`、`sentiment_collector` 一啟動就 ImportError。`scripts/` 底下的工具照舊用 `python3 scripts/xxx.py`。

```bash
# === 統一排程器（推薦）===
python -m stock_collector.daily_collector                    # 今日（股票+指數+矩陣）
python -m stock_collector.daily_collector --date 2026-06-19  # 指定日期
python -m stock_collector.daily_collector --days 7           # 批次收集過去 7 天
python -m stock_collector.daily_collector --backfill-gaps    # 回補歷史區間內缺漏的交易日
python -m stock_collector.daily_collector --skip-stock       # 只收集指數+矩陣
python -m stock_collector.daily_collector --skip-index       # 只收集股票+矩陣
python -m stock_collector.daily_collector --skip-matrix      # 只收集資料，不更新矩陣
python -m stock_collector.daily_collector --skip-sentiment   # 不抓市場溫度（--days／--backfill-gaps 迴圈內自動跳過、結束後只跑一次）
python -m stock_collector.daily_collector --us-only          # 只更新美股三大指數後結束（不看休市、不碰年度檔；排程 stock-collect-us-0830 就是跑這個）
python -m stock_collector.daily_collector --test-alert       # 寄一封測試告警信（驗證 Email 設定）
python -m stock_collector.sentiment_collector --dry-run      # 只抓不寫，看今天抓到什麼
python3 scripts/backfill_market_sentiment.py                 # 市場溫度回補 dry-run（2023 起，約 2 小時）；--write 才寫

# === 個別收集（舊方式）===
# ⚠️ stock_collector.py 單獨執行時，會寫正式資料就拒絕（它不把年度檔存回 Storage）；正式資料一律用 daily_collector
# 指數資料收集（加權指數 + 台指期 + 美股三大指數）
python -m stock_collector.index_collector              # 今日
python -m stock_collector.index_collector --days 30    # 過去 30 天
python -m stock_collector.index_collector --start 2024-01-01 --end 2026-06-16

# 每日股票收集（批次 API）
python -m stock_collector.stock_collector

# 批次歷史收集（最近 7 天）
python -m stock_collector.stock_collector --days 7

# 更新強勢股矩陣
USE_GCS_ARCHIVE=1 python -m stock_collector.update_strong_matrix   # 會先從 Storage 下載年度檔；沒設會拒絕

# 測試 Firebase 連線
python firebase_writer.py
```

### Next.js 前端開發

```bash
cd frontend

# 安裝依賴
npm install

# 開發模式
npm run dev

# 生產構建
npm run build && npm start
```

預覽設定 `.claude/launch.json`：`frontend`（`npm run dev`，port 3000）、`frontend-prod`（`npm run start -- -p 3100`，
先 `npm run build`，驗正式 build 用）。

## 效能優化

### API Response 快取

API Routes 使用 Cache-Control header 減少重複請求：

```typescript
// api/market-index/[id]/route.ts - 指數快取 5 分鐘
return NextResponse.json({ index_id, index_name, latest, history, change, changePercent }, {
  headers: {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
  }
})

// api/strong-stocks/route.ts、api/screener/route.ts - 快取 2 分鐘
headers: {
  'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300'
}
```
其他：`api/market-sentiment` 是 `s-maxage=600, swr=1800`、`api/strong-monthly` 是 `s-maxage=1800, swr=3600`。

### Server Actions（股票搜尋優化）

使用 Server Action 取代前端載入全部 2300+ 股票：

```typescript
// app/actions/stocks.ts
'use server'
import { getLatestDate, getStocksByDate } from '../../lib/firebase-admin'

export async function searchStocks(query: string): Promise<StockSearchResult[]> {
  const latestDate = await getLatestDate()
  const stocks = await getStocksByDate(latestDate)

  // 在伺服器端篩選
  return stocks
    .filter(s => s.stock_id.includes(q) || s.stock_name.includes(q))
    .slice(0, 20)
}
```

**優勢**：
- 初始載入不需取得全部股票
- 搜尋時只傳輸符合條件的 20 筆
- 在伺服器端進行篩選，減少前端負擔

### 圖表時間軸對齊

主圖與指標圖用 **LogicalRange** 同步（`CandleChart.tsx` 的 `subscribeVisibleLogicalRangeChange`），
細節見上方「K 線圖」段落。指標一律用完整資料計算，子圖暖身期用 whitespace `{time}` 佔位、
保留完整時間軸，所以索引對得上；**不可濾掉暖身期的 null，也不要切資料再算**（SKILL.md 開頭 K 線段與地雷 #4）。
（2026-10-22 校正：本段先前寫「用 TimeRange 而非 LogicalRange」，與程式相反。）

## 開發原則

1. 優先編輯現有檔案
2. 統一資料路徑：`data/`
3. 優先使用批次 API（降低 API 用量）
4. 個別股票失敗不中斷整體流程
5. 為新函數撰寫 docstring
6. Firestore 寫入使用分片優化（500 筆/片）
7. **驗證要能重跑**：這個專案所有嚴重 bug 都是資料語意（null vs 0、股 vs 張、前導零、
   振幅 vs 漲跌幅），而且全部是業主肉眼發現、延遲數週。手動驗一次就丟掉等於沒驗——
   把判斷標準寫成會執行的斷言。詳見 skill 的「自動驗證迴圈」專章。
8. **衍生資料要能被重新推導並比對**：強勢股清單就是最好的例子——收集器算一次、
   檢查器用另一條路徑再算一次，不一致就是出事。

## Firebase 注意事項

### Firebase Auth 設定（到價提醒需要；收集器也靠它查收件人 email）

1. 到 Firebase Console > Authentication > Sign-in method
2. 啟用 Google Provider
3. 設定授權網域（localhost、your-domain.com）
4. 設定 OAuth 同意畫面（Google Cloud Console）

**方案**：⚠️ 本專案用的是 **Blaze（從量計費）**，不是 Spark——App Hosting 需要 Blaze。
免費額度仍適用（50K 讀取/天、20K 寫入/天、1 GB 儲存），超出才計費；
目前每日寫入約 9 次、讀取量遠低於額度，Firestore 本身幾乎不花錢。
**真正的成本在 Cloud Run / Artifact Registry / Secret Manager**，見 skill 的「GCP 成本」章節。

### Firestore 1MB 文件大小限制

Firestore 單一文件最大 1MB。每日股票資料（~2,300 筆）超過此限制，因此使用分片策略：

```python
# firebase_writer.py - 分片寫入
CHUNK_SIZE = 500  # 每片 500 筆股票

chunks = [stocks_data[i:i+CHUNK_SIZE] for i in range(0, len(stocks_data), CHUNK_SIZE)]

for i, chunk in enumerate(chunks):
    chunk_ref = db.collection('daily_data').document(date).collection('chunks').document(f'chunk_{i}')
    batch.set(chunk_ref, {'stocks': chunk, 'count': len(chunk)})
```

### 資料庫統計（截至目前）

| 項目 | 數值 |
|------|------|
| 資料日期範圍 | 2023-01-03 ~ 今日 |
| 上市上櫃股票數 | ~2,316 檔 |
| 每日寫入次數 | ~9 次（優化後） |

## 技術棧

| 類別 | 技術 |
|------|------|
| 資料收集 | Python 3.x, FinMind API, tenacity（重試） |
| 資料庫 | Firebase Firestore（分片優化） |
| 身份驗證 | Firebase Auth (Google OAuth) |
| 前端框架 | Next.js 16.2, React 19.2 |
| UI 樣式 | Tailwind CSS v4（用 `@theme`，**沒有 tailwind.config.ts**） |
| 圖表 | lightweight-charts |
| 部署 | 前端 Firebase App Hosting（push main 自動）／收集器 Cloud Run Job（需手動重建 image） |
| 版本控制 | Git, GitHub |

## GitHub Repository

https://github.com/Stone-811/stock_helper

## 最近更新

### 2026-11-06

**首頁走勢圖兩兩並排、手機上融資融券卡一排兩張**（業主：「圖表平行擺放，各佔50%」「上市融資、上櫃融資同一排，各佔版面50%」，兩次都看過改前改後說「可以上線」／「push」；
459fe2f → `build-2026-11-06-006`、e258d49 → `build-2026-11-06-007`，live 量過）
- `MarketMoodSections` 的 `ChartPair`：融資／融券、台股／美股恐慌指數兩張走勢圖依**這一塊自己的寬度**（container query `@min-[44rem]`，約螢幕 1024 以上扣側欄）並排各半；
  手機、平板上下排（一半寬在手機只剩約 170px，圖和區間按鈕看不清楚）；當沖比只有一張，維持全寬。
- `MarginStats` 手機也 `grid-cols-2`（平板、電腦本來就兩欄）。`SentimentStat` 的 md 卡（**只有融資融券用**）在手機上：數字 `min(1.875rem,19.5cqi)`、單位 `0.75em`、內距 `p-3`
  → 320～430 寬「277,051 張」都不折行，412 以上與原本同為 30px（390 約 29px、360 約 26px、320 約 22px）；320／360 寬標題旁的 ⓘ 會排到標題下一行（375 以上同一行）。
  平板、電腦字級與內距都不變；當沖比、恐慌指數的 lg 卡不變。

**改過名的股票：強勢股名單去重、全站股名改成最新正式名稱**（業主看過數字後選「照這個數字改」「改成最新名稱」「全部改成現在的名字」；249ea7f）
- `strong_stocks`：同一天同一檔只留一筆（以前改名股兩個股名各寫一筆）→ 269 天（2023-01-09～2025-12-31）拿掉 358 筆重複，每天的強勢股不增不減；
  合併的日子用網站現在的股名。雲端只重算強勢股（execution stock-collector-82b59）後與改前快照逐日比對：只有這 269 天變、count 也對了（例 2025-01-02 50→49）。
- 收集器股名改取 FinMind `TaiwanStockInfo` `date` 最新那筆（以前 keep='first' 拿到舊名，45 檔顯示舊名字，例 3521 鴻翊→台鋼建設、6757 台灣虎航-創→台灣虎航）；
  產業照舊取第一筆。`scripts/fix_stale_stock_names.py` 把既有 `daily_data` 的 3,276 筆（58 檔、70 天）改成最新名稱，只改 `stock_name`。
- 股名缺值不再存成字串「nan」（`firebase_writer._name_or_empty`）。Cloud Run image 已重建；live 個股頁標題已是新名字。

**拿掉市場溫度頁**（業主選「拿掉選單那一項」，首頁已有完整內容；6d53d2d，已上線 App Hosting `build-2026-11-06-002`）
- 刪 `app/market-mood/`（page、layout）；側欄拿掉「🌤️ 市場溫度」→ 側欄與手機底部是**同一份 4 項**（首頁／強勢股／強勢月報／選股），
  只有它在用的 `navItems.desktopOnly` 機制一起刪。首頁是市場溫度唯一的入口。
- `/market-mood` 307 轉首頁（`next.config.ts` 現在三條：`/strong-table`、`/watchlist`、`/market-mood`）；sitemap 拿掉。
- `MarketMoodSections` 只剩首頁用 → 拿掉 `level` 參數，標題固定 h3／h4（首頁 h1→h2→h3→h4）；`/api/market-sentiment` 只剩首頁在用（`?days=400`）。
- 下面「首頁再改版」「拿掉自選股功能」「前端模組化與死碼」幾段提到的 /market-mood（「與 /market-mood 共用」「市場溫度不補進底部」等）都是當時的狀態。

**美股加早上 08:30 一班**（業主選「加早上 8:30 這班」；只加排程、沒改程式）
- Cloud Scheduler `stock-collect-us-0830`：`30 0 * * 2-6`（Etc/UTC ＝ 台灣週二～週六 08:30），POST 同一個 run 端點，
  body `{"overrides":{"containerOverrides":[{"args":["--us-only"]}]}}`，服務帳號同 1700／2200。
- 以前美股要等 17:00 那班才更新，台股盤中首頁看到的是前天的美股。實測當天 08:40 FinMind 已有前一晚收盤；
  手動觸發一次成功（execution `stock-collector-5ltdf`，args `--us-only`）。`deploy-cloudrun.sh` 不會建這班。

**每年第一個交易日跨年**（業主選「照這個數字修」，改前改後數字先給過；8a0c75d、296033f；Cloud Run image 已重建）
- 以前每個年度檔各算各的：新年第一個交易日在自己的檔裡沒有前一日，漲跌幅退回用開盤當基準（＝當日振幅）；
  2027-01-04 那晚年度檔只有一天，還會被 `_assert_prev_close_sane` 擋下、整天沒名單也不告警。
- `update_strong_matrix`：每個年度檔前面接上前一年最後 **5** 個交易日（只帶 date／stock_id／open／close），只在檔案從 1/6（含）以前開始時接，
  算完丟掉。接 5 天不是 1 天（審查抓到）：前一年最後一天少一批股票時（2026 年發生過 4 次、各少約 15%），只接 1 天會讓新年第一天超過護欄 5%
  → 新年第 1、2 天都不寫。
- 只改寫 3 天、其他 921 天不變：2024-01-02 46→58（+13 −1）、2025-01-02 45→49（+8 −4）、2026-01-02 89→119（+34 −4；
  例：3308 聯德漲停 +9.95% 補進、3049 精金實際跌 0.97% 移除）。雲端只重算強勢股（`--skip-stock --skip-index --skip-sentiment`，
  execution `stock-collector-96tsm`）後 Firestore `strong_stocks` 926 天與離線預期 0 差異；審查者獨立重現也確認 2027-01-04 情境會寫出名單。
- 新模組 `stock_collector/archive_history.py`（`read_history`：當年不到 60 個交易日就補前一年最後 60 天），`update_macd` 與 `streak` 共用
  → 2026-01-02 MACD「-」從 2,296 檔降到 9 檔、6 月以後與舊版 100% 相同；跨年的連買不在 1/1 歸零。只影響之後收集的日子，舊的 `daily_data` 不改。
- `update_matrix` 跳過某個年度檔時改寄非關鍵告警（以前只有 log，那一年的名單整年不更新也沒人知道）。
- 審查順帶發現（**同一天稍晚已修**，見本則最上面「改過名的股票」）：pivot 用 (stock_id, stock_name) 當 index，改過名的股票在同一天的 `strong_stocks` 出現兩次
  （全史多 358 筆、269 天、19 檔，2023-01-09～2025-12-31；例 2025-01-02 的 6757 有「台灣虎航」「台灣虎航-創」兩筆 → count 50 不是 49、
  前端兩張一樣的卡）。修了會改寫 269 天的名單，要先給業主數字。

**首頁再改版（業主在聊天裡要的；c2c2d6c）**——下面 11-05 那則「首頁改版（晚上…）」是當時的狀態，後續演變如下：
- 「四個指數均分寬度」：加權指數＋美股三大指數四格（`components/home/MarketIndexCard.tsx`；container query `@min-[40rem]` 四格一排、
  不夠寬 2×2，320～1280 七種寬度四格等寬不溢出）。11-05 的「三格並排／三列」寫法已換掉。
- 「市場溫度的融資融卷、走勢圖也放在首頁」：抽出 `components/MarketMoodSections.tsx`，首頁（`components/home/HomeMood.tsx`）
  與 /market-mood 共用，市場溫度頁的文字與改版前逐字相同。11-05 的「首頁四張大卡」到此變成整份市場溫度。
- 「改成用點擊台指大盤彈跳視窗顯示」：頁面下方的指數走勢線圖改成點「加權指數」那格打開的彈跳視窗
  （`components/IndexChartDialog.tsx`，原生 `<dialog>`，保留加權／台指期切換）。背景捲動用 `globals.css` 的
  `html:has(dialog[open])` 鎖：CandleChart 全螢幕離開時會把 `body.style.overflow` 清成 ''，用 JS 鎖會被洗掉。
- 加權／台指期抓不到時只讓那張卡變錯誤訊息（有「重新載入」），市場溫度照常顯示。

**拿掉自選股功能**（業主：「首頁、sidebar 的自選股刪除，不用這個功能」；f3b7b78）
- 刪 `/watchlist` 頁、`WatchlistButton`、`/api/quotes`、`lib/signals.ts` 與 `lib/firebase.ts` 的自選股函式；側欄與手機底部導覽
  拿掉「⭐ 自選股」→ 底部 **4 格**（首頁／強勢／月報／選股；市場溫度不補進底部，首頁已有完整內容）；個股頁只剩 🔔 到價提醒。
- `/watchlist` 307 轉首頁（書籤、主畫面捷徑不會看到找不到頁面）；sitemap 拿掉。
- 保留：Google 登入、到價提醒；Firestore `user_watchlists` 資料與 `firestore.rules` 的規則都不動。

**前端模組化與死碼**（7af5f3c、f192b8a、b1b3837；畫面只有下面註明的兩處不同）
- `lib/use-latest-request.ts` 序號閘門，強勢股、月報、選股三頁共用。**修掉兩個真 bug**：月報「先選冷的 A 月、再選 B 月」時
  A 晚到會把下拉與整張表蓋回 A 月；選股頁連點兩個快速策略時，「已套用條件」是新的、卡片與「符合 N 檔」卻是舊條件的結果。
- 強勢股欄位定義原樣搬到 `app/strong-stocks/columns.tsx`（page 1,488→約 1,050 行）；成交額／當沖比／MACD 底色共用 `lib/format.ts`，
  搜尋正規化／比對／產業清單／排序共用 `lib/table.ts`。選股頁 7 個下拉補 `<label>`（外觀不變，讀屏念得出是哪個條件）。
- API：刪掉 repo 內沒人呼叫的 `/api/stock/[id]`（每次未快取的請求都打 FinMind 抓 5 年 K 線）與 `/api/stocks`；
  `/api/stock/[id]/institutional` 保留。market-sentiment 拿掉 `?last`、`latest`、`generatedAt`，`first` 只剩 `taivix`
  （11-05 那則的「首頁用 `?last=3`」已不存在，首頁與 /market-mood 都送 `?days=400`）；`market-index/[id]` 的 `?last` 還在（首頁美股三格用）。
  選股拿掉沒人送的 `trustBuy`；強勢股與選股的日期規則、昨收、強勢天數共用 `lib/strong-enrich.ts`（`days` 不是數字就退回 7）。
- K 線：純函式搬到 `lib/candles.ts`；**週K／月K 某一整段的量都缺時改成 null**（以前畫 0 高量柱、讀值 0，現在不畫、讀值「—」），
  部分缺值照舊加有值的日子。另刪 InfoTip 的 `dark`、`ChartSkeleton`、`IndexChart` 的 `indexId` 後備（改必填）等死碼。

**收集器清理＋到價提醒安全修正**（2608e66、1237f5e；Cloud Run image 已重建，雲端用 `--us-only` 實跑成功，2026-11-06 03:21）
- 安全：到價提醒收件人改用 Firebase Auth 查 uid（取自文件路徑）的 email，不再用文件裡使用者自己寫的 email——以前任何登入的人
  都能讓收集器用業主的 Gmail 寄信給任意地址。股名用當日資料、條件數值用解析後的數字。
- 信沒寄出就不停用提醒（以前沒設 SMTP 或 Gmail 拒收也照樣停用）；補舊日期不檢查提醒；告警信時間改台灣時間。
  預設服務帳號有 `roles/editor`（含 `firebaseauth.users.get`），不需另外改 IAM。
- 美股：抓窗 7→21 個日曆天（`US_LOOKBACK_DAYS`，蓋過春節連休）、台股休市日只抓美股、新增 `--us-only`（2608e66，11-05 深夜）；
  斷料檢查移出 tenacity 重試（以前加權指數重試 3 次就可能寄 3 封，現在一個執行最多 1 封）。
- `stock_collector` 成為套件（`__init__.py`，只支援 `python -m`）；非關鍵告警共用 `notify.send_nonfatal`；刪 `merge_daily_files.py`、
  `--incremental`／`run_incremental`、`write_strong_stocks`、config 沒用的常數、兩支已跑完的一次性腳本
  （`backfill_null_vs_zero.py`、`fix_stock_id_leading_zero.py`）。`.gcloudignore` 排除 `service-account*.json` 等憑證。
- 沒修、記在 skill 待辦：FinMind `DataLoader()` 連網沒有 timeout；美股斷料告警一天可能寄多封；
  強勢股名單裡改過名的股票同一天出現兩次（pivot 重複名稱；同一天稍晚已修，見本則最上面）。
  （當時列在這裡的「2027-01-04 跨年」與「早上的 `--us-only` 排程」同一天稍晚做完，見上方兩段。）

### 2026-11-05

**首頁改版（晚上，業主在聊天裡要的三件事；看過改前改後說「可以上線」）**
- 加權指數卡旁邊加美股三大指數（費半、S&P 500、道瓊）：跟美股前一個交易日收盤比、紅漲綠跌、標「美股 M/D 收盤」。
  依這一塊自己的寬度排（container query `@min-[26rem]`）：夠寬三格並排，手機三列（390px 三格並排時道瓊數字頂到框邊）。
  收集器 `collect_us_indices`（FinMind `USStockPrice`，每班往回抓 7 天）；已回補 2023 起各 964 筆。
- 「首頁不要放今日強勢股，把大盤當沖比、恐慌指數展開放上」「補上美國恐慌指數」→ 兩行摘要與今日強勢股換成
  四張大卡（`components/MoodStats.tsx`，與 /market-mood 共用）；首頁改抓 `?days=400`（要算近一年最高最低）。
- 「`text-sm text-gray-700 mt-0.5` 這個不用顯示」＝`PageHeader` 的 subtitle → 三頁都拿掉；月報「數字為 M/D」移到統計列。
- 回歸審查：畫面 1 項（加權指數抓不到時美股那塊跟著消失 → 卡片一定渲染）已修並用 CDP 攔截實測。

**市場溫度分頁（大盤當沖比、融資融券、恐慌指數）**（業主在聊天裡逐題決定；收集器與前端都做好、尚未上線）
- 新頁 `/market-mood` ＋ 首頁加權指數卡下面兩行摘要（整行可點）；手機底部維持 5 格、電腦側欄多一項（`navItems.desktopOnly`）。
- 當沖比＝官方「成交金額（買進）占比」（新聞口徑），上市、上櫃各一個數字；融資餘額＋融券餘額；恐慌指數台股（首頁）＋美股（新頁）。
  不貼偏高／偏低標籤，只寫數字、跟前一筆比（寫出日期）、近一年最高最低（寫出天數）。
- 全部抓官方：證交所 TWTB4U／MI_MARGN、櫃買 intraday/stat?type=Daily／margin/balance、期交所 log2data_eng 月檔、CBOE VIX_History.csv。
  **融資用次日回應的「前日餘額」當定案值**（官方 notes 說今日餘額只是參考）。
- 回歸審查 18 項（5 項經反駁者確認、其餘自己核對）全部修完：writer 逐欄合併不讓 None 蓋值、批次模式只跑一次、
  `--skip-sentiment` 獨立旗標、斷料告警、回補 --resume 不把失敗日當完成、首頁用 `?last=3` 不受春節影響、圖 resize 後 fitContent。
- 處置股查證：精材 3374 沒當沖資料＝處置期間依規定不得當沖（全市場 637 檔次 0 例外）。業主選 B：當沖缺值的說明改寫、籌碼圖當沖圖例一律標日期並在最新日沒數字時說明（已上線）。

### 2026-10-26

**強勢月報改成 Word《強勢商品篩選》的樣子**（業主在聊天裡逐題決定，看過改前改後才上線）
- 標題「西元YYYY年MM月份【強勢商品篩選】」、兩層表頭（籌碼／技術分析）、商品「1560中砂」、依代號排序、最後一欄叫「強勢日」。
- **數字全表同一天＝最新交易日**（過完的月份＝月底），不再是每檔各自的最後一次強勢日；「日期」仍是第一次強勢日。
- 收盤價漲停＝紅字＋「漲停」（`lib/format.ts` 的 `isLimitUp`，依升降單位捨去，8～10 月全市場驗證 0 誤差）。
- 說明收進一顆「📖 說明」按鈕；手機也是同一張表（商品欄固定、左右滑）。數值窗 37→20 天（讀取約少一半）。
- 不做：下載 .docx、A／非 A 兩份名單、10 日均價紅字、藍黃底色（業主私人記號）。KD／均線仍「待定義」。

**強勢股卡片頁與總表合併成一頁**（業主決定、看過改前改後截圖；兩輪審查）
- `/strong-stocks` 上方切換「卡片｜表格」：日期、搜尋、5 顆快速篩選、MACD／成交量／產業、排序、統計列、
  舊日期警示兩種檢視共用，切換不打 API。第一次卡片，之後記住上次（localStorage `strong-stocks-view`）。
  兩種都預設漲跌幅由大到小，卡片可用「排序依據」改。`/strong-table` 由 `next.config.ts` 307 轉到 `?view=table`。
- 底部導覽 5 格、字 text-sm、所在格粗體＋上方色條；Sidebar 拿掉「強勢總表」。
- `StockCard`（首頁、選股頁共用）字放大、顏色加深、平盤與法人 0 灰色、MACD 缺值「—」；
  卡片欄數依扣掉側欄的內容寬（1 / lg 2 / xl 3 / 2xl 4），卡片 ≥300px。
- 強勢天數讀取失敗時 API 送 null（畫面「—」），不再全部顯示「強勢 0 日」。

### 2026-10-23

**強勢股 0 檔日清理＋業主 Word 月報逐日比對**（collector image 已重建）
- 刪掉 2024-08-05 殘留的 5 檔舊名單；`write_strong_stock_matrix()` 之後會自動清「資料完整、重算後 0 檔」的日期，
  護欄改在寫入前檢查；股名空白的強勢股不再被 pivot 丟掉（補回 2023 年 3 檔次）。
- 發現 2026-04-24、06-25、07-02、07-09 年度檔資料不完整（07-09 法人整天是 0 → 0 檔強勢），補不補待業主決定。
- 與 Word 月報逐日比對：Word 只涵蓋 09/18～09/24；數字欄是業主「抄寫那天」的值；業主挑選沒有可重現的規則。
  22 題待業主確認的規則做成問卷 https://claude.ai/artifact/HK59rjPBnkynxb2qrYqA3W（細節見 skill）。
- 10-23 臨時停市，收集器自動跳過（證交所 holidaySchedule 不含臨時停市，FinMind 日曆有）。

### 2026-10-22

**收集器認得休市日，並清掉 daily_data 重複列**（collector image 已重建並在雲端實測）
- 新增 `stock_collector/trading_calendar.py`。以前排程只排除週六日，平日休市照跑、抓不到股價就寄告警；
  `--backfill-gaps` 也把假日當缺漏。現在要三個來源（FinMind 交易日曆、FinMind 加權指數、證交所 FMTQIK）
  都說沒交易才跳過，寧可誤報也不安靜漏收。日曆只排到 2026-12-31，2027 一律照常收集。
- 雲端實測：`--date 2026-10-09`（國慶）4 秒結束、exit 0、不寄信；交易日照常收集 2,353 檔。
- 07-24～08-03 共 7 天的重複列（每天 794 檔存兩份，因 `taiwan_stock_info` 一檔列在兩個產業）與 08-03 的
  2 片殘留分片已清掉；`write_daily_stocks()` 之後寫入前會去重並刪舊分片。
- 補 09-29、10-21 整天缺的外資持股，以及 07-24～08-31 的持股張數／發行張數。
- 手機與桌機頁面功能對齊（底部導覽 6 格、總表／月報手機排序與欄位、K 線手機讀值區、自選股今日訊號）。

### 2026-10-18（下午）

**重建 collector image：漲跌幅修正與放空收集正式生效**
- 補上 10-12~10-16 的放空資料（9,375 + 9,301 檔次），個股頁「放空籌碼」恢復。
- 重建 Cloud Run Job image → 新的 `add_change_pct`（以前一交易日收盤為基準）生效，
  並觸發 `strong_stocks` 全史重寫：**913 天、71,310 檔次（日均 78.1）**，
  改寫前是 887 天／54,777 檔次（日均 61.8）。
- 驗收用逐檔不變量檢查：2026-10-16 的 102 檔全部符合四個條件，違反數 0；
  原本掛在強勢股裡的下跌股 `9103 美德醫療-DR`（−0.33%）已消失。
- ⚠️ **更正（2026-10-22）**：不是 913 天全部改寫，是 **912 天改寫、2024-08-05 殘留 5 檔舊名單**。
  `write_strong_stock_matrix()` 只寫「重算後 ≥1 檔」的日期、沒有刪除步驟；那天新規則下是 0 檔，
  所以舊的振幅名單（易威、弘塑、新日興、健策、信驊）沒被清掉。有效檔次是 71,305 不是 71,310。
- ⚠️ `deploy-cloudrun.sh` 會被 auto mode 擋下（它同時 enable API／改 IAM／建排程），
  改用只做部署的窄指令並明確帶上 `--memory=2Gi --set-env-vars --set-secrets`。

### 2026-10-18

**盤點自動驗證迴圈（loop engineering），並實測「沒有迴圈的代價」**
- 現況：**零測試、零 hook、無有效 CI**。所有驗證都是人工做一次就丟掉。
- 實測兩件沒人發現的事：
  - **放空欄位自 2026-10-12 起全斷**（collector image 一週未重建），
    個股頁「放空籌碼」對所有股票都是「—」，**七天無人知**。
  - 強勢股矛盾仍在：2026-10-16 的 72 檔有 2 檔漲跌幅 ≤3%（`9103` −0.33%）。
- 規劃四個迴圈（資料語意不變量／文件↔程式一致性／版面不變量／排程健康度）與
  三層執行位置（hook、收集後 audit、CI），詳見 skill 的「自動驗證迴圈」專章。
- 記下一個量測陷阱：`daily_data` **沒有 `prev_close`**，寫 fallback 到 `open`
  會變成在量振幅（本次就因此量出假結果）。

### 2026-10-09

**漲跌幅基準修正 + 放空籌碼 + 文件校正**
- `change_pct` 由「當日振幅」改為「以前一交易日收盤為基準」（台股慣例，前端 2026-08-19 已統一）。
  加 `_assert_prev_close_sane()` 護欄，避免 GCS 年度檔下載失敗時默默退回振幅還覆寫歷史。
  ⚠️ **Cloud Run Job image 重建後**，887 天的 `strong_stocks` 會依新規則重寫
  （強勢檔次 54,777 → 68,815；「實際下跌卻入選」1,204 → 1）。
- 新增放空籌碼：融券／借券賣出／融資餘額三欄（收集器 + 個股頁 + `scripts/backfill_short_sale.py`）。
  已回補 53 天（104,749 + 103,890 檔次）。
- 強勢股條件四處文件同步成程式實際值（舊敘述「多頭排列＋MACD＋1000 張」是錯的）。
- InfoTip 泡泡改 `position: fixed`（原本 absolute 會讓整頁橫捲）。
- 清掉本檔的過時內容：基本面分析、streamlit_app、utils.py、Docker、tailwind.config.ts、
  Firebase Hosting 部署方式。

### 2026-07-24

**Firebase 遷移完成**

將整個專案從 Supabase 遷移至 Firebase，實現更低的寫入成本和更簡單的部署。

**後端變更**
- 移除 `supabase_writer.py`，新增 `firebase_writer.py`
- 實作分片寫入策略：每日股票分成 500 筆/片，大幅減少寫入次數
- 每日寫入次數從 ~2,400 次降至 ~9 次（節省 99.6%）

**前端變更**
- 移除 `lib/supabase.ts`，使用 `lib/firebase.ts` + `lib/firebase-admin.ts`
- 移除 `app/auth/callback/route.ts`（Firebase 使用 Popup 登入，不需 callback）
- 更新所有 API Routes 使用 Firebase Admin SDK
- 更新 Server Actions 使用 Firestore 查詢

**Firestore 集合結構**
- `daily_data/{date}/chunks/chunk_{n}` - 分片儲存每日股票
- `strong_stocks/{date}` - 聚合每日強勢股
- `market_index/{TAIEX|TX}` - 聚合指數歷史
- `user_watchlists/{userId}/stocks/{stockId}` - 自選股

**依賴更新**
- 移除 `@supabase/supabase-js`
- 新增 `firebase` 和 `firebase-admin`

### 2026-06-21

**強勢股資料同步問題修復**
- **環境變數載入修正**：`update_strong_matrix.py` 加入 `dotenv.load_dotenv()`，修正無法寫入 Supabase 的問題
- **Supabase 資料完整同步**：成功同步 50,089 筆強勢股記錄（涵蓋 833 個交易日，2023-2026）
- **強勢股日期選擇器修復**：
  - 問題：API 受 Supabase 1000 筆限制，只能顯示最近 9 個交易日
  - 解決：使用分批查詢（pagination）繞過限制
  - 結果：現可顯示最近 20 個交易日（約 1 個月）
  - 效能：從最多 60 批降至 5 批（提升 92% 效率）

**強勢股頁面 UI 改善**
- **日期資訊卡片**：新增醒目的當前日期顯示（大字體）
- **可選範圍提示**：顯示日期範圍和可用交易日總數
- **載入速度優化**：減少不必要的批次查詢，提升初次載入速度

**Sidebar 與 AuthButton UX 改善**
- **AuthButton 縮排模式**：
  - 已登入：顯示圓形頭像（10x10）+ 綠點狀態指示
  - 未登入：顯示 Google 彩色圖示（圓形按鈕）
  - 無頭像時：顯示姓名首字母圓形圖示
  - 懸停提示：顯示完整使用者資訊
  - 點擊行為：直接執行登入/登出（無需展開 sidebar）
- **縮排按鈕重新定位**：
  - 從底部移至標題區右上角（更符合使用習慣）
  - 視覺優化：圓角方形按鈕 + 圖示旋轉動畫
  - 移除舊的底部縮排按鈕（避免混淆）
- **底部資訊區適配**：
  - 縮排模式：顯示圖示（📈）
  - 展開模式：顯示完整文字「資料來源：FinMind」

**響應式設計**
- 桌面展開：w-64 (256px) - 顯示完整資訊
- 桌面縮排：w-20 (80px) - 顯示圖示
- 手機版：w-64 (256px) - 始終顯示完整資訊（漢堡選單）

### 2026-06-20

**前端優化**
- **IndexCard 文字顏色修正**：開盤、成交量、未平倉量數值改用 `text-gray-900`，提升可讀性
- **API Response 快取**：為 `/api/market-index/[id]` 和 `/api/stocks` 加入 Cache-Control headers
- **Sidebar 整合**：整合 AuthButton（Google OAuth 登入）+ 手機版響應式設計
- **元件清理**：移除舊版圖表元件（CandlestickChart、MacdChart、VolumeChart）改用整合的 StockChart
- **搜尋優化**：移除 StockSearch，改用 StockSearchOptimized（Server Action + debounce）

**手機版響應式設計**
- **自選股頁面**：手機版卡片式佈局、桌面版表格佈局
- **強勢股頁面**：調整 grid breakpoints（grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4）
- **StockCard 元件**：響應式 padding、字體大小、文字截斷
- **圖表控制**：StockChart / IndexChart 控制按鈕改為兩行佈局（手機版）

**資料架構優化**
- **強勢股矩陣精簡**：改為僅儲存強勢股（is_strong=true），資料量從 549,180 筆降至 11,557 筆（減少 98%）
- **API 查詢簡化**：`/api/strong-stocks` 移除 `is_strong` 過濾條件（存在即為強勢股）
- **自動年度存檔系統**：每日收集後自動追加到年度檔案（stocks_YYYY.csv）並刪除每日檔案
  - 合併 2023 年資料（239 檔案 → 1 年度檔案，508,369 筆）
  - 清理所有歷史每日檔案（2023-2025）
  - 儲存空間優化：從 151.7 MB 降至 135 MB（節省 37%）
  - 完全自動化：無需手動合併或清理
  - 改善 `update_strong_matrix.py`：支援年度檔案讀取（向後相容每日檔案）
  - 改善日誌輸出：清楚顯示檔案狀態（已刪除/保留）

