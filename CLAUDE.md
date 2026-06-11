# CLAUDE.md

Claude Code 處理本專案時的指引說明。

## 專案概述

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票。

功能：
1. 每日資料收集（批次 API，僅需 2 次請求）
2. 批次歷史資料收集
3. 多條件選股篩選
4. 強勢股分析網站（Next.js + Supabase）
5. Docker 容器化部署支援

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                               │
│                    Next.js 15 + Tailwind CSS                    │
│                      (Vercel / Docker)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API 層                                   │
│              Next.js API Routes (App Router)                     │
│         /api/strong-stocks  │  /api/stock/[id]                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        資料庫層                                  │
│                   Supabase PostgreSQL                            │
│         daily_stocks  │  strong_stock_matrix                     │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       資料收集層                                 │
│                    Python + FinMind API                          │
│        stock_collector.py  │  update_strong_matrix.py           │
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
│   ├── stock_collector.py              # 每日資料收集器
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
│   │   ├── layout.tsx                  # 根 Layout
│   │   ├── page.tsx                    # 首頁（強勢股列表）
│   │   ├── stock/[id]/page.tsx         # 個股詳情頁
│   │   └── api/                        # API Routes
│   │       ├── strong-stocks/route.ts  # 強勢股 API
│   │       ├── stock/[id]/route.ts     # 個股資料 API
│   │       └── stocks/route.ts         # 股票清單 API（分頁）
│   │
│   ├── components/                     # React 元件
│   │   ├── StockCard.tsx               # 股票卡片
│   │   ├── StockChart.tsx              # 專業技術分析圖（整合 K 線+指標）
│   │   └── StockSearch.tsx             # 股票搜尋（自動完成）
│   │
│   ├── lib/                            # 共用函式庫
│   │   └── supabase.ts                 # Supabase client
│   │
│   ├── Dockerfile                      # Docker 構建檔
│   ├── docker-compose.yml              # Docker Compose 配置
│   ├── next.config.ts                  # Next.js 配置
│   ├── tailwind.config.ts              # Tailwind CSS 配置
│   └── package.json                    # NPM 依賴
│
└── streamlit_app/                      # 舊版 Streamlit 網站
    └── app.py                          # Streamlit 應用
```

## 核心模組說明

### Python 後端

| 檔案 | 職責 |
|------|------|
| utils.py | 技術指標計算（MA、MACD）、選股邏輯 |
| supabase_writer.py | DataFrame 寫入 Supabase（upsert） |
| stock_collector/stock_collector.py | 批次 API 資料收集、CSV 存檔、Supabase 同步 |
| stock_collector/update_strong_matrix.py | 每日更新強勢股矩陣 |
| stock_collector/config.py | FinMind API token 配置 |

### Next.js 前端

| 檔案 | 職責 |
|------|------|
| app/page.tsx | 首頁：強勢股列表、篩選功能、股票搜尋 |
| app/stock/[id]/page.tsx | 個股詳情：專業圖表、法人買賣超 |
| api/strong-stocks/route.ts | API：取得今日強勢股（含連續強勢天數） |
| api/stock/[id]/route.ts | API：取得個股完整歷史資料 |
| api/stocks/route.ts | API：取得所有股票清單（分頁繞過 1000 筆限制） |
| components/StockChart.tsx | 專業技術分析圖（K 線 + 成交量 + MACD/KD/RSI） |
| components/StockSearch.tsx | 股票搜尋元件（自動完成、鍵盤導航） |
| components/StockCard.tsx | 股票資訊卡片元件 |
| lib/supabase.ts | Supabase client 初始化、TypeScript 介面定義 |

### StockChart 專業圖表功能

- **時間週期切換**：日K / 週K / 月K
- **技術指標選擇**：MACD / KD / RSI
- **三圖同步**：K 線主圖、成交量、指標圖
- **深色主題**：專業交易介面風格
- **十字游標**：顯示 OHLCV 即時數據

## 資料庫 Schema

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

### 批次 API（推薦）

```python
from FinMind.data import DataLoader
api = DataLoader()
api.login_by_token(api_token=token)

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
# 每日收集（批次 API）
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
| 前端框架 | Next.js 15, React 18 |
| UI 樣式 | Tailwind CSS |
| 圖表 | lightweight-charts |
| 部署 | Vercel / Docker |
| 版本控制 | Git, GitHub |

## GitHub Repository

https://github.com/Stone-811/stock_helper
