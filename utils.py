"""
台灣股票選股小幫手 - 工具函數模組
包含所有技術指標計算和資料處理函數
"""

import pandas as pd
from datetime import datetime, timedelta
import os
from pathlib import Path
from dotenv import load_dotenv
from FinMind.data import DataLoader

# 載入環境變數
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)


def initialize_finmind_api():
    """
    初始化 FinMind API 並自動登入
    優先使用 API Token，其次使用帳號密碼

    Returns:
    --------
    DataLoader
        已登入的 FinMind API 物件
    """
    api = DataLoader()

    try:
        # 優先使用 API Token
        api_token = os.getenv('FINMIND_API_TOKEN', '')
        if api_token:
            api.login_by_token(api_token=api_token)
            print("✓ 已使用 API Token 登入 FinMind")
            return api

        # 使用帳號密碼登入
        user_id = os.getenv('FINMIND_USER_ID', '')
        password = os.getenv('FINMIND_PASSWORD', '')
        if user_id and password:
            api.login(user_id=user_id, password=password)
            print("✓ 已使用帳號密碼登入 FinMind")
            return api

        # 未設定認證資訊
        print("⚠️  未設定 FinMind 認證資訊，使用免費版 API（有限制）")
        print("   請參考 .env.example 設定 API Token 或帳號密碼")

    except Exception as e:
        print(f"✗ FinMind 登入失敗: {e}")
        print("   將使用免費版 API（有限制）")

    return api


def calculate_macd(df, fast=12, slow=26, signal=9):
    """
    計算 MACD 指標

    Parameters:
    -----------
    df : pd.DataFrame
        包含 'close' 欄位的股價資料
    fast : int
        快線 EMA 週期，預設 12
    slow : int
        慢線 EMA 週期，預設 26
    signal : int
        信號線 EMA 週期，預設 9

    Returns:
    --------
    tuple : (macd, signal_line, histogram)
        MACD 線、信號線、柱狀圖
    """
    # 計算快線 EMA
    ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
    # 計算慢線 EMA
    ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
    # 計算 DIF (MACD線)
    macd = ema_fast - ema_slow
    # 計算 DEM (信號線)
    signal_line = macd.ewm(span=signal, adjust=False).mean()
    # 計算柱狀圖 (histogram)
    histogram = macd - signal_line

    return macd, signal_line, histogram


def get_macd_status(close_prices):
    """
    計算 MACD 狀態（多/空）

    Parameters:
    -----------
    close_prices : pd.Series
        收盤價序列（至少需要 26 個資料點）

    Returns:
    --------
    str
        '多' (多頭), '空' (空頭), or '-' (資料不足)
    """
    if len(close_prices) < 26:
        return '-'

    # 計算 EMA
    ema12 = close_prices.ewm(span=12, adjust=False).mean()
    ema26 = close_prices.ewm(span=26, adjust=False).mean()

    # 計算 MACD 和柱狀圖
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    histogram = macd - signal

    return '多' if histogram.iloc[-1] > 0 else '空'


def get_macd_signal(histogram, previous_histogram):
    """
    判斷 MACD 訊號

    Parameters:
    -----------
    histogram : float
        當前柱狀圖值
    previous_histogram : float
        前一個柱狀圖值

    Returns:
    --------
    str
        訊號類型: "golden_cross", "death_cross", "bullish", "bearish"
    """
    if histogram > 0 and previous_histogram <= 0:
        return "golden_cross"  # 黃金交叉 - 買進訊號
    elif histogram < 0 and previous_histogram >= 0:
        return "death_cross"  # 死亡交叉 - 賣出訊號
    elif histogram > 0:
        return "bullish"  # 多頭排列
    else:
        return "bearish"  # 空頭排列


def get_stock_name(api, stock_id):
    """
    取得股票名稱

    Parameters:
    -----------
    api : DataLoader
        FinMind API 物件
    stock_id : str
        股票代碼

    Returns:
    --------
    str
        股票名稱，若找不到則返回股票代碼
    """
    stock_info = api.taiwan_stock_info()
    stock_name = stock_info[stock_info['stock_id'] == stock_id]['stock_name'].values
    return stock_name[0] if len(stock_name) > 0 else stock_id


