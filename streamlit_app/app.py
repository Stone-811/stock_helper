"""
台灣強勢股分析網站
使用 Streamlit 建立互動式股票技術分析介面
"""

import streamlit as st
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from datetime import datetime, timedelta
import sys
from pathlib import Path

# 加入父目錄到 Python 路徑，以便匯入 utils
sys.path.append(str(Path(__file__).parent.parent))
from utils import initialize_finmind_api, calculate_macd


# 設定頁面配置
st.set_page_config(
    page_title="台灣強勢股分析",
    page_icon="📈",
    layout="wide",
    initial_sidebar_state="expanded"
)


@st.cache_data
def load_strong_stock_matrix():
    """載入強勢股矩陣資料"""
    matrix_path = Path(__file__).parent.parent / 'data' / 'strong_stock_matrix' / 'strong_stock_matrix.csv'
    if matrix_path.exists():
        return pd.read_csv(matrix_path)
    return None


@st.cache_data
def get_today_strong_stocks(_df, days=7):
    """
    取得今日強勢股

    Parameters:
    -----------
    _df : pd.DataFrame
        強勢股矩陣資料
    days : int
        回溯的交易日數量，預設 7 天

    Returns:
    --------
    tuple : (today_strong, latest_date)
        今日強勢股資料與最新日期
    """
    if _df is None:
        return pd.DataFrame(), None

    # 取得所有日期欄位
    date_columns = [col for col in _df.columns if col not in ['stock_id', 'stock_name']]

    if len(date_columns) == 0:
        return pd.DataFrame(), None

    # 取得最新日期
    latest_date = date_columns[-1]

    # 取得指定天數的交易日
    recent_days = date_columns[-days:] if len(date_columns) >= days else date_columns
    actual_days = len(recent_days)

    # 篩選今日強勢股
    today_strong = _df[_df[latest_date] == 1].copy()

    # 計算近N日強勢次數
    column_name = f'近{actual_days}日強勢次數'
    today_strong[column_name] = today_strong[recent_days].sum(axis=1)

    # 排序
    today_strong = today_strong.sort_values(column_name, ascending=False)

    return today_strong[['stock_id', 'stock_name', column_name]], latest_date, actual_days


@st.cache_data
def get_strong_stocks_by_date(_df, selected_date):
    """
    取得指定日期的強勢股

    Parameters:
    -----------
    _df : pd.DataFrame
        強勢股矩陣資料
    selected_date : str
        選擇的日期 (格式: YYYY-MM-DD)

    Returns:
    --------
    pd.DataFrame
        該日期的強勢股清單
    """
    if _df is None:
        return pd.DataFrame()

    # 取得所有日期欄位
    date_columns = [col for col in _df.columns if col not in ['stock_id', 'stock_name']]

    if selected_date not in date_columns:
        return pd.DataFrame()

    # 篩選該日期的強勢股
    strong_stocks = _df[_df[selected_date] == 1][['stock_id', 'stock_name']].copy()

    return strong_stocks


@st.cache_data
def get_available_dates(_df):
    """取得所有可用的日期"""
    if _df is None:
        return []
    date_columns = [col for col in _df.columns if col not in ['stock_id', 'stock_name']]
    return date_columns


@st.cache_data
def load_daily_report(date_str):
    """
    載入指定日期的每日報表

    Parameters:
    -----------
    date_str : str
        日期字串 (格式: YYYY-MM-DD)

    Returns:
    --------
    pd.DataFrame or None
        每日報表資料
    """
    # 轉換日期格式 YYYY-MM-DD -> YYYYMMDD
    date_formatted = date_str.replace('-', '')
    file_path = Path(__file__).parent.parent / 'data' / 'daily_reports' / f'daily_stock_{date_formatted}.csv'

    if file_path.exists():
        df = pd.read_csv(file_path)
        df['stock_id'] = df['stock_id'].astype(str)
        return df
    return None


