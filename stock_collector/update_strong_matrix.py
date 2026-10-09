"""
強勢股矩陣更新工具
讀取所有每日報表，計算強勢股標記，產生 pivot table 格式的 CSV
"""

import pandas as pd
import os
from pathlib import Path
import glob
import logging
from dotenv import load_dotenv

# 載入環境變數
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# Firebase 寫入：憑證檔存在，或在 GCP/Cloud Run 環境（ADC）。判斷集中於 config.firebase_enabled()
try:
    from . import config
except ImportError:  # 被當獨立腳本直接執行時（python stock_collector/update_strong_matrix.py）
    import config
FIREBASE_ENABLED = config.firebase_enabled()

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# 強勢股條件設定
STRONG_CONDITIONS = {
    'min_volume': 500,        # 最低成交量（張）
    'min_change_pct': 3.0,    # 最低漲幅（%，以前一交易日收盤為基準）
    'require_up': True,       # 必須上漲（close > open）
    'require_institutional': True,  # 必須法人買超
}


def add_change_pct(df: pd.DataFrame) -> pd.DataFrame:
    """
    計算漲跌幅 change_pct（%），以「前一交易日收盤」為基準

    台股慣例漲跌幅一律對前一交易日收盤計算；
    原本寫成 (close - open) / open 其實是「當日開→收的振幅」，
    會同時造成漏選（如 4973 廣穎昨收 135.5 → 收 149.0 實際 +9.96%，振幅僅 +2.76%）
    與誤選（如 6426 統新實際 −1.87%，振幅卻 +3.02%）。
    前端已於 2026-08-19 統一成同一條規則（見 SKILL.md），此處對齊。

    ⚠️ 前一日一律取「同一檔股票在資料中的前一筆」（groupby + shift），
       不可用日曆天推算（會踩到週末與假日）。

    ⚠️ fallback：`update_matrix()` 是以**每個年度檔一次**呼叫，
       所以每個年度檔的第一個交易日（如 2026-01-02）在自己的檔案裡取不到前一日
       → 退回用 open 當基準，與前端「prev_close > 0 ? prev_close : open」同一條規則。
       （不跨檔合併是為了記憶體：4 個年度檔共約 197 萬列，Cloud Run Job 只有 2Gi。）

    Parameters:
    -----------
    df : pd.DataFrame
        含整年、所有股票、所有日期的資料（需有 date / stock_id / open / close）

    Returns:
    --------
    pd.DataFrame : 加入 prev_close、change_pct 欄位的資料
    """
    # ⚠️ 年度檔有「同一 (date, stock_id) 兩列」的情形（改名/轉上市留下兩個 stock_name，
    #    數值完全相同；2023~2025 每個交易日約 24 組）。直接對原始列 shift(1) 會讓重複的
    #    第二列把「同一天的自己」當成前一日 → change_pct 變 0 → 該列被誤判為非強勢。
    #    故先對 (stock_id, date) 去重算前一日，再按鍵對回每一列（重複列拿到同一個前收）。
    uniq = (
        df[['stock_id', 'date', 'close']]
        .drop_duplicates(['stock_id', 'date'])
        .sort_values(['stock_id', 'date'])
    )
    prev_by_key = uniq.groupby('stock_id')['close'].shift(1)
    prev_by_key.index = pd.MultiIndex.from_arrays([uniq['stock_id'], uniq['date']])
    row_key = pd.MultiIndex.from_arrays([df['stock_id'], df['date']])
    # 排序只在副本上做，避免改動呼叫端的列順序
    prev_close = pd.Series(prev_by_key.reindex(row_key).to_numpy(), index=df.index)

    # 無前一日（年度檔第一個交易日 / 新掛牌首日）或前收異常 → 退回 open
    base = prev_close.where(prev_close > 0, df['open'])
    # 基準仍 <= 0（極少數髒資料）→ 留 NaN，條件比較自然為 False，不要除零變 inf
    base = base.where(base > 0)

    df['prev_close'] = prev_close
    df['change_pct'] = ((df['close'] - base) / base * 100).round(2)

    _assert_prev_close_sane(df, prev_close)

    return df


