"""
指數資料收集器
使用 FinMind API 收集：
1. 加權指數 (TAIEX) 日K資料
2. 台指期 (TX) 日K資料
3. 美股三大指數（2026-11-05 業主要的，首頁加權指數卡右側）：費半 SOX、S&P 500 SPX、道瓊 DJI
   來源 FinMind USStockPrice（data_id ^SOX／^GSPC／^DJI，2000 年起，美國假日沒有列）。
   ⚠️ 日期是美東交易日：台灣 11/5 晚上最新是 11/4，畫面一律標「美股 M/D 收盤」。
   ⚠️ 美股收盤＝台灣清晨，所以每班往回抓 US_LOOKBACK_DAYS（21）個日曆天而不是只抓今天；SOX 的 Volume 永遠是 0，存 null 不存 0。
   ⚠️ 台股休市日（春節可連休 11 天）daily_collector 也會只抓美股（collect_us_and_save），否則首頁停在封關前一晚、
      美股那幾天也永遠補不回來（2026-11-05 審查 F1）。斷料超過 US_STALE_DAYS 天寄非關鍵告警（審查 F2）。
   ⚠️ 斷料檢查（check_us_staleness）不放在 collect_and_save 裡：daily_collector.collect_index 有 tenacity 重試，
      放在裡面一班會寄 3 封。由 daily_collector.run_daily 在重試外呼叫一次；collect_us_and_save 自己檢查一次。
"""

import pandas as pd
from datetime import datetime, timedelta
from FinMind.data import DataLoader
import logging
from . import config

# Firebase 寫入：憑證檔存在，或在 GCP/Cloud Run 環境（ADC）。判斷集中於 config.firebase_enabled()
FIREBASE_ENABLED = config.firebase_enabled()

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


class IndexCollector:
    """台股指數資料收集器（加權指數 + 台指期）"""

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

    def collect_taiex_daily(self, start_date, end_date):
        """
        收集加權指數日K資料

        Parameters:
        -----------
        start_date : str
            開始日期 (YYYY-MM-DD)
        end_date : str
            結束日期 (YYYY-MM-DD)

        Returns:
        --------
        pd.DataFrame
            加權指數日K資料
        """
        logging.info(f"收集加權指數資料: {start_date} ~ {end_date}")

        try:
            # 使用 TaiwanStockPrice 取得 TAIEX 資料
            df = self.api.taiwan_stock_daily(
                stock_id='TAIEX',
                start_date=start_date,
                end_date=end_date
            )

            if len(df) == 0:
                logging.warning("無加權指數資料")
                return pd.DataFrame()

            logging.info(f"  取得 {len(df)} 筆加權指數資料")

            # 重新命名欄位
            df = df.rename(columns={
                'max': 'high',
                'min': 'low',
                'Trading_Volume': 'volume'
            })

            # 新增 index_id 和 index_name
            df['index_id'] = 'TAIEX'
            df['index_name'] = '加權指數'

            # 加權指數沒有未平倉量和結算價
            df['open_interest'] = 0
            df['settlement_price'] = 0

            # 選擇需要的欄位
            columns = [
                'date', 'index_id', 'index_name',
                'open', 'high', 'low', 'close', 'volume',
                'open_interest', 'settlement_price'
            ]

            return df[columns]

        except Exception as e:
            logging.error(f"收集加權指數資料失敗: {e}")
            return pd.DataFrame()

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

            # 過濾出單一月份合約 (排除價差合約如 202606/202607)
            if 'contract_date' in df.columns:
                df = df[~df['contract_date'].astype(str).str.contains('/')]

            # 只保留近月合約 (最近到期且有成交量的)
            # 按日期和合約月份排序，取最近的月份
            if 'contract_date' in df.columns:
                df = df[df['volume'] > 0]  # 過濾無成交量的
                df = df.sort_values(['date', 'contract_date'], ascending=[True, True])
                df = df.drop_duplicates(subset=['date'], keep='first')
            else:
                # 若無 contract_date，退回使用成交量排序
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


