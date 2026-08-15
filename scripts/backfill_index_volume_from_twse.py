"""
一次性補資工具：用證交所 TWSE FMTQIK 的『成交股數』回補 market_index/{index} 中 volume==0 的日子。

背景（見 skill 地雷 #12）：FinMind 的 TAIEX（taiwan_stock_daily / TaiwanStockPrice）某些歷史區間
只回指數點位、Trading_Volume＝Trading_money＝0（實例：2026-02 全月 12 個交易日），collector 忠實照抄
→ market_index/TAIEX 該段 volume=0 → 大盤技術圖成交量直方圖空一段（K棒/均線/MACD 正常，個股不受影響）。
重跑 index_collector 無效（FinMind 就是回 0），故改用權威來源 TWSE 補。

設計原則：不改 collector / 不動排程 / 不打 FinMind；只改 volume==0 且 TWSE 收盤對得上的日期，
其餘欄位（OHLC 等）完全不動；預設 DRY-RUN，加 --write 才寫入。write_market_index 是
「單 doc + history 陣列、以 date 為 key 的 upsert」，單日回補安全、總筆數/latest_date 不變。

用法：
  python3 scripts/backfill_index_volume_from_twse.py            # 稽核 + dry-run（預設 TAIEX）
  python3 scripts/backfill_index_volume_from_twse.py --write    # 實際補資
  python3 scripts/backfill_index_volume_from_twse.py --index TAIEX --write
"""
import sys
import json
import subprocess
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from firebase_writer import get_firestore_client  # noqa: E402
from firebase_admin import firestore  # noqa: E402


def fetch_twse_month(yyyymm: str) -> dict:
    """抓 TWSE FMTQIK 某月（一次回整月）→ {YYYY-MM-DD: {volume 成交股數, close 加權指數}}。
    用 curl（本機 python urllib 對 twse 憑證有 SSL 問題）。失敗回空 dict（該月日期會被安全跳過）。"""
    url = f"https://www.twse.com.tw/exchangeReport/FMTQIK?response=json&date={yyyymm}01"
    try:
        out = subprocess.run(
            ["curl", "-s", "-H", "User-Agent: Mozilla/5.0", url],
            capture_output=True, text=True, timeout=60,
        ).stdout
        j = json.loads(out)
    except Exception as e:
        print(f"  ⚠️ TWSE {yyyymm} 抓取失敗：{e}")
        return {}
    if j.get("stat") != "OK":
        print(f"  ⚠️ TWSE {yyyymm} 回應非 OK：{j.get('stat')}")
        return {}
    res = {}
    for r in j.get("data", []):
        y, m, d = r[0].split("/")  # ROC 115/02/02
        g = f"{int(y) + 1911:04d}-{int(m):02d}-{int(d):02d}"
        res[g] = {"volume": int(r[1].replace(",", "")), "close": float(r[4].replace(",", ""))}
    return res


def main():
    ap = argparse.ArgumentParser(description="用 TWSE 回補 market_index volume==0 的成交量")
    ap.add_argument("--index", default="TAIEX", help="指數代號（預設 TAIEX；TX 用 FinMind 期貨、通常無此問題）")
    ap.add_argument("--write", action="store_true", help="實際寫入 Firestore（否則 dry-run）")
    args = ap.parse_args()

    db = get_firestore_client()
    ref = db.collection("market_index").document(args.index)
    doc = ref.get().to_dict()
    if not doc:
        print(f"找不到 market_index/{args.index}")
        return
    hist = doc["history"]
    zero_dates = sorted(h["date"] for h in hist if h.get("volume", 0) == 0)
    if not zero_dates:
        print(f"market_index/{args.index}：沒有 volume==0 的日期，無需補資。")
        return
    print(f"market_index/{args.index}：volume==0 共 {len(zero_dates)} 天 → {zero_dates}")

    months = sorted({d[:7].replace("-", "") for d in zero_dates})
    twse = {}
    for ym in months:
        twse.update(fetch_twse_month(ym))

    changes, skipped = [], []
    for h in hist:
        if h.get("volume", 0) == 0:
            d = h["date"]
            tw = twse.get(d)
            if not tw:
                skipped.append((d, "TWSE 無此日"))
                continue
            if abs(float(h.get("close", 0)) - tw["close"]) > 1.0:
                skipped.append((d, f"close 不符 fs={h.get('close')} twse={tw['close']}"))
                continue
            changes.append((d, h["volume"], tw["volume"]))

    print(f"可補（close 對得上）：{len(changes)} 天 | 跳過：{len(skipped)}")
    for d, ov, nv in changes:
        print(f"  {d}  {ov} -> {nv:,}")
    for d, why in skipped:
        print(f"  SKIP {d} {why}")

    if not args.write:
        print("\n[DRY-RUN] 未寫入。加 --write 才會實際更新 Firestore。")
        return
    if not changes:
        print("無可補資料，結束。")
        return

    newvol = {d: nv for d, ov, nv in changes}
    for h in hist:
        if h["date"] in newvol:
            h["volume"] = newvol[h["date"]]
    ref.set({
        "index_id": doc.get("index_id", args.index),
        "index_name": doc.get("index_name", args.index),
        "history": hist,
        "latest_date": doc.get("latest_date", hist[-1]["date"]),
        "record_count": len(hist),
        "updated_at": firestore.SERVER_TIMESTAMP,
    })
    print(f"\n✓ 已補 {len(changes)} 天成交量；總筆數 {len(hist)}、latest_date 不變。")


if __name__ == "__main__":
    main()
