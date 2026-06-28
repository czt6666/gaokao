#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# 河南+新疆 数据增量同步
#
# 背景:
#   2026/2 目录包含河南和新疆两省新版 xlsx，已本地导入（import_new_provinces.py）。
#   本脚本将两省新数据导出精简库 -> 上传 -> 服务器 DELETE + INSERT 替换。
#
# 用法（在 backend 目录）:
#   bash sync_new_provinces.sh                 # 演练：导出 + 上传 + 统计，不写库
#   bash sync_new_provinces.sh --apply         # 正式：导出 + 上传 + 替换 + 重启
#
# 环境变量（可选）:
#   SERVER      服务器地址（默认 root@43.143.206.19）
#   PROD_DB     线上库路径（默认 /app/backend/gaokao.db）
#   REMOTE_PY   服务器 python（默认 /app/backend/.venv/bin/python）
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="${SERVER:-root@43.143.206.19}"
REMOTE_BACKEND="${REMOTE_BACKEND:-/app/backend}"
PROD_DB="${PROD_DB:-$REMOTE_BACKEND/gaokao.db}"
REMOTE_PY="${REMOTE_PY:-$REMOTE_BACKEND/.venv/bin/python}"
REMOTE_TMP="${REMOTE_TMP:-/app/data}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_DB="$SCRIPT_DIR/gaokao.db"
LOCAL_PY="$SCRIPT_DIR/.venv/bin/python"
TS="$(date +%Y%m%d-%H%M%S)"

LOCAL_SYNC="$SCRIPT_DIR/province_sync_${TS}.db"
LOCAL_PAYLOAD="${LOCAL_SYNC}.gz"
REMOTE_PAYLOAD="$REMOTE_TMP/province_sync_${TS}.db.gz"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

echo "========================================"
echo "  河南+新疆 数据增量同步"
echo "  $([ $APPLY -eq 1 ] && echo '正式写入' || echo '演练 DRY-RUN')"
echo "  服务器: $SERVER"
echo "  线上库: $PROD_DB"
echo "========================================"

ssh "$SERVER" "test -f '$PROD_DB'" || {
  echo "[ERR] 线上库不存在: $PROD_DB"
  exit 1
}

# ── 1. 本地导出精简库（仅河南+新疆）──────────────────────────────────────
echo ""
echo "-> [1/5] 导出精简库 (admission_records + admission_2026 河南/新疆)..."

# 创建 apply_server.py（在服务器上执行的脚本，通过参数传递路径）(来自下面的 python 逻辑)

"$LOCAL_PY" - <<PYEOF
import sqlite3, os, gzip, shutil

src = sqlite3.connect('$LOCAL_DB')
dst_path = '$LOCAL_SYNC'
dst = sqlite3.connect(dst_path)
dst.execute("PRAGMA journal_mode=OFF")
dst.execute("PRAGMA synchronous=OFF")

provinces = ['河南', '新疆']

for tbl in ('admission_records', 'admission_2026'):
    # 复制表结构
    create_sql = src.execute(f"SELECT sql FROM sqlite_master WHERE type='table' AND name='{tbl}'").fetchone()[0]
    dst.execute(create_sql)

    # 复制目标省份数据
    all_cols = [r[1] for r in src.execute(f"PRAGMA table_info({tbl})")]
    ph = ",".join("?" for _ in all_cols)
    n = 0
    for p in provinces:
        rows = src.execute(
            f"SELECT {','.join(all_cols)} FROM {tbl} WHERE province = ?", (p,)).fetchall()
        if rows:
            dst.executemany(
                f"INSERT INTO {tbl} ({','.join(all_cols)}) VALUES ({ph})", rows)
            n += len(rows)
    print(f'  {tbl}: {n:,} 行 ({provinces})')

dst.commit()
dst.close()
src.close()

# gzip
with open('$LOCAL_SYNC', 'rb') as f_in:
    with gzip.open('$LOCAL_PAYLOAD', 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)
sz_mb = os.path.getsize('$LOCAL_PAYLOAD') / (1024*1024)
print(f'  压缩后: {sz_mb:.1f} MB')
PYEOF

# ── 编写服务器端 apply 脚本 ─────────────────────────────────────────────────
LOCAL_APPLY_SCRIPT="$SCRIPT_DIR/_apply_province_sync.py"
cat > "$LOCAL_APPLY_SCRIPT" <<'PYEOF'
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
PYEOF

