"""
回補 GCS 年度檔裡「資料收得不完整」的交易日，用收集器同一條流程重抓，換掉那天的列。

2026-10-23 發現：2026-04-24、06-25、07-02、07-09 只有前後中位數約 85% 的股票，06-25／07-02 法人只有約 4 成
有值，07-09 整天是 0 → 那天強勢股算成 0 檔。FinMind 事後都有完整資料。

⚠️ 只改 GCS 年度檔，不寫 daily_data：daily_data 從 2026-07-24 起，塞進孤立的一天，月報用 available_dates
   當交易日軸，「近 20 日投信累計」會把它當成 07-24 的前一天。
⚠️ strong_stocks 全由年度檔推導，只寫 Firestore 會被下一輪覆寫，所以一定要改年度檔。
   上傳後要再跑一次只重算強勢股：
     gcloud run jobs execute stock-collector --project=stock-analysis-b5602 --region=asia-east1 \\
       --args="--skip-stock,--skip-index" --wait

用法：
  python scripts/backfill_incomplete_days.py                      # dry-run：自動找不完整的日子，重抓並比對，不上傳
  python scripts/backfill_incomplete_days.py --date 2026-07-09    # 只處理指定日期（可重複）
  python scripts/backfill_incomplete_days.py --write              # 比對通過才上傳 Storage
"""
import argparse
import logging
import os
import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.chdir(ROOT)                      # gcs_archive 找 frontend/service-account.json 用相對路徑
os.environ['USE_GCS_ARCHIVE'] = '1'

from dotenv import load_dotenv      # noqa: E402
load_dotenv(ROOT / '.env')

import gcs_archive                  # noqa: E402
import stock_collector.stock_collector as sc   # noqa: E402
from stock_collector.update_strong_matrix import _day_stats, _complete_dates, calculate_strong   # noqa: E402

PRICE_COLS = ['open', 'high', 'low', 'close']
INST_COLS = ['foreign_buy', 'trust_buy', 'dealer_buy']
# 成交量允許「只增不減」：2026-10-24 實測這 4 天重抓時價格一致、成交量每檔只多不少（+2～+11,200 張），
# 是當初收得太早、FinMind 還沒更新完；變少才代表抓錯。


def load_year(archive_dir: Path, year: str) -> pd.DataFrame:
    return pd.read_csv(archive_dir / f'stocks_{year}.csv', low_memory=False, dtype={'stock_id': str})


def day_report(df: pd.DataFrame, date: str) -> dict:
    """某天的檔數、法人有值比例、強勢檔數（強勢要用整年資料算前一日收盤）。"""
    st = _day_stats(df).loc[date]
    strong = calculate_strong(df)
    return {'rows': int(st['rows']), 'inst': float(st['inst_share']),
            'strong': int(strong.loc[strong['date'].astype(str) == date, 'strong'].sum())}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--date', action='append', help='只處理這些日期（YYYY-MM-DD，可重複）')
    ap.add_argument('--write', action='store_true', help='比對通過後上傳 Storage（預設只預覽）')
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

    work = Path(tempfile.mkdtemp(prefix='backfill_incomplete_'))
    archive = work / 'archive'
    gcs_archive.download_archives(archive)

    if args.date:
        targets = sorted(set(args.date))
    else:
        stats = pd.concat([_day_stats(pd.read_csv(f, low_memory=False, dtype={'stock_id': str}))
                           for f in sorted(archive.glob('stocks_*.csv'))])
        targets = sorted(set(stats.index) - _complete_dates(stats))
    if not targets:
        print('沒有不完整的日子，不用補。')
        return 0
    print(f'要補的日子：{targets}')

    # daily_data 已經有的日子不歸這支腳本管：只改年度檔、不改 daily_data，強勢名單會跟網站明細對不上
    from firebase_writer import get_firestore_client
    db = get_firestore_client()
    in_daily = [d for d in targets if db.collection('daily_data').document(d).get().exists]
    if in_daily:
        print(f'❌ 這些日子 daily_data 已經有資料，要連網站明細一起重收（--date），不能只補年度檔：{in_daily}')
        return 1

    sc.FIREBASE_ENABLED = False        # 不寫 daily_data（見檔頭）
    collector = sc.StockCollector(output_dir=str(work))

    rows_out, ok = [], True
    for d in targets:                  # 由早到晚：前面補好的日子是後面算 MACD／連買天數的歷史
        year = d[:4]
        before_df = load_year(archive, year)
        before = day_report(before_df, d)
        old = before_df[before_df['date'].astype(str) == d].set_index('stock_id')
        old = old[~old.index.duplicated(keep='last')]     # 2023～2025 年度檔有改名留下的重複列

        path = collector.collect_daily_data(target_date=d)
        if not path or not str(path).endswith(f'stocks_{year}.csv'):
            print(f'❌ {d} 重抓失敗（{path}），停止，不上傳')
            return 1

        after_df = load_year(archive, year)
        after = day_report(after_df, d)
        new = after_df[after_df['date'].astype(str) == d].set_index('stock_id')
        common = old.index.intersection(new.index)
        diff = int((old.loc[common, PRICE_COLS].round(4) != new.loc[common, PRICE_COLS].round(4)).any(axis=1).sum())
        vol_up = int((new.loc[common, 'volume'] > old.loc[common, 'volume']).sum())
        vol_down = int((new.loc[common, 'volume'] < old.loc[common, 'volume']).sum())
        # 法人原本有值、重抓後變 0：FinMind 這次回得不完整，不可拿較差的資料換掉較好的
        washed = sum(int(((old.loc[common, c].fillna(0) != 0) & (new.loc[common, c].fillna(0) == 0)).sum())
                     for c in INST_COLS if c in old.columns and c in new.columns)
        lost = sorted(set(old.index) - set(new.index))
        complete = d in _complete_dates(_day_stats(after_df))
        ok &= complete and diff == 0 and vol_down == 0 and washed == 0 and not lost
        rows_out.append((d, before, after, diff, vol_up, vol_down, washed, len(lost), complete))

    print('\n日期        檔數（前→後）  法人有值（前→後）  強勢（前→後）  價格不同  量變多  量變少  法人被洗成0  消失  補完完整')
    for d, b, a, diff, up, down, washed, lost, complete in rows_out:
        print(f"{d}  {b['rows']:>5} → {a['rows']:<5}  {b['inst']:>4.0%} → {a['inst']:<4.0%}       "
              f"{b['strong']:>3} → {a['strong']:<3}     {diff:>5}   {up:>5}   {down:>5}      {washed:>5}     {lost:>4}    {'是' if complete else '否'}")
    print('（前一日收盤改由補好的日子提供，重算後隔天的強勢名單也可能小幅變動，屬於修正。）')

    to_upload, unchanged, problems = gcs_archive.check_upload(archive)
    print(f"上傳前比對：要上傳 {[p.name for p, _, _ in to_upload]}，沒改過 {unchanged}")
    if problems:
        print('❌ ' + '；'.join(problems))
        ok = False

    if not ok:
        print('\n❌ 比對沒過（補完仍不完整、舊列價格被改、成交量變少、法人被洗成 0、有股票消失、或上傳前比對不過），不上傳。')
        return 1
    if not args.write:
        print(f'\n（dry-run）比對通過，沒有上傳。暫存目錄：{work}')
        return 0
    gcs_archive.upload_archives(archive)
    print('\n✓ 已上傳 Storage。接著跑一次只重算強勢股（見檔頭指令）。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
