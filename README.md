# 台灣強勢股分析系統

台灣股票資料收集與篩選工具，使用 FinMind API 抓取全市場上市上櫃股票資料，提供強勢股篩選與技術分析功能。

## 功能特色

### 1. 批次資料收集（高效能）
- **全市場股價資料**：一次 API 取得所有股票（開高低收、成交量）
- **三大法人籌碼**：外資、投信、自營商買賣超資料
- **外資持股指標**：
  - 外資持股比例
  - 外資尚可投資比例
  - 外資投資上限比例
- **效能優化**：相較逐檔抓取節省 99.95% API 用量

### 2. 強勢股智能篩選
篩選同時滿足以下條件的股票：
- ✅ 成交量 > 500 張
- ✅ 當日漲幅 > 3%
- ✅ 收盤價高於開盤價
- ✅ 三大法人合計買超 > 0 張

### 3. Streamlit 互動式分析網站
- 📊 **今日強勢股列表**：一鍵查看符合條件的股票
- 📈 **技術分析圖表**：K 線圖 + MA5/MA20/MA60
- 📉 **成交量分析**：紅綠柱狀圖視覺化
- 🎯 **MACD 指標**：完整的 MACD、信號線、柱狀圖
- 💰 **三大法人買超**：顯示外資、投信、自營商買賣張數
- 🔍 **近 N 日強勢次數**：追蹤股票持續強勢的天數

---

## 安裝

### 1. 建立虛擬環境

```bash
python -m venv venv
source venv/bin/activate  # macOS/Linux
# 或
venv\Scripts\activate  # Windows
```

### 2. 安裝套件

```bash
# 基本套件
pip install FinMind pandas python-dotenv

# Streamlit 網站額外套件
pip install streamlit plotly
```

### 3. 設定 FinMind API

```bash
# 複製環境變數範本
cp .env.example .env

# 編輯 .env，填入 API Token
FINMIND_API_TOKEN=your_token_here
```

