# CLAUDE.md

Claude Code 處理本專案時的指引說明。

> ⭐ **改動前先讀 `.claude/skills/stock-helper-context/SKILL.md`**：
> 那裡記錄踩過的地雷與資料語意（「無資料」不可寫成 0、股→張一律 `Math.trunc`、
> 表格溢出不可讓整頁橫捲、強勢股條件的權威來源、改 collector 不會自動部署…）。
> 本檔講的是**架構與慣例**，skill 講的是**為什麼不能那樣做**。

## 專案概述

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票。

功能：
1. 大盤指數分析（加權指數 TAIEX + 台指期 TX）
2. 每日資料收集（批次 API，6 次請求抓完全市場）
3. 批次歷史資料收集與一次性回補工具（`scripts/`）
4. 多條件選股篩選（`/screener`）
5. 強勢股分析網站：卡片 `/strong-stocks`、總表 `/strong-table`、月報 `/strong-monthly`
6. 個股詳情：K 線／技術指標／三大法人／放空籌碼／今日訊號
7. 自選股與到價提醒（Firebase Auth + Google OAuth）

⚠️ **已移除、文件若再提到就是過時**：基本面分析（OpenAI/Claude 生成報告，
連同 `app/analysis`、`api/analysis`、`stock_analysis_reports` collection）、
`streamlit_app/`、`utils.py`、`tailwind.config.ts`（Tailwind v4 用 `@theme`，沒有設定檔）。
根目錄的 `優化建議報告.md`（2026-08-01）整份已過時，其中 S1/S2 指的端點都不存在了。

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                               │
│              Next.js 16 + React 19 + Tailwind CSS v4            │
│            (Firebase App Hosting，push main 自動 rollout)        │
│                                                                  │
│  ┌──────────┬──────────────────────────────────────────────┐    │
│  │ Sidebar  │               主內容區                        │    │
│  │ (md 以上)│  首頁：Dashboard（指數＋今日強勢＋自選）      │    │
│  │ 📊 首頁  │  強勢股：卡片檢視 /strong-stocks              │    │
│  │ 🔥 強勢股│  總表　：全欄位表格 /strong-table             │    │
│  │ 🗓️ 月報  │  月報　：當月彙整 /strong-monthly             │    │
│  │ 🔍 選股  │  選股　：自訂條件 /screener                   │    │
│  │ ⭐ 自選股│  自選股：需 Google 登入                       │    │
│  └──────────┴──────────────────────────────────────────────┘    │
│  手機：不渲染 Sidebar，導覽用 MobileBottomNav、登入在 TopBar    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API 層                                   │
│              Next.js API Routes (App Router)                     │
│  market-index/[id] │ strong-stocks │ strong-monthly │ screener │
│  stock/[id] │ stock/[id]/institutional │ stocks │ quotes         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        資料庫層                                  │
│                  Firebase Firestore + Auth                       │
│  daily_data/{date}/chunks │ strong_stocks │ market_index │ metadata │
│  （使用者資料：user_watchlists／alerts）                         │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       資料收集層                                 │
│                    Python + FinMind API                          │
│   index_collector.py  │  stock_collector.py  │  update_matrix   │
└─────────────────────────────────────────────────────────────────┘
```

## 專案結構

```
選股小幫手/
├── CLAUDE.md                           # 專案指引
├── .env                                # 環境變數（API keys）
├── requirements.txt                    # Python 依賴
│
├── stock_collector/                    # 資料收集模組
│   ├── config.py                       # FinMind API 配置
│   ├── daily_collector.py              # 統一排程器（重試、增量更新、驗證）
│   ├── stock_collector.py              # 每日股票資料收集器（6 支批次 API）
│   ├── index_collector.py              # 指數資料收集器（TAIEX + TX）
│   ├── update_strong_matrix.py         # 強勢股判定與矩陣更新（條件的唯一權威）
│   ├── indicators.py                   # MACD 狀態（由已刪除的 utils.py 精簡而來）
│   ├── streak.py                       # 法人連買／連賣天數
│   ├── alert_checker.py                # 到價提醒檢查
│   ├── update_macd.py                  # 舊版逐檔 MACD（已被 indicators 取代）
│   └── merge_daily_files.py            # 舊版檔案合併工具（已被年度歸檔取代）
│
├── firebase_writer.py                  # Firestore 寫入（分片優化 + null 語意）
├── gcs_archive.py                      # 年度檔上下載 GCS（collector 是 stateless）
├── notify.py                           # 通知
│
├── scripts/                            # 一次性稽核／回補工具（一律預設 dry-run，--write 才寫）
│   ├── backfill_null_vs_zero.py        # 把「缺資料被寫成 0」改回 null
│   ├── fix_stock_id_leading_zero.py    # 修 ETF 代碼掉前導零（0050→50）
│   ├── backfill_foreign_hold_shares.py # 回補外資持股張數／已發行張數
│   ├── backfill_short_sale.py          # 回補融券／借券賣出／融資餘額
│   └── backfill_index_volume_from_twse.py  # FinMind 缺大盤成交量時改抓 TWSE
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
│   │   ├── page.tsx                    # 首頁 Dashboard
│   │   ├── strong-stocks/page.tsx      # 強勢股（卡片）
│   │   ├── strong-table/page.tsx       # 強勢股總表（全欄位表格）
│   │   ├── strong-monthly/page.tsx     # 強勢月報（當月彙整）
│   │   ├── screener/page.tsx           # 自訂條件選股
│   │   ├── watchlist/page.tsx          # 自選股
│   │   ├── stock/[id]/                 # 個股詳情（page + StockDetailClient）
│   │   ├── actions/stocks.ts           # Server Action：股票搜尋
│   │   └── api/                        # market-index/[id]、strong-stocks、
│   │                                   # strong-monthly、screener、stocks、quotes、
│   │                                   # stock/[id]、stock/[id]/institutional
│   │
│   ├── components/                     # React 元件
│   │   ├── Sidebar.tsx                 # 側邊導航（hidden md:flex，手機不渲染）
│   │   ├── TopBar.tsx                  # 置頂搜尋列（手機版右側放登入）
│   │   ├── MobileBottomNav.tsx         # 手機底部導覽（6 格，與 Sidebar 共用 navItems）
│   │   ├── AuthButton.tsx              # Google 登入（variant: sidebar | topbar）
│   │   ├── InfoTip.tsx                 # 說明泡泡（⚠️ 一律 position: fixed）
│   │   ├── CandleChart.tsx             # K 線主圖
│   │   ├── IndexChart.tsx              # 指數技術分析圖
│   │   ├── StockChart.tsx              # 個股技術分析圖
│   │   ├── InstitutionalChart.tsx      # 三大法人籌碼圖
│   │   ├── StockSignals.tsx            # 今日訊號（純前端判定）
│   │   ├── StockCard.tsx / states.tsx / table.tsx / MainContent.tsx
│   │   ├── WatchlistButton.tsx / AlertButton.tsx
│   │   └── StockSearchOptimized.tsx    # 搜尋（Server Action + debounce）
│   │
│   ├── lib/                            # 共用函式庫
│   │   ├── firebase.ts                 # Client SDK + Auth + 型別定義
│   │   ├── firebase-admin.ts           # Admin SDK（含 dayCache）
│   │   ├── finmind.ts                  # 個股 K 線直打 FinMind REST
│   │   ├── stock-data.ts               # 個股頁資料彙整
│   │   ├── monthly-report.ts           # 月報彙整層
│   │   ├── indicators.ts / signals.ts / format.ts / table.ts
│   │
│   ├── next.config.ts                  # Next.js 配置
│   ├── postcss.config.mjs              # Tailwind v4 走 PostCSS（沒有 tailwind.config.ts）
│   ├── firestore.rules                 # Firestore 安全規則（需另外部署）
│   └── package.json                    # NPM 依賴
│
└── .claude/skills/stock-helper-context/SKILL.md   # ⭐ 改動前必讀：踩過的地雷與資料語意
```

⚠️ **已刪除、文件別再提**：`utils.py`、`streamlit_app/`、`frontend/Dockerfile`、
`docker-compose.yml`、`tailwind.config.ts`、`app/analysis/`、`api/analysis/`。

## 核心模組說明

### Python 後端

| 檔案 | 職責 |
|------|------|
| firebase_writer.py | DataFrame 寫入 Firestore（分片優化）；`_opt_num` 缺漏寫 null、`_norm_stock_id` 補前導零 |
| gcs_archive.py | 年度檔上下載 GCS（collector 是 stateless，年度檔是唯一完整歷史） |
| stock_collector/daily_collector.py | 統一排程器：重試機制、缺口回補、資料驗證 |
| stock_collector/stock_collector.py | 6 支批次 API 收集、CSV 存檔、Firestore 同步 |
| stock_collector/index_collector.py | 指數資料收集（加權指數 TAIEX + 台指期 TX） |
| stock_collector/update_strong_matrix.py | **強勢股判定的唯一權威**；每次執行重算全部歷史 |
| stock_collector/indicators.py | MACD 狀態（用本地年度檔算，零 API） |
| stock_collector/streak.py | 法人連買／連賣天數 |
| stock_collector/alert_checker.py | 到價提醒 |
| stock_collector/config.py | FinMind API token 配置 |

### Next.js 前端

| 檔案 | 職責 |
|------|------|
| app/layout.tsx | 根 Layout：Sidebar（md 以上）+ TopBar + MobileBottomNav |
| app/page.tsx | 首頁 Dashboard：指數、今日強勢、我的自選 |
| app/strong-stocks/page.tsx | 強勢股（卡片檢視） |
| app/strong-table/page.tsx | 強勢股總表（表格，預設全欄位） |
| app/strong-monthly/page.tsx | 強勢月報（當月彙整，12 欄對應業主 Word 月報） |
| app/screener/page.tsx | 自訂條件選股 |
| app/watchlist/page.tsx | 自選股：用戶自訂觀察清單（需登入） |
| app/stock/[id]/ | 個股詳情：K 線、三大法人、放空籌碼、今日訊號 |
| api/market-index/[id]/route.ts | API：取得指數歷史資料（TAIEX / TX） |
| api/strong-stocks/route.ts | API：取得今日強勢股（含連續強勢天數） |
| api/strong-monthly/route.ts | API：月報彙整（s-maxage=1800） |
| api/screener/route.ts | API：自訂條件選股 |
| api/stock/[id]/route.ts | API：取得個股完整歷史資料 |
| api/stock/[id]/institutional/route.ts | API：個股法人籌碼 |
| api/stocks/route.ts | API：取得所有股票清單（分頁繞過 1000 筆限制） |
| api/quotes/route.ts | API：報價 |
| components/Sidebar.tsx | 側邊導航欄（`hidden md:flex`，**手機不渲染**）+ AuthButton |
| components/TopBar.tsx | 置頂搜尋列；手機版右側放登入 |
| components/MobileBottomNav.tsx | 手機底部導覽（6 格；清單與亮燈規則共用 `Sidebar.tsx` 的 `navItems`／`isNavActive`，改一處兩邊同步） |
| components/InfoTip.tsx | 說明泡泡（⚠️ 一律 `position: fixed`，見 skill） |
| components/StockSignals.tsx | 今日訊號（純前端，零額外 API） |
| components/InstitutionalChart.tsx | 三大法人籌碼圖 |
| components/AuthButton.tsx | Google OAuth 登入/登出按鈕 |
| components/WatchlistButton.tsx | 加入/移除自選股按鈕 |
| components/IndexChart.tsx | 指數技術分析圖（K 線 + 成交量 + MACD/KD/RSI） |
| components/StockChart.tsx | 專業技術分析圖（K 線 + 成交量 + 當沖比 + MACD/KD/RSI） |
| components/StockSearchOptimized.tsx | 股票搜尋（Server Action + debounce） |
| components/StockCard.tsx | 股票資訊卡片元件 |
| components/MainContent.tsx | 主內容區（響應式寬度調整） |
| app/actions/stocks.ts | Server Action：股票搜尋（Firestore） |
| lib/firebase.ts | Firebase Client SDK + Auth + 型別定義 |
| lib/firebase-admin.ts | Firebase Admin SDK（伺服器端查詢） |

### K 線圖（`CandleChart`；`StockChart`／`IndexChart` 只是包一層）

使用 TradingView 開源的 **lightweight-charts**。個股頁與首頁「指數走勢」共用同一個 `CandleChart`。
（2026-10-22 依程式校正：本段先前寫的 TimeRange 同步、十字游標顯示開高低收／成交額／當沖、
「固定範圍無動態滑動」、16px、`#1a1a2e` 全部與程式不符。）

