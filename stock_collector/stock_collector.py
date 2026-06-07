"""
股票資料收集器（批次 API 版本）
使用全市場批次 API，大幅減少 API 呼叫次數
每日只需 2 次 API（股價 + 法人），而非約 5000 次
"""

import pandas as pd
from datetime import datetime, timedelta
from FinMind.data import DataLoader
import logging
from pathlib import Path
from . import config

# 設定日誌
log_dir = Path(__file__).parent / 'logs'
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_dir / 'stock_collector.log', encoding='utf-8'),
        logging.StreamHandler()
    ]
)


class StockCollector:
    """股票資料收集器（批次 API 版本）"""

    def __init__(self, output_dir='data/daily_reports'):
        """初始化收集器"""
        self.api = DataLoader()
        self._login_finmind()

        self.output_dir = Path(__file__).parent.parent / output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logging.info(f"輸出目錄: {self.output_dir}")

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

    def collect_daily_data(self, target_date=None):
        """
        收集單日全市場股票資料（批次 API）

        Parameters:
        -----------
        target_date : str
            目標日期 (YYYY-MM-DD)，None 則使用今天

        Returns:
        --------
        str : 儲存的檔案路徑
        """
        if target_date is None:
            target_date = datetime.now().strftime('%Y-%m-%d')

        logging.info("=" * 70)
        logging.info(f"快速收集 {target_date} 的股票資料（批次 API）")
        logging.info("=" * 70)

        try:
            # 1. 批次取得全市場股價（1 次 API）
            logging.info("取得全市場股價...")
            price_data = self.api.taiwan_stock_daily(
                stock_id='',
                start_date=target_date,
                end_date=target_date
            )

            if len(price_data) == 0:
                logging.error(f"無股價資料: {target_date}")
                return None

            logging.info(f"  取得 {len(price_data)} 筆股價資料")

            # 2. 批次取得全市場法人資料（1 次 API）
            logging.info("取得全市場法人資料...")
            inst_data = self.api.taiwan_stock_institutional_investors(
                stock_id='',
                start_date=target_date,
                end_date=target_date
            )
            logging.info(f"  取得 {len(inst_data)} 筆法人資料")

            # 3. 批次取得全市場外資持股資料（1 次 API）
            logging.info("取得全市場外資持股資料...")
            shareholding_data = self.api.taiwan_stock_shareholding(
                start_date=target_date,
                end_date=target_date
            )
            logging.info(f"  取得 {len(shareholding_data)} 筆外資持股資料")

            # 4. 處理法人資料（長格式轉寬格式）
            inst_pivot = self._process_institutional_data(inst_data)

            # 5. 處理外資持股資料
            shareholding_processed = self._process_shareholding_data(shareholding_data)

            # 6. 合併股價、法人與外資持股資料
            df = self._merge_data(price_data, inst_pivot, shareholding_processed, target_date)

            if len(df) == 0:
                logging.error("沒有有效資料")
                return None

            # 7. 儲存
            filename = f"daily_stock_{target_date.replace('-', '')}.csv"
            filepath = self.output_dir / filename
            df.to_csv(filepath, index=False, encoding='utf-8-sig')

            # 8. 自動計算並加入 MACD 狀態
            logging.info("計算 MACD 狀態...")
            from .update_macd import update_daily_file_macd
            try:
                update_daily_file_macd(filepath, self.api, force_update=False)
                logging.info("✓ MACD 狀態已更新")
            except Exception as e:
                logging.warning(f"⚠️ MACD 計算失敗: {e}")
                logging.warning("   檔案已儲存，但 MACD 狀態為空")

            # 統計
            logging.info("=" * 70)
            logging.info("收集完成！")
            logging.info(f"日期: {target_date}")
            logging.info(f"股票數: {len(df)}")
            logging.info(f"檔案: {filepath}")
            logging.info("=" * 70)

            return str(filepath)

        except Exception as e:
            logging.error(f"收集失敗: {e}")
            return None

    def _process_institutional_data(self, inst_data):
        """
        處理法人資料（長格式轉寬格式）

        計算各法人買超 = buy - sell
        """
        if len(inst_data) == 0:
            return pd.DataFrame()

        # 計算淨買超
        inst_data['net_buy'] = inst_data['buy'] - inst_data['sell']

        # Pivot: 每檔股票一筆，各法人為欄位
        pivot = inst_data.pivot_table(
            index=['date', 'stock_id'],
            columns='name',
            values='net_buy',
            aggfunc='sum'
        ).reset_index()

        # 重新命名欄位
        column_map = {
            'Foreign_Investor': 'foreign_buy',
            'Investment_Trust': 'trust_buy',
            'Dealer_self': 'dealer_self',
            'Dealer_Hedging': 'dealer_hedging'
        }
        pivot = pivot.rename(columns=column_map)

        # 合併自營商
        if 'dealer_self' in pivot.columns and 'dealer_hedging' in pivot.columns:
            pivot['dealer_buy'] = pivot['dealer_self'].fillna(0) + pivot['dealer_hedging'].fillna(0)
            pivot = pivot.drop(columns=['dealer_self', 'dealer_hedging'], errors='ignore')
        elif 'dealer_self' in pivot.columns:
            pivot['dealer_buy'] = pivot['dealer_self'].fillna(0)
            pivot = pivot.drop(columns=['dealer_self'], errors='ignore')
        elif 'dealer_hedging' in pivot.columns:
            pivot['dealer_buy'] = pivot['dealer_hedging'].fillna(0)
            pivot = pivot.drop(columns=['dealer_hedging'], errors='ignore')
        else:
            pivot['dealer_buy'] = 0

        # 確保欄位存在
        for col in ['foreign_buy', 'trust_buy', 'dealer_buy']:
            if col not in pivot.columns:
                pivot[col] = 0

        return pivot

    def _process_shareholding_data(self, shareholding_data):
        """
        處理外資持股資料，提取三個關鍵指標

        Parameters:
        -----------
        shareholding_data : pd.DataFrame
            外資持股原始資料

        Returns:
        --------
        pd.DataFrame
            包含 stock_id 和三個外資持股指標
        """
        if len(shareholding_data) == 0:
            return pd.DataFrame()

        # 只保留需要的欄位
        columns_to_keep = [
            'stock_id',
            'ForeignInvestmentSharesRatio',      # 外資持股比例
            'ForeignInvestmentRemainRatio',      # 外資尚可投資比例
            'ForeignInvestmentUpperLimitRatio'   # 外資投資上限
        ]

        # 檢查欄位是否存在
        available_columns = [col for col in columns_to_keep if col in shareholding_data.columns]

        if 'stock_id' not in available_columns:
            return pd.DataFrame()

        # 提取欄位
        processed = shareholding_data[available_columns].copy()

        # 重新命名欄位（使用更簡潔的名稱）
        rename_map = {
            'ForeignInvestmentSharesRatio': 'foreign_hold_ratio',
            'ForeignInvestmentRemainRatio': 'foreign_remain_ratio',
            'ForeignInvestmentUpperLimitRatio': 'foreign_limit_ratio'
        }
        processed = processed.rename(columns=rename_map)

        # 填充缺失值為 0
        for col in ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio']:
            if col in processed.columns:
                processed[col] = processed[col].fillna(0)

        return processed

    def _merge_data(self, price_data, inst_pivot, shareholding_processed, target_date):
        """合併股價、法人與外資持股資料"""

        # 取得股票名稱對照
        try:
            stock_info = self.api.taiwan_stock_info()
            stock_info = stock_info[['stock_id', 'stock_name']].drop_duplicates()
        except:
            stock_info = pd.DataFrame(columns=['stock_id', 'stock_name'])

        # 篩選目標日期的股價
        df = price_data[price_data['date'] == target_date].copy()

        # 只保留 4 位數字股票代碼
        df = df[df['stock_id'].str.match(r'^\d{4}$')]

        # 重新命名欄位
        df = df.rename(columns={
            'max': 'high',
            'min': 'low',
            'Trading_Volume': 'volume'
        })

        # 轉換成交量為張數
        df['volume'] = (df['volume'] / 1000).astype(int)

        # 合併股票名稱
        df = df.merge(stock_info, on='stock_id', how='left')
        df['stock_name'] = df['stock_name'].fillna('')

        # 合併法人資料
        if len(inst_pivot) > 0:
            df = df.merge(
                inst_pivot[['stock_id', 'foreign_buy', 'trust_buy', 'dealer_buy']],
                on='stock_id',
                how='left'
            )

        # 填充缺失值並轉換為張數
        for col in ['foreign_buy', 'trust_buy', 'dealer_buy']:
            if col not in df.columns:
                df[col] = 0
            df[col] = (df[col].fillna(0) / 1000).astype(int)

        # 合併外資持股資料
        if len(shareholding_processed) > 0:
            df = df.merge(
                shareholding_processed,
                on='stock_id',
                how='left'
            )

        # 填充外資持股欄位的缺失值
        for col in ['foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio']:
            if col not in df.columns:
                df[col] = 0.0
            df[col] = df[col].fillna(0.0)

        # 選擇並排序欄位
        columns = [
            'date', 'stock_id', 'stock_name', 'open', 'high', 'low', 'close',
            'volume', 'foreign_buy', 'trust_buy', 'dealer_buy',
            'foreign_hold_ratio', 'foreign_remain_ratio', 'foreign_limit_ratio'
        ]
        df = df[[c for c in columns if c in df.columns]]

        return df


