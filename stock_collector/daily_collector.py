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

# 確保 logs 目錄存在（必須在 basicConfig 之前，否則 FileHandler 開檔會 FileNotFoundError，
# 這在 Cloud Run 等沒有預建 logs/ 的環境會導致容器一啟動就崩潰）
Path('logs').mkdir(exist_ok=True)

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(f'logs/daily_collector_{datetime.now().strftime("%Y%m%d")}.log', encoding='utf-8')
    ]
)


class DailyCollector:
    """每日資料收集器"""

    def __init__(self):
        self.start_time = datetime.now()
        self.results = {
            'stock': {'success': False, 'count': 0, 'error': None},
            'index': {'success': False, 'count': 0, 'error': None},
            'matrix': {'success': False, 'count': 0, 'error': None},
        }
        # 休市日的說明（None＝有開盤或不確定）。不放進 self.results：print_summary／告警會逐項讀
        # results 的 success／count／error，多一個鍵會讓它們壞掉。
        self.market_closed = None
        self.day_log = []   # 批次模式逐日結果 (日期, 結果)，迴圈結束後印一份總表

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
        """取得交易日列表：依台股交易日曆，排除國定假日、補假與颱風停市（不只排除週末）。

        原本只排除週六日 → 平日假日（中秋、國慶補假…）每次都被 --backfill-gaps 當成缺漏重抓。
        日曆沒涵蓋的日子（下一年度行事曆還沒公布）退回週一到五，寧可多試也不要漏。
        """
        from stock_collector.trading_calendar import trading_days_between
        # with_actual：再聯集加權指數實際有 K 棒的日子——日曆萬一誤標休市，找缺口時也不會跟著漏
        return trading_days_between(start_date, end_date, with_actual=True)

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

        # 使用 collect_daily_data；MACD 改用本地年度檔計算（零 API，故不再 skip）（C7）
        filepath = collector.collect_daily_data(target_date=date, skip_macd=False)

        if filepath:
            # 讀取 CSV 檔案進行驗證
            df = pd.read_csv(filepath, low_memory=False, dtype={'stock_id': str})  # dtype 必要：否則 0050→50；年度檔含空值故 low_memory=False
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

        # C1: 輔助資料集若整批為 0，多半是收集時尚未發布（如外資持股盤後較晚），
        # 不視為失敗（會事後補），但明確警示，避免「未發布」被當「真的是 0」而靜默略過
        for col, label in [
            ('foreign_hold_ratio', '外資持股比例'),
            ('foreign_buy', '三大法人買賣超'),
            ('day_trading_volume', '當沖量'),
        ]:
            if col in df.columns and (df[col].fillna(0) == 0).all():
                logging.warning(f"⚠️ {label}（{col}）整批為 0，可能尚未發布，建議稍後重跑補寫")

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

        # 休市日（國定假日、補假、颱風停市）：不收集、不重算、不告警。
        # ⚠️ 三個來源（交易日曆、加權指數 K 棒、證交所當月成交清單）都說沒交易才跳過；
        #    日曆沒涵蓋（下一年度行事曆未公布）、任一來源抓不到、或來源互相矛盾時一律照常收集——
        #    寧可多一封誤報，也不要把真的交易日安靜漏掉（見 trading_calendar.py）。
        target = date or datetime.now().strftime('%Y-%m-%d')
        self.market_closed = None   # 批次模式（--days／--backfill-gaps）會連續呼叫，每天都要重設
        try:
            from stock_collector.trading_calendar import is_market_closed
            closed, why = is_market_closed(target)
        except Exception as e:
            closed, why = False, f'休市判斷失敗，照常收集：{e}'
        logging.info(f"🗓️ {target}：{why}")
        matrix_only = skip_stock and skip_index and not skip_matrix
        if closed and matrix_only:
            # 手動「只重算強勢股」（--skip-stock --skip-index）：跟今天有沒有開盤無關，照樣執行。
            # 重建 image 後常在週末跑這個指令驗證歷史重算，不可被休市判斷吞掉（2026-10-22 審查指出）。
            logging.info(f"🏖️ {target} 休市，但這次只重算強勢股 → 照常執行")
        elif closed:
            self.market_closed = why
            self.day_log.append((target, '休市跳過'))
            logging.info(f"🏖️ {target} 休市，本次不收集股票與指數、不重算強勢股、不檢查提醒、不寄告警")
            self.print_summary()
            return

        # 0. 從 Cloud Storage 下載年度檔（讓 Cloud Run 等 stateless 環境有持久歷史，供 MACD/強勢股計算）
        #    ⚠️ 下載失敗會 raise ArchiveSyncError，不在這裡接：整輪（批次模式也是）中止、由 main() 寄告警。
        #    拿殘缺的年度檔收集或重算，最後還會被上傳蓋掉 Storage 的完整歷史。
        from gcs_archive import download_archives, require_authoritative_archive
        require_authoritative_archive()
        download_archives('data/daily_reports/archive')

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

        # 4. 年度檔上傳回 Cloud Storage（供下次 stateless 執行使用）
        #    比下載時殘缺、或別的執行先更新過的檔不會上傳。失敗時資料已寫進 Firestore，
        #    所以先記下、把後面的 available_dates／self-check／到價提醒跑完，最後再 raise（main() 寄告警）。
        from gcs_archive import upload_archives, ArchiveUploadError
        upload_error = None
        try:
            upload_archives('data/daily_reports/archive')
        except ArchiveUploadError as e:
            upload_error = e
            logging.error(f"❌ 年度檔沒有存回 Storage：{e}")

        # 4.5 以 daily_data 實際日期更新 available_dates（C5：來源改為權威的 daily_data，
        #     而非強勢股矩陣，避免前端下拉選到沒有明細的日期）
        if not skip_stock:
            try:
                from firebase_writer import update_available_dates
                update_available_dates()
            except Exception as e:
                logging.warning(f"更新 available_dates 失敗: {e}")

        # 5. self-check：確認當日資料「真的寫進 Firestore」，而非只落在本地 CSV/GCS
        self._verify_firestore_written(date, skip_stock)

        # 6. 檢查使用者到價/訊號警示，達成則 Email 通知（僅在當日股票確實寫入後）
        if not skip_stock and self.results['stock']['success']:
            try:
                from stock_collector.alert_checker import check_alerts
                check_alerts(date)
            except Exception as e:
                logging.warning(f"警示檢查失敗: {e}")

        # 輸出總結
        self.print_summary()
        if not skip_stock:
            self.day_log.append((target, '已收集' if self.results['stock']['success'] else '失敗'))
        if upload_error:
            upload_error.target = target
            raise upload_error

    def print_batch_summary(self):
        """批次模式（--days／--backfill-gaps）結束時的總表：最後一天若是休市，log 結尾只會看到
        「休市日」，會蓋掉前面幾天的收集與失敗結果。"""
        if not self.day_log:
            return
        counts = {}
        for _, st in self.day_log:
            counts[st] = counts.get(st, 0) + 1
        logging.info("\n" + "=" * 70)
        logging.info("📋 批次總表：" + "、".join(f"{k} {v} 天" for k, v in counts.items()))
        for d, st in self.day_log:
            logging.info(f"  {d}：{st}")
        self.market_closed = None

    def _verify_firestore_written(self, date=None, skip_stock=False):
        """收集後驗證當日股票資料確實寫入 Firestore（而非只落在本地 CSV/GCS）。

        Cloud Run「exit 0」不代表寫入成功——曾因 ADC gate 誤判整批跳過寫入卻仍正常結束。
        僅在「這次有收集股票且收到當日資料」時檢查；非交易日（count=0）或 skip 不驗。
        驗證失敗會把 stock 標為 failed，讓 main() 以非 0 結束、Cloud Run execution 真的 FAIL。
        """
        if skip_stock or self.results['stock']['count'] <= 0:
            return
        target = date or datetime.now().strftime('%Y-%m-%d')
        try:
            from firebase_writer import get_daily_data_count
            written = get_daily_data_count(target)
        except Exception as e:
            logging.warning(f"self-check 無法讀取 Firestore（{e}），略過驗證")
            return
        if written <= 0:
            self.results['stock']['success'] = False
            self.results['stock']['error'] = (
                f"收集到 {self.results['stock']['count']} 筆，但 Firestore daily_data/{target} 為空"
                f"（寫入被跳過？檢查 FIREBASE_ENABLED / ADC）"
            )
            logging.error(f"❌ self-check 失敗：{self.results['stock']['error']}")
        else:
            logging.info(f"✓ self-check：daily_data/{target} 已落地 {written} 筆")

    def get_gap_dates(self):
        """找出 daily_data 已有資料範圍內「缺漏的交易日」（C3）。

        get_missing_dates 只看 latest_date 之後，抓不到中間缺口；此處掃 daily_data 實際
        日期，與「最早～最新」之間應有的交易日比對，回傳缺漏日期（升冪）。
        """
        try:
            from firebase_writer import list_daily_data_dates
            have = list_daily_data_dates()
        except Exception as e:
            logging.warning(f"無法讀取 daily_data 日期：{e}")
            return []
        if len(have) < 2:
            return []
        start = datetime.strptime(have[0], '%Y-%m-%d').date()
        end = datetime.strptime(have[-1], '%Y-%m-%d').date()
        expected = set(self.get_trading_days(start, end))
        return sorted(expected - set(have))

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

        if self.market_closed:
            logging.info(f"🏖️ 休市日，沒有收集任何資料（{self.market_closed}）")
            logging.info(f"⏱️ 耗時: {elapsed}")
            return

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


