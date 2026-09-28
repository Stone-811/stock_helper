# 台灣強勢股分析系統 — 前端

Next.js 16 + React 19 + Tailwind CSS v4 建構的台股分析網站。

**線上版本**：https://stock-analysis--stock-analysis-b5602.asia-east1.hosted.app

## 頁面

| 路由 | 內容 |
|---|---|
| `/` | 市場 Dashboard：加權指數、今日強勢股、我的自選、指數走勢 |
| `/strong-stocks` | 今日強勢股（卡片檢視） |
| `/strong-table` | 強勢股總表（表格檢視，一次看全部欄位） |
| `/screener` | 自訂條件選股 |
| `/watchlist` | 自選股（需 Google 登入） |
| `/stock/[id]` | 個股詳情：K 線、技術指標、籌碼圖、今日訊號 |

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
- Firebase Firestore（資料）＋ Firebase Auth（Google 登入）
- 個股 K 線直接打 FinMind REST（`lib/finmind.ts`），繞過 Firestore

## 開發前必讀

專案 skill `.claude/skills/stock-helper-context/SKILL.md` 記錄了架構、資料語意與踩過的地雷
（例如「無資料」不可寫成 0、股→張換算一律 `Math.trunc`、表格溢出不可讓整頁橫捲）。
**改動前先讀它**；專案根目錄的 `CLAUDE.md` 部分內容已過時，以 skill 為準。
