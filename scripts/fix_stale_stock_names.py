#!/usr/bin/env python3
"""
一次性修正：daily_data 裡「改過名／轉板的股票」存的是舊股名，改成 FinMind 最新的正式名稱。

背景（2026-11-06）
------------------
FinMind TaiwanStockInfo 對改過名或轉板（創新板 ↔ 一般板）的股票同時留著舊名（舊 date）與新名（當天 date）。
收集器以前 `drop_duplicates(keep='first')` 拿到舊名 → 2026-07-24 起 daily_data 有一批股票一直顯示舊名字
（例：3521 顯示「鴻翊」、現在是「台鋼建設」；6757 顯示「台灣虎航-創」、現在是「台灣虎航」）。
收集器已改成取 date 最新的股名（stock_collector.py `_merge_data`）；這支把既有日期也改過來。

安全設計
--------
* **只改 stock_name**，價格、法人等其他欄位一個字都不動。
* 權威來源是 FinMind TaiwanStockInfo「date 最新」那筆，跟收集器同一條規則。
* FinMind 回 0 筆（API 暫時失敗）→ 整支中止，不改任何東西。
* 預設 DRY-RUN，--write 才實際寫入；寫入前把會動到的 chunks 備份到 logs/。冪等：重跑不會再改。

用法
----
  python3 scripts/fix_stale_stock_names.py            # dry-run：列出會改哪些股票、幾筆
  python3 scripts/fix_stale_stock_names.py --write    # 實際寫入
"""
import sys
import json
import argparse
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import requests
import pandas as pd
from dotenv import dotenv_values


def newest_names() -> dict:
    tok = dotenv_values(ROOT / '.env').get('FINMIND_API_TOKEN')
    r = requests.get('https://api.finmindtrade.com/api/v4/data', params={'dataset': 'TaiwanStockInfo'},
                     headers={'Authorization': f'Bearer {tok}'} if tok else {}, timeout=120)
    rows = (r.json() or {}).get('data') or []
    if not rows:
        raise SystemExit('FinMind TaiwanStockInfo 回 0 筆，中止（不改任何東西）')
    info = pd.DataFrame(rows)
    newest = info.sort_values('date', kind='stable').drop_duplicates('stock_id', keep='last')
    return dict(zip(newest['stock_id'].astype(str), newest['stock_name']))


def main():
    ap = argparse.ArgumentParser(description='daily_data 的舊股名改成 FinMind 最新正式名稱（預設 dry-run）')
    ap.add_argument('--write', action='store_true', help='實際寫入（預設只列出）')
    args = ap.parse_args()

    from firebase_writer import get_firestore_client
    names = newest_names()
    db = get_firestore_client()
    per_stock = Counter(); before_after = {}; days = set(); todo = []
    for day in db.collection('daily_data').stream():
        for ch in day.reference.collection('chunks').stream():
            doc = ch.to_dict() or {}
            stocks = doc.get('stocks', [])
            changed = False
            for s in stocks:
                sid = str(s.get('stock_id'))
                new = names.get(sid)
                if new and s.get('stock_name') != new:
                    before_after.setdefault(sid, (s.get('stock_name'), new))
                    per_stock[sid] += 1; days.add(day.id)
                    if args.write:
                        s['stock_name'] = new
                    changed = True
            if changed:
                todo.append((ch.reference, doc, stocks))

    print(f"會改：{sum(per_stock.values())} 筆、{len(per_stock)} 檔、{len(days)} 天（{min(days) if days else '-'}～{max(days) if days else '-'}）、{len(todo)} 份分片")
    for sid in sorted(per_stock):
        old, new = before_after[sid]
        print(f"  {sid}  {old} → {new}  （{per_stock[sid]} 筆）")
    if not args.write:
        print('\nDRY-RUN：沒有寫入。確認後加 --write。')
        return

    backup = ROOT / 'logs' / f"stale_names_backup_{datetime.now():%Y%m%d_%H%M%S}.json"
    backup.parent.mkdir(exist_ok=True)
    backup.write_text(json.dumps([{'path': ref.path, 'doc': {k: v for k, v in doc.items() if k != 'updated_at'}} for ref, doc, _ in todo],
                                 ensure_ascii=False, default=str))
    for ref, _, stocks in todo:
        ref.update({'stocks': stocks})
    print(f"\n已寫入 {len(todo)} 份分片（備份：{backup}）")


if __name__ == '__main__':
    main()
