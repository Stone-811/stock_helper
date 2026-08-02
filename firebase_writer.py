"""
Firebase Firestore 資料寫入模組（優化版）
使用聚合文件結構，大幅減少寫入次數

架構：
- daily_data/{date}                    # 每日摘要
- daily_data/{date}/chunks/chunk_{n}   # 股票分片（每片 500 筆）
- strong_stocks/{date}                 # 每日強勢股（單一文件）
- market_index/{index_id}              # 指數歷史（聚合）
- metadata/latest_date                 # 最新日期
- metadata/available_dates             # 可用日期列表
"""

import os
import json
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any
import pandas as pd

# Firebase Admin SDK
import firebase_admin
from firebase_admin import credentials, firestore

# 設定日誌
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

# Firebase 初始化
_db = None

# 常數
CHUNK_SIZE = 500  # 每個分片的股票數量


def get_firestore_client():
    """取得 Firestore 客戶端（單例模式）"""
    global _db

    if _db is not None:
        return _db

    # 尋找憑證檔案
    credential_paths = [
        Path(__file__).parent / 'frontend' / 'service-account.json',
        Path(__file__).parent / 'service-account.json',
        Path.home() / '.firebase' / 'service-account.json',
    ]

    cred = None
    for path in credential_paths:
        if path.exists():
            cred = credentials.Certificate(str(path))
            logging.info(f"使用憑證檔案: {path}")
            break

    # 使用環境變數
    if cred is None and os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY'):
        try:
            service_account = json.loads(os.getenv('FIREBASE_SERVICE_ACCOUNT_KEY'))
            cred = credentials.Certificate(service_account)
            logging.info("使用環境變數中的憑證")
        except json.JSONDecodeError:
            pass

    # 初始化 Firebase
    if not firebase_admin._apps:
        if cred is not None:
            firebase_admin.initialize_app(cred, {'projectId': 'stock-analysis-b5602'})
        else:
            # Cloud Run / GCP 環境：用 Application Default Credentials（同專案免放金鑰）
            logging.info("未找到明確憑證，改用 Application Default Credentials (ADC)")
            firebase_admin.initialize_app(options={'projectId': 'stock-analysis-b5602'})

    _db = firestore.client()
    return _db


def _convert_stock_row(row) -> Dict[str, Any]:
    """將 DataFrame 行轉換為字典"""
    return {
        'stock_id': str(row.get('stock_id', '')),
        'stock_name': str(row.get('stock_name', '')),
        'industry': str(row.get('industry', '')),
        'open': float(row.get('open', 0) or 0),
        'high': float(row.get('high', 0) or 0),
        'low': float(row.get('low', 0) or 0),
        'close': float(row.get('close', 0) or 0),
        'volume': int(row.get('volume', 0) or 0),
        'day_trading_volume': int(row.get('day_trading_volume', 0) or 0),
        'foreign_buy': int(row.get('foreign_buy', 0) or 0),
        'trust_buy': int(row.get('trust_buy', 0) or 0),
        'dealer_buy': int(row.get('dealer_buy', 0) or 0),
        'foreign_hold_ratio': float(row.get('foreign_hold_ratio', 0) or 0),
        'foreign_remain_ratio': float(row.get('foreign_remain_ratio', 0) or 0),
        'foreign_limit_ratio': float(row.get('foreign_limit_ratio', 0) or 0),
        'macd_status': str(row.get('macd_status', '') or '')
    }