# 美股三大指數：Firestore 文件 id → FinMind data_id、中文名
US_INDICES = {
    'SOX': ('^SOX', '費城半導體'),
    'SPX': ('^GSPC', 'S&P 500'),
    'DJI': ('^DJI', '道瓊工業'),
}
# 美股收盤在台灣清晨，17:00／22:00 那兩班「今天」的美股還沒收；每班往回多抓幾天把前一晚補進來。
# 21 天：蓋過台股春節連休（10～12 個日曆天）＋美國連假，請求數一樣是每檔 1 次（審查 F1）。
US_LOOKBACK_DAYS = 21
# 最新一筆比執行日舊超過這麼多天就告警：美國最長的正常空窗是 4 天（耶誕／感恩節＋週末）
US_STALE_DAYS = 6


def collect_us_indices(start_date, end_date):
    """美股三大指數（FinMind USStockPrice）→ 與 TAIEX 同形狀的 DataFrame。
    抓不到就回空（不中止其他指數）。成交量 0（SOX 永遠是 0）存成 NaN，由 writer 寫 null。"""
    frames = []
    token = config.FINMIND_API_TOKEN
    import requests
    for index_id, (sym, name) in US_INDICES.items():
        try:
            r = requests.get('https://api.finmindtrade.com/api/v4/data',
                             params={'dataset': 'USStockPrice', 'data_id': sym, 'start_date': start_date, 'end_date': end_date},
                             headers={'Authorization': f'Bearer {token}'} if token else {}, timeout=60)
            j = r.json()
            rows = j.get('data') or []
            if j.get('status') != 200 or not rows:
                logging.warning(f"美股指數 {index_id}（{sym}）{start_date}～{end_date} 無資料：{j.get('msg')}")
                continue
            df = pd.DataFrame(rows)
            df = df.rename(columns={'Open': 'open', 'High': 'high', 'Low': 'low', 'Close': 'close', 'Volume': 'volume'})
            df = df[df['close'].notna() & (df['close'] > 0)]
            df['volume'] = pd.to_numeric(df['volume'], errors='coerce')
            df.loc[df['volume'] <= 0, 'volume'] = pd.NA     # 0 是「沒有這個數字」，不是真的零成交
            df['index_id'] = index_id
            df['index_name'] = name
            df['open_interest'] = pd.NA
            df['settlement_price'] = pd.NA
            frames.append(df[['date', 'index_id', 'index_name', 'open', 'high', 'low', 'close', 'volume', 'open_interest', 'settlement_price']])
            logging.info(f"  取得 {len(df)} 筆 {name}（{sym}），最新 {df['date'].max()}")
        except Exception as e:
            logging.warning(f"美股指數 {index_id} 抓取失敗（不影響台股指數）：{e}")
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def _us_window_start(start_date):
    return (datetime.strptime(start_date, '%Y-%m-%d') - timedelta(days=US_LOOKBACK_DAYS)).strftime('%Y-%m-%d')


def check_us_staleness(day):
    """美股三大指數斷料不可無聲（2026-11-05 審查 F2）：Firestore 最新日期比 day 舊超過 US_STALE_DAYS 天 → 非關鍵告警。
    不改 exit code、不 raise；比照 sentiment_collector._check_staleness。只讀 latest_date 欄位（不拉整份 history）。
    ⚠️ 每次呼叫都可能寄一封：不可放進會被重試的函式（collect_and_save 被 collect_index 的 tenacity 包著）。"""
    if not FIREBASE_ENABLED:
        return
    try:
        from firebase_writer import get_latest_dates
        latest = get_latest_dates('market_index', US_INDICES)
    except Exception as e:
        logging.warning(f"美股指數陳舊度檢查失敗：{e}")
        return
    cutoff = (datetime.strptime(day, '%Y-%m-%d') - timedelta(days=US_STALE_DAYS)).strftime('%Y-%m-%d')
    problems = [f"{k} 最新 {v}，比 {day} 舊超過 {US_STALE_DAYS} 天" for k, v in latest.items() if v is None or v < cutoff]
    if not problems:
        return
    logging.error("⚠️ 美股三大指數斷料：" + '；'.join(problems))
    from notify import send_nonfatal
    send_nonfatal('[選股小幫手] 美股三大指數資料斷了',
                  f'執行日 {day}\n' + '\n'.join(problems) +
                  '\n\n可能原因：FinMind USStockPrice 改了權限或代號（^SOX／^GSPC／^DJI）、網路問題。'
                  '\n首頁加權指數旁的美股三格會停在舊日期。'
                  '\n手動補：python -m stock_collector.daily_collector --us-only，或 index_collector --start／--end。')


