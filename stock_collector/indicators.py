"""
技術指標（collector 端）。目前只需 MACD 狀態，供每日收集標記多空。
（原本在 utils.py，該檔其餘為舊 Streamlit 版遺留的死碼，已移除。）
"""


def get_macd_status(close_prices):
    """
    計算 MACD 狀態（多/空）。

    close_prices: 收盤價序列（至少需要 26 個資料點）
    回傳: '多'（多頭）/ '空'（空頭）/ '-'（資料不足）
    """
    if len(close_prices) < 26:
        return '-'

    ema12 = close_prices.ewm(span=12, adjust=False).mean()
    ema26 = close_prices.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    histogram = macd - signal

    return '多' if histogram.iloc[-1] > 0 else '空'


def get_buy_streak(net_values):
    """法人連續同向買賣天數。

    net_values: 買賣超序列（時間升冪，正=買超、負=賣超；單位張）
    回傳: 連買 +N、連賣 -N；最新一日為 0 或無資料回 0。
      例：[..., +100, +50, +200] → +3；[..., -10, -20] → -2。
    """
    vals = list(net_values)
    if not vals:
        return 0
    last = vals[-1]
    sign = 1 if last > 0 else (-1 if last < 0 else 0)
    if sign == 0:
        return 0
    n = 0
    for v in reversed(vals):
        if (sign == 1 and v > 0) or (sign == -1 and v < 0):
            n += 1
        else:
            break
    return n * sign
