#!/usr/bin/env python3
"""
清理 daily_data 的重複列與殘留分片。

背景（2026-10-22 發現）
----------------------
* 07-24～07-31：每天 3,216 列、只有 2,339 檔不重複（794 檔存了兩份），摘要 chunk_count=7。
  兩份數值完全相同，只差在兩個「標籤」欄位：產業別（792 檔；FinMind taiwan_stock_info 同一檔可能列在
  兩個產業分類，例如「電子工業」與「電子零組件業」，當時合併沒去重）與股名（37 檔，改名前後）。
* 08-03：摘要寫 5 片，實際有 7 片——chunk_5／chunk_6 是更早那次寫入的殘留。
  根因：firebase_writer.write_daily_stocks() 重寫時不刪除編號 ≥ n 的舊分片（已一併修正）。
網站照 chunk_count 讀並依代號去重，所以畫面不受影響；但用 stream() 掃全部分片的
Python 工具會讀到重複，統計會算錯。

安全設計
--------
* 同一檔的多份資料，**除了股名、產業別這兩個標籤欄位以外，任何欄位不一致就不動那一天**，只回報——
  數值不一致時不替使用者猜哪份是對的。
* 股名或產業別不同時，取「最新交易日」那天的值（＝現在的名字與分類，與其他日子一致）；
  最新日沒有這檔、或最新日的值不在這幾份之中，才保留第一份。
* 保留原本的列順序，分片方式與 write_daily_stocks 相同（每片 500 筆）。
* 預設 DRY-RUN；--write 前把摘要與全部分片備份到 logs/dedupe_backup/。
* 寫完立刻重讀驗證：列數＝不重複檔數、分片數＝chunk_count、每檔數值與清理前相同。

用法
----
  python3 scripts/dedupe_daily_data.py                    # 全部日期檢查（只預覽）
  python3 scripts/dedupe_daily_data.py --write            # 實際清理
  python3 scripts/dedupe_daily_data.py --date 2026-08-03 --write
"""
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / '.env')

CHUNK_SIZE = 500   # 與 firebase_writer.CHUNK_SIZE 相同


def read_day(db, date):
    """回傳 (摘要 dict, [(分片 id, 分片 dict)] 依編號排序)。"""
    summ_ref = db.collection('daily_data').document(date)
    summ = summ_ref.get().to_dict() or {}
    chunks = []
    for doc in summ_ref.collection('chunks').stream():
        try:
            idx = int(doc.id.split('_')[-1])
        except ValueError:
            idx = 10 ** 6
        chunks.append((idx, doc.id, doc.to_dict() or {}))
    chunks.sort()
    return summ, [(cid, data) for _, cid, data in chunks]


LABELS = ('stock_name', 'industry')   # 允許不同、由參考日決定的標籤欄位


def plan_day(summ, chunks, ref):
    """回傳 (清理後的列, 問題說明 or None, 統計)。問題不為 None 時不可寫入。"""
    rows = [s for _, data in chunks for s in (data.get('stocks') or [])]
    groups = {}
    order = []
    for r in rows:
        sid = str(r.get('stock_id', ''))
        if sid not in groups:
            groups[sid] = []
            order.append(sid)
        groups[sid].append(r)

    out, name_fix, conflicts = [], 0, []
    for sid in order:
        copies = groups[sid]
        base = copies[0]
        for other in copies[1:]:
            keys = (set(base) | set(other)) - set(LABELS)
            diff = [k for k in keys if base.get(k) != other.get(k)]
            if diff:
                conflicts.append((sid, diff[:5]))
        keep = dict(base)
        for f in LABELS:
            vals = [c.get(f) for c in copies]
            if len(set(map(str, vals))) > 1:
                if f == 'stock_name':
                    name_fix += 1
                want = (ref.get(sid) or {}).get(f)
                keep[f] = want if want in vals else base.get(f)
        out.append(keep)

    stats = {
        '列數': len(rows), '不重複': len(out), '重複檔數': sum(1 for v in groups.values() if len(v) > 1),
        '分片實際': len(chunks), '摘要片數': summ.get('chunk_count'), '摘要檔數': summ.get('stock_count'),
        '股名不同': name_fix,
    }
    problem = f"同一檔的多份資料數值不一致（{len(conflicts)} 檔，例 {conflicts[:3]}），不自動處理" if conflicts else None
    return out, problem, stats


