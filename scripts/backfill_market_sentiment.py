"""
一次性回補「市場溫度」歷史（大盤當沖比、融資融券餘額、臺指VIX、美股 VIX）到 Firestore market_sentiment/。

業主 2026-11-05 決定：歷史從 2023-01 起（和網站其他資料一樣）。
  - 當沖與融資：證交所／櫃買官方網站 API，一天 4 次請求、間隔 3 秒 → 2023 年起約 700 個交易日 ≈ 1.5～2.5 小時。
  - 臺指VIX：期交所只保留當月＋前 3 個月，更早的用 FinMind TaiwanOptionVix（每 15 秒一筆，取 13:45:00）
    回補，**只從 2026-03-02 起**，再早沒有免費來源（畫面要寫「本站自 2026-03 起統計」）。
  - 美股 VIX：CBOE 全史 CSV 一次抓，1990 年起都有，從 2023-01-01 起寫。

設計原則（同其他 scripts/）：
  * 預設 DRY-RUN，只抓、只印統計與抽樣，**加 --write 才寫**。
  * 每一天抓到的結果先存到 logs/sentiment_backfill/<run>.jsonl（含 null），中斷可用 --resume 從那裡接著跑、不重抓。
  * 休市／抓不到的日子就是沒有那一列，絕不寫 0。
  * 寫入走 firebase_writer.write_market_sentiment（null-aware、依 date upsert），不會動到已有的其他天。

用法：
  python3 scripts/backfill_market_sentiment.py                       # dry-run，2023-01-01 ～ 今天
  python3 scripts/backfill_market_sentiment.py --start 2026-10-01    # 縮小範圍先試
  python3 scripts/backfill_market_sentiment.py --resume logs/sentiment_backfill/xxx.jsonl --write
"""
import argparse
import json
import logging
import sys
import time
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))  # 只加專案根目錄；加 stock_collector/ 會讓 stock_collector.py 蓋掉同名套件

from stock_collector import sentiment_collector as sc  # noqa: E402
from stock_collector.trading_calendar import trading_days_between  # noqa: E402
from stock_collector import config  # noqa: E402

LOG_DIR = ROOT / 'logs' / 'sentiment_backfill'


def fetch_finmind_taivix(start: str, end: str):
    """FinMind TaiwanOptionVix（15 秒一筆）→ 每天 13:45:00 那筆當收盤。只有 2026-03-02 起。"""
    import requests
    out = {}
    try:
        r = requests.get('https://api.finmindtrade.com/api/v4/data',
                         params={'dataset': 'TaiwanOptionVix', 'start_date': start, 'end_date': end},
                         headers={'Authorization': f'Bearer {config.FINMIND_API_TOKEN}'}, timeout=300)
        j = r.json()
    except Exception as e:
        print(f"  ⚠️ FinMind TaiwanOptionVix 抓取失敗：{e}")
        return out
    if j.get('status') != 200:
        print(f"  ⚠️ FinMind TaiwanOptionVix 回 {j.get('status')} {j.get('msg')}")
        return out
    for row in j.get('data') or []:
        if str(row.get('time', '')).startswith('13:45:00'):
            v = sc._num(row.get('vix'))
            if v is not None:
                out[row['date']] = {'close': v, 'close_1min_avg': None}
    return out