def write_daily_stocks(df: pd.DataFrame) -> int:
    """
    寫入每日股票資料到 Firestore（優化版：使用分片）

    寫入次數：
    - 1 個摘要文件
    - N 個分片文件（每片 500 筆，約 5 個）
    - 1 個 metadata 更新
    總計：約 7 次寫入（原本 2,300+ 次）

    Parameters:
    -----------
    df : pd.DataFrame
        股票資料 DataFrame

    Returns:
    --------
    int : 寫入的股票數量
    """
    db = get_firestore_client()

    if df.empty:
        logging.warning("DataFrame 為空，跳過寫入")
        return 0

    # 確保必要欄位存在
    required_columns = ['date', 'stock_id']
    for col in required_columns:
        if col not in df.columns:
            raise ValueError(f"缺少必要欄位: {col}")

    date = str(df['date'].iloc[0])

    # 轉換所有股票資料
    stocks_data = [_convert_stock_row(row) for _, row in df.iterrows()]

    # 分片
    chunks = [stocks_data[i:i+CHUNK_SIZE] for i in range(0, len(stocks_data), CHUNK_SIZE)]

    batch = db.batch()

    # 1. 寫入摘要文件
    summary_ref = db.collection('daily_data').document(date)
    batch.set(summary_ref, {
        'date': date,
        'stock_count': len(stocks_data),
        'chunk_count': len(chunks),
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    # 2. 寫入分片
    for i, chunk in enumerate(chunks):
        chunk_ref = db.collection('daily_data').document(date).collection('chunks').document(f'chunk_{i}')
        batch.set(chunk_ref, {
            'chunk_index': i,
            'stocks': chunk,
            'count': len(chunk)
        })

    # 3. 更新 metadata：只在 date >= 現有 latest_date 時更新，避免補舊資料時 latest_date 倒退（C3）
    current = db.collection('metadata').document('latest_date').get()
    current_date = current.to_dict().get('date') if current.exists else None
    if current_date is None or date >= current_date:
        metadata_ref = db.collection('metadata').document('latest_date')
        batch.set(metadata_ref, {
            'date': date,
            'updated_at': firestore.SERVER_TIMESTAMP
        })

    # 提交批次
    batch.commit()

    logging.info(f"✓ 成功寫入 daily_data/{date}: {len(stocks_data)} 筆股票，{len(chunks)} 個分片")
    return len(stocks_data)


def write_strong_stocks(df: pd.DataFrame, date: str) -> int:
    """
    寫入單日強勢股到 Firestore（優化版：單一文件）

    寫入次數：1 次

    Parameters:
    -----------
    df : pd.DataFrame
        強勢股資料（僅該日）
    date : str
        日期

    Returns:
    --------
    int : 寫入的強勢股數量
    """
    db = get_firestore_client()

    if df.empty:
        logging.warning("沒有強勢股資料")
        return 0

    # 轉換資料
    strong_stocks = []
    for _, row in df.iterrows():
        strong_stocks.append({
            'stock_id': str(row.get('stock_id', '')),
            'stock_name': str(row.get('stock_name', '')),
        })

    # 寫入單一聚合文件
    doc_ref = db.collection('strong_stocks').document(date)
    doc_ref.set({
        'date': date,
        'stocks': strong_stocks,
        'count': len(strong_stocks),
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    logging.info(f"✓ 成功寫入 strong_stocks/{date}: {len(strong_stocks)} 筆")
    return len(strong_stocks)


def write_strong_stock_matrix(df: pd.DataFrame) -> int:
    """
    寫入強勢股矩陣到 Firestore（優化版：按日期聚合）

    寫入次數：每個日期 1 次 + metadata 1 次

    Parameters:
    -----------
    df : pd.DataFrame
        強勢股資料（pivot format 或 long format）

    Returns:
    --------
    int : 寫入的總強勢股數量
    """
    db = get_firestore_client()

    if df.empty:
        logging.warning("DataFrame 為空，跳過寫入")
        return 0

    # 判斷是 pivot 格式還是 long 格式
    if 'date' in df.columns and 'stock_id' in df.columns:
        # Long format
        strong_df = df[df.get('is_strong', df.get('strong', 0)) == 1].copy()
    else:
        # Pivot format: 將日期欄位轉為 long format
        date_columns = [col for col in df.columns if col not in ['stock_id', 'stock_name']]
        records = []

        for _, row in df.iterrows():
            stock_id = str(row['stock_id'])
            stock_name = str(row.get('stock_name', ''))

            for date_col in date_columns:
                if row[date_col] == 1:  # 強勢股
                    records.append({
                        'date': str(date_col),
                        'stock_id': stock_id,
                        'stock_name': stock_name
                    })

        strong_df = pd.DataFrame(records)

    if strong_df.empty:
        logging.warning("沒有強勢股資料")
        return 0

    # 按日期分組
    by_date: Dict[str, List[Dict]] = {}
    for _, row in strong_df.iterrows():
        date = str(row['date'])
        if date not in by_date:
            by_date[date] = []
        by_date[date].append({
            'stock_id': str(row['stock_id']),
            'stock_name': str(row.get('stock_name', ''))
        })

    total_written = 0
    all_dates = sorted(by_date.keys(), reverse=True)

    # 分批寫入（每批最多 500 個操作）
    batch_operations = 0
    batch = db.batch()

    for date in all_dates:
        stocks = by_date[date]
        doc_ref = db.collection('strong_stocks').document(date)
        batch.set(doc_ref, {
            'date': date,
            'stocks': stocks,
            'count': len(stocks),
            'updated_at': firestore.SERVER_TIMESTAMP
        })
        total_written += len(stocks)
        batch_operations += 1

        # 每 400 個操作提交一次（保留空間給 metadata）
        if batch_operations >= 400:
            batch.commit()
            logging.info(f"  已寫入 {len([d for d in all_dates if d >= date])} 個日期")
            batch = db.batch()
            batch_operations = 0

    # 更新 metadata
    metadata_ref = db.collection('metadata').document('available_dates')
    batch.set(metadata_ref, {
        'dates': all_dates[:100],  # 保留最近 100 天
        'updated_at': firestore.SERVER_TIMESTAMP
    })

    batch.commit()

    logging.info(f"✓ 成功寫入 strong_stocks: {len(all_dates)} 個日期，共 {total_written} 筆")
    return total_written


def write_market_index(df: pd.DataFrame) -> int:
    """
    寫入市場指數資料到 Firestore（優化版：聚合歷史）

    寫入次數：每個指數 1 次（累加歷史）

    Parameters:
    -----------
    df : pd.DataFrame
        指數資料 DataFrame

    Returns:
    --------
    int : 寫入的文件數量
    """
    db = get_firestore_client()

    if df.empty:
        logging.warning("DataFrame 為空，跳過寫入")
        return 0

    # 按 index_id 分組
    for index_id in df['index_id'].unique():
        index_df = df[df['index_id'] == index_id].sort_values('date')

        # 讀取現有歷史
        doc_ref = db.collection('market_index').document(index_id)
        doc = doc_ref.get()

        existing_history = []
        existing_dates = set()
        if doc.exists:
            existing_history = doc.to_dict().get('history', [])
            existing_dates = {h['date'] for h in existing_history}

        # 以 date 為 key upsert：同日覆蓋，讓盤中先存的不完整指數值事後可被修正（C6）
        merged = {h['date']: h for h in existing_history}
        for _, row in index_df.iterrows():
            date = str(row['date'])
            merged[date] = {
                'date': date,
                'open': float(row.get('open', 0)),
                'high': float(row.get('high', 0)),
                'low': float(row.get('low', 0)),
                'close': float(row.get('close', 0)),
                'volume': int(row.get('volume', 0)),
                'open_interest': int(row.get('open_interest', 0)),
                'settlement_price': float(row.get('settlement_price', 0))
            }
        all_history = sorted(merged.values(), key=lambda x: x['date'])

        # 寫入
        doc_ref.set({
            'index_id': index_id,
            'index_name': str(index_df['index_name'].iloc[0]) if 'index_name' in index_df.columns else index_id,
            'history': all_history,
            'latest_date': all_history[-1]['date'] if all_history else None,
            'record_count': len(all_history),
            'updated_at': firestore.SERVER_TIMESTAMP
        })

        logging.info(f"  {index_id}: 寫入/更新 {len(index_df)} 筆，總計 {len(all_history)} 筆")

    logging.info(f"✓ 成功寫入 market_index: {len(df['index_id'].unique())} 個指數")
    return len(df)


def get_daily_stocks(date: str) -> List[Dict]:
    """
    讀取每日股票資料（從分片重組）

    讀取次數：1 次摘要 + N 次分片（約 6 次）

    Parameters:
    -----------
    date : str
        日期

    Returns:
    --------
    List[Dict] : 股票資料列表
    """
    db = get_firestore_client()

    # 讀取摘要
    summary_ref = db.collection('daily_data').document(date)
    summary_doc = summary_ref.get()

    if not summary_doc.exists:
        return []

    summary = summary_doc.to_dict()
    chunk_count = summary.get('chunk_count', 0)

    # 讀取所有分片
    all_stocks = []
    for i in range(chunk_count):
        chunk_ref = summary_ref.collection('chunks').document(f'chunk_{i}')
        chunk_doc = chunk_ref.get()
        if chunk_doc.exists:
            chunk_data = chunk_doc.to_dict()
            all_stocks.extend(chunk_data.get('stocks', []))

    return all_stocks


def get_strong_stocks(date: str) -> List[Dict]:
    """
    讀取每日強勢股

    讀取次數：1 次

    Parameters:
    -----------
    date : str
        日期

    Returns:
    --------
    List[Dict] : 強勢股列表
    """
    db = get_firestore_client()

    doc_ref = db.collection('strong_stocks').document(date)
    doc = doc_ref.get()

    if not doc.exists:
        return []

    return doc.to_dict().get('stocks', [])


def get_market_index_history(index_id: str) -> List[Dict]:
    """
    讀取指數歷史

    讀取次數：1 次

    Parameters:
    -----------
    index_id : str
        指數 ID（TAIEX 或 TX）

    Returns:
    --------
    List[Dict] : 歷史資料列表
    """
    db = get_firestore_client()

    doc_ref = db.collection('market_index').document(index_id)
    doc = doc_ref.get()

    if not doc.exists:
        return []

    return doc.to_dict().get('history', [])


def test_connection():
    """測試 Firestore 連線"""
    try:
        db = get_firestore_client()

        # 寫入測試文件
        test_ref = db.collection('_test').document('connection_test')
        test_ref.set({
            'message': 'Firebase 連線測試成功',
            'timestamp': firestore.SERVER_TIMESTAMP
        })

        # 讀取測試文件
        doc = test_ref.get()
        if doc.exists:
            logging.info("✓ Firestore 連線測試成功")
            # 刪除測試文件
            test_ref.delete()
            return True
        else:
            logging.error("✗ 無法讀取測試文件")
            return False

    except Exception as e:
        logging.error(f"✗ Firestore 連線失敗: {e}")
        return False


if __name__ == "__main__":
    print("測試 Firebase 連線...")
    if test_connection():
        print("\n✅ Firebase 設定成功！")
    else:
        print("\n❌ Firebase 設定失敗，請檢查憑證")
