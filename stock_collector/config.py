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
