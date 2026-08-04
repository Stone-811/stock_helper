"""到價 / 訊號警示檢查：每日收集後掃 user_alerts，達成條件則 Email 通知該使用者。

資料流：
- 使用者在前端（綁 Firebase Auth uid）寫入 Firestore：
    user_alerts/{uid}/alerts/{alertId}
      { stock_id, stock_name, type, value, email, enabled, created_at }
- 本模組用 Admin SDK collection_group 掃所有 alerts，對照當日 daily_data 該檔
  close / macd_status / foreign_streak / trust_streak 判斷是否達成。
- 達成後用 notify.send_alert 寄給該 alert 的 email，並把 enabled 設為 False + 記 triggered_at，
  避免每天重複通知（使用者可在網站重新啟用）。

掛在 daily_collector.run_daily() 尾端（收集 + self-check 通過後）。
"""
import os
import logging
from datetime import datetime

# 支援的條件類型 → 人類可讀描述（value 以 {v} 代入）
_LABELS = {
    'price_above': '股價漲到 {v} 以上',
    'price_below': '股價跌到 {v} 以下',
    'macd_bullish': 'MACD 轉多頭',
    'macd_bearish': 'MACD 轉空頭',
    'foreign_streak': '外資連買達 {v} 天',
    'trust_streak': '投信連買達 {v} 天',
}


def _is_met(alert: dict, stock: dict) -> bool:
    """判斷單筆 alert 是否被當日資料觸發。"""
    t = alert.get('type')
    try:
        val = float(alert.get('value', 0) or 0)
    except (TypeError, ValueError):
        val = 0
    close = float(stock.get('close', 0) or 0)
    if t == 'price_above':
        return close > 0 and close >= val
    if t == 'price_below':
        return close > 0 and close <= val
    if t == 'macd_bullish':
        return stock.get('macd_status') == '多'
    if t == 'macd_bearish':
        return stock.get('macd_status') == '空'
    if t == 'foreign_streak':
        return int(stock.get('foreign_streak', 0) or 0) >= val
    if t == 'trust_streak':
        return int(stock.get('trust_streak', 0) or 0) >= val
    return False


def _load_day_stock_map(db, date: str) -> dict:
    """讀當日 daily_data 全市場明細，建 stock_id → 資料 dict。"""
    day_doc = db.collection('daily_data').document(date).get()
    if not day_doc.exists:
        return {}
    chunk_count = day_doc.to_dict().get('chunk_count', 0)
    stock_map = {}
    for i in range(chunk_count):
        c = db.collection('daily_data').document(date).collection('chunks').document(f'chunk_{i}').get()
        if c.exists:
            for s in c.to_dict().get('stocks', []):
                stock_map[str(s.get('stock_id'))] = s
    return stock_map


def _notify(alert: dict, stock: dict, date: str) -> None:
    from notify import send_alert
    cond = _LABELS.get(alert.get('type'), str(alert.get('type'))).format(v=alert.get('value'))
    name = alert.get('stock_name') or stock.get('stock_name') or alert.get('stock_id')
    body = '\n'.join([
        '您在選股小幫手設定的股票警示已達成',
        '=' * 40,
        f"股票：{alert.get('stock_id')} {name}",
        f"條件：{cond}",
        f"目前收盤：{stock.get('close')}",
        f"外資連買：{stock.get('foreign_streak', 0)} 天　投信連買：{stock.get('trust_streak', 0)} 天",
        f"MACD：{stock.get('macd_status', '-')}",
        f"資料日期：{date}",
        '',
        '此警示已自動停用，如需再次追蹤請至網站重新啟用。',
    ])
    send_alert(
        f"[選股小幫手] 警示達成：{alert.get('stock_id')} {name}",
        body,
        to=alert.get('email'),
    )


def check_alerts(target_date=None) -> None:
    """檢查所有啟用的警示，達成則寄信並停用。缺 Firebase/SMTP 時安全略過。"""
    try:
        from firebase_writer import get_firestore_client
    except Exception as e:
        logging.warning(f"警示檢查略過（Firebase 未就緒）：{e}")
        return

    db = get_firestore_client()
    target = target_date or datetime.now().strftime('%Y-%m-%d')

    stock_map = _load_day_stock_map(db, target)
    if not stock_map:
        logging.info(f"警示檢查：daily_data/{target} 無資料，略過")
        return

    # collection_group 掃所有使用者的 alerts；不帶 where（避免 collection-group 複合索引需求），
    # 在程式端過濾 enabled。警示筆數通常不多，全掃可接受。
    checked = triggered = 0
    try:
        alerts = list(db.collection_group('alerts').stream())
    except Exception as e:
        logging.warning(f"警示查詢失敗（collection_group 'alerts'）：{e}")
        return

    for alert_doc in alerts:
        a = alert_doc.to_dict() or {}
        if not a.get('enabled'):
            continue
        checked += 1
        stock = stock_map.get(str(a.get('stock_id')))
        if not stock:
            continue
        if _is_met(a, stock):
            try:
                _notify(a, stock, target)
                alert_doc.reference.update({'enabled': False, 'triggered_at': target})
                triggered += 1
            except Exception as e:
                logging.warning(f"警示通知失敗（{a.get('stock_id')}）：{e}")

    logging.info(f"✓ 警示檢查完成：啟用 {checked} 筆，觸發 {triggered} 筆")
