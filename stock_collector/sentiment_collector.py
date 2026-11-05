"""
市場溫度收集器：大盤當沖比例、融資融券餘額、恐慌指數。

業主 2026-11-05 要的新分頁「市場溫度」用的資料，全部抓**官方**來源，不用 FinMind：
  - 當沖：證交所 TWTB4U（上市）、櫃買 intraday/stat（上櫃）的「當日沖銷交易統計資訊」。
    主數字＝**成交金額（買進）占比**，就是新聞說的「當沖比」；股數占比另存，分母含 ETF／權證會亂跳。
  - 融資融券：證交所 MI_MARGN（selectType=MS）、櫃買 margin/balance 的合計列。
  - 台股恐慌指數（臺指VIX）：期交所 log2data_eng/YYYYMMnew.txt 的 Daily Index（13:45 收盤）。
  - 美股恐慌指數（VIX）：CBOE VIX_History.csv（美東日期；台灣 10:21 才有前一晚的值）。

為什麼不用 FinMind 自己加總（2026-11-05 四位研究者實測）：
  FinMind 個股當沖的分子跟官方逐檔 0 差異，但「全市場分母」拿不到——它的 TPEx 指數列只含上櫃股票，
  算出來 58%，官方是 55.92%；本站 daily_data 又只留 4 碼代號，會丟掉 351 檔 ETF 的當沖。

⚠️ 三條鐵則（跟全站一樣）
  1. 休市、颱風停市、「當天還沒公布」三種情況官方回應**長得一模一樣**（stat OK＋空表）。
     空就回 None、不寫，**絕不寫 0**。表要用標題找，不可直接取 tables[0]。
  2. 期交所舊月份是 302 → 404.htm，跟著轉址會拿到 HTTP 200 的 HTML；期交所查沒資料的日期也回 200 HTML。
     一律看內容（第一行表頭、8 碼日期），不看狀態碼——CLAUDE.md「HTTP 200 不等於成功」同一類陷阱。
  3. 官方當沖統計 T+2 才定案（實測 T 日值與最終值 0 差異，但官方明說以 T+2 為準），
     每次都重抓最近 3 個交易日；上一班漏抓的也會順便補上。

公布時間（2026-11-05 量到之前的已知）：當沖與融資都是「當日晚間」，17:00 那班通常還沒有（會寫 None 跳過），
22:00 那班有；臺指VIX 16:10 就有；CBOE 台灣 10:21。確切幾點見 skill「大盤當沖比例與恐慌指數」一節。

存放：Firestore `market_sentiment/{doc}`（單一文件＋history 陣列，依 date upsert，同 market_index 的寫法；
writer 在 firebase_writer.write_market_sentiment，**null-aware**，不用 write_market_index 那支——它會把缺欄位寫成 0）。
  - daytrade：{date, twse_buy_pct, twse_sell_pct, twse_shares_pct, twse_dt_shares, twse_buy_amount, twse_sell_amount,
               tpex_buy_pct, tpex_sell_pct, tpex_shares_pct, tpex_dt_shares, tpex_buy_amount, tpex_sell_amount}
  - margin：  {date, twse_margin_balance（仟元）, twse_margin_lots（張）, twse_short_lots（張）,
               tpex_margin_balance（仟元）, tpex_margin_lots, tpex_short_lots}
  - taivix：  {date, close, close_1min_avg}
  - vix：     {date（美東）, open, high, low, close}
  上市／上櫃任一邊抓不到就那幾欄是 None；整天兩邊都沒有就不寫那一天。
"""
import csv
import io
import logging
import re
import time
from datetime import date as _date, datetime, timedelta

import requests

try:
    from . import config  # noqa: F401  （保留：與其他收集器一致，未來要用 token 時直接取）
except ImportError:  # 直接執行或從 scripts/ 匯入時
    import config  # type: ignore  # noqa: F401

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'}
TIMEOUT = 60
# 官方站連續請求要留間隔，回補幾百天時尤其重要（研究者間隔 3 秒抓了 200 多次沒被擋）
REQUEST_GAP = 3.0
# 每次重抓最近幾個交易日（T+2 定案 ＋ 補前一班漏掉的）
RECHECK_DAYS = 3

TWSE_DAYTRADE = 'https://www.twse.com.tw/rwd/zh/dayTrading/TWTB4U'
TWSE_MARGIN = 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN'
TPEX_DAYTRADE = 'https://www.tpex.org.tw/www/zh-tw/intraday/stat'
TPEX_MARGIN = 'https://www.tpex.org.tw/www/zh-tw/margin/balance'
TAIFEX_VIX = 'https://www.taifex.com.tw/file/taifex/Dailydownload/vix/log2data_eng/{yyyymm}new.txt'
CBOE_VIX = 'https://cdn.cboe.com/api/global/us_indices/daily_prices/VIX_History.csv'


