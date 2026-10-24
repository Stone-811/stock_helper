"""
年度檔的 Cloud Storage 同步。

讓 stateless 環境（如 Cloud Run Job、GitHub Actions）也有持久的歷史年度檔：
- collector 開始時 download_archives()：從 Storage 拉年度檔到本地
- collector 結束時 upload_archives()：把本地年度檔推回 Storage

用 USE_GCS_ARCHIVE=1 啟用（Cloud Run 設定；本地開發不設則沿用本地檔）。
Storage 用與前端相同的 Firebase Storage bucket。
"""
import base64
import hashlib
import logging
import os
import re
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


class ArchiveUploadError(ArchiveSyncError):
    """資料已收集、已寫 Firestore，但年度檔沒存回 Storage（被防線擋下或與別的執行衝突）。"""


# 只同步正式年度檔。archive/ 底下的備份（子資料夾、stocks_2026_backup.csv）不可被下載、重傳，
# 也不可被 update_matrix 的 glob('stocks_*.csv') 當成另一份年度檔。備份請放在 archive/ 以外。
ARCHIVE_RE = re.compile(r'stocks_\d{4}\.csv')

# 這次執行從 Storage 下載到的每個檔：{檔名: {'generation', 'md5', 'days', 'rows', 'first', 'last'}}
_downloaded = {}


def _summary(path) -> dict:
    """
    年度檔每天有幾檔（同一天同一代號只算一次）與最早／最晚日期。

    ⚠️ 不可數原始列數：2023～2025 年度檔各有約 1.1% 的 (date, stock_id) 重複列（改名、轉上市留下的兩個股名），
    重收任何一天時 _append_to_yearly_archive 會整份去重，列數少 1% 以上，但資料沒有少。
    """
    days = {}
    with open(path, encoding='utf-8-sig') as f:
        next(f, None)  # 表頭
        for line in f:
            parts = line.split(',', 2)
            if len(parts) < 2 or not parts[0].strip():
                continue
            days.setdefault(parts[0].strip(), set()).add(parts[1].strip())
    counts = {d: len(ids) for d, ids in days.items()}
    return {'days': counts, 'rows': sum(counts.values()),
            'first': min(counts) if counts else None, 'last': max(counts) if counts else None}


def _md5(path) -> str:
    """與 Storage 的 blob.md5_hash 同格式（base64），用來判斷本地檔有沒有被改過。"""
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode()


def require_authoritative_archive(writes_firestore: bool):
    """
    會寫 Firestore、卻沒開 Storage 同步時中止。

    本機的 data/daily_reports/archive 只是某天的副本（例：停在 2026-09-04），拿它算前一日收盤、MACD、連買天數，
    會把錯的強勢名單與 daily_data 寫進正式站，而且本機不上傳，Storage 也缺那一天。
    要在本機跑正式資料：設 USE_GCS_ARCHIVE=1（開頭下載、結尾上傳）。確定只是本機實驗：設 ALLOW_LOCAL_ARCHIVE=1。

    writes_firestore 由呼叫端傳入（stock_collector.config.firebase_enabled()）。⚠️ 這裡不可自己
    `from stock_collector import config`：用 `python stock_collector/update_strong_matrix.py` 執行時，
    stock_collector/ 目錄在 sys.path 上，會把 stock_collector/stock_collector.py 當成頂層套件載入而崩潰。
    """
    if writes_firestore and not gcs_enabled() and os.getenv('ALLOW_LOCAL_ARCHIVE') != '1':
        raise ArchiveSyncError('會寫入正式 Firestore，但沒有設 USE_GCS_ARCHIVE=1：本機年度檔不是最新的完整歷史。'
                               '請設 USE_GCS_ARCHIVE=1 再跑；只是本機實驗才設 ALLOW_LOCAL_ARCHIVE=1')


