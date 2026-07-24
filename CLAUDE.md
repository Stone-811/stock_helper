# CLAUDE.md

Claude Code 處理本專案時的指引說明。

## 專案概述

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票。

功能：
1. 大盤指數分析（加權指數 TAIEX + 台指期 TX）
2. 每日資料收集（批次 API，僅需 2 次請求）
3. 批次歷史資料收集
4. 多條件選股篩選
5. 強勢股分析網站（Next.js + Firebase + Sidebar 導航）
6. 自選股功能（Firebase Auth + Google OAuth）
7. Docker 容器化部署支援
8. 基本面分析（OpenAI GPT / Claude API 生成投資研究報告）

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                               │
│                    Next.js 15 + Tailwind CSS                    │
│                   (Firebase Hosting / Docker)                   │
│                                                                  │
│  ┌──────────┬──────────────────────────────────────────────┐    │
│  │ Sidebar  │               主內容區                        │    │
│  │ 📊 首頁  │  首頁：加權指數 / 台指期 技術分析圖           │    │
│  │ 🔥 強勢股│  強勢股：今日強勢股列表 + 篩選功能            │    │
│  │ ⭐ 自選股│  自選股：用戶自訂觀察清單（需登入）           │    │
│  │ 📈 分析  │  基本面分析：AI 生成投資研究報告              │    │
│  └──────────┴──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API 層                                   │
│              Next.js API Routes (App Router)                     │
│   /api/market-index/[id]  │  /api/strong-stocks  │  /api/stock  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        資料庫層                                  │
│                  Firebase Firestore + Auth                       │
│  daily_data/{date}/chunks │ strong_stocks │ market_index │ user_watchlists │
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
│   ├── stock_collector.py              # 每日股票資料收集器
│   ├── index_collector.py              # 指數資料收集器（TAIEX + TX）
│   ├── update_strong_matrix.py         # 強勢股矩陣更新
│   └── merge_daily_files.py            # 檔案合併工具
│
├── firebase_writer.py                  # Firebase Firestore 資料寫入模組（優化版）
├── utils.py                            # 技術指標計算
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
├── frontend/                           # Next.js 前端
│   ├── app/                            # App Router 頁面
│   │   ├── layout.tsx                  # 根 Layout（含 Sidebar）
│   │   ├── page.tsx                    # 首頁（大盤指數圖表）
│   │   ├── strong-stocks/page.tsx      # 強勢股列表頁
│   │   ├── watchlist/page.tsx          # 自選股頁面
│   │   ├── analysis/page.tsx           # 基本面分析頁
│   │   ├── stock/[id]/page.tsx         # 個股詳情頁
│   │   ├── actions/                    # Server Actions
│   │   │   └── stocks.ts               # 股票搜尋（Firestore）
│   │   └── api/                        # API Routes
│   │       ├── analysis/route.ts       # 基本面分析 API（Claude AI）
│   │       ├── analysis/[id]/route.ts  # 單一報告 API
│   │       ├── market-index/[id]/route.ts  # 指數資料 API
│   │       ├── strong-stocks/route.ts  # 強勢股 API
│   │       ├── stock/[id]/route.ts     # 個股資料 API
│   │       └── stocks/route.ts         # 股票清單 API（分頁）
│   │
│   ├── components/                     # React 元件
│   │   ├── Sidebar.tsx                 # 側邊導航欄（響應式 + AuthButton）
│   │   ├── AuthButton.tsx              # 登入/登出按鈕（Google OAuth）
│   │   ├── WatchlistButton.tsx         # 加入/移除自選股按鈕
│   │   ├── MainContent.tsx             # 主內容區（響應式寬度）
│   │   ├── IndexChart.tsx              # 指數技術分析圖（K 線+成交量+指標）
│   │   ├── StockCard.tsx               # 股票卡片
│   │   ├── StockChart.tsx              # 專業技術分析圖（整合 K 線+指標）
│   │   └── StockSearchOptimized.tsx    # 股票搜尋（Server Action + 300ms debounce）
│   │
│   ├── lib/                            # 共用函式庫
│   │   ├── firebase.ts                 # Firebase Client SDK + Auth + 型別定義
│   │   └── firebase-admin.ts           # Firebase Admin SDK（Server-side）
│   │
│   ├── Dockerfile                      # Docker 構建檔
│   ├── docker-compose.yml              # Docker Compose 配置
│   ├── next.config.ts                  # Next.js 配置
│   ├── tailwind.config.ts              # Tailwind CSS 配置
│   └── package.json                    # NPM 依賴
│
└── streamlit_app/                      # 舊版 Streamlit 網站（已棄用）
    └── app.py                          # Streamlit 應用