# --------------------------------------------------------------------- 小工具

def _num(s):
    """官方表格的數字字串（含千分位逗號、% 號、空白）→ float；空的或不是數字回 None。"""
    if s is None:
        return None
    t = str(s).replace(',', '').replace('%', '').strip()
    if t in ('', '-', '--'):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _get_json(url, params):
    r = requests.get(url, params=params, headers=UA, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def _find_table(j, keyword):
    """在證交所／櫃買的 tables 裡用標題找表；找不到回 None。
    ⚠️ 不可直接取 tables[0]：休市或還沒公布時 tables[0] 可能是空物件或標的清單。"""
    for t in j.get('tables') or []:
        if keyword in str(t.get('title') or '') and t.get('data'):
            return t
    return None


def _roc_date(s):
    """'115/11/04' 或 '1151104' → '2026-11-04'；解析失敗回 None。"""
    m = re.match(r'^\s*(\d{2,3})/(\d{1,2})/(\d{1,2})\s*$', str(s))
    if m:
        y, mo, d = m.groups()
    else:
        m = re.match(r'^\s*(\d{3})(\d{2})(\d{2})\s*$', str(s))
        if not m:
            return None
        y, mo, d = m.groups()
    return f'{int(y) + 1911:04d}-{int(mo):02d}-{int(d):02d}'


# --------------------------------------------------------------------- 當沖

def fetch_twse_daytrade(day: str):
    """證交所上市當沖統計（一天）。回 dict 或 None（休市／未公布／抓不到）。

    tables 裡標題含「當日沖銷交易統計資訊」的那張，fields：
    總成交股數、股數占比、總買進金額、買進占比、總賣出金額、賣出占比。
    占比是官方**無條件捨去**到小數 2 位的字串，照存，不自己重算。
    """
    try:
        j = _get_json(TWSE_DAYTRADE, {'date': day.replace('-', ''), 'selectType': 'All', 'response': 'json'})
    except Exception as e:
        logging.warning(f"證交所當沖 {day} 抓取失敗：{e}")
        return None
    t = _find_table(j, '當日沖銷交易統計')
    if not t:
        return None
    row = t['data'][0]
    if len(row) < 6:
        return None
    out = {
        'twse_dt_shares': _num(row[0]), 'twse_shares_pct': _num(row[1]),
        'twse_buy_amount': _num(row[2]), 'twse_buy_pct': _num(row[3]),
        'twse_sell_amount': _num(row[4]), 'twse_sell_pct': _num(row[5]),
    }
    return out if out['twse_buy_pct'] is not None else None


def fetch_tpex_daytrade(day: str):
    """櫃買上櫃當沖統計（一天）。⚠️ 一定要帶 type=Daily，不然回「參數輸入錯誤」。
    占比字串帶 %（例如 "24.40%"），_num 會去掉。"""
    y, m, d = day.split('-')
    try:
        j = _get_json(TPEX_DAYTRADE, {'type': 'Daily', 'date': f'{y}/{m}/{d}', 'response': 'json'})
    except Exception as e:
        logging.warning(f"櫃買當沖 {day} 抓取失敗：{e}")
        return None
    # 櫃買的表標題是「現股當沖交易統計資訊」（證交所叫「當日沖銷交易統計資訊」），找「當沖交易統計」兩邊都中
    t = _find_table(j, '當沖交易統計')
    if not t:
        return None
    row = t['data'][0]
    if len(row) < 6:
        return None
    out = {
        'tpex_dt_shares': _num(row[0]), 'tpex_shares_pct': _num(row[1]),
        'tpex_buy_amount': _num(row[2]), 'tpex_buy_pct': _num(row[3]),
        'tpex_sell_amount': _num(row[4]), 'tpex_sell_pct': _num(row[5]),
    }
    return out if out['tpex_buy_pct'] is not None else None


# --------------------------------------------------------------------- 融資融券

def fetch_twse_margin(day: str):
    """證交所上市信用交易統計（合計）。
    tables[標題含「信用交易統計」] 三列：融資(交易單位)、融券(交易單位)、融資金額(仟元)；
    欄位：項目、買進、賣出、現金(券)償還、前日餘額、今日餘額。取「今日餘額」。"""
    try:
        j = _get_json(TWSE_MARGIN, {'date': day.replace('-', ''), 'selectType': 'MS', 'response': 'json'})
    except Exception as e:
        logging.warning(f"證交所融資 {day} 抓取失敗：{e}")
        return None
    t = _find_table(j, '信用交易統計')
    if not t:
        return None
    rows = {str(r[0]).strip(): r for r in t['data'] if r}
    lots = rows.get('融資(交易單位)')
    short = rows.get('融券(交易單位)')
    amt = rows.get('融資金額(仟元)')
    if not (lots and short and amt) or len(amt) < 6:
        return None
    out = {
        'twse_margin_lots': _num(lots[5]), 'twse_short_lots': _num(short[5]),
        'twse_margin_balance': _num(amt[5]),
    }
    return out if out['twse_margin_balance'] is not None else None


def fetch_tpex_margin(day: str):
    """櫃買上櫃融資融券餘額（合計列在 summary）。
    summary[0]＝合計(張)：[.., '合計(張)', 前資餘額, 資買, 資賣, 現償, 資餘額, .., .., .., 前券餘額, 券賣, 券買, 券償, 券餘額, ...]
    summary[1]＝融資金(仟元)：[.., '融資金(仟元)', 前日, 買, 賣, 償, 餘額, ...]"""
    y, m, d = day.split('-')
    try:
        j = _get_json(TPEX_MARGIN, {'date': f'{y}/{m}/{d}', 'response': 'json'})
    except Exception as e:
        logging.warning(f"櫃買融資 {day} 抓取失敗：{e}")
        return None
    t = _find_table(j, '融資融券餘額')
    if not t:
        return None
    summ = {str(r[1]).strip(): r for r in (t.get('summary') or []) if len(r) > 6}
    lots = summ.get('合計(張)')
    amt = summ.get('融資金(仟元)')
    if not (lots and amt) or len(lots) < 15:
        return None
    out = {
        'tpex_margin_lots': _num(lots[6]), 'tpex_short_lots': _num(lots[14]),
        'tpex_margin_balance': _num(amt[6]),
    }
    return out if out['tpex_margin_balance'] is not None else None


# --------------------------------------------------------------------- 恐慌指數

def fetch_taivix_month(yyyymm: str):
    """期交所臺指VIX 月檔（英文版，ASCII）→ {date: {close, close_1min_avg}}。
    ⚠️ 不跟隨轉址（舊月份 302 → 404.htm 是 HTML）；回來的內容第一行必須是 'Date' 表頭，否則當成沒有。
    官方只保留當月＋前 3 個月。"""
    try:
        r = requests.get(TAIFEX_VIX.format(yyyymm=yyyymm), headers=UA, timeout=TIMEOUT, allow_redirects=False)
    except Exception as e:
        logging.warning(f"期交所臺指VIX {yyyymm} 抓取失敗：{e}")
        return {}
    if r.status_code != 200 or not r.text.lstrip().startswith('Date'):
        return {}
    out = {}
    for line in r.text.splitlines()[2:]:
        parts = line.split()
        if len(parts) < 4 or not re.match(r'^\d{8}$', parts[0]):
            continue
        d = f'{parts[0][:4]}-{parts[0][4:6]}-{parts[0][6:]}'
        close, avg = _num(parts[2]), _num(parts[3])
        if close is None:
            continue
        out[d] = {'close': close, 'close_1min_avg': avg}
    return out


def fetch_cboe_vix():
    """CBOE VIX 全史 CSV → {date(美東, YYYY-MM-DD): {open, high, low, close}}。要跟隨轉址（307 → cdn-api）。"""
    try:
        r = requests.get(CBOE_VIX, headers=UA, timeout=120, allow_redirects=True)
        r.raise_for_status()
    except Exception as e:
        logging.warning(f"CBOE VIX 抓取失敗：{e}")
        return {}
    out = {}
    for row in csv.DictReader(io.StringIO(r.text)):
        try:
            d = datetime.strptime(row['DATE'].strip(), '%m/%d/%Y').strftime('%Y-%m-%d')
        except (KeyError, ValueError):
            continue
        vals = {k.lower(): _num(row.get(k)) for k in ('OPEN', 'HIGH', 'LOW', 'CLOSE')}
        if vals['close'] is None:
            continue
        out[d] = vals
    return out


# --------------------------------------------------------------------- 組合

def collect_day(day: str, gap: float = REQUEST_GAP):
    """抓一個交易日的當沖＋融資（上市＋上櫃）。回 (daytrade_row|None, margin_row|None)。
    任一邊沒有就那幾欄 None；兩邊都沒有就整列 None（呼叫端不寫）。"""
    dt_t = fetch_twse_daytrade(day); time.sleep(gap)
    dt_o = fetch_tpex_daytrade(day); time.sleep(gap)
    mg_t = fetch_twse_margin(day); time.sleep(gap)
    mg_o = fetch_tpex_margin(day); time.sleep(gap)
    daytrade = None
    if dt_t or dt_o:
        daytrade = {'date': day}
        daytrade.update(dt_t or {k: None for k in ('twse_dt_shares', 'twse_shares_pct', 'twse_buy_amount', 'twse_buy_pct', 'twse_sell_amount', 'twse_sell_pct')})
        daytrade.update(dt_o or {k: None for k in ('tpex_dt_shares', 'tpex_shares_pct', 'tpex_buy_amount', 'tpex_buy_pct', 'tpex_sell_amount', 'tpex_sell_pct')})
    margin = None
    if mg_t or mg_o:
        margin = {'date': day}
        margin.update(mg_t or {k: None for k in ('twse_margin_lots', 'twse_short_lots', 'twse_margin_balance')})
        margin.update(mg_o or {k: None for k in ('tpex_margin_lots', 'tpex_short_lots', 'tpex_margin_balance')})
    return daytrade, margin


def recent_trading_days(day: str, n: int = RECHECK_DAYS):
    """day 以及往前共 n 個交易日（升冪）。用 trading_calendar，不可用日曆天。"""
    try:
        from .trading_calendar import trading_days_between
    except ImportError:
        from trading_calendar import trading_days_between  # type: ignore
    end = _date.fromisoformat(day)
    days = trading_days_between(end - timedelta(days=n * 3 + 7), end)
    return days[-n:] if days else [day]


def collect_and_save(day: str = None, write: bool = True):
    """每日排程用：重抓最近 RECHECK_DAYS 個交易日的當沖與融資、當月臺指VIX、CBOE VIX，寫入 Firestore。
    回傳 {'daytrade': n, 'margin': n, 'taivix': n, 'vix': n}（各寫了幾天）。
    沒有任何一項有新資料不算失敗（17:00 那班本來就常常還沒公布）。"""
    day = day or datetime.now().strftime('%Y-%m-%d')
    days = recent_trading_days(day)
    logging.info(f"🌡️ 市場溫度：重抓 {days[0]}～{days[-1]}（{len(days)} 個交易日）")

    daytrade_rows, margin_rows = [], []
    for d in days:
        dt, mg = collect_day(d)
        if dt:
            daytrade_rows.append(dt)
        if mg:
            margin_rows.append(mg)
        logging.info(f"  {d}：當沖 {'有' if dt else '無'}（上市 {dt and dt.get('twse_buy_pct')}%／上櫃 {dt and dt.get('tpex_buy_pct')}%）"
                     f"、融資 {'有' if mg else '無'}")

    # 臺指VIX：當月＋上個月（跨月那幾天上個月檔也可能才補齊）
    taivix = {}
    for ym in sorted({days[0][:7].replace('-', ''), days[-1][:7].replace('-', '')}):
        taivix.update(fetch_taivix_month(ym))
        time.sleep(REQUEST_GAP)
    taivix_rows = [{'date': d, **v} for d, v in sorted(taivix.items())]
    logging.info(f"  臺指VIX：{len(taivix_rows)} 天（最新 {taivix_rows[-1] if taivix_rows else '無'}）")

    # CBOE：整份 CSV 幾百 KB，只寫最近 10 天（全史回補另外走 scripts/）
    cboe = fetch_cboe_vix()
    vix_rows = [{'date': d, **v} for d, v in sorted(cboe.items())][-10:]
    logging.info(f"  美股 VIX：{len(vix_rows)} 天（最新 {vix_rows[-1] if vix_rows else '無'}）")

    counts = {'daytrade': len(daytrade_rows), 'margin': len(margin_rows), 'taivix': len(taivix_rows), 'vix': len(vix_rows)}
    if write and config.firebase_enabled():
        import sys
        from pathlib import Path
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from firebase_writer import write_market_sentiment
        write_market_sentiment('daytrade', daytrade_rows)
        write_market_sentiment('margin', margin_rows)
        write_market_sentiment('taivix', taivix_rows)
        write_market_sentiment('vix', vix_rows)
    elif write:
        logging.warning("未設定 Firebase，市場溫度跳過寫入")
    return counts


if __name__ == '__main__':
    import argparse
    import json
    ap = argparse.ArgumentParser(description='市場溫度收集器（當沖比、融資融券、恐慌指數）')
    ap.add_argument('--date', help='指定日期 YYYY-MM-DD（預設今天）')
    ap.add_argument('--dry-run', action='store_true', help='只抓不寫，印出抓到的數字')
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    print(json.dumps(collect_and_save(a.date, write=not a.dry_run), ensure_ascii=False))
