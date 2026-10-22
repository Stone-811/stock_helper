#!/usr/bin/env python3
"""
回補外資持股五欄：外資持股比例、外資尚可投資比例、外資投資上限（三個比例），
以及外資持股張數、已發行張數，補進既有的 daily_data。

兩種情境都用這支
----------------
1. 欄位是新加的：收集器 2026-09-28 才開始存「外資持股張數／已發行張數」，之前的日期連 key 都沒有。
2. 當天收集時 FinMind 還沒發布：收集器照規則寫 key + null、回報成功、不告警。
   2026-10-21 就是這樣——22:00 那班跑完時 FinMind 的外資持股還是 0 筆，整個市場五欄都是 null，
   隔天才有資料。（原本 SKILL.md 地雷 #1 認為「22:00 收就沒事」，這天證明不成立。）

安全設計
--------
* 權威來源是 FinMind 該日整批 TaiwanStockShareholding，與收集器同一支 API、同樣的換算：
  三個比例照原值轉數字；兩個張數欄「股 → 張」//1000 向零取整（stock_collector._process_shareholding_data）。
* **「缺」＝沒有 key 或值是 None**，兩者都補；已經有值的一律不動（可重跑、冪等）。
  ⚠️ 只檢查 key 存不存在是不夠的：情境 2 的日子 key 都在、值是 None，presence check 永遠補不到。
* 五欄**各自獨立**：FinMind 某一欄是空的，不會連累其他欄。
* 某日 FinMind 回 0 筆（API 暫時失敗或還沒發布）→ 整日跳過，不會把全市場清成 null。
* 未被 FinMind 涵蓋的股票保持 null（前端顯示「—」），不寫 0。
* 只改 Firestore daily_data，不重跑收集：所以**不會**順便用舊資料檢查到價提醒、
  不會動 MACD／連買天數、不會改年度檔（外資持股沒有被任何年度檔計算用到）。
* 預設 DRY-RUN，--write 才實際寫入；寫入前自動備份原始 chunks 到 logs/。

用法
----
  python3 scripts/backfill_foreign_hold_shares.py                      # 全部日期稽核 + dry-run
  python3 scripts/backfill_foreign_hold_shares.py --date 2026-10-21    # 只看某一天
  python3 scripts/backfill_foreign_hold_shares.py --date 2026-10-21 --write
  python3 scripts/backfill_foreign_hold_shares.py --month 2026-09 --write
"""
import os
import sys
import json
import math
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / '.env')

# 我方欄位 ← FinMind 欄位、型別
FIELDS = {
    'foreign_hold_ratio':   ('ForeignInvestmentSharesRatio', 'ratio'),
    'foreign_remain_ratio': ('ForeignInvestmentRemainRatio', 'ratio'),
    'foreign_limit_ratio':  ('ForeignInvestmentUpperLimitRatio', 'ratio'),
    'foreign_hold_shares':  ('ForeignInvestmentShares', 'lots'),
    'shares_issued':        ('NumberOfSharesIssued', 'lots'),
}


def get_api():
    from FinMind.data import DataLoader
    api = DataLoader()
    token = os.getenv('FINMIND_API_TOKEN', '')
    if token:
        api.login_by_token(api_token=token)
    return api


def _norm_sid(v) -> str:
    """與 firebase_writer._norm_stock_id 同一條規則（0050 曾被讀成 50）。"""
    sid = str(v).strip()
    return sid.zfill(4) if 0 < len(sid) < 4 else sid


def _convert(v, kind):
    """與收集器相同的換算；無法轉數字或是 NaN 一律回 None（不補 0）。"""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(x):
        return None
    return x if kind == 'ratio' else int(x) // 1000   # 股 → 張，向零取整（全站慣例）


def _missing(stock: dict, field: str) -> bool:
    """沒有 key 或值為 None 都算缺。⚠️ 0 不算缺。"""
    return stock.get(field) is None


