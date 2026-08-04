"""收集異常告警（Email via SMTP）。

用途：每日收集器在「關鍵任務失敗 / self-check 不過 / 執行崩潰」時主動寄信，
避免像 ADC gate bug 那樣「exit 0 假成功」潛伏數天沒人發現。

環境變數（Cloud Run 以 --set-env-vars / --set-secrets 注入）：
  SMTP_HOST    預設 smtp.gmail.com
  SMTP_PORT    預設 465（SSL）
  SMTP_USER    寄件 Gmail 帳號
  SMTP_PASS    Gmail 應用程式密碼（存為 Cloud Run secret，勿寫進程式）
  ALERT_EMAIL  收件人（可逗號分隔多個；預設同 SMTP_USER）

未設定 SMTP_USER / SMTP_PASS 時靜默略過（本機開發無需告警）。
"""

import os
import ssl
import smtplib
import logging
from email.message import EmailMessage
from email.utils import formatdate


def alert_enabled() -> bool:
    """是否具備寄送告警的最小設定。"""
    return bool(os.getenv('SMTP_USER') and os.getenv('SMTP_PASS'))


def send_alert(subject: str, body: str) -> bool:
    """寄送純文字告警信。回傳是否成功。缺設定時靜默略過並回 False。

    用 EmailMessage（policy=default）組信：主旨與內文的 UTF-8 編碼由標準庫處理，
    避免 MIMEText + as_string() 對含中文的 header 以 ascii 編碼失敗。
    """
    user = os.getenv('SMTP_USER')
    password = os.getenv('SMTP_PASS')
    if not user or not password:
        logging.info("未設定 SMTP_USER / SMTP_PASS，略過 Email 告警")
        return False

    host = os.getenv('SMTP_HOST', 'smtp.gmail.com')
    port = int(os.getenv('SMTP_PORT', '465'))
    to_addr = os.getenv('ALERT_EMAIL', user)
    recipients = [a.strip() for a in to_addr.split(',') if a.strip()]

    msg = EmailMessage()
    msg['Subject'] = subject
    msg['From'] = user
    msg['To'] = ', '.join(recipients)
    msg['Date'] = formatdate(localtime=True)
    msg.set_content(body)

    try:
        ctx = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=20) as server:
            server.login(user, password)
            server.send_message(msg)
        logging.info(f"✓ 已寄出告警 Email → {msg['To']}")
        return True
    except Exception as e:
        logging.error(f"寄送告警 Email 失敗：{e}")
        return False