**控制列**：
- 週期：日K／週K／月K（預設日K）
- 區間：**1M**／3M／6M／1Y／2Y（預設 3M；只決定初始顯示範圍，**可以拖曳平移、滾輪縮放**）
- 技術指標（單選分頁）：MACD／KD／RSI（預設 MACD）
- ⚙️ 圖表設定（手機收合、桌機常駐）：版面「價格為主／均衡／指標為主」（預設均衡），
  疊加勾選 MA5／MA10／MA20／MA60／布林／量（預設 MA5、MA10、MA20、量 開）
- ⛶ 全螢幕（只能按 ✕ 離開，Esc 無效）

**讀值**：日期、收、漲跌（%）、量，加上已勾選的 MA、布林與當前指標數值。
桌機疊在圖左上；**手機改放在控制列與圖之間的圖外讀值區**（兩欄格線，缺值顯示「—」），
不疊在圖上蓋住 K 棒（2026-10-22 起，之前手機直接隱藏這些數值）。
⚠️ 游標日期在新資料裡找不到時一律退回最後一根（換週期時殘留的游標會讓讀值整塊消失、圖往上跳）。

**時間軸同步**：主圖與指標圖用 **LogicalRange** 同步（`CandleChart.tsx` 的 `subscribeVisibleLogicalRangeChange` 區塊）。
指標一律用完整資料計算（不 slice），顯示範圍靠 `setVisibleLogicalRange` 控制——
這是 SKILL.md 地雷 #4「遞迴指標暖身」的解法，**不要改回用區間切資料再算**。