def fetch_day(api, date):
    """回傳 {stock_id: {欄位: 值}}，只含 FinMind 有值的欄位；抓不到或空的回 None（呼叫端必須跳過）。"""
    try:
        df = api.taiwan_stock_shareholding(start_date=date, end_date=date)
    except Exception as e:
        print(f"    ⚠️ {date} 抓取失敗，跳過：{e}")
        return None
    if df is None or len(df) == 0 or 'stock_id' not in df.columns:
        return None
    present = {f: src for f, (src, _) in FIELDS.items() if src in df.columns}
    if not present:
        print(f"    ⚠️ {date} 五個欄位都不在回傳資料裡，跳過")
        return None
    out = {}
    for _, r in df.iterrows():
        vals = {}
        for f, src in present.items():
            v = _convert(r[src], FIELDS[f][1])
            if v is not None:
                vals[f] = v
        if vals:
            out[_norm_sid(r['stock_id'])] = vals
    return out or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--month', help='只處理該月，格式 YYYY-MM')
    ap.add_argument('--date', help='只處理這一天，格式 YYYY-MM-DD')
    args = ap.parse_args()

    import firebase_writer as fw
    db = fw.get_firestore_client()

    dates = sorted(fw.list_daily_data_dates())
    if args.date:
        dates = [d for d in dates if d == args.date]
    elif args.month:
        dates = [d for d in dates if d.startswith(args.month)]
    if not dates:
        print('沒有符合的日期（daily_data 裡沒有這一天）')
        return 1

    api = get_api()
    backup = ROOT / 'logs' / 'fhs_backfill' / datetime.now().strftime('%Y%m%d_%H%M%S')
    if args.write:
        backup.mkdir(parents=True, exist_ok=True)

    print(f"=== 外資持股五欄回補　{'寫入模式' if args.write else 'DRY-RUN'} ===")
    print(f"日期 {len(dates)} 天：{dates[0]} ~ {dates[-1]}")
    if args.write:
        print(f"備份目錄：{backup}\n")

    tot_stocks = tot_cells = tot_already = tot_nocover = 0
    skipped_days, touched_days = [], []

    for date in dates:
        src = fetch_day(api, date)
        if src is None:
            skipped_days.append(date)
            print(f"  {date}: FinMind 無資料 → 整日跳過")
            continue

        ref = db.collection('daily_data').document(date).collection('chunks')
        n_stocks = n_cells = already = nocover = 0
        for doc in ref.stream():
            data = doc.to_dict() or {}
            stocks = data.get('stocks') or []
            if args.write:
                (backup / date).mkdir(parents=True, exist_ok=True)
                (backup / date / f'{doc.id}.json').write_text(
                    json.dumps(data, ensure_ascii=False, default=str), encoding='utf-8')

            changed = False
            for s in stocks:
                gaps = [f for f in FIELDS if _missing(s, f)]
                if not gaps:
                    already += 1
                    continue
                hit = src.get(str(s.get('stock_id', '')))
                filled = [f for f in gaps if hit and f in hit]
                if not filled:
                    nocover += 1          # FinMind 未涵蓋 → 保持 null，前端顯示「—」
                    continue
                for f in filled:
                    s[f] = hit[f]
                n_stocks += 1
                n_cells += len(filled)
                changed = True

            if changed and args.write:
                ref.document(doc.id).set({
                    'chunk_index': data.get('chunk_index'),
                    'stocks': stocks,
                    'count': data.get('count', len(stocks)),
                })

        tot_stocks += n_stocks
        tot_cells += n_cells
        tot_already += already
        tot_nocover += nocover
        if n_stocks:
            touched_days.append(date)
        flag = '  ← 有缺' if n_stocks else ''
        print(f"  {date}: 補 {n_stocks:5d} 檔（{n_cells:5d} 格）　已齊 {already:5d}　FinMind 未涵蓋 {nocover:4d}{flag}")

    print("\n=== 彙總 ===")
    print(f"  補上：{tot_stocks:,} 檔、{tot_cells:,} 格")
    print(f"  原本就齊：{tot_already:,} 檔")
    print(f"  FinMind 未涵蓋（保持 null，前端顯示「—」）：{tot_nocover:,} 檔")
    print(f"  有缺而被補的日期：{touched_days if touched_days else '無'}")
    if skipped_days:
        print(f"  ⚠️ 整日跳過（FinMind 無資料）：{skipped_days}")
    if not args.write:
        print("\n  這是 DRY-RUN。確認無誤後加 --write。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
