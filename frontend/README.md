# 台灣強勢股分析系統 - 前端

Next.js 16 + React 19 + Tailwind CSS 建構的強勢股分析網站。

## 功能

- **首頁**：今日強勢股列表、MACD/成交量篩選
- **個股詳情**：K線圖、MACD、成交量圖表、三大法人買超

## 快速開始

```bash
# 安裝依賴
npm install

# 設定環境變數
cp .env.example .env.local
# 編輯 .env.local

# 開發模式
npm run dev

# 生產構建
npm run build
npm start
```

## 環境變數

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

## 部署

### Vercel

1. 設定 Root Directory 為 `frontend`
2. Framework Preset 選擇 `Next.js`
3. 加入環境變數
4. Deploy

### Docker

```bash
docker-compose up -d
```

## 技術棧

- Next.js 16 (App Router)
- React 19
- Tailwind CSS 4
- lightweight-charts 4.2
- Supabase (PostgreSQL)
