# CLAUDE.md

Claude Code 處理本專案時的指引說明。

## 專案概述

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票。

功能：
1. 大盤指數分析（加權指數 TAIEX + 台指期 TX）
2. 每日資料收集（批次 API，僅需 2 次請求）
3. 批次歷史資料收集
4. 多條件選股篩選
5. 強勢股分析網站（Next.js + Supabase + Sidebar 導航）
6. 自選股功能（Supabase Auth + Google OAuth）
7. Docker 容器化部署支援

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                               │
│                    Next.js 15 + Tailwind CSS                    │
│                      (Vercel / Docker)                          │
│                                                                  │
│  ┌──────────┬──────────────────────────────────────────────┐    │
│  │ Sidebar  │               主內容區                        │    │
│  │ 📊 首頁  │  首頁：加權指數 / 台指期 技術分析圖           │    │
│  │ 🔥 強勢股│  強勢股：今日強勢股列表 + 篩選功能            │    │
│  │ ⭐ 自選股│  自選股：用戶自訂觀察清單（需登入）           │    │
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
│              Supabase PostgreSQL + Auth                          │
│  market_index_daily │ daily_stocks │ strong_stock_matrix │ user_watchlist │
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
│   ├── stock_collector.py              # 每日股票資料收集器
│   ├── index_collector.py              # 指數資料收集器（TAIEX + TX）
│   ├── update_strong_matrix.py         # 強勢股矩陣更新
│   └── merge_daily_files.py            # 檔案合併工具
│
├── supabase_writer.py                  # Supabase 資料寫入模組
├── supabase_schema.sql                 # 資料庫 Schema
├── utils.py                            # 技術指標計算
│
├── data/                               # 本地資料存放
│   ├── daily_reports/                  # 每日報表 CSV
│   │   ├── daily_stock_YYYYMMDD.csv
│   │   └── archive/                    # 歷史資料存檔
│   │       ├── stocks_2024.csv         # 2024 年度資料
│   │       └── stocks_2025.csv         # 2025 年度資料
│   └── strong_stock_matrix/            # 強勢股矩陣
│       └── strong_stock_matrix.csv
│
├── frontend/                           # Next.js 前端
│   ├── app/                            # App Router 頁面
│   │   ├── layout.tsx                  # 根 Layout（含 Sidebar）
│   │   ├── page.tsx                    # 首頁（大盤指數圖表）
│   │   ├── strong-stocks/page.tsx      # 強勢股列表頁
│   │   ├── watchlist/page.tsx          # 自選股頁面
│   │   ├── stock/[id]/page.tsx         # 個股詳情頁
│   │   ├── auth/callback/route.ts      # OAuth 回調處理
│   │   └── api/                        # API Routes
│   │       ├── market-index/[id]/route.ts  # 指數資料 API
│   │       ├── strong-stocks/route.ts  # 強勢股 API
│   │       ├── stock/[id]/route.ts     # 個股資料 API
│   │       └── stocks/route.ts         # 股票清單 API（分頁）
│   │
│   ├── components/                     # React 元件
│   │   ├── Sidebar.tsx                 # 側邊導航欄（響應式 + AuthButton）
│   │   ├── AuthButton.tsx              # 登入/登出按鈕（Google OAuth）
│   │   ├── WatchlistButton.tsx         # 加入/移除自選股按鈕
│   │   ├── IndexChart.tsx              # 指數技術分析圖（K 線+成交量+指標）
│   │   ├── StockCard.tsx               # 股票卡片
│   │   ├── StockChart.tsx              # 專業技術分析圖（整合 K 線+指標）
│   │   └── StockSearch.tsx             # 股票搜尋（自動完成）
│   │
│   ├── lib/                            # 共用函式庫
│   │   └── supabase.ts                 # Supabase client + Auth + 型別定義
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
| supabase_writer.py | DataFrame 寫入 Supabase（upsert）- 含 write_market_index() |
| stock_collector/stock_collector.py | 批次 API 資料收集、CSV 存檔、Supabase 同步 |
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
| app/stock/[id]/page.tsx | 個股詳情：專業圖表、法人買賣超 |
| app/auth/callback/route.ts | OAuth 回調處理（Google 登入） |
| api/market-index/[id]/route.ts | API：取得指數歷史資料（TAIEX / TX） |
| api/strong-stocks/route.ts | API：取得今日強勢股（含連續強勢天數） |
| api/stock/[id]/route.ts | API：取得個股完整歷史資料 |
| api/stocks/route.ts | API：取得所有股票清單（分頁繞過 1000 筆限制） |
| components/Sidebar.tsx | 側邊導航欄（桌面固定、手機漢堡選單）+ AuthButton |
| components/AuthButton.tsx | Google OAuth 登入/登出按鈕 |
| components/WatchlistButton.tsx | 加入/移除自選股按鈕 |
| components/IndexChart.tsx | 指數技術分析圖（K 線 + 成交量 + MACD/KD/RSI） |
| components/StockChart.tsx | 專業技術分析圖（K 線 + 成交量 + 當沖比 + MACD/KD/RSI） |
| components/StockSearch.tsx | 股票搜尋元件（自動完成、鍵盤導航） |
| components/StockCard.tsx | 股票資訊卡片元件 |
| lib/supabase.ts | Supabase client + Auth helpers + 型別定義 |

### StockChart / IndexChart 專業圖表功能

使用 TradingView 開源的 **lightweight-charts** 套件實作專業級技術分析圖表。

**核心功能**：
- **時間週期切換**：日K / 週K / 月K
- **技術指標選擇**：MACD / KD / RSI
- **三圖同步滾動**：K 線主圖、成交量、指標圖（使用 TimeRange 同步）
- **深色主題**：專業交易介面風格（#1a1a2e 背景）
- **預設顯示三個月**：約 65 個交易日，可向左拖曳查看更早資料

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