```

## 核心模組說明

### Python 後端

| 檔案 | 職責 |
|------|------|
| utils.py | 技術指標計算（MA、MACD）、選股邏輯 |
| firebase_writer.py | DataFrame 寫入 Firestore（分片優化）- 每日寫入從 2300+ 次降至 ~10 次 |
| stock_collector/daily_collector.py | 統一排程器：重試機制、增量更新、資料驗證 |
| stock_collector/stock_collector.py | 批次 API 資料收集、CSV 存檔、Firestore 同步 |
| stock_collector/index_collector.py | 指數資料收集（加權指數 TAIEX + 台指期 TX） |
| stock_collector/update_strong_matrix.py | 每日更新強勢股矩陣 |
| stock_collector/config.py | FinMind API token 配置 |

### Next.js 前端

| 檔案 | 職責 |
|------|------|
| app/layout.tsx | 根 Layout：整合 Sidebar 導航 |
| app/page.tsx | 首頁：加權指數 + 台指期技術分析圖 |
| app/strong-stocks/page.tsx | 強勢股：強勢股列表、篩選功能、股票搜尋 |
| app/watchlist/page.tsx | 自選股：用戶自訂觀察清單（需登入） |
| app/analysis/page.tsx | 基本面分析：Claude AI 生成投資研究報告 |
| app/stock/[id]/page.tsx | 個股詳情：專業圖表、法人買賣超 |
| api/analysis/route.ts | API：生成基本面分析報告（POST）、列出報告（GET） |
| api/analysis/[id]/route.ts | API：取得單一分析報告 |
| api/market-index/[id]/route.ts | API：取得指數歷史資料（TAIEX / TX） |
| api/strong-stocks/route.ts | API：取得今日強勢股（含連續強勢天數） |
| api/stock/[id]/route.ts | API：取得個股完整歷史資料 |
| api/stocks/route.ts | API：取得所有股票清單（分頁繞過 1000 筆限制） |
| components/Sidebar.tsx | 側邊導航欄（桌面固定、手機漢堡選單）+ AuthButton |
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

### StockChart / IndexChart 專業圖表功能

使用 TradingView 開源的 **lightweight-charts** 套件實作專業級技術分析圖表。

**核心功能**：
- **時間週期切換**：日K / 週K / 月K
- **日期區間選擇**：3M / 6M / 1Y / 2Y（固定顯示範圍，無動態滑動）
- **技術指標選擇**：MACD / KD / RSI
- **MA 均線勾選**：MA5、MA10、MA20、MA60 可獨立開關
- **深色主題**：專業交易介面風格（#1a1a2e 背景）

**十字游標即時數據**：
- **第一行**：日期、開高低收、漲跌幅、成交額
- **第二行**：當沖額、當沖比例（僅 StockChart）
- **第三行**：MA5、MA10、MA20、MA60 數值
- **第四行**：當前指標數值（MACD: DIF/MACD/柱狀、KD: K/D、RSI）

**時間軸同步**（重要）：
```typescript
// 使用 TimeRange 同步（非 LogicalRange），確保日期對齊
mainChart.timeScale().subscribeVisibleTimeRangeChange(range => {
  if (range && !isSyncing) {
    isSyncing = true
    volumeChart.timeScale().setVisibleRange(range)
    indicatorChart.timeScale().setVisibleRange(range)
    isSyncing = false
  }
})
```

**UI 規格**：
- 圖表字體大小：16px
- 資訊區字體：text-lg (18px) / text-base (16px)
- 全幅寬度顯示（跳脫 max-w-7xl 容器）
- 圖表高度：600px

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

### stock_analysis_reports/{reportId} - 分析報告

```
stock_analysis_reports/
└── {reportId}
    ├── user_id: "..."
    ├── stock_id: "2330"
    ├── stock_name: "台積電"
    ├── report_content: "..."
    ├── model_used: "claude-sonnet-4-20250514"
    └── created_at: Timestamp
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
2. 批次取得全市場資料（僅 2 次 API）：
   - 股價資料：api.taiwan_stock_daily(stock_id='')
   - 籌碼資料：api.taiwan_stock_institutional_investors(stock_id='')
3. 處理法人資料（長格式轉寬格式）
4. 合併股價與法人資料
5. 轉換單位（股數 → 張數）
6. 計算 MACD 狀態
7. 儲存到 data/daily_reports/daily_stock_YYYYMMDD.csv（暫存）
8. 同步寫入 Firestore（分片優化，僅 ~6 次寫入）
9. 自動追加到年度檔案 archive/stocks_YYYY.csv（新增）
10. 自動刪除每日檔案（已整併，節省空間）
```

**優勢**：
- API 用量：相較逐檔抓取，從 4000次降至 2次，節省 99.95%
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
```
1. 多頭排列：close > MA5 > MA20 > MA60
2. MACD 正值
3. 成交量 > 500 張
4. 法人買超：外資或投信 > 1000 張
```

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

# AI API（基本面分析功能，二擇一）
OPENAI_API_KEY=sk-...          # OpenAI GPT-4o（優先使用）
# ANTHROPIC_API_KEY=sk-ant-... # Claude Sonnet（備用）
```

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

### 方式一：Firebase Hosting（推薦）

```bash
cd frontend

# 安裝 Firebase CLI
npm install -g firebase-tools

# 登入 Firebase
firebase login

# 初始化專案（已完成，設定在 firebase.json）
# firebase init hosting

# 建置並部署
npm run build
firebase deploy --only hosting
```

**firebase.json 設定**：
```json
{
  "hosting": {
    "public": "out",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  }
}
```

### 方式二：Docker

```bash
cd frontend

# 使用 docker-compose
docker-compose up -d

# 或手動構建
docker build -t stock-helper \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=stock-analysis-b5602 .

docker run -p 3000:3000 stock-helper
```

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

### 舊版 Streamlit（已棄用）

```bash
streamlit run streamlit_app/app.py
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

## Firebase 注意事項

### Firebase Auth 設定（自選股功能需要）

1. 到 Firebase Console > Authentication > Sign-in method
2. 啟用 Google Provider
3. 設定授權網域（localhost、your-domain.com）
4. 設定 OAuth 同意畫面（Google Cloud Console）

**費用**：Spark Plan（免費）包含：
- 50K 讀取/天
- 20K 寫入/天
- 1 GB 儲存空間

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
| 前端框架 | Next.js 15, React 19 |
| UI 樣式 | Tailwind CSS |
| 圖表 | lightweight-charts |
| AI 分析 | OpenAI GPT-4o / Claude API |
| 部署 | Firebase Hosting / Docker |
| 版本控制 | Git, GitHub |

## GitHub Repository

https://github.com/Stone-811/stock_helper

## 最近更新

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
- `stock_analysis_reports/{reportId}` - 分析報告

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

