-- Supabase 資料表建立語法
-- 在 Supabase Dashboard > SQL Editor 執行此腳本

-- 1. 每日股票資料表
CREATE TABLE IF NOT EXISTS daily_stocks (
    date DATE NOT NULL,
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    open NUMERIC(10, 2),
    high NUMERIC(10, 2),
    low NUMERIC(10, 2),
    close NUMERIC(10, 2),
    volume INTEGER DEFAULT 0,
    foreign_buy INTEGER DEFAULT 0,
    trust_buy INTEGER DEFAULT 0,
    dealer_buy INTEGER DEFAULT 0,
    foreign_hold_ratio NUMERIC(6, 2) DEFAULT 0,
    foreign_remain_ratio NUMERIC(6, 2) DEFAULT 0,
    foreign_limit_ratio NUMERIC(6, 2) DEFAULT 0,
    macd_status VARCHAR(10) DEFAULT '-',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (date, stock_id)
);

-- 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_daily_stocks_stock_id ON daily_stocks(stock_id);
CREATE INDEX IF NOT EXISTS idx_daily_stocks_date ON daily_stocks(date DESC);

-- 2. 強勢股矩陣表
CREATE TABLE IF NOT EXISTS strong_stock_matrix (
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    date DATE NOT NULL,
    is_strong BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (stock_id, date)
);

-- 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_strong_matrix_date ON strong_stock_matrix(date DESC);
CREATE INDEX IF NOT EXISTS idx_strong_matrix_is_strong ON strong_stock_matrix(is_strong) WHERE is_strong = TRUE;

-- 3. 啟用 Row Level Security (RLS)
ALTER TABLE daily_stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE strong_stock_matrix ENABLE ROW LEVEL SECURITY;

-- 4. 設定公開讀取權限（前端可查詢）
CREATE POLICY "Allow public read access on daily_stocks"
    ON daily_stocks FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access on strong_stock_matrix"
    ON strong_stock_matrix FOR SELECT
    USING (true);

-- 5. 設定 Service Role 可寫入（Python 後端使用 service_role key）
CREATE POLICY "Allow service role insert on daily_stocks"
    ON daily_stocks FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow service role update on daily_stocks"
    ON daily_stocks FOR UPDATE
    USING (true);

CREATE POLICY "Allow service role insert on strong_stock_matrix"
    ON strong_stock_matrix FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow service role update on strong_stock_matrix"
    ON strong_stock_matrix FOR UPDATE
    USING (true);

-- 6. 建立查詢今日強勢股的 View（方便前端使用）
CREATE OR REPLACE VIEW today_strong_stocks AS
SELECT
    ssm.stock_id,
    ssm.stock_name,
    ssm.date,
    ds.close,
    ds.volume,
    ds.foreign_buy,
    ds.trust_buy,
    ds.dealer_buy,
    ds.macd_status
FROM strong_stock_matrix ssm
LEFT JOIN daily_stocks ds
    ON ssm.stock_id = ds.stock_id
    AND ssm.date = ds.date
WHERE ssm.is_strong = TRUE
ORDER BY ssm.date DESC, ds.volume DESC;

-- 7. 建立查詢股票近 N 日強勢次數的函數
CREATE OR REPLACE FUNCTION get_strong_count(
    p_stock_id VARCHAR,
    p_days INTEGER DEFAULT 7
)
RETURNS INTEGER AS $$
BEGIN
    RETURN (
        SELECT COUNT(*)
        FROM strong_stock_matrix
        WHERE stock_id = p_stock_id
          AND is_strong = TRUE
          AND date >= CURRENT_DATE - p_days
    );
END;
$$ LANGUAGE plpgsql;

-- 8. 市場指數/期貨資料表
CREATE TABLE IF NOT EXISTS market_index_daily (
    date DATE NOT NULL,
    index_id VARCHAR(20) NOT NULL,
    index_name VARCHAR(50),
    open NUMERIC(10, 2),
    high NUMERIC(10, 2),
    low NUMERIC(10, 2),
    close NUMERIC(10, 2),
    volume BIGINT DEFAULT 0,
    open_interest BIGINT DEFAULT 0,
    settlement_price NUMERIC(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (date, index_id)
);

CREATE INDEX IF NOT EXISTS idx_market_index_daily_date ON market_index_daily(date DESC);
CREATE INDEX IF NOT EXISTS idx_market_index_daily_index_id ON market_index_daily(index_id);

ALTER TABLE market_index_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on market_index_daily"
    ON market_index_daily FOR SELECT
    USING (true);

CREATE POLICY "Allow service role insert on market_index_daily"
    ON market_index_daily FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow service role update on market_index_daily"
    ON market_index_daily FOR UPDATE
    USING (true);

-- 9. 用戶自選股表（需要 Supabase Auth）
CREATE TABLE IF NOT EXISTS user_watchlist (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, stock_id)
);

CREATE INDEX IF NOT EXISTS idx_user_watchlist_user_id ON user_watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_stock_id ON user_watchlist(stock_id);

ALTER TABLE user_watchlist ENABLE ROW LEVEL SECURITY;

-- 用戶只能查看/管理自己的自選股
CREATE POLICY "Users can view own watchlist"
    ON user_watchlist FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own watchlist"
    ON user_watchlist FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own watchlist"
    ON user_watchlist FOR DELETE
    USING (auth.uid() = user_id);

-- 10. 股票基本面分析報告表
CREATE TABLE IF NOT EXISTS stock_analysis_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    stock_id VARCHAR(10) NOT NULL,
    stock_name VARCHAR(50),
    report_content TEXT NOT NULL,
    model_used VARCHAR(50) DEFAULT 'claude-sonnet-4-20250514',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_analysis_user ON stock_analysis_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_stock_analysis_stock ON stock_analysis_reports(stock_id);
CREATE INDEX IF NOT EXISTS idx_stock_analysis_created ON stock_analysis_reports(created_at DESC);

ALTER TABLE stock_analysis_reports ENABLE ROW LEVEL SECURITY;

-- 所有人可以查看報告
CREATE POLICY "Anyone can view reports"
    ON stock_analysis_reports FOR SELECT
    USING (true);

-- 已登入用戶可以新增報告
CREATE POLICY "Authenticated users can create reports"
    ON stock_analysis_reports FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 用戶可以刪除自己的報告
CREATE POLICY "Users can delete own reports"
    ON stock_analysis_reports FOR DELETE
    USING (auth.uid() = user_id);

-- 完成！
COMMENT ON TABLE daily_stocks IS '每日股票資料（股價、成交量、三大法人、外資持股）';
COMMENT ON TABLE strong_stock_matrix IS '強勢股矩陣（每日強勢股標記）';
COMMENT ON TABLE market_index_daily IS '市場指數/期貨日K資料';
COMMENT ON TABLE user_watchlist IS '用戶自選股清單';
COMMENT ON TABLE stock_analysis_reports IS '股票基本面分析報告（AI 生成）';
