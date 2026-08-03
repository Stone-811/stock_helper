"""
配置檔案
"""
import os
from pathlib import Path
from dotenv import load_dotenv
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    
# 載入環境變數
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# FinMind API 認證設定
FINMIND_API_TOKEN = os.getenv('FINMIND_API_TOKEN', '')
FINMIND_USER_ID = os.getenv('FINMIND_USER_ID', '')
FINMIND_PASSWORD = os.getenv('FINMIND_PASSWORD', '')

# Firebase 寫入判斷（集中於此，三個收集器共用）
_PROJECT_ROOT = Path(__file__).parent.parent


def firebase_enabled() -> bool:
    """是否可寫入 Firestore（任一條件成立即 True）。

    - 專案內有 service-account.json（本機開發）
    - 有 FIREBASE_SERVICE_ACCOUNT_KEY 環境變數（CI 等）
    - 在 GCP / Cloud Run 執行環境 → firebase_writer 會用 Application Default
      Credentials 寫入（同專案免放金鑰）

    先前只認前兩者，導致 Cloud Run（靠 ADC）被誤判為未設定 → 排程雖成功執行卻
    整批跳過 Firestore 寫入，資料只進本地 CSV/GCS，前端讀不到當日更新。
    """
    if (_PROJECT_ROOT / 'frontend' / 'service-account.json').exists():
        return True
    if (_PROJECT_ROOT / 'service-account.json').exists():
        return True
    if os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY'):
        return True
    # Cloud Run Job 注入 CLOUD_RUN_JOB；Cloud Run 服務注入 K_SERVICE；GCP 通用 GOOGLE_CLOUD_PROJECT
    if os.getenv('CLOUD_RUN_JOB') or os.getenv('K_SERVICE') or os.getenv('GOOGLE_CLOUD_PROJECT') or os.getenv('GCP_PROJECT'):
        return True
    return False


# 資料收集設定
BATCH_SIZE = 100  # 每批次處理的股票數量
DELAY_BETWEEN_BATCHES = 2.0  # 批次之間的延遲秒數
DELAY_BETWEEN_REQUESTS = 0.1  # 單一請求之間的延遲秒數

# 日期設定
LOOKBACK_DAYS = 7  # 往前抓取的天數（確保有資料）

# 資料夾設定
DATA_DIR = 'data'  # 資料儲存目錄
LOG_DIR = 'logs'  # 日誌儲存目錄

# API 設定
# FinMind API 限制（免費版）:
# - 每分鐘 600 次請求
# - 每小時 3600 次請求
API_RATE_LIMIT_PER_MINUTE = 600
API_RATE_LIMIT_PER_HOUR = 3600

# 預估執行時間
# 假設約 2000 檔股票，每批 100 檔，延遲 2 秒
# 總批次數: 20 批
# 總時間: 20 * 2 = 40 秒 (批次延遲) + 2000 * 0.1 = 200 秒 (請求延遲)
# 約 4-5 分鐘完成
ESTIMATED_STOCKS = 2000
ESTIMATED_TIME_MINUTES = (ESTIMATED_STOCKS / BATCH_SIZE * DELAY_BETWEEN_BATCHES +
                          ESTIMATED_STOCKS * DELAY_BETWEEN_REQUESTS) / 60

# 日誌設定
LOG_LEVEL = 'INFO'  # 日誌級別: DEBUG, INFO, WARNING, ERROR
LOG_FORMAT = '%(asctime)s - %(levelname)s - %(message)s'

# 檔案命名格式
# 月份目錄: YYYYMM
# 股票檔案: stock_id_YYYYMMDD.csv
# 失敗清單: failed_YYYYMMDD.csv
# 日誌檔案: collector_YYYYMMDD.log