@st.cache_data(ttl=3600)  # 快取 1 小時
def get_batch_macd_status(stock_ids_tuple):
    """
    批次計算多檔股票的 MACD 狀態

    Parameters:
    -----------
    stock_ids_tuple : tuple
        股票代碼列表（使用 tuple 以便快取）

    Returns:
    --------
    dict : {stock_id: macd_status}
    """
    stock_ids = list(stock_ids_tuple)
    results = {}

    if not stock_ids:
        return results

    api = initialize_finmind_api()
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=60)).strftime('%Y-%m-%d')

    for stock_id in stock_ids:
        try:
            stock_data = api.taiwan_stock_daily(
                stock_id=str(stock_id),
                start_date=start_date,
                end_date=end_date
            )

            if stock_data.empty or len(stock_data) < 26:
                results[str(stock_id)] = '-'
                continue

            # 計算 MACD
            close = stock_data['close']
            ema12 = close.ewm(span=12, adjust=False).mean()
            ema26 = close.ewm(span=26, adjust=False).mean()
            macd = ema12 - ema26
            signal = macd.ewm(span=9, adjust=False).mean()
            histogram = macd - signal

            results[str(stock_id)] = '多' if histogram.iloc[-1] > 0 else '空'
        except:
            results[str(stock_id)] = '-'

    return results


@st.cache_data
def get_stock_data(stock_id, days=730):
    """取得股票歷史資料（預設 2 年）"""
    try:
        api = initialize_finmind_api()
        end_date = datetime.now().strftime('%Y-%m-%d')
        start_date = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')

        # 取得股價資料
        stock_data = api.taiwan_stock_daily(
            stock_id=stock_id,
            start_date=start_date,
            end_date=end_date
        )

        if stock_data.empty:
            return None

        # 取得法人買賣超資料
        institutional_data = api.taiwan_stock_institutional_investors(
            stock_id=stock_id,
            start_date=start_date,
            end_date=end_date
        )

        # 轉換日期格式
        stock_data['date'] = pd.to_datetime(stock_data['date'])
        stock_data = stock_data.sort_values('date')

        # 處理法人資料：轉換為每日外資買賣超
        if not institutional_data.empty:
            institutional_data['date'] = pd.to_datetime(institutional_data['date'])
            # 篩選外資資料（Foreign_Investor）
            foreign_data = institutional_data[institutional_data['name'] == 'Foreign_Investor'].copy()
            if not foreign_data.empty:
                # 計算外資買賣超（買進 - 賣出），單位轉換為張
                foreign_data['foreign_buy'] = (foreign_data['buy'] - foreign_data['sell']) / 1000
                foreign_daily = foreign_data[['date', 'foreign_buy']].drop_duplicates(subset='date')
                stock_data = stock_data.merge(foreign_daily, on='date', how='left')
            else:
                stock_data['foreign_buy'] = 0
        else:
            stock_data['foreign_buy'] = 0

        # 填補空值
        stock_data['foreign_buy'] = stock_data['foreign_buy'].fillna(0)

        # 計算技術指標
        stock_data['ma5'] = stock_data['close'].rolling(window=5).mean()
        stock_data['ma20'] = stock_data['close'].rolling(window=20).mean()
        stock_data['ma60'] = stock_data['close'].rolling(window=60).mean()

        # 計算 MACD
        macd, signal, histogram = calculate_macd(stock_data)
        stock_data['macd'] = macd
        stock_data['macd_signal'] = signal
        stock_data['macd_histogram'] = histogram

        return stock_data

    except Exception as e:
        st.error(f"取得股票資料時發生錯誤: {str(e)}")
        return None


