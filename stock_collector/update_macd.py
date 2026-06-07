"""
批次更新所有 daily_stock_*.csv 的 MACD 狀態
"""

import pandas as pd
import sys
from datetime import datetime, timedelta
from pathlib import Path
from FinMind.data import DataLoader
import logging
from . import config

# 加入專案根目錄到 path，以便匯入 utils
sys.path.insert(0, str(Path(__file__).parent.parent))
from utils import get_macd_status

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


def update_daily_file_macd(file_path, api, force_update=False):
    """
    更新單一 daily_stock 檔案的 MACD 狀態

    Parameters:
    -----------
    file_path : Path
        檔案路徑
    api : DataLoader
        FinMind API 物件
    force_update : bool
        是否強制更新（即使已有 macd_status）

    Returns:
    --------
    int : 更新的股票數量
    """
    # 讀取檔案
    df = pd.read_csv(file_path)

    # 檢查是否已有 macd_status 欄位且不需強制更新
    if 'macd_status' in df.columns and not force_update:
        # 檢查是否所有都已計算
        missing_count = (df['macd_status'] == '-').sum() + df['macd_status'].isna().sum()
        if missing_count == 0:
            logging.info(f"  跳過（已有完整 MACD 資料）: {file_path.name}")
            return 0

    # 從檔名取得日期
    date_str = file_path.stem.replace('daily_stock_', '')
    target_date = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"

    # 計算需要的歷史資料起始日期（往前推 60 天確保有足夠資料）
    start_date = (datetime.strptime(target_date, '%Y-%m-%d') - timedelta(days=90)).strftime('%Y-%m-%d')

    logging.info(f"  處理: {file_path.name} (日期: {target_date})")

    # 取得所有股票代碼
    stock_ids = df['stock_id'].astype(str).unique()
    total = len(stock_ids)

    # 計算每檔股票的 MACD
    macd_results = {}
    bull_count = 0
    bear_count = 0
    insufficient_count = 0

    for idx, stock_id in enumerate(stock_ids):
        if idx % 100 == 0:
            logging.info(f"    進度: {idx}/{total}")

        try:
            # 取得歷史價格
            price_data = api.taiwan_stock_daily(
                stock_id=stock_id,
                start_date=start_date,
                end_date=target_date
            )

            if price_data.empty or len(price_data) < 26:
                macd_results[stock_id] = '-'
                insufficient_count += 1
                continue

            # 按日期排序
            price_data = price_data.sort_values('date')

            # 計算 MACD 狀態（使用 utils 的統一函數）
            status = get_macd_status(price_data['close'])
            macd_results[stock_id] = status

            if status == '多':
                bull_count += 1
            elif status == '空':
                bear_count += 1
            else:
                insufficient_count += 1

        except Exception as e:
            macd_results[stock_id] = '-'
            insufficient_count += 1

    # 更新 DataFrame
    df['stock_id'] = df['stock_id'].astype(str)
    df['macd_status'] = df['stock_id'].map(macd_results).fillna('-')

    # 儲存檔案
    df.to_csv(file_path, index=False, encoding='utf-8-sig')

    logging.info(f"    完成: 多={bull_count}, 空={bear_count}, 資料不足={insufficient_count}")

    return bull_count + bear_count


def update_all_daily_files(force_update=False):
    """
    更新所有 daily_stock_*.csv 檔案的 MACD 狀態

    Parameters:
    -----------
    force_update : bool
        是否強制更新所有檔案
    """
    # 初始化 API
    api = DataLoader()
    api.login_by_token(api_token=config.FINMIND_API_TOKEN)
    logging.info("✓ 已登入 FinMind API")

    # 取得所有每日報表檔案
    data_dir = Path(__file__).parent.parent / 'data' / 'daily_reports'
    daily_files = sorted(data_dir.glob('daily_stock_*.csv'))

    if not daily_files:
        logging.warning("找不到任何 daily_stock_*.csv 檔案")
        return

    logging.info(f"找到 {len(daily_files)} 個每日報表檔案")
    logging.info("=" * 60)

    total_updated = 0

    for idx, file_path in enumerate(daily_files, 1):
        logging.info(f"[{idx}/{len(daily_files)}] 處理中...")
        updated = update_daily_file_macd(file_path, api, force_update)
        total_updated += updated

    logging.info("=" * 60)
    logging.info(f"全部完成！共更新 {total_updated} 筆 MACD 資料")


def main():
    import argparse

    parser = argparse.ArgumentParser(description='更新 daily_stock_*.csv 的 MACD 狀態')
    parser.add_argument('--force', action='store_true', help='強制更新所有檔案（即使已有 MACD 資料）')
    parser.add_argument('--file', type=str, help='只更新指定檔案（如：daily_stock_20260416.csv）')

    args = parser.parse_args()

    start_time = datetime.now()

    if args.file:
        # 更新指定檔案
        api = DataLoader()
        api.login_by_token(api_token=config.FINMIND_API_TOKEN)

        data_dir = Path(__file__).parent.parent / 'data' / 'daily_reports'
        file_path = data_dir / args.file

        if file_path.exists():
            update_daily_file_macd(file_path, api, args.force)
        else:
            logging.error(f"檔案不存在: {file_path}")
    else:
        # 更新所有檔案
        update_all_daily_files(args.force)

    elapsed = datetime.now() - start_time
    logging.info(f"執行時間: {elapsed}")


if __name__ == "__main__":
    main()