# 門檻只套在「檔案第一個交易日之後」的列上——那些列理論上都拿得到前一日，
# 唯一的例外是年中新掛牌（全史僅 385 檔次）。
#
# ⚠️ 不可改成「對全部列算 fallback 比例」：那個比例約等於 1/交易日數
#    （第一個交易日全部沒有前一日），年初 stocks_2026.csv 只有 10 天時就是 10%，
#    會把正常的檔案誤判成壞的。扣掉第一個交易日後，正常檔案實測 < 0.1%。
MAX_FALLBACK_RATIO = 0.05


def _assert_prev_close_sane(df: pd.DataFrame, prev_close: pd.Series) -> None:
    """
    護欄：確認這份 df 真的拿得到前一交易日收盤，否則**中止**而不是默默退回振幅。

    為什麼需要這道防線
    ------------------
    `update_matrix()` 在找不到年度檔時會退用 `daily_stock_*.csv`（每檔只有一天），
    而 `gcs_archive.download_archives()` 下載失敗時只記 warning 就回傳 0
    （gcs_archive.py:48-50）→ stateless 的 Cloud Run 會用當天資料重建出
    「只含一個日期」的 stocks_YYYY.csv。這兩種情況下每一列都取不到前一日
    → 全部 fallback 回 open → change_pct **又變回當日振幅**，
    而且日誌上完全看不出異常，卻會把 strong_stocks/{date} 覆寫成錯的判定。

    中止（raise）而非回傳 None：`update_matrix()` 的迴圈會 `except ... continue`
    跳過這個檔案，全部檔案都壞時 `all_data` 為空 → 直接 return None、不寫 Firestore。
    寧可不更新，也不要用錯的定義覆蓋歷史。
    """
    n_dates = df['date'].nunique() if 'date' in df.columns else 0
    if n_dates < 2:
        raise ValueError(
            f"資料只含 {n_dates} 個日期，算不出前一交易日收盤。"
            "強勢股判定需要整個年度檔（見 add_change_pct docstring）；"
            "若在雲端出現，先確認 GCS 年度檔是否下載成功。"
        )

    # 檔案第一個交易日本來就沒有前一日（那是正常的），不列入分母
    later = df['date'] != df['date'].min()
    n_later = int(later.sum())
    if n_later == 0:
        raise ValueError("只有一個交易日的資料，算不出前一交易日收盤。")

    ratio = float(prev_close[later].isna().mean())
    if ratio > MAX_FALLBACK_RATIO:
        raise ValueError(
            f"第一個交易日之後仍有 {ratio:.1%} 的列取不到前一交易日收盤"
            f"（門檻 {MAX_FALLBACK_RATIO:.0%}，正常年度檔 < 0.1%），"
            "判定會退化成當日振幅，故中止。"
        )


def calculate_strong(df: pd.DataFrame) -> pd.DataFrame:
    """
    計算強勢股標記

    ⚠️ df 必須包含「整年、所有股票、所有日期」（update_matrix 以每個年度檔一次呼叫），
       因為 change_pct 需要同一檔股票的前一交易日收盤。傳單日切片進來會讓
       所有列都落到 open fallback。

    Parameters:
    -----------
    df : pd.DataFrame
        每日股票資料（整個年度檔）

    Returns:
    --------
    pd.DataFrame : 加入 strong 欄位的資料
    """
    # 漲跌幅一律重算（以前一交易日收盤為基準），不沿用外部傳入的 change_pct，
    # 以免不同來源的定義（振幅／漲跌幅）混進強勢股判定
    df = add_change_pct(df)

    # 計算法人合計買超
    if 'institutional_buy' not in df.columns:
        df['institutional_buy'] = (
            df.get('foreign_buy', 0) +
            df.get('trust_buy', 0) +
            df.get('dealer_buy', 0)
        )

    # 強勢股條件
    conditions = (df['volume'] > STRONG_CONDITIONS['min_volume'])
    # ⚠️ 門檻套在**已四捨五入到小數 2 位**的 change_pct 上（與畫面顯示的數字同一把尺）。
    #    副作用：真實漲幅 3.004% → round(2)=3.0 → `3.0 > 3.0` 為 False 而落選。
    #    全史量測這種「因四捨五入被排除」的共 125 檔次（反方向 0 檔次），佔 68,815 的 0.18%。
    #    刻意保留：使用者在頁面上看到 3.00% 卻說它是「漲超過 3%」更難解釋。
    conditions &= (df['change_pct'] > STRONG_CONDITIONS['min_change_pct'])

    if STRONG_CONDITIONS['require_up']:
        conditions &= (df['close'] > df['open'])

    if STRONG_CONDITIONS['require_institutional']:
        conditions &= (df['institutional_buy'] > 0)

    df['strong'] = conditions.astype(int)

    return df