def collect_us_and_save(start_date=None, end_date=None):
    """只抓美股三大指數並寫入：台股休市日、批次模式結束後、--us-only 用（台股指數不受影響）。
    寫完做一次斷料檢查（check_us_staleness）。
    失敗只記錄、不 raise（美股不是關鍵任務，不可讓收集器 exit 1）。回傳寫入筆數。"""
    end_date = end_date or datetime.now().strftime('%Y-%m-%d')
    start_date = start_date or _us_window_start(end_date)
    n = 0
    try:
        df = collect_us_indices(start_date, end_date)
        if df.empty:
            logging.warning(f"美股三大指數 {start_date}～{end_date} 一筆都沒抓到")
        elif not FIREBASE_ENABLED:
            logging.warning(f"未設定 Firebase，美股 {len(df)} 筆跳過寫入")
        else:
            from firebase_writer import write_market_index
            n = write_market_index(df)
    except Exception as e:
        logging.warning(f"美股三大指數收集失敗（不影響台股）：{e}")
    check_us_staleness(end_date)
    return n


def collect_and_save(start_date=None, end_date=None, days=None, include_us=True):
    """
    收集並儲存指數資料（加權指數 + 台指期 + 美股三大指數）

    include_us=False：批次模式（--days／--backfill-gaps）迴圈內用，美股改在迴圈結束後跑一次（審查 F4）。
    ⚠️ 這裡不做美股斷料檢查：本函式被 daily_collector.collect_index 的 tenacity 重試包著，
       檢查會跟著重試、一班寄 3 封。呼叫端在重試外自己呼叫 check_us_staleness（2026-11-06 審查 F1）。

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

    # 收集加權指數
    taiex_df = collector.collect_taiex_daily(start_date, end_date)

    # 收集台指期
    tx_df = collector.collect_futures_daily(start_date, end_date)

    # 美股三大指數：往回多抓 US_LOOKBACK_DAYS 天（美股收盤在台灣清晨）；抓不到不算指數任務失敗
    us_df = collect_us_indices(_us_window_start(start_date), end_date) if include_us else pd.DataFrame()

    # 合併資料
    all_data = []
    if not taiex_df.empty:
        all_data.append(taiex_df)
    if not tx_df.empty:
        all_data.append(tx_df)
    if not us_df.empty:
        all_data.append(us_df)

    if not all_data:
        logging.error("無資料可儲存")
        return None

    df = pd.concat(all_data, ignore_index=True)

    # 寫入 Firestore
    if FIREBASE_ENABLED:
        from firebase_writer import write_market_index
        count = write_market_index(df)
        logging.info(f"已寫入 Firestore: {count} 筆")
    else:
        logging.warning("未設定 Firebase，跳過資料庫寫入")

    # ⚠️ 回傳值只算台股（TAIEX／TX）：daily_collector.collect_index 用「回傳非空」判斷成功。
    # 美股往回抓 US_LOOKBACK_DAYS（21）天幾乎永遠有列，若把它算進去，加權指數抓不到的日子就不會重試、也不會寄告警。
    tw = [d for d in (taiex_df, tx_df) if not d.empty]
    if not tw:
        logging.error("台股指數（加權指數、台指期）都沒有資料；美股指數照常寫入")
        return None
    return pd.concat(tw, ignore_index=True)


def main():
    """主程式"""
    import argparse

    parser = argparse.ArgumentParser(
        description='台股指數資料收集器（加權指數 + 台指期）',
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
    # 斷料檢查不在 collect_and_save 裡（見其 docstring），單獨執行時在這裡做一次
    check_us_staleness(args.end if (args.start and args.end) else datetime.now().strftime('%Y-%m-%d'))

    if df is not None and not df.empty:
        # 顯示統計
        taiex_count = len(df[df['index_id'] == 'TAIEX'])
        tx_count = len(df[df['index_id'] == 'TX'])
        print(f"\n✅ 成功收集 {len(df)} 筆指數資料")
        print(f"   - 加權指數: {taiex_count} 筆")
        print(f"   - 台指期: {tx_count} 筆")
        print(df.tail())
    else:
        print("\n❌ 收集失敗")

    elapsed = datetime.now() - start_time
    print(f"\n⏱️ 執行時間: {elapsed}")


if __name__ == "__main__":
    main()