## 資料庫 Schema

### market_index_daily 表（大盤指數）

```sql
CREATE TABLE market_index_daily (
    date DATE NOT NULL,
    index_id VARCHAR(20) NOT NULL,  -- 'TAIEX' / 'TX'
    index_name VARCHAR(50),          -- '加權指數' / '台指期近月'
    open NUMERIC(10, 2),
    high NUMERIC(10, 2),
    low NUMERIC(10, 2),
    close NUMERIC(10, 2),
    volume BIGINT DEFAULT 0,
    open_interest BIGINT DEFAULT 0,  -- 未平倉量（僅台指期）
    settlement_price NUMERIC(10, 2), -- 結算價（僅台指期）
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, index_id)
);
```

### daily_stocks 表

```sql
CREATE TABLE daily_stocks (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    open DECIMAL(10,2),
    high DECIMAL(10,2),
    low DECIMAL(10,2),
    close DECIMAL(10,2),
    volume BIGINT,
    day_trading_volume BIGINT,   -- 當沖成交量（張）
    foreign_buy BIGINT,          -- 外資買賣超（張）
    trust_buy BIGINT,            -- 投信買賣超（張）
    dealer_buy BIGINT,           -- 自營商買賣超（張）
    foreign_hold_ratio DECIMAL(5,2),   -- 外資持股比例
    foreign_remain_ratio DECIMAL(5,2), -- 外資可投資剩餘比例
    foreign_limit_ratio DECIMAL(5,2),  -- 外資投資上限比例
    macd_status VARCHAR(20),     -- MACD 狀態：黃金交叉/死亡交叉/-
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(date, stock_id)
);
```

### strong_stock_matrix 表

```sql
CREATE TABLE strong_stock_matrix (
    id BIGSERIAL PRIMARY KEY,
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    date DATE NOT NULL,
    is_strong BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(stock_id, date)
);
```

### user_watchlist 表（自選股）

```sql
CREATE TABLE user_watchlist (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, stock_id)
);

-- RLS 政策：用戶只能管理自己的自選股
ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own watchlist"
    ON user_watchlist FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own watchlist"
    ON user_watchlist FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own watchlist"
    ON user_watchlist FOR DELETE USING (auth.uid() = user_id);
```

## 處理流程

### 每日資料收集（批次 API）
```
1. 登入 FinMind API
2. 批次取得全市場資料（僅 2 次 API）：
   - 股價資料：api.taiwan_stock_daily(stock_id='')
   - 籌碼資料：api.taiwan_stock_institutional_investors(stock_id='')
3. 處理法人資料（長格式轉寬格式）
4. 合併股價與法人資料
5. 轉換單位（股數 → 張數）
6. 計算 MACD 狀態
7. 儲存到 data/daily_reports/daily_stock_YYYYMMDD.csv
8. 同步寫入 Supabase（若已設定環境變數）
```

**優勢**：相較逐檔抓取，API 用量從 4000次降至 2次，節省 99.95%

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

# Supabase（Python 後端用）
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your_service_role_key

# Supabase（Next.js 前端用）
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
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

### 方式一：Vercel（推薦）

1. 將程式碼推送到 GitHub
2. 在 Vercel Dashboard 匯入專案
3. 設定 Root Directory 為 `frontend`
4. 設定環境變數
5. 部署

### 方式二：Docker

```bash
cd frontend

# 使用 docker-compose
docker-compose up -d

# 或手動構建
docker build -t stock-helper \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=your_key .

docker run -p 3000:3000 stock-helper
```

## 執行指令

### Python 資料收集

```bash
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

# 測試 Supabase 連線
python supabase_writer.py
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

## 開發原則

1. 優先編輯現有檔案
2. 統一資料路徑：`data/`
3. 優先使用批次 API（降低 API 用量）
4. 個別股票失敗不中斷整體流程
5. 為新函數撰寫 docstring
6. Supabase 寫入前需去除重複資料

## Supabase 注意事項

### Supabase Auth 設定（自選股功能需要）

1. 到 Supabase Dashboard > Authentication > Providers
2. 啟用 Google Provider
3. 設定 OAuth credentials（從 Google Cloud Console 取得）
4. 新增 Redirect URL：`https://your-domain.com/auth/callback`

**費用**：Free Plan 包含 50,000 MAU，個人使用完全免費

### 預設 1000 筆限制

Supabase 預設每次查詢最多回傳 1000 筆。需要取得更多資料時，使用分頁查詢：

```typescript
// 分批取得所有資料（每批 1000 筆）
let allData: any[] = []
let from = 0
const batchSize = 1000

while (true) {
  const { data, error } = await supabase
    .from('daily_stocks')
    .select('*')
    .range(from, from + batchSize - 1)

  if (!data || data.length === 0) break
  allData.push(...data)
  if (data.length < batchSize) break
  from += batchSize
}
```

### 資料庫統計（截至目前）

| 項目 | 數值 |
|------|------|
| daily_stocks 總筆數 | ~1,250,000 |
| 資料日期範圍 | 2024-01-02 ~ 今日 |
| 上市上櫃股票數 | ~2,316 檔 |

## 技術棧

| 類別 | 技術 |
|------|------|
| 資料收集 | Python 3.x, FinMind API |
| 資料庫 | Supabase (PostgreSQL) |
| 身份驗證 | Supabase Auth (Google OAuth) |
| 前端框架 | Next.js 15, React 18 |
| UI 樣式 | Tailwind CSS |
| 圖表 | lightweight-charts |
| 部署 | Vercel / Docker |
| 版本控制 | Git, GitHub |

## GitHub Repository

https://github.com/Stone-811/stock_helper
