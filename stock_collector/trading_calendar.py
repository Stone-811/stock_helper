"""
台股交易日曆：判斷某一天到底有沒有開盤。

為什麼不能用星期幾
------------------
平日休市（國定假日、補假、颱風停市）只能從交易日曆看出來。只排除週六日會造成：
排程在平日假日照跑 → 抓不到股價 → 誤寄「收集異常告警」；`--backfill-gaps` 把假日當成缺漏、每次都重抓。

資料來源與可信度（2026-10-22 驗證）
----------------------------------
FinMind `TaiwanStockTradingDate`：
* 是事先排好的官方行事曆（當時已排到 2026-12-31），10-26 光復節補假、12-25 行憲紀念日都正確標成休市。
* 2024-08-01 起與加權指數實際有 K 棒的日子逐日一致（541／541 天）；颱風停市也有反映
  （2024-07-24／25 凱米、2024-10-31 康芮）。

⚠️ 最重要的安全規則：寧可多一封誤報，也不要安靜漏收
--------------------------------------------------
* 下一年度的行事曆公布前（例如 2026-10 時 2027 年整年都不在日曆上），「不在日曆上」**不代表休市**。
  所以日曆沒涵蓋那一天、或日曆抓不到時，一律回「不知道」→ 照常收集。
* 就算日曆說休市，也要**另外兩個來源**都確認沒有交易才算休市（is_market_closed）：
  FinMind 加權指數沒有 K 棒，而且**證交所（TWSE FMTQIK）當月成交清單裡沒有這天**。
  只靠 FinMind 不夠：日曆與股價同一家，而且 FinMind 股價 17:30 才更新，17:00 那班「指數沒資料」
  這道確認形同虛設（2026-10-22 審查指出）。證交所收盤後就公布、與 FinMind 完全獨立。
  任何一個來源抓不到 → 當成不知道 → 照常收集。三者不一致 → 照常收集並寄信通知（日曆可能有誤）。
* 颱風當天日曆可能還沒更新 → 日曆說開盤 → 照常收集 → 抓不到資料 → 告警。這是「誤報」方向，可接受。
"""
import logging
from datetime import date as _date

try:
    from . import config
except ImportError:  # 直接執行或從 scripts/ 匯入時
    import config  # type: ignore

_cache = {}       # 年 → set(交易日) 或 None（抓取失敗）
_twse_cache = {}  # 'YYYYMM' → set(交易日) 或 None
_api = None


def _get_api():
    global _api
    if _api is None:
        from FinMind.data import DataLoader
        _api = DataLoader()
        if config.FINMIND_API_TOKEN:
            _api.login_by_token(api_token=config.FINMIND_API_TOKEN)
    return _api


def _load_year(year: int):
    """回傳該年度的交易日 set；抓不到或空的回 None（呼叫端必須當成「不知道」）。"""
    if year in _cache:
        return _cache[year]
    try:
        cal = _get_api().get_data(dataset='TaiwanStockTradingDate',
                                  start_date=f'{year}-01-01', end_date=f'{year}-12-31')
        days = set(cal['date'].astype(str)) if cal is not None and len(cal) and 'date' in cal.columns else None
    except Exception as e:
        logging.warning(f"交易日曆抓取失敗（{year}），當成不知道、照常收集：{e}")
        days = None
    _cache[year] = days or None
    return _cache[year]


def calendar_status(day: str):
    """日曆怎麼說：True＝開盤、False＝休市、None＝不知道（抓不到，或日曆沒涵蓋這天）。

    該年度日曆抓得到時，只有「晚於日曆最後一天」才算沒涵蓋（行事曆可能只公布到年中）。
    ⚠️ 不可用「早於日曆第一個交易日」也當沒涵蓋：元旦永遠在第一個交易日之前，
       會每年回 None → 照常收集 → 誤寄告警，--backfill-gaps 也會把元旦當缺口（2026-10-22 審查指出）。
    下一年度行事曆還沒公布時整年抓不到 → None——這正是不能把「不在日曆上」當成休市的原因。
    """
    days = _load_year(int(day[:4]))
    if not days:
        return None
    if day > max(days):
        return None
    return day in days