**顏色**：K 棒與量柱是「收 ≥ 開」紅、「收 < 開」綠（只比同一根的開與收）；
讀值的漲跌顏色則是跟前一根收盤比，所以兩者可能不同色。

**已知限制**：設定不會記住（每次打開回預設）；換週期／區間／指標／版面時拖曳位置會被重設；
手機上手指在圖上滑會被圖表拿去拖曳、整頁不捲動（圖高 600px）。

**UI 規格**：圖表字 14px、背景 `#131722`、高度 600px、全幅寬度（跳脫 max-w-7xl）。

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
└── TX
    ├── index_id: "TX"
    ├── index_name: "台指期近月"
    └── history: [{ date, open, high, low, close, volume, open_interest, settlement_price }, ...]
```

**優勢**：單一文件包含完整歷史，讀取從 500+ 次降至 1 次

### user_watchlists/{userId}/stocks/{stock_id} - 自選股

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
| **每日總計** | ~2,402 | **~9** | **99.6%** |

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
6. 計算 MACD 狀態
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
- **自動重試**：使用 tenacity 套件，失敗時指數退避重試（最多 3 次）
- **增量更新**：自動偵測缺少的日期，只補抓缺失資料
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
前一筆」（`groupby` + `shift(1)`），**不可用日曆天推算**；年度檔第一個交易日取不到前一日時
fallback 回 `open`（與前端 `prev_close > 0 ? prev_close : open` 同一條規則）。

⚠️ **3% 門檻是套在「四捨五入到小數 2 位」的 change_pct 上**（與畫面顯示同一把尺）：
真實漲幅 3.004% → `round(2)=3.0` → `3.0 > 3.0` 為 False 而落選，全史 125 檔次受影響（0.18%）。

⚠️ **`update_matrix()` 每次執行都會重算並覆寫全部歷史** `strong_stocks/{date}`。
改判定邏輯等於改寫 887 天的歷史強勢股清單；但 **Cloud Run Job image 不重建就不會生效**
（`gcloud run jobs deploy stock-collector --source=.`），push 到 main 只重建前端。
`_assert_prev_close_sane()` 會在「只拿到單一日期」或「fallback 比例 > 5%」時中止，
避免 GCS 年度檔下載失敗時默默用當日振幅覆寫歷史。

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
（UTC 09:00 / 14:00 ＝ 台灣 17:00 / 22:00）。

## 執行指令

### Python 資料收集

```bash
# === 統一排程器（推薦）===
python -m stock_collector.daily_collector                    # 今日（股票+指數+矩陣）
python -m stock_collector.daily_collector --incremental      # 增量更新（只補缺少的日期）
python -m stock_collector.daily_collector --date 2026-06-19  # 指定日期
python -m stock_collector.daily_collector --days 7           # 批次收集過去 7 天
python -m stock_collector.daily_collector --skip-stock       # 只收集指數+矩陣
python -m stock_collector.daily_collector --skip-index       # 只收集股票+矩陣
python -m stock_collector.daily_collector --skip-matrix      # 只收集資料，不更新矩陣

# === 個別收集（舊方式）===
# 指數資料收集（加權指數 + 台指期）
python -m stock_collector.index_collector              # 今日
python -m stock_collector.index_collector --days 30    # 過去 30 天
python -m stock_collector.index_collector --start 2024-01-01 --end 2026-06-16

# 每日股票收集（批次 API）
python stock_collector/stock_collector.py

# 批次歷史收集（最近 7 天）
python stock_collector/stock_collector.py --days 7

# 更新強勢股矩陣
python stock_collector/update_strong_matrix.py

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

## 效能優化

### API Response 快取

API Routes 使用 Cache-Control header 減少重複請求：

```typescript
// api/stocks/route.ts - 股票清單快取 5 分鐘
return NextResponse.json({ stocks, count }, {
  headers: {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600'
  }
})

// api/strong-stocks/route.ts - 強勢股快取 2 分鐘
headers: {
  'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300'
}
```

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

**重要**：使用 TimeRange（日期）而非 LogicalRange（索引）同步三圖：

- LogicalRange 問題：MACD 從第 34 根 K 棒開始計算，索引對不上
- TimeRange 解決：使用實際日期同步，確保三圖顯示相同日期範圍

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

### Firebase Auth 設定（自選股功能需要）

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

