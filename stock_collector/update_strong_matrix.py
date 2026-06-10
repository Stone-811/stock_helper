"""
強勢股矩陣更新工具
讀取所有每日報表，計算強勢股標記，產生 pivot table 格式的 CSV
"""

import pandas as pd
import os
from pathlib import Path
import glob
import logging

# Supabase 寫入（若環境變數未設定則跳過）
SUPABASE_ENABLED = bool(os.getenv('SUPABASE_URL') and os.getenv('SUPABASE_KEY'))

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# 強勢股條件設定
STRONG_CONDITIONS = {
    'min_volume': 500,        # 最低成交量（張）
    'min_change_pct': 3.0,    # 最低漲幅（%）
    'require_up': True,       # 必須上漲（close > open）
    'require_institutional': True,  # 必須法人買超
}


def calculate_strong(df: pd.DataFrame) -> pd.DataFrame:
    """
    計算強勢股標記

    Parameters:
    -----------
    df : pd.DataFrame
        每日股票資料

    Returns:
    --------
    pd.DataFrame : 加入 strong 欄位的資料
    """
    # 計算漲幅
    if 'change_pct' not in df.columns:
        df['change_pct'] = ((df['close'] - df['open']) / df['open'] * 100).round(2)

    # 計算法人合計買超
    if 'institutional_buy' not in df.columns:
        df['institutional_buy'] = (
            df.get('foreign_buy', 0) +
            df.get('trust_buy', 0) +
            df.get('dealer_buy', 0)
        )

    # 強勢股條件
    conditions = (df['volume'] > STRONG_CONDITIONS['min_volume'])
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

    # 讀取所有每日報表
    all_files = sorted(glob.glob(str(data_path / 'daily_stock_*.csv')))

    if len(all_files) == 0:
        logging.error(f"找不到每日報表：{data_path}")
        return None

    logging.info(f"找到 {len(all_files)} 個每日報表")

    all_data = []

    for file in all_files:
        try:
            df = pd.read_csv(file)
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

    # 寫入 Supabase（若已設定）
    if SUPABASE_ENABLED:
        logging.info("寫入 Supabase...")
        try:
            import sys
            sys.path.insert(0, str(base_path))
            from supabase_writer import write_strong_stock_matrix
            write_strong_stock_matrix(pivot)
            logging.info("✓ Supabase 寫入完成")
        except Exception as e:
            logging.warning(f"⚠️ Supabase 寫入失敗: {e}")
            logging.warning("   CSV 已儲存，但 Supabase 未更新")

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

    return str(filepath)


def main():
    """主程式"""
    import argparse

    parser = argparse.ArgumentParser(description='強勢股矩陣更新工具')
    parser.add_argument('--data-dir', type=str, default='data/daily_reports', help='每日報表目錄')
    parser.add_argument('--output', type=str, default='strong_stock_matrix.csv', help='輸出檔案名稱')

    args = parser.parse_args()

    filepath = update_matrix(
        data_dir=args.data_dir,
        output_filename=args.output
    )

    if filepath:
        print(f"\n✅ 成功！矩陣已更新: {filepath}")
    else:
        print(f"\n❌ 失敗！")
        return 1

    return 0


if __name__ == "__main__":
    exit(main())
