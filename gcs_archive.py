"""
年度檔的 Cloud Storage 同步。

讓 stateless 環境（如 Cloud Run Job、GitHub Actions）也有持久的歷史年度檔：
- collector 開始時 download_archives()：從 Storage 拉年度檔到本地
- collector 結束時 upload_archives()：把本地年度檔推回 Storage

用 USE_GCS_ARCHIVE=1 啟用（Cloud Run 設定；本地開發不設則沿用本地檔）。
Storage 用與前端相同的 Firebase Storage bucket。
"""
import os
import logging
from pathlib import Path

STORAGE_BUCKET = 'stock-analysis-b5602-archive'
ARCHIVE_PREFIX = 'archive/'  # bucket 內的資料夾


def gcs_enabled() -> bool:
    return os.getenv('USE_GCS_ARCHIVE', '') == '1'


def _bucket():
    from google.cloud import storage as gcs
    # 本機用 service-account.json；Cloud Run 用 ADC（同專案免金鑰）
    for p in ('frontend/service-account.json', 'service-account.json'):
        if os.path.exists(p):
            return gcs.Client.from_service_account_json(p).bucket(STORAGE_BUCKET)
    return gcs.Client(project='stock-analysis-b5602').bucket(STORAGE_BUCKET)


def download_archives(local_archive_dir) -> int:
    """從 Storage 下載年度檔到本地（collector 開始時）。回傳下載檔數。"""
    if not gcs_enabled():
        return 0
    try:
        bucket = _bucket()
        local_dir = Path(local_archive_dir)
        local_dir.mkdir(parents=True, exist_ok=True)
        count = 0
        for blob in bucket.list_blobs(prefix=ARCHIVE_PREFIX):
            fname = blob.name[len(ARCHIVE_PREFIX):]
            if fname.endswith('.csv'):
                blob.download_to_filename(str(local_dir / fname))
                count += 1
        logging.info(f"✓ 從 Storage 下載 {count} 個年度檔")
        return count
    except Exception as e:
        logging.warning(f"⚠️ Storage 下載年度檔失敗（改用本地）: {e}")
        return 0


def upload_archives(local_archive_dir) -> int:
    """把本地年度檔上傳 Storage（collector 結束時）。回傳上傳檔數。"""
    if not gcs_enabled():
        return 0
    try:
        bucket = _bucket()
        local_dir = Path(local_archive_dir)
        count = 0
        for csv in sorted(local_dir.glob('*.csv')):
            blob = bucket.blob(ARCHIVE_PREFIX + csv.name)
            blob.upload_from_filename(str(csv))
            count += 1
        logging.info(f"✓ 上傳 {count} 個年度檔到 Storage")
        return count
    except Exception as e:
        logging.error(f"❌ Storage 上傳年度檔失敗: {e}")
        return 0