def search_stock_by_name_or_id(api, query):
    """
    透過股票代碼或中文名稱搜尋股票

    Parameters:
    -----------
    api : DataLoader
        FinMind API 物件
    query : str
        搜尋關鍵字（股票代碼或中文名稱）

    Returns:
    --------
    tuple : (stock_id, stock_name, matches)
        stock_id: 找到的股票代碼（單一結果）或 None
        stock_name: 找到的股票名稱（單一結果）或 None
        matches: 所有符合的股票列表 [(stock_id, stock_name), ...]
    """
    try:
        stock_info = api.taiwan_stock_info()
        query = query.strip()

        # 去除重複的股票代碼（保留第一筆）
        stock_info = stock_info.drop_duplicates(subset=['stock_id'], keep='first')

        # 如果是純數字，優先當作股票代碼查詢
        if query.isdigit():
            exact_match = stock_info[stock_info['stock_id'] == query]
            if len(exact_match) > 0:
                return (
                    exact_match.iloc[0]['stock_id'],
                    exact_match.iloc[0]['stock_name'],
                    [(exact_match.iloc[0]['stock_id'], exact_match.iloc[0]['stock_name'])]
                )

        # 搜尋中文名稱（模糊搜尋）
        matches = stock_info[stock_info['stock_name'].str.contains(query, case=False, na=False)]

        if len(matches) == 0:
            return None, None, []
        elif len(matches) == 1:
            # 找到唯一結果
            return (
                matches.iloc[0]['stock_id'],
                matches.iloc[0]['stock_name'],
                [(matches.iloc[0]['stock_id'], matches.iloc[0]['stock_name'])]
            )
        else:
            # 找到多個結果，去除重複後返回
            matches = matches.drop_duplicates(subset=['stock_id'], keep='first')
            match_list = [(row['stock_id'], row['stock_name']) for _, row in matches.iterrows()]
            return None, None, match_list

    except Exception as e:
        return None, None, []


def calculate_price_change(latest_data, previous_data):
    """
    計算價格變化和變化百分比

    Parameters:
    -----------
    latest_data : pd.Series
        最新的股價資料
    previous_data : pd.Series
        前一筆股價資料

    Returns:
    --------
    tuple : (price_change, price_change_pct)
        價格變化和變化百分比
    """
    price_change = latest_data['close'] - previous_data['close']
    price_change_pct = (price_change / previous_data['close']) * 100

    return price_change, price_change_pct