def batch_collect(start_date, end_date):
    """
    批次收集歷史資料

    Parameters:
    -----------
    start_date : str
        開始日期 (YYYY-MM-DD)
    end_date : str
        結束日期 (YYYY-MM-DD)
    """
    # 產生交易日列表
    start = datetime.strptime(start_date, '%Y-%m-%d')
    end = datetime.strptime(end_date, '%Y-%m-%d')

    trading_days = []
    current = start
    while current <= end:
        if current.weekday() < 5:
            trading_days.append(current.strftime('%Y-%m-%d'))
        current += timedelta(days=1)

    logging.info("=" * 70)
    logging.info(f"批次收集: {start_date} ~ {end_date}")
    logging.info(f"交易日: {len(trading_days)} 天")
    logging.info(f"預估 API 次數: {len(trading_days) * 2} 次")
    logging.info("=" * 70)

    collector = StockCollector()

    success_count = 0
    failed_count = 0
    failed_dates = []

    for idx, date in enumerate(trading_days, 1):
        logging.info(f"\n[{idx}/{len(trading_days)}] 收集 {date}")

        filepath = collector.collect_daily_data(target_date=date)

        if filepath:
            success_count += 1
        else:
            failed_count += 1
            failed_dates.append(date)

    # 統計
    logging.info("\n" + "=" * 70)
    logging.info("批次收集完成！")
    logging.info(f"成功: {success_count} 天")
    logging.info(f"失敗: {failed_count} 天")
    if failed_dates:
        logging.info(f"失敗日期: {', '.join(failed_dates)}")
    logging.info("=" * 70)

    return success_count, failed_count


