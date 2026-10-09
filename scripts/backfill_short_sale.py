#!/usr/bin/env python3
"""
一次性回補：把放空資料（融券餘額 / 借券賣出餘額 / 融資餘額）補進既有的 daily_data，
讓個股頁的「放空籌碼」區塊不必等新資料累積。

背景
----
收集器原本沒抓放空資料，2026-10-09 才加上兩支批次 API：
  * TaiwanDailyShortSaleBalances       → margin_short_balance / sbl_short_balance
  * TaiwanStockMarginPurchaseShortSale → margin_balance
新程式只對之後的收集生效，既有日期沒有這三欄 → 個股頁放空區塊整片是「—」。

單位
----
* `MarginShortSalesCurrentDayBalance` / `SBLShortSalesCurrentDayBalance` 是**股**
  → `//1000` 向零取整換算成**張**（與收集器、全站慣例一致）。
* `MarginPurchaseTodayBalance` **本身已是張**，不再除 1000。
實測 2026-09-24 全部 2,216 檔：`MarginShortSalesCurrentDayBalance//1000`
與同日官方張數欄位 `ShortSaleTodayBalance` 完全相同（0 筆不一致）。

安全設計（比照 scripts/backfill_foreign_hold_shares.py）
------------------------------------------------------
* 權威來源是 FinMind 該日整批資料，與收集器同一支 API、同樣的換算。
* **只補「目前沒有該欄位」的股票**；已有值的一律不動（可重跑、冪等）。
* 某日 FinMind 回 0 筆（API 暫時失敗）→ 整日跳過，不會把全市場清成 null。
* 未被 FinMind 涵蓋的股票**保持沒有這個欄位**（前端顯示「—」），**絕不寫 0**：
  興櫃等股票沒有融券與借券制度，寫 0 會變成「有制度但無人放空」。
* 預設 DRY-RUN，--write 才實際寫入；寫入前自動備份原始 chunks 到 logs/。

用法
----
  python3 scripts/backfill_short_sale.py                       # 稽核 + dry-run
  python3 scripts/backfill_short_sale.py --write               # 實際回補
  python3 scripts/backfill_short_sale.py --month 2026-09 --write
"""
import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
load_dotenv(ROOT / '.env')

# 放空餘額（股→張）與融資餘額（已是張）分屬兩支 API，缺一邊時另一邊仍可回補，
# 故兩組欄位各自獨立判斷「有沒有」。
SHORT_FIELDS = ('margin_short_balance', 'sbl_short_balance')
MARGIN_FIELDS = ('margin_balance',)


def get_api():
    from FinMind.data import DataLoader
    api = DataLoader()
    token = os.getenv('FINMIND_API_TOKEN', '')
    if token:
        api.login_by_token(api_token=token)
    return api


def _norm_sid(v) -> str:
    """與 firebase_writer._norm_stock_id 同一條規則（0050 曾被讀成 50）。"""
    sid = str(v).strip()
    return sid.zfill(4) if 0 < len(sid) < 4 else sid


def _missing(stock: dict, fields) -> bool:
    """欄位是否「缺」——沒有 key 或值為 None 都算缺（兩者前端都顯示「—」）。

    ⚠️ 0 不算缺：0 是「有融券制度但真的沒人放空」的有效值。
    """
    return any(stock.get(f) is None for f in fields)


def _lots_from_shares(v):
    """股 → 張，向零取整；無法轉數字回 None。"""
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n // 1000


def _as_lots(v):
    """已是張的欄位，只做型別轉換。"""
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def fetch_short(api, date):
    """回傳 {stock_id: (融券張, 借券賣出張)}；抓不到或空的回 None（呼叫端必須跳過）。"""
    try:
        df = api.get_data(dataset='TaiwanDailyShortSaleBalances', data_id='',
                          start_date=date, end_date=date)
    except Exception as e:
        print(f"    ⚠️ {date} 放空餘額抓取失敗，跳過：{e}")
        return None
    if df is None or len(df) == 0:
        return None
    need = {'stock_id', 'MarginShortSalesCurrentDayBalance', 'SBLShortSalesCurrentDayBalance'}
    if not need.issubset(set(df.columns)):
        print(f"    ⚠️ {date} 放空餘額欄位不全（{sorted(set(df.columns) & need)}），跳過")
        return None
    # 兩欄**各自獨立**：一欄是 NaN 不該讓另一欄也補不到（與收集器端
    # `pd.to_numeric(errors='coerce') // 1000` 的逐欄處理對齊）。
    out = {}
    for _, r in df.iterrows():
        vals = {}
        ms = _lots_from_shares(r['MarginShortSalesCurrentDayBalance'])
        if ms is not None:
            vals['margin_short_balance'] = ms
        sbl = _lots_from_shares(r['SBLShortSalesCurrentDayBalance'])
        if sbl is not None:
            vals['sbl_short_balance'] = sbl
        if vals:
            out[_norm_sid(r['stock_id'])] = vals
    return out or None


