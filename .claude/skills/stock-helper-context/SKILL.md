---
name: stock-helper-context
description: 選股小幫手（stock_helper，台股技術分析網站）的架構、資料流、部署與踩過的地雷。在此專案（/Users/stone/1.Python資料夾/3.選股小幫手）開發前先讀，掌握資料一致性/收集時機等陷阱，避免重蹈 2026-08 修過的 bug。
---

# 選股小幫手（stock_helper）專案 context

台股技術分析網站。前端 Next.js 看盤，後端 Python collector 抓 FinMind 寫 Firestore，GitHub Actions 每交易日自動收集。

## 技術棧與部署
- **前端**：Next.js 16 + React 19 + Tailwind v4 + lightweight-charts；PWA（next-pwa）
- **部署**：Firebase **App Hosting**（backend id `stock-analysis`、region `asia-east1`、**需 Blaze 方案**），連 GitHub `Stone-811/stock_helper` 的 `main`，push 自動 rollout
- **資料層**：Firestore（GCP 專案 `stock-analysis-b5602`）
- **後端收集**：Python `stock_collector/`，GitHub Actions `.github/workflows/daily-collect.yml`（cron `30 10 * * 1-5` = 台灣 18:30）
- **Secret**：`FINMIND_API_TOKEN` 設在 App Hosting secret（`firebase apphosting:secrets:set`）；前端連 Firestore 用 **ADC**（同專案免放金鑰，見 lib/firebase-admin.ts fallback）
- **網址**：https://stock-analysis--stock-analysis-b5602.asia-east1.hosted.app
- **CLI**：`firebase` 未全域安裝，用 `npx firebase-tools`

## 資料流
1. GitHub Actions 每交易日 → `daily_collector` 抓 FinMind（股價 / 三大法人 / 外資持股 / 當沖 / 指數）
2. 寫 Firestore：`daily_data/{date}/chunks`（每日全市場，**只保留近幾天**）、`strong_stocks/{date}`（~100 天）、`market_index/{TAIEX,TX}`（history 陣列）、`metadata/{latest_date, available_dates}`
3. 前端讀 Firestore；**但個股 K 線改打 FinMind REST（`lib/finmind.ts`，單股完整歷史，繞過 Firestore）**、MACD 由前端 `lib/indicators.ts` 自算

## ⚠️ 關鍵地雷（2026-08 踩過並修過，改動前務必留意）
1. **收集時機**：外資持股（`taiwan_stock_shareholding`）盤後**較晚**才發布，18:30 收集常抓到空 → 靜默存 0。需事後重跑補，或把排程改到台灣 ~22:00。
2. **資料源日期不一致**：個股頁 K 線用 FinMind、法人用 Firestore，兩者「最新日」可能差一天 → 收盤與法人不同日。已修：法人改抓「與 K 線同一天」。
3. **「最新日」多來源**：`latest_date`（metadata，由 write_daily_data 寫）vs `available_dates[0]`（由 write_strong_stock_matrix 從強勢矩陣產生）vs FinMind 自己的最後一根，會各說各話。已統一以 `latest_date` 為權威。
4. **遞迴指標暖身**：MACD/KD/RSI 是 EMA 遞迴、對「資料起點」敏感，用短區間算會失真、與卡片對不上。規則：**指標一律用完整資料算再擷取顯示區間**（見 CandleChart 的 startIdx + slice）。
5. **PWA 快取**：next-pwa 預設把 `/api/*` 快取 24h，使用者會看不到更新的行情。已在 next.config 改成 60s NetworkFirst。改資料相關頁記得使用者可能需硬重新整理載入新 SW。
6. **daily_data 只保留近幾天**：`available_dates` / `strong_stocks` 有 ~100 天，但 `daily_data` 沒有 → 選較舊日期時明細會空（已回 `dataMissing` 讓前端提示）。
7. **latest_date 無條件覆蓋**：collector 用 `--date` 補舊資料時會把 latest_date 倒退。已修：只在 `date >= 現值` 時更新（firebase_writer.py）。補多天時**最後一次要跑最新日**，否則 latest_date 會停在最後跑的舊日。
8. **時間週期換算**：`periodToDays` 是「交易日數」，不可拿去減聚合後的週/月 bar 數。區間篩選用「日曆天門檻」（已修）。