def main():
    """主程式"""
    import argparse

    parser = argparse.ArgumentParser(
        description='股票資料收集器（批次 API）',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  # 收集今日資料
  python stock_collector.py

  # 收集指定日期
  python stock_collector.py --date 2026-04-11

  # 收集過去 7 天
  python stock_collector.py --days 7

  # 收集指定範圍
  python stock_collector.py --start 2026-01-01 --end 2026-01-31
        """
    )

    # 時間範圍選項
    date_group = parser.add_mutually_exclusive_group()
    date_group.add_argument('--date', type=str, help='單日收集 (YYYY-MM-DD)')
    date_group.add_argument('--days', type=int, help='收集過去 N 天的資料')
    date_group.add_argument('--start', type=str, help='批次收集開始日期 (YYYY-MM-DD)')

    parser.add_argument('--end', type=str, help='批次收集結束日期 (YYYY-MM-DD)，與 --start 搭配使用')

    args = parser.parse_args()

    start_time = datetime.now()

    # 計算日期範圍
    if args.days:
        # 過去 N 天
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=args.days)).strftime('%Y-%m-%d')

        print(f"\n📊 批次收集過去 {args.days} 天")
        success, failed = batch_collect(start_date, end_date)

        # 更新強勢股矩陣
        if success > 0:
            print("\n📊 更新強勢股矩陣...")
            from .update_strong_matrix import update_matrix
            update_matrix()

    elif args.start and args.end:
        # 批次收集
        success, failed = batch_collect(args.start, args.end)

        # 更新強勢股矩陣
        if success > 0:
            print("\n📊 更新強勢股矩陣...")
            from .update_strong_matrix import update_matrix
            update_matrix()

    elif args.start:
        parser.error("使用 --start 時必須同時指定 --end")

    else:
        # 單日收集
        collector = StockCollector()
        target_date = args.date
        filepath = collector.collect_daily_data(target_date=target_date)

        if filepath:
            print(f"\n✅ 成功！{filepath}")

            # 更新強勢股矩陣
            print("\n📊 更新強勢股矩陣...")
            from .update_strong_matrix import update_matrix
            update_matrix()
        else:
            print("\n❌ 失敗！")
            return 1

    elapsed = datetime.now() - start_time
    print(f"\n⏱️ 執行時間: {elapsed}")

    return 0


if __name__ == "__main__":
    exit(main())
