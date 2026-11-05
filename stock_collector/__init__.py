"""選股小幫手的資料收集器套件。

⚠️ 收集器只支援在專案根目錄用 `python -m stock_collector.<模組>` 執行（Cloud Run 的 ENTRYPOINT、
GitHub Actions 都是這樣）；scripts/ 底下的工具則是先把專案根目錄加進 sys.path，再 `import stock_collector.xxx`。
以前沒有這個檔時，`python stock_collector/xxx.py` 會讓 stock_collector/ 目錄排在 sys.path 前面，
`stock_collector/stock_collector.py` 被當成頂層的 `stock_collector` 載入，各模組只好在函式裡塞
sys.path.insert 與 except ImportError 退路（2026-11-06 拿掉）。
"""
