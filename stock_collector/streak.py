"""法人連續買賣天數：用本地年度檔（零 API），供每日收集標記外資/投信連買連賣。

仿 update_macd.add_macd_from_archive：只需買賣超序列，完整歷史本地年度檔就有，
不必逐檔向 FinMind 重抓。
"""
import pandas as pd
from pathlib import Path
from .indicators import get_buy_streak

# 只看最近這麼多個交易日算連續（連買/連賣極少超過，且省時省記憶體）
_LOOKBACK = 60


def add_streak_from_archive(df, target_date, data_dir):
    """計算每檔法人連續買賣天數，填入 df['foreign_streak']、df['trust_streak']。

    外資（foreign_buy）、投信（trust_buy）連續同向天數：連買 +N、連賣 -N，最新為 0 或無資料回 0。
    """
    df = df.copy()
    df['stock_id'] = df['stock_id'].astype(str)
    df['date'] = df['date'].astype(str)

    cols = ['stock_id', 'date', 'foreign_buy', 'trust_buy']
    frames = [df[[c for c in cols if c in df.columns]]]
    year = str(target_date)[:4]
    archive = Path(data_dir) / 'archive' / f'stocks_{year}.csv'
    if archive.exists():
        hist = pd.read_csv(archive, usecols=lambda c: c in cols, dtype={'stock_id': str})
        hist['stock_id'] = hist['stock_id'].astype(str)
        hist['date'] = hist['date'].astype(str)
        frames.append(hist)

    combined = (pd.concat(frames, ignore_index=True)
                .drop_duplicates(['stock_id', 'date'])
                .sort_values(['stock_id', 'date']))

    for col, out in [('foreign_buy', 'foreign_streak'), ('trust_buy', 'trust_streak')]:
        if col in combined.columns:
            streak_map = {
                sid: get_buy_streak(grp[col].tail(_LOOKBACK).fillna(0))
                for sid, grp in combined.groupby('stock_id')
            }
            df[out] = df['stock_id'].map(streak_map).fillna(0).astype(int)
        else:
            df[out] = 0
    return df