def main():
    ap = argparse.ArgumentParser(description='回補市場溫度歷史（預設 dry-run）')
    ap.add_argument('--start', default='2023-01-01')
    ap.add_argument('--end', default=datetime.now().strftime('%Y-%m-%d'))
    ap.add_argument('--gap', type=float, default=3.0, help='官方站請求間隔秒數')
    ap.add_argument('--resume', help='接續先前的 jsonl（已抓過的日子不重抓）')
    ap.add_argument('--write', action='store_true', help='實際寫入 Firestore')
    a = ap.parse_args()
    logging.basicConfig(level=logging.WARNING)

    days = trading_days_between(date.fromisoformat(a.start), date.fromisoformat(a.end))
    sys.stdout.reconfigure(line_buffering=True)  # 導向檔案時也要看得到進度（審查 S4）
    print(f"區間 {a.start}～{a.end}：交易日曆 {len(days)} 天；模式：{'WRITE' if a.write else 'DRY-RUN'}")

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    done = {}
    log_path = Path(a.resume) if a.resume else LOG_DIR / f"{datetime.now().strftime('%Y%m%d_%H%M%S')}.jsonl"
    if a.resume and log_path.exists():
        skipped = 0
        for line in log_path.read_text().splitlines():
            rec = json.loads(line)
            # days 已是交易日：兩邊都 None（請求失敗）或**單邊缺**（例如證交所偶爾回非 JSON，2026-03-23 實例）都要重抓（審查 S3）
            dt, mg = rec.get('daytrade'), rec.get('margin')
            def _complete(side):
                # 看「值」不看「鍵」：舊版 collect_day 把缺的那一邊存成 null 鍵（2026-03-23 實例），鍵在、值是 None 也算缺
                if not side: return False
                flat = {k: v for k, v in side.items() if k not in ('date', 'today', 'prev')}
                flat.update(side.get('today') or {})
                has_twse = any(k.startswith('twse_') and v is not None for k, v in flat.items())
                has_tpex = any(k.startswith('tpex_') and v is not None for k, v in flat.items())
                return has_twse and has_tpex
            if not (_complete(dt) and _complete(mg)):
                skipped += 1
                continue
            done[rec['date']] = rec
        print(f"接續 {log_path}：已有 {len(done)} 天；{skipped} 天先前沒抓到、會重抓", flush=True)

    # 1. 當沖＋融資（最花時間）
    t0 = time.time()
    with open(log_path, 'a') as f:
        for i, d in enumerate(days):
            if d in done:
                continue
            dt_t = sc.fetch_twse_daytrade(d); time.sleep(a.gap)
            dt_o = sc.fetch_tpex_daytrade(d); time.sleep(a.gap)
            mg_t = sc.fetch_twse_margin(d); time.sleep(a.gap)
            mg_o = sc.fetch_tpex_margin(d); time.sleep(a.gap)
            dt = {'date': d, **(dt_t or {}), **(dt_o or {})} if (dt_t or dt_o) else None
            # 融資存兩組：today＝D 的初值、prev＝官方說的定案值（D-1 的）。寫入前再用 D+1 的 prev 覆蓋 D。
            mg = None
            if mg_t or mg_o:
                mg = {'date': d, 'today': {**((mg_t or {}).get('today') or {}), **((mg_o or {}).get('today') or {})},
                      'prev': {**((mg_t or {}).get('prev') or {}), **((mg_o or {}).get('prev') or {})}}
            rec = {'date': d, 'daytrade': dt, 'margin': mg}
            done[d] = rec
            f.write(json.dumps(rec, ensure_ascii=False) + '\n'); f.flush()
            if (i + 1) % 20 == 0:
                el = time.time() - t0
                print(f"  {i + 1}/{len(days)} {d}  當沖 {'✓' if dt else '－'} 融資 {'✓' if mg else '－'}  已用 {el / 60:.1f} 分")
    daytrade_rows = [done[d]['daytrade'] for d in days if done.get(d, {}).get('daytrade')]
    # 融資：D 的值＝D 的 today，再用 D+1 的 prev（官方定案值）覆蓋；舊格式 jsonl（沒有 today 鍵）直接沿用
    margin_rows = []
    for i, d in enumerate(days):
        mg = done.get(d, {}).get('margin')
        if not mg:
            continue
        if 'today' not in mg:
            margin_rows.append(mg)
            continue
        row = dict(mg['today'])
        nxt = days[i + 1] if i + 1 < len(days) else None
        nmg = done.get(nxt, {}).get('margin') if nxt else None
        if nmg and nmg.get('prev'):
            row.update({k: v for k, v in nmg['prev'].items() if v is not None})
        if row:
            margin_rows.append({'date': d, **row})

    # 2. 臺指VIX：期交所當月＋前 3 個月 ＋ FinMind 補更早（2026-03-02 起）
    taivix = fetch_finmind_taivix(max(a.start, '2026-03-02'), a.end)
    cur = date.fromisoformat(a.end).replace(day=1)
    for _ in range(4):
        taivix.update(sc.fetch_taivix_month(cur.strftime('%Y%m')))   # 官方值覆蓋 FinMind 值
        cur = (cur - timedelta(days=1)).replace(day=1)
        time.sleep(a.gap)
    taivix_rows = [{'date': d, **v} for d, v in sorted(taivix.items()) if a.start <= d <= a.end]

    # 3. 美股 VIX
    cboe = sc.fetch_cboe_vix()
    vix_rows = [{'date': d, **v} for d, v in sorted(cboe.items()) if a.start <= d <= a.end]

    # 統計與抽樣（給業主看的數字）
    print('\n==== 結果 ====')
    miss_dt = [d for d in days if not done.get(d, {}).get('daytrade')]
    miss_mg = [d for d in days if not done.get(d, {}).get('margin')]
    print(f"當沖：{len(daytrade_rows)}/{len(days)} 天有資料；沒有的 {len(miss_dt)} 天：{miss_dt[:15]}{' …' if len(miss_dt) > 15 else ''}")
    half = [r['date'] for r in daytrade_rows if (r.get('twse_buy_pct') is None) != (r.get('tpex_buy_pct') is None)]
    print(f"  只有一邊（上市或上櫃）的：{len(half)} 天 {half[:10]}")
    print(f"融資：{len(margin_rows)}/{len(days)} 天有資料；沒有的 {len(miss_mg)} 天：{miss_mg[:15]}{' …' if len(miss_mg) > 15 else ''}")
    print(f"臺指VIX：{len(taivix_rows)} 天（{taivix_rows[0]['date'] if taivix_rows else '－'}～{taivix_rows[-1]['date'] if taivix_rows else '－'}）")
    print(f"美股 VIX：{len(vix_rows)} 天（{vix_rows[0]['date'] if vix_rows else '－'}～{vix_rows[-1]['date'] if vix_rows else '－'}）")

    def pct(xs):
        xs = sorted(x for x in xs if x is not None)
        if not xs:
            return '－'
        q = lambda p: xs[min(len(xs) - 1, int(p * len(xs)))]
        return f"最低 {xs[0]}、中位 {q(.5)}、最高 {xs[-1]}（{len(xs)} 天）"
    print(f"  上市當沖占成交金額：{pct([r['twse_buy_pct'] for r in daytrade_rows])}")
    print(f"  上櫃當沖占成交金額：{pct([r['tpex_buy_pct'] for r in daytrade_rows])}")
    print(f"  上市融資餘額（億元）：{pct([round(r['twse_margin_balance'] / 1e5, 1) for r in margin_rows if r.get('twse_margin_balance')])}")
    print(f"  上櫃融資餘額（億元）：{pct([round(r['tpex_margin_balance'] / 1e5, 1) for r in margin_rows if r.get('tpex_margin_balance')])}")
    print(f"  臺指VIX 收盤：{pct([r['close'] for r in taivix_rows])}")
    print(f"  美股 VIX 收盤：{pct([r['close'] for r in vix_rows])}")
    print('抽樣（最近 3 天）：')
    for r in daytrade_rows[-3:]:
        print('  當沖', r)
    for r in margin_rows[-3:]:
        print('  融資', r)
    print(f"逐日結果檔：{log_path}")

    if not a.write:
        print('\nDRY-RUN：沒有寫入。確認數字後加 --write。')
        return 0
    from firebase_writer import write_market_sentiment
    n = 0
    n += write_market_sentiment('daytrade', daytrade_rows)
    n += write_market_sentiment('margin', margin_rows)
    n += write_market_sentiment('taivix', taivix_rows)
    n += write_market_sentiment('vix', vix_rows)
    print(f"✅ 已寫入 {n} 列")
    return 0


if __name__ == '__main__':
    sys.exit(main())