def fetch_margin(api, date):
    """回傳 {stock_id: 融資餘額張}；抓不到或空的回 None。"""
    try:
        df = api.get_data(dataset='TaiwanStockMarginPurchaseShortSale', data_id='',
                          start_date=date, end_date=date)
    except Exception as e:
        print(f"    ⚠️ {date} 融資資料抓取失敗，跳過：{e}")
        return None
    if df is None or len(df) == 0:
        return None
    if 'MarginPurchaseTodayBalance' not in df.columns or 'stock_id' not in df.columns:
        print(f"    ⚠️ {date} 融資欄位不全，跳過")
        return None
    out = {}
    for _, r in df.iterrows():
        bal = _as_lots(r['MarginPurchaseTodayBalance'])   # 已是張，不除 1000
        if bal is not None:
            out[_norm_sid(r['stock_id'])] = bal
    return out or None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='實際寫入 Firestore（預設 dry-run）')
    ap.add_argument('--month', help='只處理該月，格式 YYYY-MM')
    args = ap.parse_args()

    import firebase_writer as fw
    db = fw.get_firestore_client()

    dates = sorted(fw.list_daily_data_dates())
    if args.month:
        dates = [d for d in dates if d.startswith(args.month)]
    if not dates:
        print('沒有符合的日期')
        return 1

    api = get_api()
    backup = ROOT / 'logs' / 'short_sale_backfill' / datetime.now().strftime('%Y%m%d_%H%M%S')
    if args.write:
        backup.mkdir(parents=True, exist_ok=True)

    print(f"=== 放空資料回補　{'寫入模式' if args.write else 'DRY-RUN'} ===")
    print(f"日期 {len(dates)} 天：{dates[0]} ~ {dates[-1]}")
    if args.write:
        print(f"備份目錄：{backup}\n")

    tot_short = tot_margin = tot_already = tot_nocover = 0
    skipped_days = []

    for date in dates:
        src_short = fetch_short(api, date)
        src_margin = fetch_margin(api, date)
        if src_short is None and src_margin is None:
            skipped_days.append(date)
            print(f"  {date}: FinMind 無資料 → 整日跳過")
            continue

        ref = db.collection('daily_data').document(date).collection('chunks')
        n_short = n_margin = already = nocover = 0
        for doc in ref.stream():
            data = doc.to_dict() or {}
            stocks = data.get('stocks') or []
            if args.write:
                (backup / date).mkdir(parents=True, exist_ok=True)
                (backup / date / f'{doc.id}.json').write_text(
                    json.dumps(data, ensure_ascii=False, default=str), encoding='utf-8')

            changed = False
            for s in stocks:
                sid = str(s.get('stock_id', ''))
                touched = False

                # ⚠️ 「缺」＝ key 不存在 **或值是 None**，兩者都要補。
                #    只檢查 key 存不存在是不夠的：收集器對未涵蓋的股票是寫 key + None，
                #    所以 17:00 那班在放空資料尚未發布時跑過，整個市場三欄都會是
                #    「key 存在但值為 None」。那種日子如果 22:00 那班又失敗，
                #    用 presence check 的版本永遠補不回來，還會被統計成「原本就有」。
                if src_short is not None and _missing(s, SHORT_FIELDS):
                    hit = src_short.get(sid)
                    if hit:
                        for f, v in hit.items():
                            if s.get(f) is None:
                                s[f] = v
                                touched = True
                        if touched:
                            n_short += 1

                if src_margin is not None and _missing(s, MARGIN_FIELDS):
                    hit = src_margin.get(sid)
                    if hit is not None:
                        s['margin_balance'] = hit
                        n_margin += 1
                        touched = True

                if touched:
                    changed = True
                elif not _missing(s, SHORT_FIELDS + MARGIN_FIELDS):
                    already += 1
                else:
                    # FinMind 未涵蓋（無融券/借券制度）→ 保持 null，前端顯示「—」，不寫 0
                    nocover += 1

            if changed and args.write:
                ref.document(doc.id).set({
                    'chunk_index': data.get('chunk_index'),
                    'stocks': stocks,
                    'count': data.get('count', len(stocks)),
                })

        tot_short += n_short
        tot_margin += n_margin
        tot_already += already
        tot_nocover += nocover
        print(f"  {date}: 補放空 {n_short:5d} 檔　補融資 {n_margin:5d} 檔　"
              f"已有 {already:5d}　FinMind 未涵蓋 {nocover:4d}")

    print("\n=== 彙總 ===")
    print(f"  補上放空餘額（融券/借券賣出）：{tot_short:,} 檔")
    print(f"  補上融資餘額：{tot_margin:,} 檔")
    print(f"  原本就有：{tot_already:,} 檔")
    print(f"  FinMind 未涵蓋（保持無欄位，前端顯示「—」）：{tot_nocover:,} 檔")
    if skipped_days:
        print(f"  ⚠️ 整日跳過（FinMind 無資料）：{skipped_days}")
    if not args.write:
        print("\n  這是 DRY-RUN。確認無誤後加 --write。")
    return 0


if __name__ == '__main__':
    sys.exit(main())