**取得 Token**：[FinMind 官網](https://finmindtrade.com/) → 個人資料 → API Token

---

## 使用方式

### 📊 資料收集

#### 每日資料收集

```bash
cd stock_collector

# 收集今日資料（僅需 3 次 API）
python stock_collector.py

# 收集指定日期
python stock_collector.py --date 2024-12-31
```

**API 用量**：每日僅需 3 次請求
- 股價資料：1 次
- 法人資料：1 次
- 外資持股：1 次

#### 批次歷史收集

```bash
# 過去 7 天
python stock_collector.py --days 7

# 過去一年（約 250 交易日 × 3 = 750 次 API）
python stock_collector.py --days 365

# 指定範圍
python stock_collector.py --start 2024-01-01 --end 2024-12-31
```

### 🗂️ 資料合併與歸檔

#### 按年份合併（推薦）

```bash
cd stock_collector

# 合併 2024 年資料到 archive/stocks_2024.csv
python merge_daily_files.py --year 2024

# 合併後自動清理每日檔案（移到 archive/merged/）
python merge_daily_files.py --year 2024 --cleanup
```

#### 顯示統計資訊

```bash
python merge_daily_files.py --stats
```

#### 一般合併

```bash
# 合併所有每日檔案
python merge_daily_files.py

# 合併指定日期範圍
python merge_daily_files.py --start 20240101 --end 20241231

# 指定輸出檔名
python merge_daily_files.py --output all_stocks_2024.csv
```

### 🔄 更新強勢股矩陣

```bash
cd stock_collector

# 讀取所有每日報表，計算強勢股標記
python update_strong_matrix.py
```

### 📊 批次更新 MACD 狀態

```bash
cd stock_collector

# 更新所有每日報表的 MACD 狀態
python -m stock_collector.update_macd

# 強制更新（即使已有 MACD 資料）
python -m stock_collector.update_macd --force

# 只更新指定檔案
python -m stock_collector.update_macd --file daily_stock_20260416.csv
```

**說明**：收集資料時會自動計算 MACD，此指令用於補算或重算歷史資料。

### 🌐 啟動 Streamlit 網站

```bash
# 從專案根目錄執行
streamlit run streamlit_app/app.py

# 或進入 streamlit_app 目錄執行
cd streamlit_app
streamlit run app.py
```

網站將在瀏覽器自動開啟（預設 http://localhost:8501）

---

## 專案結構

```
選股小幫手/
├── utils.py                      # 核心邏輯（技術指標、選股）
├── stock_collector/
│   ├── stock_collector.py        # 資料收集器（批次 API）
│   ├── update_strong_matrix.py   # 更新強勢股矩陣
│   ├── update_macd.py            # 批次更新 MACD 狀態
│   ├── merge_daily_files.py      # 合併檔案工具
│   ├── config.py                 # API 配置
│   └── logs/                     # 執行日誌
├── streamlit_app/
│   ├── app.py                    # Streamlit 主程式
│   └── requirements.txt          # 網站相依套件
├── data/
│   ├── daily_reports/            # 每日報表
│   │   ├── daily_stock_YYYYMMDD.csv
│   │   └── archive/
│   │       ├── stocks_YYYY.csv   # 年度合併檔案
│   │       └── merged/           # 已合併的每日檔案
│   └── strong_stock_matrix/
│       └── strong_stock_matrix.csv  # 強勢股矩陣
├── .env.example                  # 環境變數範本
├── README.md
└── CLAUDE.md                     # Claude Code 專案指引
```

---

## 資料格式說明

### 每日報表 CSV（15 欄位）

| 欄位 | 說明 | 單位 | 範例 |
|------|------|------|------|
| date | 交易日期 | YYYY-MM-DD | 2024-12-31 |
| stock_id | 股票代碼 | 4位數字 | 2330 |
| stock_name | 股票名稱 | 中文 | 台積電 |
| open | 開盤價 | 元 | 580.0 |
| high | 最高價 | 元 | 585.0 |
| low | 最低價 | 元 | 575.0 |
| close | 收盤價 | 元 | 582.0 |
| volume | 成交量 | 張 | 45995 |
| foreign_buy | 外資買超 | 張 | 1234 |
| trust_buy | 投信買超 | 張 | -567 |
| dealer_buy | 自營商買超 | 張 | 89 |
| foreign_hold_ratio | 外資持股比例 | % | 75.32 |
| foreign_remain_ratio | 外資尚可投資比例 | % | 24.68 |
| foreign_limit_ratio | 外資投資上限 | % | 100.0 |
| macd_status | MACD 狀態 | - | 多/空/-

**說明**：
- 成交量、法人買超已轉換為「張數」（1張 = 1000股）
- 正數表示買超，負數表示賣超
- macd_status：「多」= MACD 柱狀圖為正（多頭），「空」= 柱狀圖為負（空頭），「-」= 資料不足

### 強勢股矩陣格式

```
stock_id | stock_name | 2024-01-02 | 2024-01-03 | 2024-01-04 | ...
---------|------------|------------|------------|------------|----
2330     | 台積電      | 1          | 0          | 1          | ...
1301     | 台塑        | 0          | 1          | 0          | ...
```

- **1** = 當日為強勢股
- **0** = 當日非強勢股

---

## Streamlit 網站功能

### 首頁功能

#### 側邊欄
1. **回溯交易日數**：選擇 1-60 天，計算近 N 日強勢次數
2. **今日強勢股數量**：顯示最新交易日的強勢股統計
3. **最少強勢天數**：篩選至少出現幾次的股票
4. **快速選股**：下拉選單快速切換股票

#### 主畫面
- **股票卡片**：每列 5 個，顯示代碼、名稱、強勢次數
- **點擊查看**：點擊任意股票進入詳細分析頁

### 股票詳情頁

#### 基本資訊（緊湊排列，18px 字體）
- 股票代碼、名稱、近 N 日強勢次數
- 收盤價、當日漲跌（含漲跌幅 %）
- 成交量（張）、MACD 狀態

#### 三大法人買超
- **外資**：買超張數（綠色正值 / 紅色負值）
- **投信**：買超張數
- **自營商**：買超張數

#### 技術分析圖表
1. **價量分析**
   - K 線圖（紅漲綠跌）
   - 移動平均線（MA5、MA20、MA60）
   - 成交量柱狀圖（紅漲綠跌）
   - X 軸使用 category 類型（無非交易日間隔）
   - 隱藏 X 軸日期標籤（游標懸停顯示）

2. **MACD 指標**
   - MACD 線（藍色）
   - 信號線（橘色）
   - 柱狀圖（紅色正值 / 綠色負值）
   - 零軸參考線

#### 互動功能
- 縮放、拖曳查看歷史細節
- 懸停顯示完整數據
- 返回強勢股列表按鈕

---

## API Token 用量估算

### 批次 API 效能

**單日收集**：
- **3 次 API** → 數秒完成
- 取得全市場 2000+ 檔股票完整資料
- 相較逐檔抓取節省 **99.95% API 用量**

**一年歷史資料**（約 250 交易日）：
- 250 天 × 3 次 = **750 次請求**
- 預估 15-25 分鐘完成
- 相較傳統方式從 150 萬次降至 750 次

**五年歷史資料**（2020-2024）：
- 約 1250 天 × 3 次 = **3,750 次請求**
- 預估 2-3 小時完成
- 遠低於 API 限制（600次/分鐘）

### API 限制

- **免費版**：600 次/分鐘，3600 次/小時
- **付費版**：更高限制，請參考 FinMind 官網

---

## 強勢股篩選邏輯

### 篩選條件（必須全部滿足）

定義於 `stock_collector/update_strong_matrix.py`

```python
STRONG_CONDITIONS = {
    'min_volume': 500,              # 最低成交量（張）
    'min_change_pct': 3.0,          # 最低漲幅（%）
    'require_up': True,             # 必須上漲
    'require_institutional': True,  # 必須法人買超
}
```

### 計算公式

1. **漲幅計算**
   ```
   change_pct = (close - open) / open × 100
   ```

2. **法人合計買超**
   ```
   institutional_buy = foreign_buy + trust_buy + dealer_buy
   ```

3. **強勢股標記**
   ```
   strong = 1 if (
       volume > 500 張 AND
       change_pct > 3.0% AND
       close > open AND
       institutional_buy > 0 張
   ) else 0
   ```

### 優勢

- **技術面 + 籌碼面**：價量配合法人買超
- **過濾雜訊**：排除低量、小漲、震盪股
- **主力認同**：確保有機構資金進場
- **可調整性**：參數可依需求調整

---

## 注意事項

### API 使用
- **免費限制**：600次/分鐘，3600次/小時
- **建議作法**：
  - 使用批次 API（已實作）
  - 避免重複抓取相同日期
  - 使用年度合併功能整理檔案

### 資料特性
- **籌碼延遲**：法人資料通常延遲 1-2 天
- **週末假日**：無交易資料（會自動跳過）
- **停牌股票**：當日無資料
- **歷史資料**：FinMind 提供 2008 年起的資料

### 風險聲明

**本工具僅供學習與研究使用，不構成任何投資建議。**

- 歷史績效不代表未來表現
- 強勢股篩選為技術指標，非買賣訊號
- 投資前請審慎評估風險
- 建議搭配基本面分析與風險管理

---

## 常見問題

### Q1: 為何沒有今日資料？
A: 籌碼資料通常延遲 1-2 天，建議在每日收盤後 2-3 小時執行收集。

### Q2: 如何加速歷史資料收集？
A: 使用批次 API 已是最快方式（每日僅 3 次請求），無需額外優化。

### Q3: 可以修改強勢股條件嗎？
A: 可以，編輯 `stock_collector/update_strong_matrix.py` 的 `STRONG_CONDITIONS` 字典。

### Q4: 資料佔用多少空間？
A:
- 每日報表：約 0.5-0.8 MB/檔
- 年度合併：約 15-25 MB/年
- 五年資料：約 75-125 MB

### Q5: 可以用於自動交易嗎？
A: 不建議。本工具僅供參考，且資料有延遲，不適合即時交易。

---

## 授權

MIT License

---

## 相關資源

- [FinMind 官方文件](https://finmind.github.io/)
- [Streamlit 文件](https://docs.streamlit.io/)
- [Plotly 圖表文件](https://plotly.com/python/)

---

## 更新日誌

### v2.0 (2026-04-15)
- 新增外資持股三個指標（持股比例、尚可投資、投資上限）
- Streamlit 新增三大法人買超資訊顯示
- 圖表優化：移除非交易日間隔、隱藏 X 軸標籤
- 成交量單位統一為「張」
- UI 優化：字體縮小至 18px、間距緊湊化

### v1.5 (2026-01)
- 新增年份合併功能（merge_daily_files.py --year）
- 新增 archive 目錄自動管理
- 新增統計資訊顯示功能

### v1.0 (2025-12)
- 批次 API 資料收集
- 強勢股矩陣計算
- Streamlit 互動式分析網站