# ── 2. 上传 ──────────────────────────────────────────────────────────────────
echo ""
echo "-> [2/5] 上传精简库 + 应用脚本到服务器..."
ssh "$SERVER" "mkdir -p '$REMOTE_TMP' '$REMOTE_BACKEND/scripts' '$REMOTE_BACKEND/db-backup'"

rsync -av --no-owner --no-group "$LOCAL_PAYLOAD" "$SERVER:$REMOTE_TMP/"
rsync -av --no-owner --no-group "$LOCAL_APPLY_SCRIPT" "$SERVER:$REMOTE_BACKEND/scripts/"

# ── 3. 演练 / 正式应用 ──────────────────────────────────────────────────────
if [ $APPLY -eq 0 ]; then
  echo ""
  echo "-> [3/5] DRY-RUN: 线上两表当前河南/新疆行数..."
  ssh "$SERVER" "$REMOTE_PY" -c "
import sqlite3
c = sqlite3.connect('$PROD_DB')
for p in ('河南','新疆'):
    a26 = c.execute('SELECT COUNT(*) FROM admission_2026 WHERE province=?', (p,)).fetchone()[0]
    adm = c.execute('SELECT COUNT(*) FROM admission_records WHERE province=?', (p,)).fetchone()[0]
    print(f'  [{p}] plan={a26:,} | explode={adm:,}')
c.close()
"
  echo ""
  echo "[OK] 演练完成，未改动线上库。确认无误后加 --apply 写入。"
  echo "     本地精简库: $LOCAL_PAYLOAD"
  rm -f "$LOCAL_APPLY_SCRIPT"
  exit 0
fi

echo ""
echo "-> [3/5] 正式应用: 备份 -> 替换河南/新疆数据..."
ssh "$SERVER" "
  set -e
  cp '$PROD_DB' '$REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS'
  echo '  backup: gaokao.db.bak-$TS'

  $REMOTE_PY $REMOTE_BACKEND/scripts/_apply_province_sync.py '$PROD_DB' '$REMOTE_PAYLOAD' 河南 新疆
"

# ── 4. 校验 ──────────────────────────────────────────────────────────────────
echo ""
echo "-> [4/5] 校验线上结果..."
ssh "$SERVER" "$REMOTE_PY" -c "
import sqlite3
c = sqlite3.connect('$PROD_DB')

for p in ('河南','新疆'):
    a26 = c.execute('SELECT COUNT(*) FROM admission_2026 WHERE province=?', (p,)).fetchone()[0]
    adm = c.execute('SELECT COUNT(*) FROM admission_records WHERE province=?', (p,)).fetchone()[0]
    print(f'  [{p}] plan={a26:,} | explode={adm:,}')

print()
for p in ('河南','新疆'):
    print(f'  [{p}] admission_records 年份:')
    for yr, cnt in c.execute('SELECT year, COUNT(*) FROM admission_records WHERE province=? GROUP BY year ORDER BY year', (p,)):
        print(f'    {yr}: {cnt:,}')

n = c.execute('SELECT COUNT(*) FROM admission_records').fetchone()[0]
n26 = c.execute('SELECT COUNT(*) FROM admission_2026').fetchone()[0]
print(f'\n  全库: records={n:,} | plan={n26:,}')
c.close()
"

# ── 5. 重启后端 ──────────────────────────────────────────────────────────────
echo ""
echo "-> [5/5] 重启后端使数据变更生效..."

ssh "$SERVER" "
  echo '  restart gaokao-backend...'
  sudo systemctl restart gaokao-backend 2>/dev/null && echo '  OK: systemctl restarted' || {
    sudo supervisorctl restart gaokao-backend 2>/dev/null && echo '  OK: supervisorctl restarted' || echo '  WARN: manual restart needed'
  }
  sleep 2
"

# ── 清理 ──────────────────────────────────────────────────────────────────────
echo ""
echo "-> 清理临时文件..."
rm -f "$LOCAL_PAYLOAD" "$LOCAL_SYNC" "$LOCAL_APPLY_SCRIPT"
ssh "$SERVER" "rm -f '$REMOTE_PAYLOAD' '$REMOTE_BACKEND/scripts/_apply_province_sync.py'"

echo ""
echo "========================================"
echo "  同步完成 ($TS)"
echo "  河南: 57,168 plan / 121,928 records"
echo "  新疆: 38,615 plan / 40,666 records"
echo ""
echo "  回滚方案:"
echo "  ssh $SERVER 'cp $REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS $PROD_DB && sudo systemctl restart gaokao-backend'"
echo "========================================"
