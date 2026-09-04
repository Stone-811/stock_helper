#!/usr/bin/env python3
"""
一次性回補工具：把 daily_data 中「缺資料被寫成 0」的欄位改回 null。

背景
----
收集器早期在三個層次把「無資料」補成 0（_process_shareholding_data 的 fillna(0)、
_merge_data 的 fillna(0.0)、firebase_writer 的 `or 0`），前端 stock-data.ts 又再 `?? 0`
一次。結果 FinMind 未涵蓋的股票（多為上櫃／新掛牌）會顯示：

    外資投資上限 0.00%   ← 法規上不可能存在，鐵證是缺資料
    外資持股比例 0.00%   ← 但同一檔當天外資買超 61 張，買了卻持股 0
    當日當沖   0.0%

而同一頁下方的籌碼圖直接打 FinMind，會誠實顯示「此股無外資持股申報資料」／「無當沖資料」
→ 同一畫面上下互相矛盾。收集器與前端都已修正（改寫 null），本腳本負責清理既有歷史。

判斷依據（不做推測）
--------------------
直接向 FinMind 取「該日期整批」的 TaiwanStockShareholding / TaiwanStockDayTrading，
得到當天確實有資料的 stock_id 集合；不在集合內者才視為缺資料。
不採用「foreign_limit_ratio == 0 就當缺資料」這類啟發式規則。

安全設計
--------
* 預設 DRY-RUN，加 --write 才寫入。
* 只改 4 個目標欄位，且**只改目前值為 0 的**；非 0 值一律不動（避免誤刪真資料）。
* 若某日 FinMind 該資料集回 0 筆（可能是 API 暫時失敗），該日該欄位整批**跳過**，
  不會把全市場清成 null。
* --write 前自動把原始 chunks 備份成本地 JSON，可據以還原。
* 不動 strong_stocks（那裡只存 stock_id/stock_name）、不動年度檔 CSV、不動排程。

用法
----
  python3 scripts/backfill_null_vs_zero.py                 # 稽核 + dry-run
  python3 scripts/backfill_null_vs_zero.py --write          # 實際回補
  python3 scripts/backfill_null_vs_zero.py --date 2026-09-03 --write
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

# 欄位 → 權威資料集
SHAREHOLDING_FIELDS = ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio']
DAYTRADE_FIELDS = ['day_trading_volume']
TARGET_FIELDS = SHAREHOLDING_FIELDS + DAYTRADE_FIELDS


def get_finmind():
    from FinMind.data import DataLoader
    api = DataLoader()
    token = os.getenv('FINMIND_API_TOKEN', '')
    if token:
        api.login_by_token(api_token=token)
    return api


def fetch_authoritative_sets(api, date):
    """回傳 (持股有資料的 stock_id set 或 None, 當沖有資料的 set 或 None)。

    None 代表「該日該資料集抓不到／回 0 筆」→ 呼叫端必須跳過，不可當成全部缺資料。
    """
    def ids(df):
        if df is None or len(df) == 0:
            return None
        return set(df['stock_id'].astype(str))

    try:
        sh = api.taiwan_stock_shareholding(start_date=date, end_date=date)
    except Exception as e:
        print(f"    ⚠️ 持股資料抓取失敗（跳過該欄位）: {e}")
        sh = None
    try:
        dt = api.get_data(dataset='TaiwanStockDayTrading', data_id='',
                          start_date=date, end_date=date)
    except Exception as e:
        print(f"    ⚠️ 當沖資料抓取失敗（跳過該欄位）: {e}")
        dt = None
    return ids(sh), ids(dt)


def is_zero(v):
    """目前值是否為 0（含 0.0）。None 不算，非數字不算。"""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='實際寫入（預設只 dry-run）')
    ap.add_argument('--date', help='只處理單一日期（預設全部）')
    ap.add_argument('--backup-dir', default=str(ROOT / 'logs' / 'backfill_backup'))
    args = ap.parse_args()

    import firebase_writer as fw
    db = fw.get_firestore_client()

    dates = [args.date] if args.date else sorted(fw.list_daily_data_dates())
    if not dates:
        print("daily_data 沒有任何日期"); return 1

    api = get_finmind()
    backup_dir = Path(args.backup_dir) / datetime.now().strftime('%Y%m%d_%H%M%S')
    if args.write:
        backup_dir.mkdir(parents=True, exist_ok=True)
        print(f"備份目錄: {backup_dir}\n")

    mode = "寫入模式" if args.write else "DRY-RUN（不寫入）"
    print(f"=== daily_data 0→null 回補　{mode} ===")
    print(f"日期數: {len(dates)}　({dates[0]} ~ {dates[-1]})\n")

    tot = {f: 0 for f in TARGET_FIELDS}
    tot_stocks = 0
    tot_chunks_written = 0
    skipped = []

    for date in dates:
        sh_ids, dt_ids = fetch_authoritative_sets(api, date)
        if sh_ids is None:
            skipped.append((date, '持股'))
        if dt_ids is None:
            skipped.append((date, '當沖'))

        chunks_ref = db.collection('daily_data').document(date).collection('chunks')
        chunk_docs = list(chunks_ref.stream())
        if not chunk_docs:
            print(f"  {date}: 無 chunks，略過")
            continue

        per_date = {f: 0 for f in TARGET_FIELDS}
        n_stocks = 0
        written = 0

        for doc in chunk_docs:
            data = doc.to_dict() or {}
            stocks = data.get('stocks') or []
            if args.write:
                (backup_dir / date).mkdir(parents=True, exist_ok=True)
                (backup_dir / date / f'{doc.id}.json').write_text(
                    json.dumps(data, ensure_ascii=False, default=str), encoding='utf-8')

            changed = False
            for s in stocks:
                sid = str(s.get('stock_id', ''))
                n_stocks += 1
                # 外資持股三欄：只有在該日抓得到權威清單時才處理
                if sh_ids is not None and sid not in sh_ids:
                    for f in SHAREHOLDING_FIELDS:
                        if is_zero(s.get(f)):
                            s[f] = None; per_date[f] += 1; changed = True
                # 當沖
                if dt_ids is not None and sid not in dt_ids:
                    for f in DAYTRADE_FIELDS:
                        if is_zero(s.get(f)):
                            s[f] = None; per_date[f] += 1; changed = True

            if changed and args.write:
                chunks_ref.document(doc.id).set({
                    'chunk_index': data.get('chunk_index'),
                    'stocks': stocks,
                    'count': data.get('count', len(stocks)),
                })
                written += 1
            elif changed:
                written += 1  # dry-run：計算「會被寫」的分片數

        tot_stocks += n_stocks
        tot_chunks_written += written
        for f in TARGET_FIELDS:
            tot[f] += per_date[f]
        chg = sum(per_date.values())
        flag = '' if (sh_ids and dt_ids) else '  ⚠️部分欄位跳過'
        print(f"  {date}: {n_stocks:5d} 檔　改 {chg:5d} 格　({written} 個分片){flag}")

    print("\n=== 彙總 ===")
    print(f"  掃描股票筆數: {tot_stocks}")
    for f in TARGET_FIELDS:
        print(f"  {f:22s} 0 → null: {tot[f]}")
    print(f"  受影響分片數: {tot_chunks_written}")
    if skipped:
        print(f"  ⚠️ 因抓不到權威清單而跳過: {skipped}")
    if not args.write:
        print("\n  這是 DRY-RUN。確認無誤後加 --write 實際執行。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
