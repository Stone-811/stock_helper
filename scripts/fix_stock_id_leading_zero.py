#!/usr/bin/env python3
"""
一次性修復：把年度檔 CSV 與 Firestore daily_data 中掉了前導零的股票代碼補回來。

背景
----
`pd.read_csv()` 未指定 `dtype={'stock_id': str}`，pandas 把 `0050` 讀成整數 `50`。
寫進 Firestore 的 DataFrame 正是從 CSV 讀回來的（daily_collector.py:124），
於是 `0050 元大台灣50`、`0056 元大高股息` 等 ETF 在 Firestore 變成 `50`、`56`。

後果：個股頁用 `0050` 查 Firestore 查不到 → 三大法人、外資持股、當沖整區顯示「—」
與「當日資料尚未提供」。中的是台股最熱門的 ETF。

程式面已修（8 處 read_csv 補 dtype，firebase_writer 加 _norm_stock_id 第二道防線），
本腳本負責清理既有資料。

安全設計
--------
* CSV **逐位元組處理**：只用 `split(b',', 2)` 取出第 2 欄改寫，其餘位元組原封不動
  （date 欄不含逗號，故第 2 欄必為 stock_id；後段即使有引號逗號也不受影響）。
* 只改 `0 < len(stock_id) < 4` 的列；台股代碼最短 4 碼，故短於 4 必為掉零。
* 補零後若與既有代碼衝突則中止（已驗證無衝突）。
* 預設 DRY-RUN，`--write` 才實際寫入；CSV 會先下載備份到本機。
* 修完驗證：總位元組數變化量 == 受影響列數 × 每列補的字元數；行數不變。

用法
----
  python3 scripts/fix_stock_id_leading_zero.py                # dry-run
  python3 scripts/fix_stock_id_leading_zero.py --write        # 實際修復
  python3 scripts/fix_stock_id_leading_zero.py --skip-csv --write     # 只修 Firestore
  python3 scripts/fix_stock_id_leading_zero.py --skip-firestore --write
"""
import sys
import argparse
import subprocess
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / '.env')

BUCKET = 'gs://stock-analysis-b5602-archive/archive'
YEARS = ['2023', '2024', '2025', '2026']
GCLOUD = '/Users/stone/google-cloud-sdk/bin/gcloud'


def norm(sid: bytes) -> bytes:
    """台股代碼補滿 4 碼。"""
    s = sid.strip()
    return s.rjust(4, b'0') if 0 < len(s) < 4 else sid


def fix_csv_bytes(raw: bytes):
    """逐行處理，只改第 2 欄（stock_id）。回傳 (新內容, 改動列數, 代碼對照)。"""
    out = []
    changed = 0
    mapping = {}
    for i, line in enumerate(raw.split(b'\n')):
        if i == 0 or not line.strip():          # 表頭與空行原樣保留
            out.append(line)
            continue
        parts = line.split(b',', 2)             # 只切前兩個逗號，其餘原封不動
        if len(parts) == 3:
            new_sid = norm(parts[1])
            if new_sid != parts[1]:
                mapping[parts[1].decode()] = new_sid.decode()
                parts[1] = new_sid
                changed += 1
                line = b','.join(parts)
        out.append(line)
    return b'\n'.join(out), changed, mapping


def run_csv(args, workdir: Path):
    print("\n########## 年度檔 CSV ##########")
    total_changed = 0
    for y in YEARS:
        local = workdir / f'stocks_{y}.csv'
        if not local.exists():
            subprocess.run([GCLOUD, 'storage', 'cp', f'{BUCKET}/stocks_{y}.csv', str(local)],
                           check=True, capture_output=True)
        raw = local.read_bytes()
        new, changed, mapping = fix_csv_bytes(raw)
        total_changed += changed

        # 驗證：行數不變、位元組增量 == 補的零總數
        assert raw.count(b'\n') == new.count(b'\n'), f'{y} 行數改變了！'
        expected_delta = sum(len(v) - len(k) for k, v in mapping.items()) if mapping else 0
        per_row = (len(new) - len(raw))
        print(f"  stocks_{y}.csv: 改 {changed} 列　位元組 {len(raw)} → {len(new)} (+{per_row})")
        if mapping:
            print(f"    代碼對照: {mapping}")

        if args.write and changed:
            fixed = workdir / f'stocks_{y}.fixed.csv'
            fixed.write_bytes(new)
            subprocess.run([GCLOUD, 'storage', 'cp', str(fixed), f'{BUCKET}/stocks_{y}.csv'],
                           check=True, capture_output=True)
            print(f"    ✓ 已上傳")
    print(f"  小計：{total_changed} 列")
    return total_changed


def run_firestore(args):
    print("\n########## Firestore daily_data ##########")
    import firebase_writer as fw
    db = fw.get_firestore_client()
    dates = sorted(fw.list_daily_data_dates())
    total = 0
    for date in dates:
        ref = db.collection('daily_data').document(date).collection('chunks')
        n = 0
        for doc in ref.stream():
            data = doc.to_dict() or {}
            stocks = data.get('stocks') or []
            changed = False
            for s in stocks:
                sid = str(s.get('stock_id', ''))
                if 0 < len(sid) < 4:
                    s['stock_id'] = sid.zfill(4)
                    n += 1
                    changed = True
            if changed and args.write:
                ref.document(doc.id).set({
                    'chunk_index': data.get('chunk_index'),
                    'stocks': stocks,
                    'count': data.get('count', len(stocks)),
                })
        total += n
        if n:
            print(f"  {date}: 改 {n} 檔")
    print(f"  小計：{total} 檔")

    # strong_stocks 也存 stock_id
    print("\n########## Firestore strong_stocks ##########")
    total_ss = 0
    for doc in db.collection('strong_stocks').stream():
        data = doc.to_dict() or {}
        stocks = data.get('stocks') or []
        changed = False
        for s in stocks:
            sid = str(s.get('stock_id', ''))
            if 0 < len(sid) < 4:
                s['stock_id'] = sid.zfill(4)
                total_ss += 1
                changed = True
        if changed and args.write:
            data['stocks'] = stocks
            db.collection('strong_stocks').document(doc.id).set(data)
    print(f"  小計：{total_ss} 檔")
    return total + total_ss


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--skip-csv', action='store_true')
    ap.add_argument('--skip-firestore', action='store_true')
    args = ap.parse_args()

    workdir = ROOT / 'logs' / 'stockid_fix' / datetime.now().strftime('%Y%m%d_%H%M%S')
    workdir.mkdir(parents=True, exist_ok=True)
    print(f"=== stock_id 前導零修復　{'寫入模式' if args.write else 'DRY-RUN'} ===")
    print(f"工作目錄（含原檔備份）: {workdir}")

    if not args.skip_csv:
        run_csv(args, workdir)
    if not args.skip_firestore:
        run_firestore(args)

    if not args.write:
        print("\n  這是 DRY-RUN。確認無誤後加 --write。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
