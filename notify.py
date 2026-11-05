"""收集異常告警（Email via SMTP）。

用途：每日收集器在「關鍵任務失敗 / self-check 不過 / 執行崩潰」時主動寄信，
避免像 ADC gate bug 那樣「exit 0 假成功」潛伏數天沒人發現。

環境變數（Cloud Run 以 --set-env-vars / --set-secrets 注入）：
  SMTP_HOST    預設 smtp.gmail.com
  SMTP_PORT    預設 465（SSL）
  SMTP_USER    寄件 Gmail 帳號
  SMTP_PASS    Gmail 應用程式密碼（存為 Cloud Run secret，勿寫進程式）
  ALERT_EMAIL  收件人（可逗號分隔多個；預設同 SMTP_USER）

未設定 SMTP_USER / SMTP_PASS 時不寄（本機開發無需告警），send_alert 回 False。

兩個入口：
  send_nonfatal(subject, body)  收集器的告警（斷料、日曆不一致、強勢股異常、收集失敗）。永不 raise，
                                沒寄出就記 log；新增一種告警只要呼叫這一行。
  send_alert(subject, body, to) 要知道「有沒有寄出」的地方（到價提醒、--test-alert）。也不 raise，回 bool。
"""

import os
import ssl
import smtplib
import logging
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime

# 台灣時間（固定 +8，不依賴 image 有沒有 tzdata）。Cloud Run 容器是 UTC，
# datetime.now() 在 17:00 那班會寫成 09:00。
TW_TZ = timezone(timedelta(hours=8), 'Asia/Taipei')


def tw_now() -> datetime:
    """現在的台灣時間（帶時區）。信件內文與 Date 標頭用這個。"""
    return datetime.now(TW_TZ)


def _smtp_credentials():
    """(SMTP_USER, SMTP_PASS)；任一沒設回 None。"""
    user = os.getenv('SMTP_USER')
    password = os.getenv('SMTP_PASS')
    return (user, password) if user and password else None


def send_alert(subject: str, body: str, to: str | None = None) -> bool:
    """寄送純文字信。回傳是否成功；缺設定或寄送失敗都回 False，不 raise。

    to：收件人（覆蓋 ALERT_EMAIL），用於「寄給特定使用者」的警示通知；未給則用 ALERT_EMAIL。
    用 EmailMessage（policy=default）組信：主旨與內文的 UTF-8 編碼由標準庫處理，
    避免 MIMEText + as_string() 對含中文的 header 以 ascii 編碼失敗。
    """
    creds = _smtp_credentials()
    if not creds:
        logging.info("未設定 SMTP_USER / SMTP_PASS，略過 Email 告警")
        return False
    user, password = creds

    try:
        # SMTP_PORT 設錯（例如 'abc'）、主旨含換行等組信錯誤也算寄送失敗，不可讓呼叫端崩潰
        host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
        port = int(os.getenv('SMTP_PORT', '465'))
        to_addr = to or os.getenv('ALERT_EMAIL', user)
        recipients = [a.strip() for a in to_addr.split(',') if a.strip()]

        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = user
        msg['To'] = ', '.join(recipients)
        msg['Date'] = format_datetime(tw_now())
        msg.set_content(body)

        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as server:
            server.login(user, password)
            server.send_message(msg)
        logging.info(f"✓ 已寄出告警 Email → {msg['To']}")
        return True
    except Exception as e:
        logging.error(f"寄送告警 Email 失敗：{e}")
        return False


def send_nonfatal(subject: str, body: str) -> bool:
    """收集器的非關鍵告警（寄給 ALERT_EMAIL）。永不 raise；回傳是否寄出。

    - 沒設 SMTP：記一行 warning（含主旨），告警只留在 log。
    - 有設卻寄失敗：send_alert 已記 error（含原因）。
    呼叫端在寄信前自己 logging.error 問題內容，所以沒寄出時 log 裡仍有完整紀錄。
    """
    if not _smtp_credentials():
        logging.warning(f"未設定 SMTP，這封告警只記在 log：{subject}")
        return False
    try:
        return send_alert(subject, body)
    except Exception as e:   # send_alert 本身不 raise；這層只是保險
        logging.error(f"寄送告警失敗（{subject}）：{e}")
        return False
