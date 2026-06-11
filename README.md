# 台灣強勢股分析系統

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票資料，提供強勢股篩選與技術分析功能。

## 線上版本

**Vercel 部署**: [https://stock-helper.vercel.app](https://stock-helper.vercel.app)

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                               │
│                    Next.js 16 + Tailwind CSS                    │
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

## 功能特色

### 1. 批次資料收集（高效能）
- **全市場股價資料**：一次 API 取得所有股票（開高低收、成交量）
- **三大法人籌碼**：外資、投信、自營商買賣超資料
- **外資持股指標**：持股比例、尚可投資比例、投資上限比例
- **效能優化**：相較逐檔抓取節省 99.95% API 用量

### 2. 強勢股智能篩選
篩選同時滿足以下條件的股票：
- 成交量 > 500 張
- 當日漲幅 > 3%
- 收盤價高於開盤價
- 三大法人合計買超 > 0 張

### 3. Next.js 互動式分析網站
- **今日強勢股列表**：卡片式排列，顯示強勢次數
- **股票搜尋**：自動完成、支援代碼與名稱搜尋、鍵盤導航
- **篩選功能**：MACD 多空、成交量門檻
- **專業技術分析圖表**（仿鉅亨網/Yahoo Finance）：
  - K 線圖 + MA5/MA20/MA60（深色主題）
  - 時間週期切換：日K / 週K / 月K
  - 技術指標選擇：MACD / KD / RSI
  - 成交量柱狀圖（紅漲綠跌）
  - 十字游標即時顯示 OHLCV 數據
- **三大法人買超**：即時顯示法人買賣張數
- **完整歷史資料**：從 2024 年至今所有交易日資料

---

## 快速開始

### 環境需求
- Python 3.10+
- Node.js 20+
- Supabase 帳號

### 1. 安裝 Python 套件

```bash
pip install FinMind pandas python-dotenv supabase
```

### 2. 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`：

```bash
# FinMind API
FINMIND_API_TOKEN=your_token_here

# Supabase（Python 後端）
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your_service_role_key
```

### 3. 啟動 Next.js 前端

```bash
cd frontend
npm install

# 建立環境變數
cp .env.example .env.local
# 編輯 .env.local 設定 Supabase

npm run dev
```

瀏覽器開啟 http://localhost:3000

---

## 資料收集

### 每日資料收集

```bash
# 收集今日資料（僅需 2 次 API）
python stock_collector/stock_collector.py

# 收集指定日期
python stock_collector/stock_collector.py --date 2024-12-31

# 批次收集過去 7 天
python stock_collector/stock_collector.py --days 7
```

### 更新強勢股矩陣

```bash
python stock_collector/update_strong_matrix.py
```

---

## 專案結構

```
選股小幫手/
├── CLAUDE.md                           # 專案指引
├── README.md                           # 專案說明
├── .env                                # 環境變數
├── requirements.txt                    # Python 依賴
│
├── stock_collector/                    # 資料收集模組
│   ├── stock_collector.py              # 每日資料收集器
│   ├── update_strong_matrix.py         # 強勢股矩陣更新
│   ├── merge_daily_files.py            # 檔案合併工具
│   └── config.py                       # API 配置
│
├── supabase_writer.py                  # Supabase 資料寫入
├── supabase_schema.sql                 # 資料庫 Schema
├── utils.py                            # 技術指標計算
│
├── data/                               # 本地資料存放
│   ├── daily_reports/                  # 每日報表 CSV
│   │   └── archive/                    # 2024/2025 年度資料
│   └── strong_stock_matrix/            # 強勢股矩陣
│
└── frontend/                           # Next.js 前端
    ├── app/                            # App Router 頁面
    │   ├── page.tsx                    # 首頁
    │   ├── stock/[id]/page.tsx         # 個股詳情
    │   └── api/                        # API Routes
    │       ├── strong-stocks/          # 強勢股 API
    │       ├── stock/[id]/             # 個股資料 API
    │       └── stocks/                 # 股票清單 API
    ├── components/                     # React 元件
    │   ├── StockCard.tsx               # 股票卡片
    │   ├── StockChart.tsx              # 專業技術分析圖
    │   └── StockSearch.tsx             # 股票搜尋元件
    └── lib/
        └── supabase.ts                 # Supabase client
```

---

## 部署

### Vercel（推薦）

1. Push 程式碼到 GitHub
2. 在 Vercel Dashboard 匯入專案
3. 設定：
   - **Root Directory**: `frontend`
   - **Framework Preset**: Next.js
4. 設定環境變數：
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Deploy

### Docker

```bash
cd frontend
docker-compose up -d
```

---

## 技術棧

| 類別 | 技術 |
|------|------|
| 資料收集 | Python 3.x, FinMind API |
| 資料庫 | Supabase (PostgreSQL) |
| 前端框架 | Next.js 16, React 19 |
| UI 樣式 | Tailwind CSS |
| 圖表 | lightweight-charts |
| 部署 | Vercel / Docker |

---

## 風險聲明

**本工具僅供學習與研究使用，不構成任何投資建議。**

- 歷史績效不代表未來表現
- 強勢股篩選為技術指標，非買賣訊號
- 投資前請審慎評估風險

---

## 授權

MIT License

---

## 相關資源

- [FinMind 官方文件](https://finmind.github.io/)
- [Next.js 文件](https://nextjs.org/docs)
- [Supabase 文件](https://supabase.com/docs)
- [lightweight-charts](https://tradingview.github.io/lightweight-charts/)
