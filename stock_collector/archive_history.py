"""年度檔歷史讀取：MACD 狀態（update_macd）與法人連買天數（streak）共用。

為什麼要跨年（2026-11-06 業主同意修「每年第一個交易日」的問題）：
以前兩支都只讀「當年」的 stocks_{year}.csv。一開年當年只有幾天資料 →
  - MACD 需要至少 26 個交易日，2027-01 起約 25 個交易日全站 MACD 都是「—」，到價提醒的 MACD 條件也不會觸發；
  - 連買／連賣天數在 1/1 歸零，跨年的連買被切斷。
現在當年不到 min_days 個交易日時，補上前一年年度檔的最後 min_days 個交易日（Cloud Run 開頭會從 GCS 下載全部年度檔）。

⚠️ 只取 target_date（含）以前：補舊日期時年度檔已經有之後的資料，tail() 會拿到「未來」的序列。
"""
from pathlib import Path

import pandas as pd


def _read(path: Path, cols, target_date: str) -> pd.DataFrame:
    hist = pd.read_csv(path, usecols=lambda c: c in cols, dtype={'stock_id': str})
    hist['stock_id'] = hist['stock_id'].astype(str)
    hist['date'] = hist['date'].astype(str)
    return hist[hist['date'] <= target_date]


def read_history(data_dir, target_date, cols, min_days: int = 60) -> pd.DataFrame:
    """讀 target_date（含）以前的年度檔歷史（只讀 cols 欄）。

    當年的交易日不到 min_days 天，就補前一年最後 min_days 個交易日；兩個檔都沒有回空的 DataFrame。
    呼叫端自己決定要取幾筆（tail），這裡只保證「夠長」。
    """
    target = str(target_date)
    year = int(target[:4])
    archive = Path(data_dir) / 'archive'
    frames = []

    cur_path = archive / f'stocks_{year}.csv'
    cur = _read(cur_path, cols, target) if cur_path.exists() else None
    if cur is not None:
        frames.append(cur)

    cur_days = cur['date'].nunique() if cur is not None else 0
    prev_path = archive / f'stocks_{year - 1}.csv'
    if cur_days < min_days and prev_path.exists():
        prev = _read(prev_path, cols, target)
        keep = sorted(prev['date'].unique())[-min_days:]
        frames.insert(0, prev[prev['date'].isin(keep)])

    if not frames:
        return pd.DataFrame(columns=list(cols))
    return pd.concat(frames, ignore_index=True)