def needs_fix(stats):
    want_chunks = (stats['不重複'] + CHUNK_SIZE - 1) // CHUNK_SIZE
    return (stats['列數'] != stats['不重複'] or stats['分片實際'] != want_chunks
            or stats['摘要片數'] != want_chunks or stats['摘要檔數'] != stats['不重複'])


def write_day(db, date, summ, chunks, rows, backup_dir):
    summ_ref = db.collection('daily_data').document(date)
    (backup_dir / date).mkdir(parents=True, exist_ok=True)
    (backup_dir / date / '_summary.json').write_text(json.dumps(summ, ensure_ascii=False, default=str), encoding='utf-8')
    for cid, data in chunks:
        (backup_dir / date / f'{cid}.json').write_text(json.dumps(data, ensure_ascii=False, default=str), encoding='utf-8')

    parts = [rows[i:i + CHUNK_SIZE] for i in range(0, len(rows), CHUNK_SIZE)]
    batch = db.batch()
    for i, part in enumerate(parts):
        batch.set(summ_ref.collection('chunks').document(f'chunk_{i}'),
                  {'chunk_index': i, 'stocks': part, 'count': len(part)})
    keep_ids = {f'chunk_{i}' for i in range(len(parts))}
    for cid, _ in chunks:
        if cid not in keep_ids:
            batch.delete(summ_ref.collection('chunks').document(cid))
    batch.update(summ_ref, {'stock_count': len(rows), 'chunk_count': len(parts)})
    batch.commit()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--date')
    args = ap.parse_args()

    import firebase_writer as fw
    db = fw.get_firestore_client()
    dates = sorted(fw.list_daily_data_dates())
    latest = dates[-1]
    if args.date:
        dates = [d for d in dates if d == args.date]

    # 參考值：最新交易日的股名與產業別＝現在的名字與分類
    _, lchunks = read_day(db, latest)
    ref = {str(s.get('stock_id')): {f: s.get(f) for f in LABELS} for _, d in lchunks for s in (d.get('stocks') or [])}

    backup = ROOT / 'logs' / 'dedupe_backup' / datetime.now().strftime('%Y%m%d_%H%M%S')
    print(f"=== daily_data 重複列與殘留分片清理　{'寫入模式' if args.write else 'DRY-RUN'} ===")
    print(f"日期 {len(dates)} 天；股名參考日 {latest}")
    todo, blocked = [], []
    for date in dates:
        summ, chunks = read_day(db, date)
        rows, problem, st = plan_day(summ, chunks, ref)
        if not needs_fix(st):
            continue
        tag = f"  {date}: 列數 {st['列數']} → {st['不重複']}（重複 {st['重複檔數']} 檔、股名不同 {st['股名不同']}）　分片 {st['分片實際']} 片（摘要寫 {st['摘要片數']}）→ {(st['不重複'] + CHUNK_SIZE - 1) // CHUNK_SIZE}"
        if problem:
            blocked.append(date); print(tag + f'　⛔ {problem}'); continue
        todo.append(date); print(tag)
        if args.write:
            before = {str(r['stock_id']): r for r in rows}
            write_day(db, date, summ, chunks, rows, backup)
            summ2, chunks2 = read_day(db, date)
            rows2 = [s for _, d in chunks2 for s in (d.get('stocks') or [])]
            ids2 = [str(r['stock_id']) for r in rows2]
            after = {str(r['stock_id']): r for r in rows2}
            ok = (len(ids2) == len(set(ids2)) == len(rows) and len(chunks2) == summ2.get('chunk_count')
                  and summ2.get('stock_count') == len(rows) and after == before)
            print(f"      寫入後驗證：{'✓ 列數、分片數、摘要、每檔數值都正確' if ok else '✗ 驗證失敗，請用備份還原：' + str(backup / date)}")
            if not ok:
                return 1
    print(f"\n需要清理 {len(todo)} 天：{todo}")
    if blocked:
        print(f"⛔ 數值不一致、未處理 {len(blocked)} 天：{blocked}")
    if args.write and todo:
        print(f"備份目錄：{backup}")
    if not args.write:
        print("\n這是 DRY-RUN。確認無誤後加 --write。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