def _alert_failure(reason: str, collector):
    """組裝並寄出收集失敗告警（分區塊純文字）。缺 SMTP 設定時自動略過。"""
    try:
        from notify import send_alert
    except Exception:
        return
    r = collector.results
    task_names = {'stock': '股票資料', 'index': '指數資料', 'matrix': '強勢股矩陣'}
    lines = [
        '選股小幫手 每日收集器 — 異常告警',
        '=' * 40,
        f'時間　：{datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
        f'原因　：{reason}',
        '',
        '── 各任務結果 ──',
    ]
    for task, res in r.items():
        name = task_names.get(task, task)
        # 沒跑到的任務（休市跳過、或批次模式只最後重算）不可顯示成「失敗」
        ran = res['success'] or res['count'] or res['error']
        status = '✅ 成功' if res['success'] else ('❌ 失敗' if ran else '— 未執行')
        lines.append(f'{name}：{status}｜筆數 {res["count"]}')
        if res['error']:
            lines.append(f'　└ {res["error"]}')
    lines += [
        '',
        '── 建議處理 ──',
        '1. 查 Cloud Run 執行 log 確認失敗原因',
        '2. 手動補跑單日：python -m stock_collector.daily_collector --date YYYY-MM-DD',
        '3. 回補中間缺口：python -m stock_collector.daily_collector --backfill-gaps',
    ]
    send_alert('[選股小幫手] 收集異常告警', '\n'.join(lines))


