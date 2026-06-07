# CLAUDE.md

Claude Code 處理本專案時的指引說明。

## 專案概述

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票。

功能：
1. 每日資料收集（批次 API，僅需 2 次請求）
2. 批次歷史資料收集
3. 多條件選股篩選
4. 強勢股分析網站（Streamlit）

## 核心模組

| 檔案 | 職責 |
|------|------|
| utils.py | 技術指標計算、選股邏輯 |
| stock_collector/stock_collector.py | 資料收集器（批次 API） |
| stock_collector/update_strong_matrix.py | 更新強勢股矩陣 |
| stock_collector/merge_daily_files.py | 合併檔案工具 |
| stock_collector/config.py | FinMind API 配置 |
| streamlit_app/app.py | 強勢股分析網站 |

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
6. 儲存到 data/daily_reports/daily_stock_YYYYMMDD.csv
```

**優勢**：相較逐檔抓取，API 用量從 4000次降至 2次，節省 99.95%

### 選股篩選
```
1. 取得全市場股票清單
2. 逐檔檢查條件：
   - 多頭排列：close > MA5 > MA20 > MA60
   - MACD 正值
   - 成交量 > 500 張
   - 法人買超：外資或投信 > 1000 張
3. 按漲幅排序取前 100 名
4. 儲存到 screening/screening_YYYYMMDD_HHMMSS.csv
```

## 資料存放

```
data/
├── daily_reports/              # 每日報表
│   └── daily_stock_YYYYMMDD.csv
└── strong_stock_matrix/        # 強勢股矩陣
    └── strong_stock_matrix.csv
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

## 開發原則

1. 優先編輯現有檔案
2. 統一資料路徑：`data/`
3. 優先使用批次 API（降低 API 用量）
4. 個別股票失敗不中斷整體流程
5. 為新函數撰寫 docstring

## 執行指令

```bash
# 每日收集（批次 API）
python stock_collector/stock_collector.py

# 批次歷史收集
python stock_collector/stock_collector.py --days 7

# 更新強勢股矩陣
python stock_collector/update_strong_matrix.py

# 啟動分析網站
streamlit run streamlit_app/app.py
```
