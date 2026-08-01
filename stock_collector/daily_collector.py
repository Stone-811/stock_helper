"""
每日自動收集排程器
統一管理所有資料收集流程

功能：
1. 收集當日股票資料
2. 收集指數資料（TAIEX + TX）
3. 更新強勢股矩陣
4. 增量更新（只抓缺少的日期）
5. 資料驗證
6. 錯誤重試機制
"""

import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path
import sys
import os

# 確保可以導入同層模組
sys.path.insert(0, str(Path(__file__).parent.parent))

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(f'logs/daily_collector_{datetime.now().strftime("%Y%m%d")}.log', encoding='utf-8')
    ]
)

# 確保 logs 目錄存在
Path('logs').mkdir(exist_ok=True)


class DailyCollector:
    """每日資料收集器"""

    def __init__(self):
        self.start_time = datetime.now()
        self.results = {
            'stock': {'success': False, 'count': 0, 'error': None},
            'index': {'success': False, 'count': 0, 'error': None},
            'matrix': {'success': False, 'count': 0, 'error': None},
        }

    def get_latest_date_from_db(self, table='daily_stocks'):
        """從 Firestore 取得最新資料日期"""
        try:
            from firebase_writer import get_firestore_client
            db = get_firestore_client()

            # 從 metadata 集合取得最新日期
            if table == 'daily_stocks':
                metadata_ref = db.collection('metadata').document('latest_date')
                doc = metadata_ref.get()
                if doc.exists:
                    return doc.to_dict().get('date')
            elif table == 'market_index_daily':
                # 查詢最新指數日期
                docs = db.collection('market_index_daily').order_by('date', direction='DESCENDING').limit(1).get()
                for doc in docs:
                    return doc.to_dict().get('date')

            return None
        except Exception as e:
            logging.warning(f"無法從資料庫取得最新日期: {e}")
            return None

    def get_trading_days(self, start_date, end_date):
        """取得交易日列表（排除週末）"""
        days = []
        current = start_date
        while current <= end_date:
            # 排除週末
            if current.weekday() < 5:
                days.append(current.strftime('%Y-%m-%d'))
            current += timedelta(days=1)
        return days

    def get_missing_dates(self, table='daily_stocks'):
        """取得缺少資料的日期"""
        latest = self.get_latest_date_from_db(table)
        today = datetime.now().date()

        if latest:
            latest_date = datetime.strptime(latest, '%Y-%m-%d').date()
            # 從最新日期的下一天開始
            start = latest_date + timedelta(days=1)
        else:
            # 沒有資料，從今天開始
            start = today

        if start > today:
            return []

        return self.get_trading_days(start, today)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type(Exception),
        before_sleep=lambda retry_state: logging.warning(
            f"重試中... 第 {retry_state.attempt_number} 次"
        )
    )
    def collect_stocks(self, date=None):
        """收集股票資料（含重試機制）"""
        from stock_collector.stock_collector import StockCollector
        import pandas as pd

        collector = StockCollector()

        # 修正：使用正確的方法名稱 collect_daily_data
        filepath = collector.collect_daily_data(target_date=date, skip_macd=True)

        if filepath:
            # 讀取 CSV 檔案進行驗證
            df = pd.read_csv(filepath)
            # C2: filepath 可能是年度檔（含多日），驗證只針對「當日切片」，
            # 否則 len>=2000 恆真、防呆完全失效（就算今天只抓到 10 檔或全 0 也會通過）
            target = date or datetime.now().strftime('%Y-%m-%d')
            if 'date' in df.columns:
                day_df = df[df['date'].astype(str) == target]
                if len(day_df) > 0:
                    df = day_df
            if self.validate_stock_data(df):
                self.results['stock']['success'] = True
                self.results['stock']['count'] = len(df)
                return df
            else:
                raise ValueError("股票資料驗證失敗")
        else:
            raise ValueError("無股票資料")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=4, max=60),
        retry=retry_if_exception_type(Exception)
    )
    def collect_index(self, date=None):
        """收集指數資料（含重試機制）"""
        from stock_collector.index_collector import collect_and_save

        if date:
            df = collect_and_save(start_date=date, end_date=date)
        else:
            df = collect_and_save()

        if df is not None and not df.empty:
            self.results['index']['success'] = True
            self.results['index']['count'] = len(df)
            return df
        else:
            raise ValueError("無指數資料")

    def update_strong_matrix(self):
        """更新強勢股矩陣"""
        try:
            from stock_collector.update_strong_matrix import update_matrix

            count = update_matrix()
            self.results['matrix']['success'] = True
            self.results['matrix']['count'] = count
            return count
        except Exception as e:
            self.results['matrix']['error'] = str(e)
            raise

    def validate_stock_data(self, df):
        """驗證股票資料完整性"""
        checks = {
            'has_data': len(df) > 0,
            'row_count': len(df) >= 2000,  # 至少 2000 檔股票
            'has_price': df['close'].notna().sum() > len(df) * 0.95,  # 95% 有收盤價
            'volume_positive': (df['volume'] >= 0).all(),
            'has_date': 'date' in df.columns,
            'has_stock_id': 'stock_id' in df.columns,
        }

        failed = [k for k, v in checks.items() if not v]

        if failed:
            logging.warning(f"資料驗證失敗: {failed}")
            logging.warning(f"  - 資料筆數: {len(df)}")
            logging.warning(f"  - 有收盤價比例: {df['close'].notna().sum() / len(df) * 100:.1f}%")
            return False

        logging.info(f"資料驗證通過: {len(df)} 筆")
        return True

    def run_daily(self, date=None, skip_stock=False, skip_index=False, skip_matrix=False):
        """
        執行每日收集流程

        Parameters:
        -----------
        date : str
            指定日期 (YYYY-MM-DD)，None 則收集今日
        skip_stock : bool
            跳過股票資料收集
        skip_index : bool
            跳過指數資料收集
        skip_matrix : bool
            跳過強勢股矩陣更新
        """
        logging.info("=" * 70)
        logging.info(f"📅 開始每日資料收集: {date or '今日'}")
        logging.info("=" * 70)

        # 1. 收集股票資料
        if not skip_stock:
            logging.info("\n📊 [1/3] 收集股票資料...")
            try:
                self.collect_stocks(date)
                logging.info(f"  ✅ 成功: {self.results['stock']['count']} 筆")
            except Exception as e:
                self.results['stock']['error'] = str(e)
                logging.error(f"  ❌ 失敗: {e}")

        # 2. 收集指數資料
        if not skip_index:
            logging.info("\n📈 [2/3] 收集指數資料...")
            try:
                self.collect_index(date)
                logging.info(f"  ✅ 成功: {self.results['index']['count']} 筆")
            except Exception as e:
                self.results['index']['error'] = str(e)
                logging.error(f"  ❌ 失敗: {e}")

        # 3. 更新強勢股矩陣
        if not skip_matrix:
            logging.info("\n🔥 [3/3] 更新強勢股矩陣...")
            try:
                self.update_strong_matrix()
                logging.info(f"  ✅ 成功: {self.results['matrix']['count']} 筆")
            except Exception as e:
                self.results['matrix']['error'] = str(e)
                logging.error(f"  ❌ 失敗: {e}")

        # 輸出總結
        self.print_summary()

    def run_incremental(self):
        """執行增量更新（只收集缺少的日期）"""
        logging.info("=" * 70)
        logging.info("📅 開始增量更新")
        logging.info("=" * 70)

        # 檢查缺少的股票資料日期
        missing_stock_dates = self.get_missing_dates('daily_stocks')
        logging.info(f"缺少股票資料的日期: {len(missing_stock_dates)} 天")

        # 檢查缺少的指數資料日期
        missing_index_dates = self.get_missing_dates('market_index_daily')
        logging.info(f"缺少指數資料的日期: {len(missing_index_dates)} 天")

        if not missing_stock_dates and not missing_index_dates:
            logging.info("✅ 資料已是最新，無需更新")
            return

        # 收集缺少的資料
        all_dates = set(missing_stock_dates + missing_index_dates)

        for date in sorted(all_dates):
            logging.info(f"\n{'='*50}")
            logging.info(f"處理日期: {date}")

            if date in missing_stock_dates:
                try:
                    self.collect_stocks(date)
                    logging.info(f"  股票: ✅")
                except Exception as e:
                    logging.error(f"  股票: ❌ {e}")

            if date in missing_index_dates:
                try:
                    self.collect_index(date)
                    logging.info(f"  指數: ✅")
                except Exception as e:
                    logging.error(f"  指數: ❌ {e}")

        # 更新強勢股矩陣
        logging.info("\n更新強勢股矩陣...")
        try:
            self.update_strong_matrix()
            logging.info("  ✅ 完成")
        except Exception as e:
            logging.error(f"  ❌ {e}")

        self.print_summary()

    def print_summary(self):
        """輸出收集結果總結"""
        elapsed = datetime.now() - self.start_time

        logging.info("\n" + "=" * 70)
        logging.info("📋 收集結果總結")
        logging.info("=" * 70)

        for task, result in self.results.items():
            status = "✅" if result['success'] else "❌"
            count = result['count']
            error = result['error'] or ""

            task_name = {
                'stock': '股票資料',
                'index': '指數資料',
                'matrix': '強勢股矩陣'
            }.get(task, task)

            if result['success']:
                logging.info(f"  {status} {task_name}: {count} 筆")
            else:
                logging.info(f"  {status} {task_name}: {error}")

        logging.info(f"\n⏱️  總耗時: {elapsed}")
        logging.info("=" * 70)


