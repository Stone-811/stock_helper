"""
Supabase 資料寫入模組
負責將 DataFrame 寫入 Supabase PostgreSQL
"""

import os
import pandas as pd
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
import logging

# 載入環境變數
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)


def get_supabase_client() -> Client:
    """
    取得 Supabase client

    Returns:
    --------
    Client
        Supabase client 物件
    """
    url = os.getenv('SUPABASE_URL')
    key = os.getenv('SUPABASE_KEY')

    if not url or not key:
        raise ValueError("請設定 SUPABASE_URL 和 SUPABASE_KEY 環境變數")

    return create_client(url, key)


def write_daily_stocks(df: pd.DataFrame) -> int:
    """
    寫入每日股票資料到 Supabase

    Parameters:
    -----------
    df : pd.DataFrame
        每日股票資料，需包含以下欄位：
        date, stock_id, stock_name, open, high, low, close, volume,
        foreign_buy, trust_buy, dealer_buy,
        foreign_hold_ratio, foreign_remain_ratio, foreign_limit_ratio,
        macd_status

    Returns:
    --------
    int
        成功寫入的筆數
    """
    if df.empty:
        logging.warning("DataFrame 為空，跳過寫入")
        return 0

    try:
        client = get_supabase_client()

        # 去除重複資料（保留第一筆）
        df = df.drop_duplicates(subset=['date', 'stock_id'], keep='first')

        # 準備資料
        records = []
        for _, row in df.iterrows():
            record = {
                'date': str(row.get('date', '')),
                'stock_id': str(row.get('stock_id', '')),
                'stock_name': str(row.get('stock_name', '')),
                'open': float(row.get('open', 0)) if pd.notna(row.get('open')) else None,
                'high': float(row.get('high', 0)) if pd.notna(row.get('high')) else None,
                'low': float(row.get('low', 0)) if pd.notna(row.get('low')) else None,
                'close': float(row.get('close', 0)) if pd.notna(row.get('close')) else None,
                'volume': int(row.get('volume', 0)) if pd.notna(row.get('volume')) else 0,
                'foreign_buy': int(row.get('foreign_buy', 0)) if pd.notna(row.get('foreign_buy')) else 0,
                'trust_buy': int(row.get('trust_buy', 0)) if pd.notna(row.get('trust_buy')) else 0,
                'dealer_buy': int(row.get('dealer_buy', 0)) if pd.notna(row.get('dealer_buy')) else 0,
                'foreign_hold_ratio': float(row.get('foreign_hold_ratio', 0)) if pd.notna(row.get('foreign_hold_ratio')) else 0,
                'foreign_remain_ratio': float(row.get('foreign_remain_ratio', 0)) if pd.notna(row.get('foreign_remain_ratio')) else 0,
                'foreign_limit_ratio': float(row.get('foreign_limit_ratio', 0)) if pd.notna(row.get('foreign_limit_ratio')) else 0,
                'macd_status': str(row.get('macd_status', '-')) if pd.notna(row.get('macd_status')) else '-'
            }
            records.append(record)

        # 使用 upsert 避免重複寫入錯誤
        # on_conflict 指定衝突時更新的主鍵欄位
        result = client.table('daily_stocks').upsert(
            records,
            on_conflict='date,stock_id'
        ).execute()

        count = len(result.data) if result.data else 0
        logging.info(f"✓ 成功寫入 daily_stocks: {count} 筆")
        return count

    except Exception as e:
        logging.error(f"✗ 寫入 daily_stocks 失敗: {e}")
        raise


def write_strong_stock_matrix(df: pd.DataFrame) -> int:
    """
    寫入強勢股矩陣資料到 Supabase

    Parameters:
    -----------
    df : pd.DataFrame
        強勢股矩陣資料，格式為：
        - stock_id, stock_name 為固定欄位
        - 其他欄位為日期 (YYYY-MM-DD)，值為 0 或 1

    Returns:
    --------
    int
        成功寫入的筆數
    """
    if df.empty:
        logging.warning("DataFrame 為空，跳過寫入")
        return 0

    try:
        client = get_supabase_client()

        # 取得日期欄位（排除 stock_id 和 stock_name）
        date_columns = [col for col in df.columns if col not in ['stock_id', 'stock_name']]

        # 轉換為長格式 (stock_id, stock_name, date, is_strong)
        records = []
        for _, row in df.iterrows():
            stock_id = str(row['stock_id'])
            stock_name = str(row['stock_name'])

            for date_col in date_columns:
                is_strong = bool(row[date_col] == 1) if pd.notna(row[date_col]) else False
                records.append({
                    'stock_id': stock_id,
                    'stock_name': stock_name,
                    'date': date_col,
                    'is_strong': is_strong
                })

        # 分批寫入（每批 1000 筆，避免 payload 過大）
        batch_size = 1000
        total_count = 0

        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            result = client.table('strong_stock_matrix').upsert(
                batch,
                on_conflict='stock_id,date'
            ).execute()
            total_count += len(result.data) if result.data else 0

        logging.info(f"✓ 成功寫入 strong_stock_matrix: {total_count} 筆")
        return total_count

    except Exception as e:
        logging.error(f"✗ 寫入 strong_stock_matrix 失敗: {e}")
        raise


def test_connection() -> bool:
    """
    測試 Supabase 連線

    Returns:
    --------
    bool
        連線是否成功
    """
    try:
        client = get_supabase_client()
        # 嘗試查詢 daily_stocks 表（即使是空的也可以）
        result = client.table('daily_stocks').select('*').limit(1).execute()
        logging.info("✓ Supabase 連線成功")
        return True
    except Exception as e:
        logging.error(f"✗ Supabase 連線失敗: {e}")
        return False


if __name__ == "__main__":
    """測試 Supabase 連線和寫入"""
    print("=== Supabase 連線測試 ===")

    # 測試連線
    if test_connection():
        print("\n連線成功！可以開始寫入資料。")
    else:
        print("\n連線失敗！請檢查環境變數設定。")
        print("需要設定：")
        print("  SUPABASE_URL=https://xxxx.supabase.co")
        print("  SUPABASE_KEY=your_anon_key")
