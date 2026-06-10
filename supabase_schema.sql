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

-- 完成！
COMMENT ON TABLE daily_stocks IS '每日股票資料（股價、成交量、三大法人、外資持股）';
COMMENT ON TABLE strong_stock_matrix IS '強勢股矩陣（每日強勢股標記）';