def main():
    """主程式"""
    parser = argparse.ArgumentParser(
        description='每日自動收集排程器',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  # 收集今日資料
  python -m stock_collector.daily_collector

  # 收集指定日期
  python -m stock_collector.daily_collector --date 2026-06-19

  # 增量更新（只收集缺少的日期）
  python -m stock_collector.daily_collector --incremental

  # 只收集指數
  python -m stock_collector.daily_collector --skip-stock --skip-matrix

  # 批次收集（過去 N 天）
  python -m stock_collector.daily_collector --days 7
        """
    )

    parser.add_argument('--date', type=str, help='指定日期 (YYYY-MM-DD)')
    parser.add_argument('--days', type=int, help='收集過去 N 天')
    parser.add_argument('--incremental', action='store_true', help='增量更新模式')
    parser.add_argument('--skip-stock', action='store_true', help='跳過股票資料')
    parser.add_argument('--skip-index', action='store_true', help='跳過指數資料')
    parser.add_argument('--skip-matrix', action='store_true', help='跳過強勢股矩陣')

    args = parser.parse_args()

    collector = DailyCollector()

    try:
        if args.incremental:
            # 增量更新模式
            collector.run_incremental()

        elif args.days:
            # 批次收集過去 N 天
            today = datetime.now().date()
            for i in range(args.days, 0, -1):
                date = (today - timedelta(days=i)).strftime('%Y-%m-%d')
                logging.info(f"\n{'='*70}")
                logging.info(f"批次收集: {date}")
                collector.run_daily(
                    date=date,
                    skip_stock=args.skip_stock,
                    skip_index=args.skip_index,
                    skip_matrix=True  # 批次時最後再更新一次
                )

            # 最後更新強勢股矩陣
            if not args.skip_matrix:
                collector.update_strong_matrix()

        else:
            # 單日收集
            collector.run_daily(
                date=args.date,
                skip_stock=args.skip_stock,
                skip_index=args.skip_index,
                skip_matrix=args.skip_matrix
            )

    except KeyboardInterrupt:
        logging.info("\n⚠️ 使用者中斷")
        return 1
    except Exception as e:
        logging.error(f"\n❌ 執行失敗: {e}")
        return 1

    return 0


if __name__ == '__main__':
    exit(main())