def ensure_downloaded(local_archive_dir) -> int:
    """這次執行還沒從 Storage 下載過年度檔就先下載（例：--days 的日子全是休市日、run_daily 都沒走到下載，
    最後卻還要重算強勢股）。已下載過就不重下。回傳下載檔數。"""
    if gcs_enabled() and not _downloaded:
        return download_archives(local_archive_dir)
    return 0


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
            if not ARCHIVE_RE.fullmatch(fname):
                if fname:
                    logging.warning(f"⚠️ Storage 的 {blob.name} 不是年度檔，略過（備份請放在 {ARCHIVE_PREFIX} 以外）")
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
            _downloaded[fname] = {'generation': blob.generation, 'md5': blob.md5_hash, **_summary(final)}
            count += 1
        if count == 0:
            raise ArchiveSyncError('Storage 裡沒有任何年度檔')
        logging.info(f"✓ 從 Storage 下載 {count} 個年度檔：" + '、'.join(
            f"{k} {len(v['days'])} 天（到 {v['last']}）" for k, v in sorted(_downloaded.items())))
        return count
    except ArchiveSyncError:
        raise
    except Exception as e:
        raise ArchiveSyncError(f'Storage 下載年度檔失敗：{e}') from e


def check_upload(local_archive_dir):
    """
    上傳前的比對，只檢查不上傳（回補腳本的 dry-run 也用這個，預告 --write 的結果）。

    回傳 (要上傳的 [(路徑, generation, summary)], 沒改過略過的檔名, 問題清單)。
    不過關的條件：下載時有的日子不見了，或某一天的檔數比下載時少（同一天重收是整天替換，不會合法地變少；
    例：重收某天時 FinMind 只回 85%，2,334 檔被換成 1,979 檔。少掉的正是唯一完整歷史裡要保護的列）。
    """
    local_dir = Path(local_archive_dir)
    to_upload, unchanged, problems = [], [], []
    for csv in sorted(local_dir.glob('*.csv')):
        name = csv.name
        if not ARCHIVE_RE.fullmatch(name):
            continue
        base = _downloaded.get(name)
        if base and base.get('md5') and base['md5'] == _md5(csv):
            unchanged.append(name)
            continue
        now = _summary(csv)
        if base:
            lost = sorted(d for d in base['days'] if d not in now['days'])
            shrunk = sorted(d for d, n in base['days'].items() if d in now['days'] and now['days'][d] < n)
            if lost or shrunk:
                detail = []
                if lost:
                    detail.append(f"少了 {len(lost)} 天（{'、'.join(lost[:5])}{'…' if len(lost) > 5 else ''}）")
                for d in shrunk[:5]:
                    detail.append(f"{d} 從 {base['days'][d]:,} 檔變 {now['days'][d]:,} 檔")
                problems.append(f"{name} 比下載時殘缺：{'；'.join(detail)}，不上傳")
                continue
            to_upload.append((csv, base['generation'], now))
        else:
            to_upload.append((csv, 0, now))   # 新年度檔：Storage 上必須還不存在
    return to_upload, unchanged, problems


def upload_archives(local_archive_dir) -> int:
    """
    把本地有改過的年度檔上傳 Storage（collector 結束時）。回傳上傳檔數。

    ⚠️ 比對（check_upload）不過的檔不上傳；其餘帶下載時的 generation 上傳（新年度檔帶 0），
    兩個執行同時跑時（排程與手動 workflow_dispatch），後傳的不會蓋掉先傳的那天。
    沒改過的檔不重傳，免得只重算強勢股的執行也跟排程互相衝突。
    有任何問題就 raise ArchiveUploadError（呼叫端會寄告警，資料已寫 Firestore）。
    """
    if not gcs_enabled():
        return 0
    to_upload, unchanged, problems = check_upload(local_archive_dir)
    count = 0
    if to_upload:
        try:
            bucket = _bucket()
        except Exception as e:
            raise ArchiveUploadError(f'連不到 Storage，年度檔沒有上傳：{e}') from e
        for csv, generation, now in to_upload:
            blob = bucket.blob(ARCHIVE_PREFIX + csv.name)
            try:
                blob.upload_from_filename(str(csv), if_generation_match=generation)
            except Exception as e:
                problems.append(f'{csv.name} 上傳失敗（可能有另一個執行先更新了）：{e}')
                continue
            _downloaded[csv.name] = {'generation': blob.generation, 'md5': blob.md5_hash, **now}
            count += 1
    if problems:
        raise ArchiveUploadError('；'.join(problems))
    logging.info(f"✓ 上傳 {count} 個年度檔到 Storage" + (f"（{len(unchanged)} 個沒改過、略過）" if unchanged else ''))
    return count