def main():
    """主程式"""
    from gcs_archive import ArchiveSyncError, ArchiveUploadError
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
    parser.add_argument('--backfill-gaps', action='store_true', help='回補歷史區間內缺漏的交易日（C3）')
    parser.add_argument('--test-alert', action='store_true', help='寄一封測試告警信後結束（驗證 Email 設定）')
    parser.add_argument('--skip-stock', action='store_true', help='跳過股票資料')
    parser.add_argument('--skip-index', action='store_true', help='跳過指數資料')
    parser.add_argument('--skip-matrix', action='store_true', help='跳過強勢股矩陣')

    args = parser.parse_args()

    collector = DailyCollector()

    try:
        if args.test_alert:
            # 驗證 Email 告警管道
            from notify import send_alert
            ok = send_alert('[選股小幫手] 測試告警',
                            '這是一封測試信。\n收到代表收集器的 Email 告警管道設定正常。')
            return 0 if ok else 1

        if args.backfill_gaps:
            # C3：回補歷史區間內缺漏的交易日（掃 daily_data 找中間缺口）
            gaps = collector.get_gap_dates()
            if not gaps:
                logging.info("✓ 無缺漏交易日，daily_data 區間完整")
            else:
                preview = ', '.join(gaps[:10]) + ('...' if len(gaps) > 10 else '')
                logging.info(f"發現 {len(gaps)} 個缺漏交易日，開始回補：{preview}")
                for d in gaps:
                    logging.info(f"\n{'='*70}\n回補缺漏日：{d}")
                    collector.run_daily(date=d, skip_matrix=True)
                collector.update_strong_matrix()
                collector.print_batch_summary()
            return 0

        elif args.incremental:
            # ⚠️ 已停用：run_incremental 不經過年度檔下載／上傳（Cloud Run 上用空目錄收集，MACD 全是「-」、
            #    年度檔永遠缺那天），get_missing_dates 查的 collection 也早就不存在，實際只會補今天。
            logging.error("--incremental 已停用：補缺口請用 --backfill-gaps，補單日請用 --date YYYY-MM-DD")
            return 2

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
            collector.print_batch_summary()

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
    except ArchiveUploadError as e:
        day = getattr(e, 'target', None) or args.date or '今天'
        logging.error(f"\n❌ {day} 已收集，但年度檔沒有存回 Storage: {e}")
        _alert_failure(f"{day} 的資料已收集並寫入網站，但 Storage 年度檔沒有更新：{e}。"
                       f"下一輪會用舊的年度檔重算強勢股，請補跑 --date {day}", collector)
        return 1
    except ArchiveSyncError as e:
        logging.error(f"\n❌ 年度檔同步失敗，整輪中止: {e}")
        _alert_failure(f"年度檔與 Storage 同步失敗，這輪沒有收集也沒有上傳：{e}", collector)
        return 1
    except Exception as e:
        logging.error(f"\n❌ 執行失敗: {e}")
        _alert_failure(f"收集器執行崩潰：{e}", collector)
        return 1

    # 依收集結果決定 exit code（僅單日排程模式）：關鍵任務（股票/指數）未成功 → 非 0，
    # 讓 Cloud Run execution 真的 FAIL，「假成功」才可觀測。批次/增量/回補有自身語意，不套用。
    single_day_mode = not (args.incremental or args.backfill_gaps or args.days)
    if single_day_mode and collector.market_closed:
        logging.info("🏖️ 休市日 → exit 0（不寄告警）")
        return 0
    if single_day_mode:
        r = collector.results
        critical_failed = []
        if not args.skip_stock and not r['stock']['success']:
            critical_failed.append('stock')
        if not args.skip_index and not r['index']['success']:
            critical_failed.append('index')
        if critical_failed:
            logging.error(f"❌ 關鍵任務未成功：{critical_failed} → exit 1")
            _alert_failure(f"關鍵任務未成功：{critical_failed}", collector)
            return 1
    return 0


if __name__ == '__main__':
    exit(main())
