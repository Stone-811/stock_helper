# 台灣強勢股分析系統

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票資料，提供大盤指數分析、強勢股篩選與技術分析功能。

## 線上版本

**Vercel 部署**: [https://stock-helper.vercel.app](https://stock-helper.vercel.app)

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                         使用者介面                               │
│                    Next.js 15 + Tailwind CSS                    │
│                      (Vercel / Docker)                          │
│                                                                  │
│  ┌──────────┬──────────────────────────────────────────────┐    │
│  │ Sidebar  │               主內容區                        │    │
│  │          │                                              │    │
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
│                   Supabase PostgreSQL                            │
│    market_index_daily  │  daily_stocks  │  strong_stock_matrix  │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       資料收集層                                 │
│                    Python + FinMind API                          │
│   index_collector.py  │  stock_collector.py  │  update_matrix   │
└─────────────────────────────────────────────────────────────────┘
```

## 功能特色

### 1. 大盤指數技術分析（首頁）
- **加權指數（TAIEX）**：台灣股市大盤走勢
- **台指期（TX）**：近月期貨，含未平倉量
- **指數卡片**：即時顯示開高低收、漲跌幅
- **可切換圖表**：點擊標籤切換加權指數/台指期
- **完整技術分析**：K 線圖 + 成交量 + MACD/KD/RSI

### 2. 批次資料收集（高效能）
- **全市場股價資料**：一次 API 取得所有股票（開高低收、成交量、當沖量）
- **三大法人籌碼**：外資、投信、自營商買賣超資料
- **外資持股指標**：持股比例、尚可投資比例、投資上限比例
- **效能優化**：相較逐檔抓取節省 99.95% API 用量

### 3. 強勢股智能篩選
篩選同時滿足以下條件的股票：
- 成交量 > 500 張
- 當日漲幅 > 3%
- 收盤價高於開盤價
- 三大法人合計買超 > 0 張

### 4. Next.js 互動式分析網站
- **Sidebar 導航**：首頁（大盤指數）、強勢股、自選股、基本面分析
- **今日強勢股列表**：卡片式排列，顯示強勢次數
- **股票搜尋**：自動完成、支援代碼與名稱搜尋、鍵盤導航
- **篩選功能**：MACD 多空、成交量門檻
- **專業技術分析圖表**（使用 TradingView lightweight-charts）：
  - K 線圖 + MA5/MA10/MA20/MA60（深色主題）
  - 時間週期切換：日K / 週K / 月K
  - 技術指標選擇：MACD / KD / RSI
  - 成交量柱狀圖（紅漲綠跌）+ 當沖比例顯示
  - 預設顯示近三個月資料（可向左拖曳查看更早資料）
  - 三圖同步滾動（K 線、成交量、指標圖時間軸對齊）
  - 十字游標即時顯示：
    - OHLCV 數據（開高低收、成交額、當沖額、當沖比）
    - MA 均線數值（MA5/MA10/MA20/MA60）
    - 技術指標數值（MACD: DIF/MACD/柱狀、KD: K/D、RSI）
  - 全幅寬度、600px 高度、16px 字體
- **三大法人買超**：即時顯示法人買賣張數
- **完整歷史資料**：從 2024-01-02 至今（約 125 萬筆、2,316 檔股票）

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

### 統一排程器（推薦）

整合所有收集流程，含自動重試、增量更新、資料驗證：

```bash
# 今日全部資料（股票 + 指數 + 強勢股矩陣）
python -m stock_collector.daily_collector

# 增量更新（只補缺少的日期）
python -m stock_collector.daily_collector --incremental

# 指定日期
python -m stock_collector.daily_collector --date 2026-06-19

# 批次收集過去 7 天
python -m stock_collector.daily_collector --days 7

# 可選參數：--skip-stock, --skip-index, --skip-matrix
```

### 個別收集（舊方式）

```bash
# 指數資料（加權指數 + 台指期）
python -m stock_collector.index_collector
python -m stock_collector.index_collector --days 30

# 每日股票資料（批次 API，僅需 2 次請求）
python stock_collector/stock_collector.py
python stock_collector/stock_collector.py --days 7

# 更新強勢股矩陣
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
│   ├── daily_collector.py              # 統一排程器（推薦）
│   ├── stock_collector.py              # 每日股票資料收集器
│   ├── index_collector.py              # 指數資料收集器（TAIEX + TX）
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
│   │   └── archive/                    # 年度合併存檔（2024/2025/2026）
│   └── strong_stock_matrix/            # 強勢股矩陣
│
└── frontend/                           # Next.js 前端
    ├── app/                            # App Router 頁面
    │   ├── layout.tsx                  # 根 Layout（含 Sidebar）
    │   ├── page.tsx                    # 首頁（大盤指數圖表）
    │   ├── strong-stocks/page.tsx      # 強勢股列表
    │   ├── watchlist/page.tsx          # 自選股（需登入）
    │   ├── analysis/page.tsx           # 基本面分析
    │   ├── stock/[id]/page.tsx         # 個股詳情
    │   ├── actions/stocks.ts           # Server Action（股票搜尋）
    │   └── api/                        # API Routes（含快取）
    │       ├── analysis/               # AI 分析報告 API
    │       ├── market-index/[id]/      # 指數資料 API
    │       ├── strong-stocks/          # 強勢股 API
    │       ├── stock/[id]/             # 個股資料 API
    │       └── stocks/                 # 股票清單 API
    ├── components/                     # React 元件
    │   ├── Sidebar.tsx                 # 側邊導航欄
    │   ├── AuthButton.tsx              # Google OAuth 登入
    │   ├── WatchlistButton.tsx         # 加入自選股按鈕
    │   ├── MainContent.tsx             # 主內容區（響應式）
    │   ├── IndexChart.tsx              # 指數技術分析圖
    │   ├── StockCard.tsx               # 股票卡片
    │   ├── StockChart.tsx              # 專業技術分析圖
    │   └── StockSearchOptimized.tsx    # 股票搜尋（Server Action）
    └── lib/
        └── supabase.ts                 # Supabase client + Auth
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
| 資料收集 | Python 3.x, FinMind API, tenacity（重試） |
| 資料庫 | Supabase (PostgreSQL) |
| 身份驗證 | Supabase Auth (Google OAuth) |
| 前端框架 | Next.js 15, React 18 |
| UI 樣式 | Tailwind CSS |
| 圖表 | lightweight-charts |
| AI 分析 | OpenAI GPT-4o / Claude API |
| 部署 | Vercel / Docker |

---

## 最近更新

### 2026-06-20

**前端優化與手機版響應式設計**
- ✨ **UI 改善**：IndexCard 文字顏色優化（開盤、成交量、未平倉量改用深灰色，提升可讀性）
- ⚡ **效能提升**：API Routes 加入 Cache-Control headers（market-index 5分鐘、stocks 5分鐘快取）
- 📱 **響應式設計**：
  - 自選股頁面：手機版卡片式佈局 / 桌面版表格佈局
  - 強勢股頁面：優化 grid breakpoints（1/2/3/4 欄位自動調整）
  - 圖表控制：手機版改為兩行佈局，提升操作體驗
- 🔐 **認證整合**：Sidebar 整合 Google OAuth 登入按鈕（響應式設計）
- 🗄️ **資料庫優化**：強勢股矩陣改為精簡架構（僅儲存強勢股，減少 98% 資料量）
- 🧹 **程式碼清理**：移除舊版圖表元件（CandlestickChart、MacdChart、VolumeChart）
- 🔍 **搜尋優化**：採用 Server Action + debounce 機制，減少網路傳輸
- 💾 **自動存檔系統**：每日收集後自動追加到年度檔案並刪除每日檔案
  - 合併 2023 年歷史資料（239 檔 → 1 年度檔，508K 筆）
  - 自動追加：無需手動合併，即時更新年度檔案
  - 儲存優化：節省 37% 空間（151.7 MB → 135 MB）
  - 相容性修正：update_strong_matrix 支援年度檔案讀取
  - 改善日誌：清楚顯示檔案處理狀態

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
