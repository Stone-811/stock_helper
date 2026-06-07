"""
合併每日 CSV 檔案為單一大檔案
將 daily_reports 目錄下的多個 daily_stock_YYYYMMDD.csv 合併成一個檔案

支援功能：
1. 合併指定日期範圍的每日檔案
2. 按年份自動合併並歸檔
3. 可選：移動或刪除已合併的每日檔案
"""

import pandas as pd
import argparse
from pathlib import Path
import glob
import logging
from datetime import datetime

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

def merge_daily_files(input_dir='data/daily_reports', output_file=None, start_date=None, end_date=None):
    """
    合併每日 CSV 檔案為單一檔案

    Parameters:
    -----------
    input_dir : str
        輸入目錄（包含 daily_stock_*.csv）
    output_file : str
        輸出檔案路徑，None 則自動產生
    start_date : str
        開始日期 (YYYYMMDD)，None 則包含所有
    end_date : str
        結束日期 (YYYYMMDD)，None 則包含所有

    Returns:
    --------
    str : 輸出檔案路徑
    """
    input_path = Path(input_dir)

    if not input_path.exists():
        logging.error(f"目錄不存在: {input_dir}")
        return None

    # 尋找所有每日檔案
    pattern = str(input_path / 'daily_stock_*.csv')
    files = sorted(glob.glob(pattern))

    if len(files) == 0:
        logging.error(f"找不到任何 daily_stock_*.csv 檔案在 {input_dir}")
        return None

    logging.info(f"找到 {len(files)} 個每日檔案")

    # 日期篩選
    filtered_files = []
    for f in files:
        filename = Path(f).name
        # 提取日期：daily_stock_20250128.csv -> 20250128
        date_str = filename.replace('daily_stock_', '').replace('.csv', '')

        if start_date and date_str < start_date:
            continue
        if end_date and date_str > end_date:
            continue

        filtered_files.append(f)

    if len(filtered_files) == 0:
        logging.error(f"日期範圍內找不到檔案 ({start_date} ~ {end_date})")
        return None

    logging.info(f"符合日期範圍的檔案: {len(filtered_files)}")

    # 讀取並合併所有檔案
    logging.info("開始合併檔案...")
    dfs = []

    for idx, filepath in enumerate(filtered_files, 1):
        try:
            df = pd.read_csv(filepath)
            dfs.append(df)

            if idx % 50 == 0:
                logging.info(f"  已讀取 {idx}/{len(filtered_files)} 個檔案")

        except Exception as e:
            logging.warning(f"  跳過檔案 {filepath}: {e}")
            continue

    if len(dfs) == 0:
        logging.error("沒有成功讀取任何檔案")
        return None

    # 合併所有 DataFrame
    logging.info("合併資料中...")
    merged_df = pd.concat(dfs, ignore_index=True)

    # 排序：按股票代碼和日期
    logging.info("排序資料中...")
    merged_df = merged_df.sort_values(['stock_id', 'date'])

    # 產生輸出檔名
    if output_file is None:
        if start_date and end_date:
            output_file = f"merged_stock_{start_date}_{end_date}.csv"
        else:
            # 取得日期範圍
            min_date = merged_df['date'].min().replace('-', '')
            max_date = merged_df['date'].max().replace('-', '')
            output_file = f"merged_stock_{min_date}_{max_date}.csv"

    output_path = input_path / output_file

    # 儲存
    logging.info(f"儲存至 {output_path}")
    merged_df.to_csv(output_path, index=False, encoding='utf-8-sig')

    # 統計資訊
    logging.info("\n" + "="*70)
    logging.info("合併完成！")
    logging.info("="*70)
    logging.info(f"輸入檔案數: {len(filtered_files)}")
    logging.info(f"總資料筆數: {len(merged_df):,}")
    logging.info(f"股票數量: {merged_df['stock_id'].nunique()}")
    logging.info(f"日期範圍: {merged_df['date'].min()} ~ {merged_df['date'].max()}")
    logging.info(f"檔案大小: {output_path.stat().st_size / 1024 / 1024:.2f} MB")
    logging.info(f"輸出檔案: {output_path}")
    logging.info("="*70)

    return str(output_path)


def create_archive_structure(base_dir='data/daily_reports'):
    """
    建立歸檔目錄結構

    Parameters:
    -----------
    base_dir : str
        基礎目錄

    Returns:
    --------
    Path : archive 目錄路徑
    """
    base_path = Path(base_dir)
    archive_path = base_path / 'archive'

    if not archive_path.exists():
        archive_path.mkdir(parents=True, exist_ok=True)
        logging.info(f"建立歸檔目錄: {archive_path}")

    return archive_path


def merge_yearly(year, input_dir='data/daily_reports', cleanup=False):
    """
    合併指定年份的所有每日檔案

    Parameters:
    -----------
    year : int or str
        年份 (例如: 2026)
    input_dir : str
        輸入目錄
    cleanup : bool
        是否移動已合併的檔案到 archive/merged/

    Returns:
    --------
    str : 輸出檔案路徑
    """
    year_str = str(year)
    start_date = f"{year_str}0101"
    end_date = f"{year_str}1231"

    logging.info("="*70)
    logging.info(f"📅 開始合併 {year_str} 年的資料")
    logging.info("="*70)

    # 建立 archive 目錄
    archive_path = create_archive_structure(input_dir)

    # 合併檔案
    output_file = f"stocks_{year_str}.csv"
    output_path = merge_daily_files(
        input_dir=input_dir,
        output_file=output_file,
        start_date=start_date,
        end_date=end_date
    )

    if not output_path:
        logging.error(f"合併 {year_str} 年資料失敗")
        return None

    # 移動輸出檔案到 archive 目錄
    src_path = Path(output_path)
    dest_path = archive_path / src_path.name

    if src_path.exists():
        src_path.rename(dest_path)
        logging.info(f"移動檔案至: {dest_path}")
        output_path = str(dest_path)

    # 清理已合併的每日檔案
    if cleanup:
        moved_count = move_merged_files(year_str, input_dir)
        logging.info(f"已移動 {moved_count} 個每日檔案到歸檔目錄")

    return output_path