def calculate_rsi(df, period=14):
    """計算 RSI 指標"""
    delta = df['close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss
    rsi = 100 - (100 / (1 + rs))
    return rsi


def calculate_kd(df, period=9, k_period=3, d_period=3):
    """計算 KD 指標"""
    low_min = df['min'].rolling(window=period).min()
    high_max = df['max'].rolling(window=period).max()
    rsv = (df['close'] - low_min) / (high_max - low_min) * 100
    k_values = rsv.ewm(span=k_period, adjust=False).mean()
    d_values = k_values.ewm(span=d_period, adjust=False).mean()
    return k_values, d_values


def calculate_ma(df, period):
    """計算移動平均線"""
    return df['close'].rolling(window=period).mean()


def analyze_technical_indicators(stock_data):
    """
    分析四大技術指標並給出建議

    Returns:
    --------
    dict: 包含四大指標的分析結果
    """
    if len(stock_data) < 30:
        return None

    # 計算技術指標
    macd, signal_line, histogram = calculate_macd(stock_data)
    rsi = calculate_rsi(stock_data)
    k_values, d_values = calculate_kd(stock_data)
    ma5 = calculate_ma(stock_data, 5)
    ma20 = calculate_ma(stock_data, 20)

    # 取得最新值
    latest_close = stock_data['close'].iloc[-1]
    latest_macd = macd.iloc[-1]
    latest_signal = signal_line.iloc[-1]
    latest_histogram = histogram.iloc[-1]
    prev_histogram = histogram.iloc[-2]
    latest_rsi = rsi.iloc[-1]
    latest_k = k_values.iloc[-1]
    latest_d = d_values.iloc[-1]
    prev_k = k_values.iloc[-2]
    prev_d = d_values.iloc[-2]
    latest_ma5 = ma5.iloc[-1]
    latest_ma20 = ma20.iloc[-1]

    # MACD 判斷
    if latest_histogram > 0 and prev_histogram <= 0:
        macd_rec = "買進"
        macd_reason = "黃金交叉"
    elif latest_histogram < 0 and prev_histogram >= 0:
        macd_rec = "賣出"
        macd_reason = "死亡交叉"
    elif latest_histogram > 0:
        macd_rec = "持有"
        macd_reason = "多頭排列"
    else:
        macd_rec = "觀望"
        macd_reason = "空頭排列"

    # RSI 判斷
    if latest_rsi < 30:
        rsi_rec = "買進"
        rsi_reason = f"超賣區 ({latest_rsi:.1f})"
    elif latest_rsi > 70:
        rsi_rec = "賣出"
        rsi_reason = f"超買區 ({latest_rsi:.1f})"
    elif 30 <= latest_rsi <= 50:
        rsi_rec = "觀望"
        rsi_reason = f"中性偏弱 ({latest_rsi:.1f})"
    else:
        rsi_rec = "持有"
        rsi_reason = f"中性偏強 ({latest_rsi:.1f})"

    # KD 判斷
    if latest_k > latest_d and prev_k <= prev_d and latest_k < 20:
        kd_rec = "買進"
        kd_reason = "低檔黃金交叉"
    elif latest_k < latest_d and prev_k >= prev_d and latest_k > 80:
        kd_rec = "賣出"
        kd_reason = "高檔死亡交叉"
    elif latest_k > latest_d:
        kd_rec = "持有"
        kd_reason = f"K>D (K:{latest_k:.1f}, D:{latest_d:.1f})"
    else:
        kd_rec = "觀望"
        kd_reason = f"K<D (K:{latest_k:.1f}, D:{latest_d:.1f})"

    # 均線判斷
    if latest_close > latest_ma5 > latest_ma20:
        ma_rec = "買進"
        ma_reason = "多頭排列"
    elif latest_close < latest_ma5 < latest_ma20:
        ma_rec = "賣出"
        ma_reason = "空頭排列"
    elif latest_close > latest_ma5 and latest_ma5 < latest_ma20:
        ma_rec = "觀望"
        ma_reason = "突破短均"
    else:
        ma_rec = "觀望"
        ma_reason = "盤整格局"

    # 綜合判斷
    buy_count = [macd_rec, rsi_rec, kd_rec, ma_rec].count("買進")
    sell_count = [macd_rec, rsi_rec, kd_rec, ma_rec].count("賣出")

    if buy_count >= 3:
        overall = "強力買進"
    elif buy_count >= 2:
        overall = "買進"
    elif sell_count >= 3:
        overall = "強力賣出"
    elif sell_count >= 2:
        overall = "賣出"
    else:
        overall = "中性觀望"

    return {
        'macd': {'recommendation': macd_rec, 'reason': macd_reason, 'value': latest_macd},
        'rsi': {'recommendation': rsi_rec, 'reason': rsi_reason, 'value': latest_rsi},
        'kd': {'recommendation': kd_rec, 'reason': kd_reason, 'k': latest_k, 'd': latest_d},
        'ma': {'recommendation': ma_rec, 'reason': ma_reason, 'ma5': latest_ma5, 'ma20': latest_ma20},
        'overall': overall
    }


def calculate_volume_ma(df, period=20):
    """
    計算成交量移動平均

    Parameters:
    -----------
    df : pd.DataFrame
        包含 'Trading_Volume' 欄位的股價資料
    period : int
        計算週期，預設 20

    Returns:
    --------
    pd.Series
        成交量移動平均
    """
    return df['Trading_Volume'].rolling(window=period).mean()


def check_volume_conditions(stock_data, min_avg_volume=1000, volume_surge_pct=1.15):
    """
    檢查成交量條件

    Parameters:
    -----------
    stock_data : pd.DataFrame
        股價資料
    min_avg_volume : int
        最小平均成交量（張），預設 1000
    volume_surge_pct : float
        爆量比例，預設 1.15 (115%)

    Returns:
    --------
    dict : 包含是否符合條件及相關數據
    """
    if len(stock_data) < 20:
        return {
            'pass': False,
            'condition1_pass': False,
            'condition2_pass': False,
            'latest_volume': 0,
            'volume_ma20': 0,
            'volume_ratio': 0,
            'error': '資料不足'
        }

    # 計算20日成交量均線
    volume_ma20 = calculate_volume_ma(stock_data, period=20)

    # 取得最新資料（股數）
    latest_volume_shares = stock_data['Trading_Volume'].iloc[-1]
    latest_volume_ma20_shares = volume_ma20.iloc[-1]

    # 轉換為張數（1張 = 1000股）
    latest_volume_lots = latest_volume_shares / 1000
    latest_volume_ma20_lots = latest_volume_ma20_shares / 1000

    # 條件1: 20日平均成交量 > 1000張
    condition1 = latest_volume_ma20_lots > min_avg_volume

    # 條件2: 當日成交量 > 20日均量的115%
    condition2 = latest_volume_lots > (latest_volume_ma20_lots * volume_surge_pct)

    return {
        'pass': condition1 and condition2,
        'condition1_pass': condition1,
        'condition2_pass': condition2,
        'latest_volume': latest_volume_lots,  # 回傳張數
        'volume_ma20': latest_volume_ma20_lots,  # 回傳張數
        'volume_ratio': (latest_volume_lots / latest_volume_ma20_lots) if latest_volume_ma20_lots > 0 else 0
    }


def calculate_ma60(df):
    """
    計算60日移動平均線

    Parameters:
    -----------
    df : pd.DataFrame
        包含 'close' 欄位的股價資料

    Returns:
    --------
    pd.Series
        60日移動平均
    """
    return df['close'].rolling(window=60).mean()


def check_ma_bullish_alignment(stock_data):
    """
    檢查是否符合多頭排列：收盤價 > MA5 > MA20 > MA60

    Parameters:
    -----------
    stock_data : pd.DataFrame
        股價資料

    Returns:
    --------
    tuple : (bool, dict)
        是否符合條件及詳細數據
    """
    if len(stock_data) < 60:
        return False, {
            'pass': False,
            'error': '資料不足（需要至少60筆資料）',
            'close': 0,
            'ma5': 0,
            'ma20': 0,
            'ma60': 0
        }

    # 計算均線
    ma5 = calculate_ma(stock_data, 5)
    ma20 = calculate_ma(stock_data, 20)
    ma60 = calculate_ma60(stock_data)

    # 取得最新值
    latest_close = stock_data['close'].iloc[-1]
    latest_ma5 = ma5.iloc[-1]
    latest_ma20 = ma20.iloc[-1]
    latest_ma60 = ma60.iloc[-1]

    # 檢查多頭排列：收盤價 > MA5 > MA20 > MA60
    pass_check = (latest_close > latest_ma5 > latest_ma20 > latest_ma60)

    return pass_check, {
        'pass': pass_check,
        'close': latest_close,
        'ma5': latest_ma5,
        'ma20': latest_ma20,
        'ma60': latest_ma60
    }


def check_macd_positive(stock_data):
    """
    檢查 MACD 是否為正值

    Parameters:
    -----------
    stock_data : pd.DataFrame
        股價資料

    Returns:
    --------
    tuple : (bool, float)
        是否為正值及 MACD 值
    """
    if len(stock_data) < 26:
        return False, 0.0

    macd, signal_line, histogram = calculate_macd(stock_data)
    latest_macd = macd.iloc[-1]

    return latest_macd > 0, latest_macd


def check_institutional_investors(api, stock_id, end_date):
    """
    檢查外資、投信買進張數是否超過 1000 張

    Parameters:
    -----------
    api : DataLoader
        FinMind API 物件
    stock_id : str
        股票代碼
    end_date : str
        查詢日期 (YYYY-MM-DD)

    Returns:
    --------
    dict : 包含法人買賣資訊
    """
    try:
        # 往前抓5天資料（避免假日或無交易日）
        start_date = (datetime.strptime(end_date, '%Y-%m-%d') - timedelta(days=5)).strftime('%Y-%m-%d')

        institutional_data = api.taiwan_stock_institutional_investors(
            stock_id=stock_id,
            start_date=start_date,
            end_date=end_date
        )

        if len(institutional_data) == 0:
            return {
                'foreign_investor_pass': False,
                'investment_trust_pass': False,
                'foreign_buy': 0,
                'investment_trust_buy': 0,
                'error': '無法人資料'
            }

        # 取最新一筆資料
        latest_date = institutional_data['date'].max()
        latest_data = institutional_data[institutional_data['date'] == latest_date]

        # 外資買進張數
        foreign_data = latest_data[latest_data['name'] == 'Foreign_Investor']
        foreign_buy = foreign_data['buy'].values[0] if len(foreign_data) > 0 else 0

        # 投信買進張數
        trust_data = latest_data[latest_data['name'] == 'Investment_Trust']
        trust_buy = trust_data['buy'].values[0] if len(trust_data) > 0 else 0

        # 判斷是否符合條件
        foreign_pass = foreign_buy > 1000
        trust_pass = trust_buy > 1000

        return {
            'foreign_investor_pass': foreign_pass,
            'investment_trust_pass': trust_pass,
            'foreign_buy': int(foreign_buy),
            'investment_trust_buy': int(trust_buy),
            'pass': foreign_pass and trust_pass
        }

    except Exception as e:
        return {
            'foreign_investor_pass': False,
            'investment_trust_pass': False,
            'foreign_buy': 0,
            'investment_trust_buy': 0,
            'error': str(e)
        }


def check_volume_and_price(stock_data):
    """
    檢查成交量是否大於 500 張，計算漲幅

    Parameters:
    -----------
    stock_data : pd.DataFrame
        股價資料

    Returns:
    --------
    dict : 包含成交量與漲幅資訊
    """
    if len(stock_data) < 2:
        return {
            'volume_pass': False,
            'volume': 0,
            'price_change_pct': 0,
            'error': '資料不足'
        }

    # 取得最新資料
    latest_data = stock_data.iloc[-1]
    previous_data = stock_data.iloc[-2]

    # 成交量（張）
    latest_volume = latest_data['Trading_Volume']

    # 漲幅
    price_change, price_change_pct = calculate_price_change(latest_data, previous_data)

    # 判斷成交量是否大於 500 張
    volume_pass = latest_volume > 500

    return {
        'volume_pass': volume_pass,
        'volume': int(latest_volume),
        'price_change': price_change,
        'price_change_pct': price_change_pct
    }


def advanced_stock_screening(api, progress_callback=None):
    """
    執行完整的進階選股流程（全市場）

    Parameters:
    -----------
    api : DataLoader
        FinMind API 物件
    progress_callback : callable
        進度回調函數 callback(current, total, stock_id, stock_name, status)

    Returns:
    --------
    pd.DataFrame
        篩選結果（漲幅前100名）
    """
    import time

    # 取得全市場股票清單
    stock_list = api.taiwan_stock_info()
    # 僅保留上市上櫃股票（4位數字代碼）
    stock_list = stock_list[stock_list['stock_id'].str.match(r'^\d{4}$')]
    stock_list = stock_list.drop_duplicates(subset=['stock_id'], keep='first')

    results = []
    end_date = datetime.now()
    start_date = end_date - timedelta(days=120)  # 需要至少60個交易日

    total = len(stock_list)
    request_count = 0

    for idx, row in stock_list.iterrows():
        stock_id = row['stock_id']
        stock_name = row['stock_name']

        # 更新進度
        if progress_callback:
            progress_callback(idx + 1, total, stock_id, stock_name, "檢查中")

        try:
            # === 1. 取得股價資料 ===
            stock_data = api.taiwan_stock_daily(
                stock_id=stock_id,
                start_date=start_date.strftime('%Y-%m-%d'),
                end_date=end_date.strftime('%Y-%m-%d')
            )
            request_count += 1
            time.sleep(0.15)  # 每次請求後延遲 0.15 秒，避免觸發 API 限制

            if len(stock_data) < 60:
                continue

            # === 2. 檢查均線多頭排列 ===
            ma_pass, ma_data = check_ma_bullish_alignment(stock_data)
            if not ma_pass:
                continue

            # === 3. 檢查 MACD 正值 ===
            macd_pass, macd_value = check_macd_positive(stock_data)
            if not macd_pass:
                continue

            # === 4. 檢查成交量與漲幅 ===
            volume_data = check_volume_and_price(stock_data)
            if not volume_data['volume_pass']:
                continue

            # === 5. 檢查三大法人買進 ===
            institutional_data = check_institutional_investors(
                api, stock_id, end_date.strftime('%Y-%m-%d')
            )
            request_count += 1
            time.sleep(0.15)  # 每次請求後延遲 0.15 秒，避免觸發 API 限制

            # 檢查外資或投信是否至少有一個符合條件
            if not (institutional_data['foreign_investor_pass'] or institutional_data['investment_trust_pass']):
                continue

            # === 6. 符合所有條件，加入結果（統一格式）===
            latest_data = stock_data.iloc[-1]

            # 自營商資料（screening 不需要，設為 0）
            dealer_buy = 0

            results.append({
                'date': latest_data['date'],
                'stock_id': stock_id,
                'stock_name': stock_name,
                'open': latest_data['open'],
                'high': latest_data['max'],
                'low': latest_data['min'],
                'close': latest_data['close'],
                'volume': int(volume_data['volume'] / 1000),  # 轉換為張數
                'foreign_buy': institutional_data['foreign_buy'],
                'trust_buy': institutional_data['investment_trust_buy'],
                'dealer_buy': dealer_buy,
                '_price_change_pct': volume_data['price_change_pct']  # 暫存用於排序
            })

            # 更新進度為符合條件
            if progress_callback:
                progress_callback(idx + 1, total, stock_id, stock_name, f"✓ 符合條件 (已找到{len(results)}檔)")

            # API 請求管理：每 100 個請求額外休息 5 秒
            if request_count % 100 == 0:
                time.sleep(5)

        except Exception as e:
            # 忽略個別股票錯誤，繼續掃描
            if progress_callback:
                progress_callback(idx + 1, total, stock_id, stock_name, f"跳過 ({str(e)[:20]})")
            continue

    # 轉換為 DataFrame
    results_df = pd.DataFrame(results)

    if len(results_df) == 0:
        return results_df

    # 按漲幅排序並取前100名
    results_df = results_df.sort_values('_price_change_pct', ascending=False).head(100)

    # 移除暫存的排序欄位（保持統一格式）
    results_df = results_df.drop(columns=['_price_change_pct'])

    return results_df


def save_screening_results(results_df, filename=None):
    """
    儲存篩選結果到 CSV

    Parameters:
    -----------
    results_df : pd.DataFrame
        篩選結果
    filename : str, optional
        檔名，若不指定則自動產生

    Returns:
    --------
    str : 儲存的檔案路徑
    """
    import os

    # 確保 screening 目錄存在
    screening_dir = 'stock_collector/data/screening'
    if not os.path.exists(screening_dir):
        os.makedirs(screening_dir)

    # 產生檔名
    if filename is None:
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'screening_{timestamp}.csv'

    filepath = os.path.join(screening_dir, filename)

    # 儲存 CSV
    results_df.to_csv(filepath, index=False, encoding='utf-8-sig')

    return filepath


def load_latest_screening_results():
    """
    載入最新的篩選結果

    Returns:
    --------
    pd.DataFrame or None
        最新的篩選結果，若無則返回 None
    """
    import os
    import glob

    # 尋找所有篩選結果檔案
    pattern = 'stock_collector/data/screening/screening_*.csv'
    files = glob.glob(pattern)

    if len(files) == 0:
        return None

    # 取得最新的檔案
    latest_file = max(files, key=os.path.getctime)

    # 讀取 CSV
    results_df = pd.read_csv(latest_file, encoding='utf-8-sig')

    return results_df