def update_matrix(data_dir: str = 'data/daily_reports', output_dir: str = 'data/strong_stock_matrix', output_filename: str = 'strong_stock_matrix.csv'):
    """
    更新強勢股矩陣

    Parameters:
    -----------
    data_dir : str
        每日報表目錄
    output_dir : str
        輸出目錄
    output_filename : str
        輸出檔案名稱
    """
    base_path = Path(__file__).parent.parent
    data_path = base_path / data_dir
    output_path = base_path / output_dir
    output_path.mkdir(parents=True, exist_ok=True)

    # 讀取年度合併檔案（優先）或每日報表（備用）
    archive_files = sorted(glob.glob(str(data_path / 'archive' / 'stocks_*.csv')))
    daily_files = sorted(glob.glob(str(data_path / 'daily_stock_*.csv')))

    if archive_files:
        all_files = archive_files
        logging.info(f"找到 {len(all_files)} 個年度合併檔案")
    elif daily_files:
        all_files = daily_files
        logging.info(f"找到 {len(all_files)} 個每日報表")
    else:
        logging.error(f"找不到資料檔案：{data_path}")
        return None

    all_data = []

    for file in all_files:
        try:
            df = pd.read_csv(file, low_memory=False, dtype={'stock_id': str})
            df = calculate_strong(df)

            # 取需要的欄位
            df_subset = df[['date', 'stock_id', 'stock_name', 'strong']].copy()
            all_data.append(df_subset)

            # 統計
            strong_count = df['strong'].sum()
            date = df['date'].iloc[0] if len(df) > 0 else 'unknown'
            logging.info(f"  {Path(file).name}: {strong_count} 檔強勢股")

        except Exception as e:
            logging.error(f"處理檔案失敗 {file}: {e}")
            continue

    if len(all_data) == 0:
        logging.error("沒有可用的資料")
        return None

    # 合併所有資料
    combined = pd.concat(all_data, ignore_index=True)

    # Pivot：row=股票, columns=日期, values=strong
    pivot = combined.pivot_table(
        index=['stock_id', 'stock_name'],
        columns='date',
        values='strong',
        aggfunc='first'
    ).fillna(0).astype(int)

    # 重設 index
    pivot = pivot.reset_index()

    # 儲存
    filepath = output_path / output_filename
    pivot.to_csv(filepath, index=False, encoding='utf-8-sig')

    # 寫入 Firestore（若已設定）
    if FIREBASE_ENABLED:
        logging.info("寫入 Firestore...")
        try:
            import sys
            sys.path.insert(0, str(base_path))
            from firebase_writer import write_strong_stock_matrix
            write_strong_stock_matrix(pivot)
            logging.info("✓ Firestore 寫入完成")
        except Exception as e:
            logging.warning(f"⚠️ Firestore 寫入失敗: {e}")
            logging.warning("   CSV 已儲存，但 Firestore 未更新")

    # 統計
    date_cols = [c for c in pivot.columns if c not in ['stock_id', 'stock_name']]

    logging.info("=" * 50)
    logging.info(f"強勢股矩陣已更新: {filepath}")
    logging.info(f"股票數: {len(pivot)}")
    logging.info(f"日期數: {len(date_cols)}")
    logging.info("=" * 50)

    for col in date_cols:
        count = pivot[col].sum()
        logging.info(f"  {col}: {count} 檔強勢股")

    # 回傳股票數（非路徑）——供 daily_collector 統計與 print_summary 正確顯示筆數
    return len(pivot)


def main():
    """主程式"""
    import argparse

    parser = argparse.ArgumentParser(description='強勢股矩陣更新工具')
    parser.add_argument('--data-dir', type=str, default='data/daily_reports', help='每日報表目錄')
    parser.add_argument('--output', type=str, default='strong_stock_matrix.csv', help='輸出檔案名稱')

    args = parser.parse_args()

    count = update_matrix(
        data_dir=args.data_dir,
        output_filename=args.output
    )

    if count:
        print(f"\n✅ 成功！強勢股矩陣已更新（{count} 檔股票）")
    else:
        print(f"\n❌ 失敗！")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
