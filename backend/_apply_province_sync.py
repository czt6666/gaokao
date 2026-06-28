"""在服务器上执行：用精简库替换目标省份数据。用法：python _apply_province_sync.py <main_db> <slim_db_gz> <prov1> [prov2 ...]"""
import sys, sqlite3, gzip, shutil, os, tempfile

main_db = sys.argv[1]
payload = sys.argv[2]
provinces = tuple(sys.argv[3:])

if not provinces:
    raise SystemExit("至少指定一个省份")

# 解压
tmp_slim = tempfile.mktemp(suffix='.db')
with gzip.open(payload, 'rb') as f_in:
    with open(tmp_slim, 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)

src = sqlite3.connect(tmp_slim)
main = sqlite3.connect(main_db)
main.execute('PRAGMA journal_mode=WAL')
main.execute('PRAGMA synchronous=NORMAL')
cur = main.cursor()

for tbl in ('admission_records', 'admission_2026'):
    for p in provinces:
        cur.execute(f'DELETE FROM {tbl} WHERE province = ?', (p,))
    print(f'  已清空 {tbl} 中 {provinces} 旧数据')

    all_cols = [r[1] for r in main.execute(f'PRAGMA table_info({tbl})')]
    ph = ','.join('?' for _ in all_cols)
    n = 0
    for p in provinces:
        rows = src.execute(
            f"SELECT {','.join(all_cols)} FROM {tbl} WHERE province = ?", (p,)).fetchall()
        if rows:
            cur.executemany(
                f'INSERT INTO {tbl} ({",".join(all_cols)}) VALUES ({ph})', rows)
            n += len(rows)
    print(f'  已写入 {tbl}: {n:,} 行')

main.commit()

# 索引重建
for idx_sql in [
    'CREATE INDEX IF NOT EXISTS ix_ar_prov_year ON admission_records(province, year)',
    'CREATE INDEX IF NOT EXISTS ix_ar_school ON admission_records(school_name)',
    'CREATE INDEX IF NOT EXISTS ix_ar_major ON admission_records(major_name)',
    'CREATE UNIQUE INDEX IF NOT EXISTS ux_a26_uid ON admission_2026(row_uid)',
    'CREATE INDEX IF NOT EXISTS ix_a26_prov ON admission_2026(province)',
    'CREATE INDEX IF NOT EXISTS ix_a26_school ON admission_2026(school_name)',
]:
    cur.execute(idx_sql)
main.commit()

src.close()
main.close()
os.unlink(tmp_slim)
print('  ✓ 替换完成')
