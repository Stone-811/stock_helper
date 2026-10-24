"""
年度檔的 Cloud Storage 同步。

讓 stateless 環境（如 Cloud Run Job、GitHub Actions）也有持久的歷史年度檔：
- collector 開始時 download_archives()：從 Storage 拉年度檔到本地
- collector 結束時 upload_archives()：把本地年度檔推回 Storage

用 USE_GCS_ARCHIVE=1 啟用（Cloud Run 設定；本地開發不設則沿用本地檔）。
Storage 用與前端相同的 Firebase Storage bucket。
"""
import os
import logging
from pathlib import Path

STORAGE_BUCKET = 'stock-analysis-b5602-archive'
ARCHIVE_PREFIX = 'archive/'  # bucket 內的資料夾


def gcs_enabled() -> bool:
    return os.getenv('USE_GCS_ARCHIVE', '') == '1'


def _bucket():
    from google.cloud import storage as gcs
    # 本機用 service-account.json；Cloud Run 用 ADC（同專案免金鑰）
    for p in ('frontend/service-account.json', 'service-account.json'):
        if os.path.exists(p):
            return gcs.Client.from_service_account_json(p).bucket(STORAGE_BUCKET)
    return gcs.Client(project='stock-analysis-b5602').bucket(STORAGE_BUCKET)


class ArchiveSyncError(RuntimeError):
    """年度檔與 Storage 同步失敗。收集器要整輪中止：不可拿殘缺的年度檔收集、重算，更不可上傳蓋掉完整歷史。"""


# 這次執行從 Storage 下載到的每個檔：{檔名: {'generation', 'rows', 'first', 'last'}}，上傳時拿來比對
_downloaded = {}


def _summary(path) -> dict:
    """年度檔的列數與最早／最晚日期（第一欄就是 date，不用 pandas 整份讀進來）。"""
    rows, first, last = 0, None, None
    with open(path, encoding='utf-8-sig') as f:
        next(f, None)  # 表頭
        for line in f:
            d = line.split(',', 1)[0].strip()
            if not d:
                continue
            rows += 1
            if first is None or d < first:
                first = d
            if last is None or d > last:
                last = d
    return {'rows': rows, 'first': first, 'last': last}


def download_archives(local_archive_dir) -> int:
    """
    從 Storage 下載年度檔到本地（collector 開始時）。回傳下載檔數。

    ⚠️ 任何一個檔下載失敗都 raise ArchiveSyncError，呼叫端要讓整輪中止。以前是記 warning 回傳 0、照常收集，
    結果是拿截斷或只有一天的年度檔算漲跌幅與強勢股，最後 upload_archives() 再把它蓋回 Storage，
    完整歷史就沒了（bucket 沒開 versioning，只有 7 天 soft delete 救得回來）。
    先下載到 .part、確認大小與 Storage 一致才換上，並鎖定列出時的 generation。
    """
    if not gcs_enabled():
        return 0
    _downloaded.clear()
    try:
        bucket = _bucket()
        local_dir = Path(local_archive_dir)
        local_dir.mkdir(parents=True, exist_ok=True)
        count = 0
        for blob in bucket.list_blobs(prefix=ARCHIVE_PREFIX):
            fname = blob.name[len(ARCHIVE_PREFIX):]
            if not fname.endswith('.csv'):
                continue
            final, part = local_dir / fname, local_dir / (fname + '.part')
            try:
                blob.download_to_filename(str(part), if_generation_match=blob.generation)
                got = part.stat().st_size
                if got != blob.size:
                    raise ArchiveSyncError(f'{fname} 下載不完整：{got:,} / {blob.size:,} bytes')
                os.replace(part, final)
            finally:
                if part.exists():
                    part.unlink()
            _downloaded[fname] = {'generation': blob.generation, **_summary(final)}
            count += 1
        if count == 0:
            raise ArchiveSyncError('Storage 裡沒有任何年度檔')
        logging.info(f"✓ 從 Storage 下載 {count} 個年度檔：" + '、'.join(
            f"{k} {v['rows']:,} 列（到 {v['last']}）" for k, v in sorted(_downloaded.items())))
        return count
    except ArchiveSyncError:
        raise
    except Exception as e:
        raise ArchiveSyncError(f'Storage 下載年度檔失敗：{e}') from e


def upload_archives(local_archive_dir) -> int:
    """
    把本地年度檔上傳 Storage（collector 結束時）。回傳上傳檔數。

    ⚠️ 兩道防線，任何一個檔不過就不上傳該檔，最後 raise ArchiveSyncError（呼叫端會寄告警）：
    1. 不可比下載時「變少」：列數少於 99%、最晚日期倒退、或最早日期往後 → 一定是本地檔殘缺。
    2. 帶下載時的 generation 上傳（新年度的檔帶 0＝Storage 上必須還不存在）：
       兩個執行同時跑時（排程與手動 workflow_dispatch），後傳的不會蓋掉先傳的那天。
    """
    if not gcs_enabled():
        return 0
    try:
        bucket = _bucket()
    except Exception as e:
        raise ArchiveSyncError(f'連不到 Storage，年度檔沒有上傳：{e}') from e
    local_dir = Path(local_archive_dir)
    problems, count = [], 0
    for csv in sorted(local_dir.glob('*.csv')):
        name, now = csv.name, _summary(csv)
        base = _downloaded.get(name)
        if base:
            shrunk = now['rows'] < base['rows'] * 0.99
            moved = ((now['last'] or '') < (base['last'] or '')
                     or (base['first'] and now['first'] and now['first'] > base['first']))
            if shrunk or moved:
                problems.append(f"{name} 比下載時殘缺（{base['rows']:,} → {now['rows']:,} 列，"
                                f"{base['first']}～{base['last']} → {now['first']}～{now['last']}），不上傳")
                continue
            generation = base['generation']
        else:
            generation = 0
        blob = bucket.blob(ARCHIVE_PREFIX + name)
        try:
            blob.upload_from_filename(str(csv), if_generation_match=generation)
        except Exception as e:
            problems.append(f'{name} 上傳失敗（可能有另一個執行先更新了）：{e}')
            continue
        _downloaded[name] = {'generation': blob.generation, **now}
        count += 1
    if problems:
        raise ArchiveSyncError('；'.join(problems))
    logging.info(f"✓ 上傳 {count} 個年度檔到 Storage")
    return count