def move_merged_files(year, input_dir='data/daily_reports'):
    """
    移動已合併的每日檔案到歸檔目錄

    Parameters:
    -----------
    year : str
        年份 (例如: '2026')
    input_dir : str
        輸入目錄

    Returns:
    --------
    int : 移動的檔案數量
    """
    input_path = Path(input_dir)
    archive_path = input_path / 'archive' / 'merged'

    # 建立 merged 子目錄
    if not archive_path.exists():
        archive_path.mkdir(parents=True, exist_ok=True)

    # 尋找該年份的所有每日檔案
    pattern = str(input_path / f'daily_stock_{year}*.csv')
    files = sorted(glob.glob(pattern))

    moved_count = 0
    for filepath in files:
        src = Path(filepath)
        dest = archive_path / src.name

        try:
            src.rename(dest)
            moved_count += 1
        except Exception as e:
            logging.warning(f"移動檔案失敗 {src.name}: {e}")

    logging.info(f"已移動 {moved_count} 個檔案到 {archive_path}")
    return moved_count


def main():
    """主程式"""
    parser = argparse.ArgumentParser(
        description='合併每日 CSV 檔案為單一大檔案',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：

【一般合併】
  # 合併所有每日檔案
  python merge_daily_files.py

  # 合併指定日期範圍
  python merge_daily_files.py --start 20250101 --end 20251231

  # 指定輸出檔名
  python merge_daily_files.py --output all_stocks_2025.csv

【年份合併（推薦）】
  # 合併 2025 年的資料到 archive/stocks_2025.csv
  python merge_daily_files.py --year 2025

  # 合併 2026 年並移動已合併的每日檔案
  python merge_daily_files.py --year 2026 --cleanup

【統計資訊】
  # 顯示統計資訊
  python merge_daily_files.py --stats

注意：
  - 日期格式為 YYYYMMDD (例如: 20250128)
  - 年份合併會自動建立 archive/ 目錄結構
  - --cleanup 會將已合併的每日檔案移到 archive/merged/
  - 合併後的檔案約 15-25 MB/年
        """
    )

    parser.add_argument('--input-dir', type=str, default='data/daily_reports',
                        help='輸入目錄（預設: data/daily_reports）')
    parser.add_argument('--output', type=str, help='輸出檔名（預設自動產生）')
    parser.add_argument('--start', type=str, help='開始日期 (YYYYMMDD)')
    parser.add_argument('--end', type=str, help='結束日期 (YYYYMMDD)')
    parser.add_argument('--stats', action='store_true', help='顯示統計資訊後結束')
    parser.add_argument('--year', type=int, help='按年份合併 (例如: 2026)')
    parser.add_argument('--cleanup', action='store_true', help='移動已合併的每日檔案到 archive/merged/')


    args = parser.parse_args()

    # 僅顯示統計
    if args.stats:
        input_path = Path(args.input_dir)
        pattern = str(input_path / 'daily_stock_*.csv')
        files = sorted(glob.glob(pattern))

        if len(files) == 0:
            print(f"❌ 找不到任何檔案在 {args.input_dir}")
            return 1

        # 讀取第一個和最後一個檔案的日期
        first_file = Path(files[0]).name
        last_file = Path(files[-1]).name

        first_date = first_file.replace('daily_stock_', '').replace('.csv', '')
        last_date = last_file.replace('daily_stock_', '').replace('.csv', '')

        # 計算總大小
        total_size = sum(Path(f).stat().st_size for f in files) / 1024 / 1024

        print("\n" + "="*70)
        print("📊 每日檔案統計")
        print("="*70)
        print(f"檔案數量: {len(files)}")
        print(f"日期範圍: {first_date} ~ {last_date}")
        print(f"總大小: {total_size:.2f} MB")
        print(f"平均大小: {total_size/len(files):.2f} MB/檔")
        print("="*70)

        return 0

    start_time = datetime.now()

    # 年份合併模式
    if args.year:
        print("\n" + "="*70)
        print(f"📅 按年份合併: {args.year}")
        print("="*70)

        if args.cleanup:
            print("⚠️  清理模式: 已合併的檔案將移動到 archive/merged/")
        else:
            print("💡 提示: 使用 --cleanup 參數可自動移動已合併的檔案")

        print("="*70)

        output_path = merge_yearly(
            year=args.year,
            input_dir=args.input_dir,
            cleanup=args.cleanup
        )

    # 一般合併模式
    else:
        print("\n" + "="*70)
        print("📦 合併每日 CSV 檔案")
        print("="*70)

        if args.start or args.end:
            print(f"日期範圍: {args.start or '最早'} ~ {args.end or '最新'}")
        else:
            print("日期範圍: 所有檔案")

        print("="*70)

        output_path = merge_daily_files(
            input_dir=args.input_dir,
            output_file=args.output,
            start_date=args.start,
            end_date=args.end
        )

    end_time = datetime.now()
    elapsed = end_time - start_time

    if output_path:
        print(f"\n✅ 合併完成！")
        print(f"⏱️  耗時: {elapsed}")
        print(f"📁 檔案: {output_path}")
        return 0
    else:
        print(f"\n❌ 合併失敗")
        return 1

if __name__ == '__main__':
    exit(main())
