# 台灣強勢股分析系統 — 前端

Next.js 16 + React 19 + Tailwind CSS v4 建構的台股分析網站。

**線上版本**：https://stock-analysis--stock-analysis-b5602.asia-east1.hosted.app

## 頁面

| 路由 | 內容 |
|---|---|
| `/` | 首頁：加權指數＋美股三大指數四格（點加權指數開指數走勢彈跳視窗，可切台指期）、市場溫度全部內容 |
| `/strong-stocks` | 強勢股：上方切換卡片／表格（表格**預設顯示全部欄位**） |
| `/strong-monthly` | 強勢月報：當月曾入選的個股彙整（12 欄，對應業主的 Word 月報） |
| `/screener` | 自訂條件選股 |
| `/market-mood` | 市場溫度：大盤當沖比、融資融券、台股／美股恐慌指數（入口只在桌機側欄；首頁已放同一份內容） |
| `/stock/[id]` | 個股詳情：K 線、技術指標、籌碼圖、**放空籌碼**、今日訊號、🔔 到價提醒（需 Google 登入） |

舊網址：`/strong-table` 307 轉 `/strong-stocks?view=table`；`/watchlist`（自選股，2026-11-06 拿掉）307 轉 `/`。

手機不顯示 Sidebar（導覽在 MobileBottomNav：首頁／強勢／月報／選股 4 格，登入在 TopBar 右側）。

## 快速開始

```bash
npm install
npm run dev          # 開發模式
npm run build        # 生產建置
```

## 環境變數

前端公開設定寫在 `apphosting.yaml`（會 inline 進瀏覽器 bundle），本機開發用 `.env.local`：

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=stock-analysis-b5602.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=stock-analysis-b5602
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

伺服器端連 Firestore **不需要金鑰**：App Hosting 在同專案下自動走 ADC
（見 `lib/firebase-admin.ts` 的三層 fallback：環境變數 → service-account.json → ADC）。
本機開發建議 `gcloud auth application-default login` 走 ADC，而不是放金鑰檔。

## 部署

**推送到 GitHub `main` 即自動 rollout**，不需手動執行任何指令。

- Firebase App Hosting，backend `stock-analysis`、region `asia-east1`（需 Blaze 方案）
- 設定檔 `apphosting.yaml`
- ⚠️ `minInstances: 0` 是刻意的（冷啟動 2-5 秒換省成本），改成 1 會多 $10~15/月

Firestore rules 需另外部署：

```bash
npx firebase-tools deploy --only firestore:rules --project stock-analysis-b5602
```

## 技術棧

- Next.js 16（App Router）、React 19
- Tailwind CSS v4（用 `@theme`，**沒有 tailwind.config.ts**）
- lightweight-charts（K 線與技術指標）
- Firebase Firestore（資料）＋ Firebase Auth（Google 登入，給到價提醒用）
- 個股 K 線直接打 FinMind REST（`lib/finmind.ts`），繞過 Firestore

## 開發前必讀

專案 skill `.claude/skills/stock-helper-context/SKILL.md` 記錄了架構、資料語意與踩過的地雷
（例如「無資料」不可寫成 0、股→張換算一律 `Math.trunc`、表格溢出不可讓整頁橫捲、
InfoTip 泡泡一律 `position: fixed`）。**改動前先讀它。**
專案根目錄的 `CLAUDE.md` 講架構與慣例（2026-11-06 依程式校正過），skill 講「為什麼不能那樣做」。