## 已修 bug 清單（2026-08 本次 session，均已部署）
**前端**：A2 週/月K 區間鈕單位、A3 月K MACD 暖身（K 線抓 5 年）、B1 個股頁日期錯位、B2 找不到時假 0（改顯示「—」）、B3 強勢股 dataMissing 提示、B4 最新日統一、MACD 卡片 vs 圖表一致（指標用完整資料算）、PWA 快取 24h→60s。
**後端**：C1 輔助資料整批 0 警示、C2 驗證改當日切片、C3 latest_date 不倒退、C4 Firestore 寫入失敗醒目、C6 指數 upsert、C7 MACD 改本地年度檔計算（`add_macd_from_archive`，零 API）。

## 待辦（尚未修，附具體修法）
- **C5 available_dates 以 daily_data 為準**：目前由 `write_strong_stock_matrix` 從強勢矩陣日期產生（firebase_writer.py:307-311），與 daily_data 覆蓋天數不一致，且「某日 0 強勢股」會讓該日消失。修法：改由 `daily_data` 實際存在日期產生，或取交集；允許「0 強勢股但有資料」的日期列入。
- **C3 增量回補中間缺口**：`get_missing_dates`（daily_collector.py:85-101）只從 `latest_date+1` 往後找，中間某天失敗後補不回；且 `get_latest_date_from_db` 查的是**舊架構** collection（`daily_stocks` / `market_index_daily`，Python 已不寫入）。修法：改用「過去 N 天交易日全集 − 已存在日期集合」，並改查新架構 `daily_data` / `market_index` 的日期。
- **A1 列表 vs 個股 MACD 完全統一**：C7 後 Firestore `macd_status` 已有值（列表可用），但個股頁仍前端算，資料源不同、極臨界日可能小差異。要完全一致需二選一單一來源。
- **安全**：`service-account.json` 私鑰會被 bundle 進 `.next`（本機建置產物，已 gitignore）；建議輪替金鑰、production 一律用環境變數 `FIREBASE_SERVICE_ACCOUNT_KEY` 注入而非 `require` 讀檔。

## 運維現況（2026-08 排查結論）
- **GitHub Actions 沒有斷**：2026-07-24 才從 Supabase 遷 Firebase 並首次加 Actions，7/24 初設失敗 2 次（依賴/憑證）當天修好，7/27 起 cron 每交易日穩定成功。**上半年缺資料是因為當時根本沒這套系統**，非中斷。
- **收集排程已改為台灣 22:00**（cron `0 14 * * 1-5`，原 18:30），等外資持股發布後才收集，根治「每天外資持股 0」。
- ⚠️ **GitHub 會自動停用「連續 60 天無 commit」repo 的排程 workflow**——長期只靠 cron、沒人 push 會讓收集真的斷掉；要嘛定期 commit，要嘛用外部排程觸發。
- 排查指令：`gh run list --workflow=daily-collect.yml`（看每交易日成功與否）。

## 常用指令
```bash
# 補某交易日（含法人/外資持股/當沖/指數/強勢股/MACD）
python3 -m stock_collector.daily_collector --date 2026-07-31
# 補歷史指數
python3 -m stock_collector.index_collector --days 730
# 前端建置
cd frontend && npm run build
# 部署 Firestore rules/indexes（前端部署走 App Hosting 自動 rollout）
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project stock-analysis-b5602
```
查 Firestore 現況：用 `frontend/service-account.json` + `firebase-admin` 寫小 script（metadata/latest_date、daily_data/{date}/chunks）。