def plot_technical_analysis(data, stock_id, stock_name):
    """繪製技術分析圖表：K線圖 + 成交量 + MACD"""

    # 準備資料：格式化日期和轉換成交量
    data = data.copy()
    data['date_str'] = pd.to_datetime(data['date']).dt.strftime('%Y-%m-%d')
    data['volume_lots'] = (data['Trading_Volume'] / 1000).astype(int)
    data['foreign_buy_int'] = data['foreign_buy'].astype(int)

    # 建立 K 線的 hover 文字（包含外資買賣）
    hover_texts = []
    for _, row in data.iterrows():
        foreign_sign = '+' if row['foreign_buy_int'] >= 0 else ''
        text = (f"開盤：{row['open']:.2f}<br>"
                f"最高：{row['max']:.2f}<br>"
                f"最低：{row['min']:.2f}<br>"
                f"收盤：{row['close']:.2f}<br>"
                f"成交量：{row['volume_lots']:,} 張<br>"
                f"外資買賣：{foreign_sign}{row['foreign_buy_int']:,} 張")
        hover_texts.append(text)

    # 創建子圖：K線圖 + 成交量 + MACD（統一間距）
    fig = make_subplots(
        rows=3, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.05,
        row_heights=[0.5, 0.2, 0.3],
        subplot_titles=('', '', '')
    )

    # K 線圖
    fig.add_trace(
        go.Candlestick(
            x=data['date_str'],
            open=data['open'],
            high=data['max'],
            low=data['min'],
            close=data['close'],
            name='',
            increasing_line_color='red',
            decreasing_line_color='green',
            text=hover_texts,
            hoverinfo='text'
        ),
        row=1, col=1
    )

    # 移動平均線
    ma5_text = [f"MA5：{v:.2f}" if pd.notna(v) else "" for v in data['ma5']]
    fig.add_trace(
        go.Scatter(
            x=data['date_str'],
            y=data['ma5'],
            name='MA5',
            line=dict(color='blue', width=1),
            text=ma5_text,
            hoverinfo='text'
        ),
        row=1, col=1
    )

    ma20_text = [f"MA20：{v:.2f}" if pd.notna(v) else "" for v in data['ma20']]
    fig.add_trace(
        go.Scatter(
            x=data['date_str'],
            y=data['ma20'],
            name='MA20',
            line=dict(color='orange', width=1),
            text=ma20_text,
            hoverinfo='text'
        ),
        row=1, col=1
    )

    ma60_text = [f"MA60：{v:.2f}" if pd.notna(v) else "" for v in data['ma60']]
    fig.add_trace(
        go.Scatter(
            x=data['date_str'],
            y=data['ma60'],
            name='MA60',
            line=dict(color='purple', width=1),
            text=ma60_text,
            hoverinfo='text'
        ),
        row=1, col=1
    )

    # 成交量
    colors = ['red' if close >= open else 'green'
              for close, open in zip(data['close'], data['open'])]
    volume_text = [f"成交量：{v:,} 張" for v in data['volume_lots']]

    fig.add_trace(
        go.Bar(
            x=data['date_str'],
            y=data['Trading_Volume'],
            name='成交量',
            marker_color=colors,
            showlegend=False,
            text=volume_text,
            hoverinfo='text'
        ),
        row=2, col=1
    )

    # MACD 線
    macd_text = [f"MACD：{v:.2f}" if pd.notna(v) else "" for v in data['macd']]
    fig.add_trace(
        go.Scatter(
            x=data['date_str'],
            y=data['macd'],
            name='MACD',
            line=dict(color='blue', width=2),
            text=macd_text,
            hoverinfo='text'
        ),
        row=3, col=1
    )

    # MACD 信號線
    signal_text = [f"Signal：{v:.2f}" if pd.notna(v) else "" for v in data['macd_signal']]
    fig.add_trace(
        go.Scatter(
            x=data['date_str'],
            y=data['macd_signal'],
            name='Signal',
            line=dict(color='orange', width=2),
            text=signal_text,
            hoverinfo='text'
        ),
        row=3, col=1
    )

    # MACD 柱狀圖
    macd_colors = ['red' if val >= 0 else 'green' for val in data['macd_histogram']]
    hist_text = [f"Histogram：{v:.2f}" if pd.notna(v) else "" for v in data['macd_histogram']]
    fig.add_trace(
        go.Bar(
            x=data['date_str'],
            y=data['macd_histogram'],
            name='Histogram',
            marker_color=macd_colors,
            text=hist_text,
            hoverinfo='text'
        ),
        row=3, col=1
    )

    # MACD 零軸線
    fig.add_hline(y=0, line_dash="dash", line_color="gray", opacity=0.5, row=3, col=1)

    # 更新布局
    fig.update_layout(
        height=1000,
        xaxis_rangeslider_visible=False,
        hovermode='x unified',
        template='plotly_white',
        hoverlabel=dict(
            bgcolor="white",
            font_size=14,
            font_family="Arial",
            font_color="black"
        )
    )

    # 更新 X 軸（只顯示「日期」標籤，不顯示刻度）
    fig.update_xaxes(title_text="", type='category', showticklabels=False, hoverformat='', row=1, col=1)
    fig.update_xaxes(title_text="", type='category', showticklabels=False, hoverformat='', row=2, col=1)
    fig.update_xaxes(title_text="日期", type='category', showticklabels=False, hoverformat='', row=3, col=1)

    # 更新 Y 軸
    fig.update_yaxes(title_text="價格", row=1, col=1)
    fig.update_yaxes(title_text="成交量", row=2, col=1)
    fig.update_yaxes(title_text="MACD", row=3, col=1)

    return fig




