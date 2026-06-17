"""
台指期資料收集器
使用 FinMind API 收集台指期 (TX) 日K資料
"""

import pandas as pd
from datetime import datetime, timedelta
from FinMind.data import DataLoader
import logging
import os
from pathlib import Path
from . import config

# Supabase 寫入
SUPABASE_ENABLED = bool(os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_KEY'))

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


class IndexCollector:
    """台指期資料收集器"""

    def __init__(self):
        """初始化收集器"""
        self.api = DataLoader()
        self._login_finmind()

    def _login_finmind(self):
        """FinMind API 登入"""
        try:
            if config.FINMIND_API_TOKEN:
                self.api.login_by_token(api_token=config.FINMIND_API_TOKEN)
                logging.info("✓ 已使用 API Token 登入 FinMind")
            else:
                logging.warning("⚠️ 未設定 API Token")
        except Exception as e:
            logging.error(f"✗ FinMind 登入失敗: {e}")

    def collect_futures_daily(self, start_date, end_date):
        """
        收集台指期日K資料

        Parameters:
        -----------
        start_date : str
            開始日期 (YYYY-MM-DD)
        end_date : str
            結束日期 (YYYY-MM-DD)

        Returns:
        --------
        pd.DataFrame
            台指期日K資料
        """
        logging.info(f"收集台指期資料: {start_date} ~ {end_date}")

        try:
            # 使用 FinMind API 取得台指期資料
            df = self.api.taiwan_futures_daily(
                futures_id='TX',
                start_date=start_date,
                end_date=end_date
            )

            if len(df) == 0:
                logging.warning("無台指期資料")
                return pd.DataFrame()

            logging.info(f"  取得 {len(df)} 筆台指期資料")

            # 只保留日盤資料 (排除 after_market)
            if 'trading_session' in df.columns:
                df = df[df['trading_session'] != 'after_market']

            # 只保留近月合約 (成交量最大的)
            df = df.sort_values(['date', 'volume'], ascending=[True, False])
            df = df.drop_duplicates(subset=['date'], keep='first')

            # 重新命名欄位
            df = df.rename(columns={
                'max': 'high',
                'min': 'low'
            })

            # 新增 index_id 和 index_name
            df['index_id'] = 'TX'
            df['index_name'] = '台指期近月'

            # 選擇需要的欄位
            columns = [
                'date', 'index_id', 'index_name',
                'open', 'high', 'low', 'close', 'volume',
                'open_interest', 'settlement_price'
            ]

            # 確保欄位存在
            for col in columns:
                if col not in df.columns:
                    df[col] = 0

            return df[columns]

        except Exception as e:
            logging.error(f"收集台指期資料失敗: {e}")
            return pd.DataFrame()


def collect_and_save(start_date=None, end_date=None, days=None):
    """
    收集並儲存台指期資料

    Parameters:
    -----------
    start_date : str
        開始日期
    end_date : str
        結束日期
    days : int
        收集過去 N 天（與 start_date/end_date 互斥）
    """
    if days:
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
    elif not start_date:
        # 預設收集今天
        start_date = end_date = datetime.now().strftime('%Y-%m-%d')

    collector = IndexCollector()
    df = collector.collect_futures_daily(start_date, end_date)

    if df.empty:
        logging.error("無資料可儲存")
        return None

    # 寫入 Supabase
    if SUPABASE_ENABLED:
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent))
        from supabase_writer import write_market_index
        count = write_market_index(df)
        logging.info(f"已寫入 Supabase: {count} 筆")
    else:
        logging.warning("未設定 Supabase，跳過資料庫寫入")

    return df


def main():
    """主程式"""
    import argparse

    parser = argparse.ArgumentParser(
        description='台指期資料收集器',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  # 收集今日資料
  python -m stock_collector.index_collector

  # 收集過去 30 天
  python -m stock_collector.index_collector --days 30

  # 收集指定範圍
  python -m stock_collector.index_collector --start 2024-01-01 --end 2026-06-16
        """
    )

    date_group = parser.add_mutually_exclusive_group()
    date_group.add_argument('--days', type=int, help='收集過去 N 天的資料')
    date_group.add_argument('--start', type=str, help='開始日期 (YYYY-MM-DD)')

    parser.add_argument('--end', type=str, help='結束日期 (YYYY-MM-DD)')

    args = parser.parse_args()

    start_time = datetime.now()

    if args.days:
        df = collect_and_save(days=args.days)
    elif args.start and args.end:
        df = collect_and_save(start_date=args.start, end_date=args.end)
    elif args.start:
        parser.error("使用 --start 時必須同時指定 --end")
    else:
        df = collect_and_save()

    if df is not None and not df.empty:
        print(f"\n✅ 成功收集 {len(df)} 筆台指期資料")
        print(df.tail())
    else:
        print("\n❌ 收集失敗")

    elapsed = datetime.now() - start_time
    print(f"\n⏱️ 執行時間: {elapsed}")


if __name__ == "__main__":
    main()
