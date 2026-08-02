# Cloud Run Job：每日股票收集器（stock_collector）
FROM python:3.11-slim

WORKDIR /app

# 編譯型依賴（pandas / lxml 等原生套件需要）
RUN apt-get update && apt-get install -y --no-install-recommends gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY stock_collector/ ./stock_collector/
COPY firebase_writer.py utils.py ./

# 收集當日資料（不帶 --date = today）。
# Firestore 用 ADC（Cloud Run 服務帳號，同專案免金鑰）；FinMind token 由環境變數注入。
ENTRYPOINT ["python", "-m", "stock_collector.daily_collector"]