def main():
    """主程式"""

    # 初始化 session state
    if 'selected_stock_id' not in st.session_state:
        st.session_state.selected_stock_id = None
    if 'selected_stock_name' not in st.session_state:
        st.session_state.selected_stock_name = None
    if 'search_query' not in st.session_state:
        st.session_state.search_query = ''
    if 'history_date' not in st.session_state:
        st.session_state.history_date = None
    if 'history_stocks' not in st.session_state:
        st.session_state.history_stocks = pd.DataFrame()

    # 標題
    st.markdown("<h1 style='font-size: 20px; font-weight: bold;'>台灣強勢股分析系統</h1>", unsafe_allow_html=True)
    st.markdown("---")

    # 載入強勢股資料
    matrix_df = load_strong_stock_matrix()

    if matrix_df is None:
        st.error("無法載入強勢股資料，請確認 data/strong_stock_matrix/strong_stock_matrix.csv 檔案存在")
        return

    # 側邊欄
    with st.sidebar:
        st.header("選股工具")

        # 股票搜尋
        st.markdown("### 股票搜尋")
        search_query = st.text_input(
            "輸入股票代碼或名稱",
            value=st.session_state.search_query,
            placeholder="例如：2330 或 台積電",
            help="搜尋任何上市上櫃股票",
            key="search_input"
        )

        # 更新 session state
        st.session_state.search_query = search_query

        if search_query:
            # 搜尋股票
            from FinMind.data import DataLoader
            api = DataLoader()
            stock_info = api.taiwan_stock_info()

            # 去除重複的股票代碼（保留第一筆）
            stock_info = stock_info.drop_duplicates(subset='stock_id', keep='first')

            # 優先完全匹配股票代碼
            exact_match = stock_info[stock_info['stock_id'] == search_query]

            if len(exact_match) > 0:
                # 找到完全匹配，直接顯示
                search_results = exact_match
            else:
                # 沒有完全匹配，進行模糊搜尋
                search_results = stock_info[
                    (stock_info['stock_id'].str.contains(search_query, na=False)) |
                    (stock_info['stock_name'].str.contains(search_query, na=False))
                ]

            if len(search_results) > 0:
                if len(search_results) == 1:
                    st.write("找到 1 筆結果")
                    # 只有一筆結果，直接選取
                    stock_id = str(search_results.iloc[0]['stock_id'])
                    stock_name = str(search_results.iloc[0]['stock_name'])
                    if st.button(f"✓ 選擇 {stock_id} {stock_name}", key="select_single"):
                        st.session_state.selected_stock_id = stock_id
                        st.session_state.selected_stock_name = stock_name
                        st.session_state.search_query = ''
                        st.rerun()
                else:
                    st.write(f"找到 {len(search_results)} 筆結果")

                    # 使用 selectbox 代替按鈕，更穩定
                    display_results = search_results.head(10).reset_index(drop=True)
                    options = [f"{row['stock_id']} {row['stock_name']}"
                              for _, row in display_results.iterrows()]

                    selected_option = st.selectbox(
                        "選擇股票",
                        options,
                        key="search_selectbox"
                    )

                    if st.button("確認選擇", key="confirm_selection"):
                        # 從選項中解析出股票代碼和名稱
                        parts = selected_option.split(' ', 1)
                        stock_id = parts[0]
                        stock_name = parts[1] if len(parts) > 1 else ""

                        st.session_state.selected_stock_id = stock_id
                        st.session_state.selected_stock_name = stock_name
                        st.session_state.search_query = ''
                        st.rerun()
            else:
                st.warning("找不到符合的股票")

        st.markdown("---")

        # 取得今日強勢股（供主頁使用）
        today_stocks, latest_date, actual_days = get_today_strong_stocks(matrix_df, days=1)

        # 依日期查詢強勢股
        st.markdown("### 歷史強勢股查詢")
        available_dates = get_available_dates(matrix_df)

        if available_dates:
            # 將字串日期轉換為 datetime 物件
            from datetime import datetime as dt
            date_objects = [dt.strptime(d, '%Y-%m-%d').date() for d in available_dates]
            available_dates_set = set(available_dates)

            # 使用日期選擇器
            selected_date = st.date_input(
                "選擇日期",
                value=date_objects[-1],  # 預設最新日期
                min_value=date_objects[0],
                max_value=date_objects[-1],
                help="選擇要查詢的日期（僅交易日有資料）"
            )

            # 轉換為字串格式
            selected_history_date = selected_date.strftime('%Y-%m-%d')

            # 檢查是否為有效交易日
            if selected_history_date in available_dates_set:
                # 取得該日期的強勢股
                history_strong_stocks = get_strong_stocks_by_date(matrix_df, selected_history_date)
                st.info(f"{selected_history_date} 共 {len(history_strong_stocks)} 檔強勢股")

                # 儲存到 session state 供主頁使用
                st.session_state.history_date = selected_history_date
                st.session_state.history_stocks = history_strong_stocks
            else:
                st.warning(f"{selected_history_date} 非交易日，請選擇其他日期")
                st.session_state.history_date = None
                st.session_state.history_stocks = pd.DataFrame()
        else:
            st.warning("沒有可用的歷史資料")
            st.session_state.history_date = None
            st.session_state.history_stocks = pd.DataFrame()

    # 檢查是否有選中的股票
    if st.session_state.selected_stock_id:
        selected_stock_id = st.session_state.selected_stock_id
        selected_stock_name = st.session_state.selected_stock_name
    else:
        selected_stock_id = None
        selected_stock_name = None

    # 如果有選中股票，顯示股票詳情
    if selected_stock_id:
        # 自定義 CSS 樣式：放大字體
        st.markdown("""
        <style>
        [data-testid="stMetricValue"] {
            font-size: 24px !important;
            font-weight: bold !important;
        }
        [data-testid="stMetricLabel"] {
            font-size: 16px !important;
            font-weight: bold !important;
        }
        [data-testid="stMetricDelta"] {
            font-size: 16px !important;
            font-weight: bold !important;
        }
        div[data-testid="column"] {
            padding: 0 5px;
        }
        </style>
        """, unsafe_allow_html=True)

        # 返回首頁按鈕
        if st.button("返回強勢股列表"):
            st.session_state.selected_stock_id = None
            st.session_state.selected_stock_name = None
            st.rerun()

        # 載入股票資料
        with st.spinner('正在載入股票資料...'):
            stock_data = get_stock_data(selected_stock_id)

        if stock_data is not None and not stock_data.empty:
            # 顯示最新資訊
            latest_data = stock_data.iloc[-1]

            # 顯示股票資訊（6個欄位一排）
            col1, col2, col3, col4, col5, col6 = st.columns(6)

            with col1:
                st.metric("股票代碼", selected_stock_id)
            with col2:
                st.metric("股票名稱", selected_stock_name)
            with col3:
                st.metric("收盤價", f"${latest_data['close']:.2f}")
            with col4:
                # 計算漲跌（今日收盤 vs 昨日收盤）
                if len(stock_data) >= 2:
                    prev_close = stock_data.iloc[-2]['close']
                    price_change = latest_data['close'] - prev_close
                    price_change_pct = (price_change / prev_close) * 100
                else:
                    price_change = 0
                    price_change_pct = 0
                st.metric(
                    "漲跌",
                    f"${price_change:.2f}",
                    f"{price_change_pct:+.2f}%"
                )
            with col5:
                volume_lots = int(latest_data['Trading_Volume'] / 1000)
                st.metric("成交量", f"{volume_lots:,} 張")
            with col6:
                macd_status = "多頭" if latest_data['macd_histogram'] > 0 else "空頭"
                st.metric("MACD 狀態", macd_status)

            st.markdown("---")

            # 取得法人資料：尋找最近可用的每日報表
            institutional_data = None
            data_dir = Path(__file__).parent.parent / 'data' / 'daily_reports'

            # 取得所有每日報表檔案，按日期排序（最新的在前）
            import glob
            daily_files = sorted(glob.glob(str(data_dir / 'daily_stock_*.csv')), reverse=True)

            if daily_files:
                # 使用最新的每日報表
                latest_daily_file = Path(daily_files[0])
                try:
                    daily_df = pd.read_csv(latest_daily_file)
                    # 確保 stock_id 格式一致（轉為字串）
                    daily_df['stock_id'] = daily_df['stock_id'].astype(str)
                    stock_daily = daily_df[daily_df['stock_id'] == str(selected_stock_id)]

                    if len(stock_daily) > 0:
                        institutional_data = stock_daily.iloc[0]
                except Exception as e:
                    pass  # 靜默處理錯誤，不影響頁面顯示

            # 三大法人買超與外資持股資訊（合併為一排）
            if institutional_data is not None:
                st.markdown("##### 三大法人買賣超")
                col1, col2, col3, col4, col5, col6 = st.columns(6)

                with col1:
                    foreign_buy = int(institutional_data.get('foreign_buy', 0))
                    st.metric(
                        "外資",
                        f"{foreign_buy:+,} 張",
                        delta_color="normal" if foreign_buy >= 0 else "inverse"
                    )
                with col2:
                    trust_buy = int(institutional_data.get('trust_buy', 0))
                    st.metric(
                        "投信",
                        f"{trust_buy:+,} 張",
                        delta_color="normal" if trust_buy >= 0 else "inverse"
                    )
                with col3:
                    dealer_buy = int(institutional_data.get('dealer_buy', 0))
                    st.metric(
                        "自營商",
                        f"{dealer_buy:+,} 張",
                        delta_color="normal" if dealer_buy >= 0 else "inverse"
                    )
                with col4:
                    foreign_hold_ratio = float(institutional_data.get('foreign_hold_ratio', 0))
                    st.metric("外資持股比例", f"{foreign_hold_ratio:.2f}%")
                with col5:
                    foreign_remain_ratio = float(institutional_data.get('foreign_remain_ratio', 0))
                    st.metric("外資尚可投資比例", f"{foreign_remain_ratio:.2f}%")
                with col6:
                    foreign_limit_ratio = float(institutional_data.get('foreign_limit_ratio', 0))
                    st.metric("外資投資上限", f"{foreign_limit_ratio:.2f}%")

            st.markdown("---")

            # 技術分析圖表（K線 + 成交量 + MACD）
            st.markdown("##### 技術分析")
            fig_technical = plot_technical_analysis(
                stock_data,
                selected_stock_id,
                selected_stock_name
            )
            st.plotly_chart(fig_technical, use_container_width=True)

        else:
            st.error("無法取得股票資料，請稍後再試")

    else:
        # 如果沒有選中股票，顯示首頁強勢股列表
        # 使用 tabs 切換今日強勢股和歷史強勢股
        tab1, tab2 = st.tabs(["今日強勢股", "歷史強勢股查詢"])

        with tab1:
            # 顯示今日強勢股列表
            st.subheader(f"今日強勢股列表 ({latest_date})")

            if len(today_stocks) > 0:
                # 載入當日報表取得收盤價和MACD
                daily_report = load_daily_report(latest_date)
                price_dict = {}
                macd_dict = {}
                volume_dict = {}
                foreign_dict = {}
                trust_dict = {}

                if daily_report is not None:
                    for _, r in daily_report.iterrows():
                        sid = str(r['stock_id'])
                        price_dict[sid] = r['close']
                        volume_dict[sid] = r.get('volume', 0)
                        foreign_dict[sid] = r.get('foreign_buy', 0)
                        trust_dict[sid] = r.get('trust_buy', 0)
                        if 'macd_status' in daily_report.columns:
                            macd_dict[sid] = r['macd_status']

                    # 如果沒有 MACD 資料，即時計算
                    if 'macd_status' not in daily_report.columns:
                        stock_ids = tuple(today_stocks['stock_id'].unique())
                        macd_dict = get_batch_macd_status(stock_ids)

                # 篩選條件（橫向排列）
                filter_col1, filter_col2, filter_col3, filter_col4 = st.columns(4)

                with filter_col1:
                    macd_filter = st.selectbox("MACD", ["全部", "多", "空"], key="macd_filter")

                with filter_col2:
                    price_filter = st.selectbox("價格", ["不限", "50元以下", "50-100元", "100-200元", "200元以上"], key="price_filter")

                with filter_col3:
                    volume_filter = st.selectbox("成交量", ["不限", "1000張以上", "5000張以上", "10000張以上"], key="volume_filter")

                with filter_col4:
                    inst_filter = st.selectbox("法人買超", ["不限", "外資買超", "投信買超", "外資+投信"], key="inst_filter")

                # 按股票代號排序，並去除重複
                sorted_stocks = today_stocks.drop_duplicates(subset=['stock_id']).sort_values('stock_id')

                # 套用篩選條件
                filtered_stocks = []
                for _, row in sorted_stocks.iterrows():
                    stock_id = str(row['stock_id'])
                    price = price_dict.get(stock_id, 0)
                    volume = volume_dict.get(stock_id, 0)
                    macd = macd_dict.get(stock_id, '-')
                    foreign = foreign_dict.get(stock_id, 0)
                    trust = trust_dict.get(stock_id, 0)

                    # MACD 篩選
                    if macd_filter != "全部" and macd != macd_filter:
                        continue

                    # 價格篩選
                    if price_filter == "50元以下" and price >= 50:
                        continue
                    elif price_filter == "50-100元" and (price < 50 or price >= 100):
                        continue
                    elif price_filter == "100-200元" and (price < 100 or price >= 200):
                        continue
                    elif price_filter == "200元以上" and price < 200:
                        continue

                    # 成交量篩選
                    if volume_filter == "1000張以上" and volume < 1000:
                        continue
                    elif volume_filter == "5000張以上" and volume < 5000:
                        continue
                    elif volume_filter == "10000張以上" and volume < 10000:
                        continue

                    # 法人篩選
                    if inst_filter == "外資買超" and foreign <= 0:
                        continue
                    elif inst_filter == "投信買超" and trust <= 0:
                        continue
                    elif inst_filter == "外資+投信" and (foreign <= 0 or trust <= 0):
                        continue

                    filtered_stocks.append(row)

                # 轉換為 DataFrame
                if filtered_stocks:
                    sorted_stocks = pd.DataFrame(filtered_stocks)
                else:
                    sorted_stocks = pd.DataFrame()

                st.info(f"篩選結果：{len(sorted_stocks)} 檔 / 共 {len(today_stocks)} 檔")

                if len(sorted_stocks) == 0:
                    st.warning("沒有符合篩選條件的股票")
                else:
                    # 使用列來展示股票，每列5個
                    num_cols = 5
                    rows = []

                    for idx, (_, row) in enumerate(sorted_stocks.iterrows()):
                        if idx % num_cols == 0:
                            rows.append(st.columns(num_cols))

                        col_idx = idx % num_cols
                        with rows[-1][col_idx]:
                            stock_id = str(row['stock_id'])
                            stock_name = row['stock_name']
                            close_price = price_dict.get(stock_id, '-')
                            macd_status = macd_dict.get(stock_id, '-')

                            # 格式化收盤價
                            price_str = f"${close_price:.2f}" if isinstance(close_price, (int, float)) else "-"

                            # 整個卡片可點擊：所有資訊放在按鈕內
                            card_text = f"{stock_id} {stock_name}\n{price_str}\nMACD: {macd_status}"
                            if st.button(card_text, key=f"stock_{idx}_{stock_id}", use_container_width=True):
                                st.session_state.selected_stock_id = stock_id
                                st.session_state.selected_stock_name = str(stock_name)
                                st.rerun()
            else:
                st.info("今日沒有強勢股")

        with tab2:
            # 顯示歷史強勢股列表
            history_date = st.session_state.get('history_date', None)
            history_stocks = st.session_state.get('history_stocks', pd.DataFrame())

            if history_date and len(history_stocks) > 0:
                st.subheader(f"{history_date} 強勢股列表")
                st.info(f"共 {len(history_stocks)} 檔 | 點擊股票查看技術分析")

                # 載入該日報表取得收盤價和MACD
                history_daily_report = load_daily_report(history_date)
                history_price_dict = {}
                history_macd_dict = {}
                if history_daily_report is not None:
                    for _, r in history_daily_report.iterrows():
                        history_price_dict[str(r['stock_id'])] = r['close']
                        if 'macd_status' in history_daily_report.columns:
                            history_macd_dict[str(r['stock_id'])] = r['macd_status']

                    # 如果沒有 MACD 資料，即時計算
                    if 'macd_status' not in history_daily_report.columns:
                        history_stock_ids = tuple(history_stocks['stock_id'].unique())
                        history_macd_dict = get_batch_macd_status(history_stock_ids)

                # 按股票代號排序，並去除重複
                sorted_history = history_stocks.drop_duplicates(subset=['stock_id']).sort_values('stock_id')

                # 使用列來展示股票，每列5個
                num_cols = 5
                rows = []

                for idx, (_, row) in enumerate(sorted_history.iterrows()):
                    if idx % num_cols == 0:
                        rows.append(st.columns(num_cols))

                    col_idx = idx % num_cols
                    with rows[-1][col_idx]:
                        stock_id = str(row['stock_id'])
                        stock_name = row['stock_name']
                        close_price = history_price_dict.get(stock_id, '-')
                        macd_status = history_macd_dict.get(stock_id, '-')

                        # 格式化收盤價（歷史價格）
                        price_str = f"${close_price:.2f}" if isinstance(close_price, (int, float)) else "-"

                        # 整個卡片可點擊：所有資訊放在按鈕內
                        card_text = f"{stock_id} {stock_name}\n{price_str}\nMACD: {macd_status}"
                        if st.button(card_text, key=f"history_{idx}_{stock_id}", use_container_width=True):
                            st.session_state.selected_stock_id = stock_id
                            st.session_state.selected_stock_name = str(stock_name)
                            st.rerun()
            else:
                st.info("請在左側選擇日期查詢歷史強勢股")


if __name__ == "__main__":
    main()
