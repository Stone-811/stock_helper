"""
MACD 狀態計算：用本地年度檔（零 API），供每日收集標記多空。

（原本還有逐檔打 FinMind API 的 update_daily_file_macd / update_all_daily_files / main，
 已被 add_macd_from_archive 取代並移除——舊做法約 2000 次 API 無節流，生產環境一直 skip。）
"""
import pandas as pd
from pathlib import Path
from .indicators import get_macd_status


def add_macd_from_archive(df, target_date, data_dir):
    """
    用本地年度檔計算每檔 MACD 狀態（零 API），填入 df['macd_status']。

    get_macd_status 只需要收盤價序列，而完整歷史本地年度檔就有，
    不必逐檔向 FinMind 重抓。
    """
    df = df.copy()
    df['stock_id'] = df['stock_id'].astype(str)
    df['date'] = df['date'].astype(str)

    frames = [df[['stock_id', 'date', 'close']]]
    year = str(target_date)[:4]
    archive = Path(data_dir) / 'archive' / f'stocks_{year}.csv'
    if archive.exists():
        hist = pd.read_csv(archive, usecols=['stock_id', 'date', 'close'])
        hist['stock_id'] = hist['stock_id'].astype(str)
        hist['date'] = hist['date'].astype(str)
        frames.append(hist)

    combined = (pd.concat(frames, ignore_index=True)
                .drop_duplicates(['stock_id', 'date'])
                .sort_values(['stock_id', 'date']))

    status_map = {
        sid: get_macd_status(grp['close'].tail(60))
        for sid, grp in combined.groupby('stock_id')
    }
    df['macd_status'] = df['stock_id'].map(status_map).fillna('-')
    return df
