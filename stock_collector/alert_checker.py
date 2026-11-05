"""到價 / 訊號警示檢查：每日收集後掃 user_alerts，達成條件則 Email 通知該使用者。

資料流：
- 使用者在前端（綁 Firebase Auth uid）寫入 Firestore：
    user_alerts/{uid}/alerts/{alertId}
      { stock_id, stock_name, type, value, email, enabled, created_at }
- 本模組用 Admin SDK collection_group 掃所有 alerts，對照當日 daily_data 該檔
  close / macd_status / foreign_streak / trust_streak 判斷是否達成。
- 達成後寄信給該使用者，**信確實寄出**才把 enabled 設為 False + 記 triggered_at，
  避免每天重複通知（使用者可在網站重新啟用）。沒寄出（沒設 SMTP、Gmail 拒絕、查不到收件人）就維持啟用，下一班再試。

⚠️ 文件內容是使用者自己寫的（firestore.rules 只驗 uid、不驗欄位），不可信任：
  - 收件人一律用 Firebase Auth 查 uid 的 email（uid 取自文件路徑），**不用**文件裡的 email 欄位——
    否則任何登入的人都能讓收集器用業主的 Gmail 寄信給任意地址。
  - 股名、代號用當日 daily_data 的值，不用文件裡的 stock_name；條件數值用解析後的數字。
  - 文件 email 是空字串時，以前會落到 notify 的 ALERT_EMAIL（寄給業主）。

只檢查「今天」：補舊日期（--date 舊日、--days、--backfill-gaps）不檢查，否則會拿舊收盤價寄出「警示達成」並停用提醒。

掛在 daily_collector.run_daily() 尾端（收集 + self-check 通過後）。
"""
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

# 警示文件的固定路徑：user_alerts/{uid}/alerts/{alertId}
_ALERTS_PARENT = 'user_alerts'


def _alert_value(alert: dict) -> float:
    """條件數值（使用者寫的，可能是字串或亂填）→ float；不是數字回 0（與舊行為相同）。"""
    try:
        return float(alert.get('value', 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def _fmt_value(v: float) -> str:
    """600.0 → '600'、600.5 → '600.5'。信裡只放解析後的數字，不放使用者原字串。"""
    return str(int(v)) if float(v).is_integer() else str(v)


def _is_met(alert: dict, stock: dict) -> bool:
    """判斷單筆 alert 是否被當日資料觸發。"""
    t = alert.get('type')
    val = _alert_value(alert)
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


def _streak_label(v) -> str:
    """連續買賣天數 → 可讀字串：正=連買、負=連賣、0=無。"""
    n = int(v or 0)
    if n > 0:
        return f'連買 {n} 天'
    if n < 0:
        return f'連賣 {abs(n)} 天'
    return '無'


def _alert_uid(alert_doc):
    """從文件路徑 user_alerts/{uid}/alerts/{id} 取 uid；路徑不對（別處同名的 alerts 集合）回 None。"""
    try:
        user_doc = alert_doc.reference.parent.parent
        if user_doc is None or user_doc.parent.id != _ALERTS_PARENT:
            return None
        return user_doc.id or None
    except AttributeError:
        return None


def _recipient(uid: str, cache: dict):
    """uid 在 Firebase Auth 登記的 email（同一班每個 uid 只查一次）；查不到或沒有 email 回 None。"""
    if uid in cache:
        return cache[uid]
    email = None
    try:
        from firebase_admin import auth
        email = (auth.get_user(uid).email or '').strip() or None
    except Exception as e:
        logging.warning(f"警示收件人查詢失敗（uid {uid}）：{e}")
    cache[uid] = email
    return email


def _notify(alert: dict, stock: dict, date: str, to: str) -> bool:
    """寄出警示信；回傳是否寄出（send_alert 不 raise）。股名、代號用當日資料，條件數值用解析後的數字。"""
    from notify import send_alert
    sid = str(stock.get('stock_id') or alert.get('stock_id'))
    name = stock.get('stock_name') or sid
    cond = _LABELS.get(alert.get('type'), str(alert.get('type'))).format(v=_fmt_value(_alert_value(alert)))
    body = '\n'.join([
        '您在選股小幫手設定的股票警示已達成',
        '=' * 40,
        f"股票：{sid} {name}",
        f"條件：{cond}",
        f"目前收盤：{stock.get('close')}",
        f"外資：{_streak_label(stock.get('foreign_streak'))}　投信：{_streak_label(stock.get('trust_streak'))}",
        f"MACD：{'多頭' if stock.get('macd_status') == '多' else '空頭' if stock.get('macd_status') == '空' else '-'}",
        f"資料日期：{date}",
        '',
        '此警示已自動停用，如需再次追蹤請至網站重新啟用。',
    ])
    return send_alert(f"[選股小幫手] 警示達成：{sid} {name}", body, to=to)


def _today_candidates() -> set:
    """「今天」：本機時鐘（收集器預設日期用的那個；Cloud Run 是 UTC）與台灣時間各一個，
    兩班排程（台灣 17:00／22:00＝UTC 09:00／14:00）兩者相同。"""
    from notify import tw_now
    return {datetime.now().strftime('%Y-%m-%d'), tw_now().strftime('%Y-%m-%d')}


def check_alerts(target_date=None) -> None:
    """檢查所有啟用的警示，達成且信確實寄出才停用。缺 Firebase/SMTP 時安全略過（SMTP 沒設＝不停用）。

    target_date 不是今天（補舊日期）就不檢查：拿舊收盤價判斷會誤寄「警示達成」並停用提醒。
    """
    target = target_date or datetime.now().strftime('%Y-%m-%d')
    if target not in _today_candidates():
        logging.info(f"警示檢查：{target} 不是今天（補舊日期），不檢查提醒")
        return

    try:
        from firebase_writer import get_firestore_client
    except Exception as e:
        logging.warning(f"警示檢查略過（Firebase 未就緒）：{e}")
        return

    db = get_firestore_client()

    stock_map = _load_day_stock_map(db, target)
    if not stock_map:
        logging.info(f"警示檢查：daily_data/{target} 無資料，略過")
        return

    # collection_group 掃所有使用者的 alerts；不帶 where（避免 collection-group 複合索引需求），
    # 在程式端過濾 enabled。警示筆數通常不多，全掃可接受。
    checked = triggered = unsent = 0
    try:
        alerts = list(db.collection_group('alerts').stream())
    except Exception as e:
        logging.warning(f"警示查詢失敗（collection_group 'alerts'）：{e}")
        return

    emails = {}
    for alert_doc in alerts:
        a = alert_doc.to_dict() or {}
        if not a.get('enabled'):
            continue
        checked += 1
        stock = stock_map.get(str(a.get('stock_id')))
        if not stock:
            continue
        if not _is_met(a, stock):
            continue
        uid = _alert_uid(alert_doc)
        to = _recipient(uid, emails) if uid else None
        if not to:
            unsent += 1
            logging.warning(f"警示達成但查不到收件人（{alert_doc.reference.path}），不寄、不停用")
            continue
        try:
            if not _notify(a, stock, target, to):
                unsent += 1
                logging.error(f"警示信沒有寄出（{alert_doc.reference.path}），維持啟用、下一班再試")
                continue
            alert_doc.reference.update({'enabled': False, 'triggered_at': target})
            triggered += 1
        except Exception as e:
            logging.warning(f"警示通知失敗（{a.get('stock_id')}）：{e}")

    logging.info(f"✓ 警示檢查完成：啟用 {checked} 筆，觸發 {triggered} 筆" + (f"，未寄出 {unsent} 筆" if unsent else ''))
