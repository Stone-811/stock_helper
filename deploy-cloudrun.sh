#!/usr/bin/env bash
# 選股小幫手：Cloud Run Job + Cloud Scheduler（兩段式 17:00 + 22:00 工作日）部署
# 前置：已裝 gcloud、已 gcloud auth login、專案已在 Blaze 方案
set -euo pipefail

PROJECT=stock-analysis-b5602
REGION=asia-east1
JOB=stock-collector

echo "== 0. 設定專案 =="
gcloud config set project "$PROJECT"

echo "== 1. 啟用必要 API =="
gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com

echo "== 2. 確認 FinMind token secret（App Hosting 已建過同名，可共用）=="
if ! gcloud secrets describe FINMIND_API_TOKEN >/dev/null 2>&1; then
  echo "  ❌ secret FINMIND_API_TOKEN 不存在。請先執行："
  echo "     printf '%s' '你的FinMindToken' | gcloud secrets create FINMIND_API_TOKEN --data-file=-"
  exit 1
fi

PROJECT_NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
RUN_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

echo "== 3. 先授予服務帳號權限（必須在部署前，否則 --set-secrets 會權限不足）=="
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${RUN_SA}" --role="roles/datastore.user" >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${RUN_SA}" --role="roles/run.invoker" >/dev/null
gcloud secrets add-iam-policy-binding FINMIND_API_TOKEN \
  --member="serviceAccount:${RUN_SA}" --role="roles/secretmanager.secretAccessor" >/dev/null
gcloud storage buckets add-iam-policy-binding gs://stock-analysis-b5602-archive \
  --member="serviceAccount:${RUN_SA}" --role="roles/storage.objectAdmin" >/dev/null
echo "  ✓ 權限授予完成（等幾秒讓權限生效）"
sleep 10

echo "== 4. 部署 Cloud Run Job（從 source 自動 build image）=="
gcloud run jobs deploy "$JOB" \
  --source=. \
  --region="$REGION" \
  --task-timeout=10m \
  --max-retries=1 \
  --memory=512Mi \
  --cpu=1 \
  --set-env-vars=USE_GCS_ARCHIVE=1 \
  --set-secrets=FINMIND_API_TOKEN=FINMIND_API_TOKEN:latest

echo "== 5. 建立兩個 Cloud Scheduler（UTC 09:00=台17:00、UTC 14:00=台22:00，工作日）=="
JOB_URI="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run"
create_sched () {
  local name=$1 cron=$2
  gcloud scheduler jobs create http "$name" \
    --location="$REGION" --schedule="$cron" --time-zone="Etc/UTC" \
    --uri="$JOB_URI" --http-method=POST \
    --oauth-service-account-email="$RUN_SA" 2>/dev/null \
  || gcloud scheduler jobs update http "$name" \
    --location="$REGION" --schedule="$cron" --time-zone="Etc/UTC"
}
create_sched "stock-collect-1700" "0 9 * * 1-5"
create_sched "stock-collect-2200" "0 14 * * 1-5"

echo ""
echo "✅ 完成！Cloud Run Job = $JOB，兩個排程（台灣 17:00 + 22:00 工作日）已建立。"
echo "   手動測試一次： gcloud run jobs execute $JOB --region=$REGION"
