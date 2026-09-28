#!/usr/bin/env python3
"""
一次性回補：把外資持股張數（foreign_hold_shares）與已發行張數（shares_issued）
補進既有的 daily_data，讓「月度強勢商品篩選」頁面不必等新資料累積。

背景
----
收集器原本只保留 TaiwanStockShareholding 的三個「比例」欄位，2026-09-28 才加上
ForeignInvestmentShares（外資持股股數）與 NumberOfSharesIssued（已發行股數）。
新程式只對之後的收集生效，既有日期沒有這兩欄 → 月報的「籌碼(外資)」整欄會是「—」。

安全設計
--------
* 權威來源是 FinMind 該日整批 TaiwanStockShareholding，與收集器同一支 API、同樣的
  股→張換算（//1000 向零取整）。
* **只補「目前沒有這兩個欄位」的股票**；已有值的一律不動（可重跑、冪等）。
* 某日 FinMind 回 0 筆（API 暫時失敗）→ 整日跳過，不會把全市場清成 null。
* 未被 FinMind 涵蓋的股票**保持沒有這個欄位**（前端顯示「—」），不寫 0。
* 預設 DRY-RUN，--write 才實際寫入；寫入前自動備份原始 chunks 到 logs/。

用法
----
  python3 scripts/backfill_foreign_hold_shares.py                 # 稽核 + dry-run
  python3 scripts/backfill_foreign_hold_shares.py --write         # 實際回補
  python3 scripts/backfill_foreign_hold_shares.py --month 2026-09 --write
"""
import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / '.env')

FIELDS = ('foreign_hold_shares', 'shares_issued')


def get_api():
    from FinMind.data import DataLoader
    api = DataLoader()
    token = os.getenv('FINMIND_API_TOKEN', '')
    if token:
        api.login_by_token(api_token=token)
    return api


def fetch_day(api, date):
    """回傳 {stock_id: (外資持股張, 發行張)}；抓不到或空的回 None（呼叫端必須跳過）。"""
    try:
        df = api.taiwan_stock_shareholding(start_date=date, end_date=date)
    except Exception as e:
        print(f"    ⚠️ {date} 抓取失敗，跳過：{e}")
        return None
    if df is None or len(df) == 0:
        return None
    need = {'stock_id', 'ForeignInvestmentShares', 'NumberOfSharesIssued'}
    if not need.issubset(set(df.columns)):
        print(f"    ⚠️ {date} 欄位不全（{sorted(set(df.columns) & need)}），跳過")
        return None
    out = {}
    for _, r in df.iterrows():
        sid = str(r['stock_id']).strip()
        if 0 < len(sid) < 4:          # 與 firebase_writer._norm_stock_id 同一條規則
            sid = sid.zfill(4)
        def lots(v):
            try:
                n = int(v)
            except (TypeError, ValueError):
                return None
            return n // 1000          # 股 → 張，向零取整（全站慣例）
        hs, iss = lots(r['ForeignInvestmentShares']), lots(r['NumberOfSharesIssued'])
        if hs is not None and iss is not None:
            out[sid] = (hs, iss)
    return out or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--month', help='只處理該月，格式 YYYY-MM')
    args = ap.parse_args()

    import firebase_writer as fw
    db = fw.get_firestore_client()

    dates = sorted(fw.list_daily_data_dates())
    if args.month:
        dates = [d for d in dates if d.startswith(args.month)]
    if not dates:
        print('沒有符合的日期')
        return 1

    api = get_api()
    backup = ROOT / 'logs' / 'fhs_backfill' / datetime.now().strftime('%Y%m%d_%H%M%S')
    if args.write:
        backup.mkdir(parents=True, exist_ok=True)

    print(f"=== 外資持股張數回補　{'寫入模式' if args.write else 'DRY-RUN'} ===")
    print(f"日期 {len(dates)} 天：{dates[0]} ~ {dates[-1]}")
    if args.write:
        print(f"備份目錄：{backup}\n")

    tot_filled = tot_skipped = tot_already = 0
    skipped_days = []

    for date in dates:
        src = fetch_day(api, date)
        if src is None:
            skipped_days.append(date)
            print(f"  {date}: FinMind 無資料 → 整日跳過")
            continue

        ref = db.collection('daily_data').document(date).collection('chunks')
        filled = already = nocover = 0
        for doc in ref.stream():
            data = doc.to_dict() or {}
            stocks = data.get('stocks') or []
            if args.write:
                (backup / date).mkdir(parents=True, exist_ok=True)
                (backup / date / f'{doc.id}.json').write_text(
                    json.dumps(data, ensure_ascii=False, default=str), encoding='utf-8')

            changed = False
            for s in stocks:
                sid = str(s.get('stock_id', ''))
                if all(f in s for f in FIELDS):
                    already += 1
                    continue
                hit = src.get(sid)
                if hit is None:
                    nocover += 1          # FinMind 未涵蓋 → 保持沒有欄位，前端顯示「—」
                    continue
                s['foreign_hold_shares'], s['shares_issued'] = hit
                filled += 1
                changed = True

            if changed and args.write:
                ref.document(doc.id).set({
                    'chunk_index': data.get('chunk_index'),
                    'stocks': stocks,
                    'count': data.get('count', len(stocks)),
                })

        tot_filled += filled
        tot_already += already
        tot_skipped += nocover
        print(f"  {date}: 補 {filled:5d} 檔　已有 {already:5d}　FinMind 未涵蓋 {nocover:4d}")

    print("\n=== 彙總 ===")
    print(f"  補上欄位：{tot_filled:,} 檔")
    print(f"  原本就有：{tot_already:,} 檔")
    print(f"  FinMind 未涵蓋（保持無欄位，前端顯示「—」）：{tot_skipped:,} 檔")
    if skipped_days:
        print(f"  ⚠️ 整日跳過（FinMind 無資料）：{skipped_days}")
    if not args.write:
        print("\n  這是 DRY-RUN。確認無誤後加 --write。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