def _twse_month(day: str):
    """證交所 FMTQIK 當月有成交的日子（set）；抓不到回 None。與 FinMind 完全獨立的第三個來源。

    證交所日期是民國年（例如 115/10/01）。用 requests 並保留憑證檢查——本機 python urllib
    對 twse 憑證曾有 SSL 問題，但 requests（certifi）正常；若在某環境失敗就回 None、照常收集。
    """
    ym = day[:4] + day[5:7]
    if ym in _twse_cache:
        return _twse_cache[ym]
    days = None
    try:
        import requests
        r = requests.get('https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK',
                         params={'date': ym + '01', 'response': 'json'},
                         headers={'User-Agent': 'Mozilla/5.0'}, timeout=15)
        j = r.json()
        if r.status_code == 200 and j.get('stat') == 'OK':
            days = set()
            for row in j.get('data') or []:
                y, m, d = str(row[0]).strip().split('/')
                days.add(f'{int(y) + 1911:04d}-{int(m):02d}-{int(d):02d}')
    except Exception as e:
        logging.warning(f"證交所成交清單抓取失敗（{ym}），當成不知道、照常收集：{e}")
        days = None
    _twse_cache[ym] = days
    return days


def _notify_mismatch(day: str, detail: str):
    """日曆說休市、實際卻有成交：照常收集，另寄一封信讓業主知道日曆可能有誤。"""
    try:
        from notify import send_alert
        send_alert('[選股小幫手] 交易日曆與實際成交不一致',
                   f'日期：{day}\nFinMind 交易日曆顯示休市，但{detail}。\n'
                   '收集器已照常收集這一天；請留意日曆是否有誤（日曆出錯時，下次若資料又晚到，可能被誤判成休市）。')
    except Exception as e:
        logging.warning(f"寄送日曆不一致通知失敗：{e}")


def _has_index_bar(day: str):
    """當天加權指數有沒有 K 棒（1 次 API）；抓取失敗回 None。"""
    try:
        df = _get_api().taiwan_stock_daily(stock_id='TAIEX', start_date=day, end_date=day)
        return df is not None and len(df) > 0
    except Exception as e:
        logging.warning(f"確認休市時抓加權指數失敗，當成不知道、照常收集：{e}")
        return None


def is_market_closed(day: str):
    """回傳 (是否休市, 說明)。只有「日曆說休市」且「加權指數確實沒有資料」兩者都成立才回 True。

    ⚠️ 週末也一律問日曆，不可寫死「週六日不開盤」：2016～2018 年有 8 個補班的週六是交易日
    （例如 2016-01-30、2018-12-22，FinMind 日曆查得到）。
    """
    cal = calendar_status(day)
    if cal is not False:
        return False, ('日曆顯示開盤' if cal else '日曆沒涵蓋或抓不到，照常收集')
    bar = _has_index_bar(day)
    twse = _twse_month(day)
    in_twse = None if twse is None else (day in twse)
    if bar is True or in_twse is True:
        detail = '、'.join(x for x in [('FinMind 加權指數有 K 棒' if bar else ''),
                                       ('證交所成交清單有這天' if in_twse else '')] if x)
        logging.warning(f"⚠️ {day} 日曆顯示休市，但{detail} → 照常收集（日曆可能有誤）")
        _notify_mismatch(day, detail)
        return False, f'日曆顯示休市但{detail}，照常收集'
    if bar is False and in_twse is False:
        return True, '交易日曆顯示休市，加權指數與證交所成交清單也都沒有這天'
    return False, '無法確認是否休市（有來源抓不到），照常收集'


def trading_days_between(start: _date, end: _date, with_actual: bool = False):
    """start～end 之間的交易日（字串、升冪）。

    日曆有涵蓋的日子完全照日曆（包含補班的週六交易日、排除平日休市）；
    日曆沒涵蓋的日子（例如下一年度行事曆還沒公布）退回「週一到五」——寧可多試，也不要漏。
    with_actual=True 時再聯集「同區間加權指數實際有 K 棒的日子」（多 1 次 API）：
    日曆萬一把真的交易日誤標成休市，找缺口時也不會跟著漏掉（寧可多試、不可漏）。
    """
    from datetime import timedelta
    actual = set()
    if with_actual:
        try:
            df = _get_api().taiwan_stock_daily(stock_id='TAIEX', start_date=start.isoformat(), end_date=end.isoformat())
            if df is not None and len(df) and 'date' in df.columns:
                actual = set(df['date'].astype(str))
        except Exception as e:
            logging.warning(f"找缺口時抓加權指數失敗，只用日曆判斷：{e}")
    out, cur = [], start
    while cur <= end:
        s = cur.isoformat()
        st = calendar_status(s)
        if st is True or s in actual or (st is None and cur.weekday() < 5):
            out.append(s)
        cur += timedelta(days=1)
    return out
