#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# rank_tables（一分一段）— 全量替换式同步线上
#
# 一分一段表本地重建/补全后整体推线上。沿用 admission 同款方案：
#   「导出精简库 -> 上传 -> 服务器 ATTACH 替换 rank_tables -> 重启」
#
# 精简库只含 rank_tables（~1MB gzip）。apply 端在事务内 DELETE + INSERT，
# 不删表（保留线上现有索引），目标表缺列时自动 ALTER 补列。
#
# 用法（在 backend 目录）：
#   bash migrate_rank_to_prod.sh                 # 演练：导出 + 上传 + 统计，不写库
#   bash migrate_rank_to_prod.sh --apply         # 正式：导出 + 上传 + 替换 + 重启
#
# 环境变量（可选）：
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

LOCAL_SYNC="$SCRIPT_DIR/rank_sync_${TS}.db"
LOCAL_PAYLOAD="${LOCAL_SYNC}.gz"
REMOTE_PAYLOAD="$REMOTE_TMP/rank_sync_${TS}.db.gz"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

echo "========================================"
echo "  rank_tables 一分一段 — 全量替换同步"
echo "  $([ $APPLY -eq 1 ] && echo '正式写入' || echo '演练 DRY-RUN')"
echo "  服务器: $SERVER"
echo "  线上库: $PROD_DB"
echo "========================================"

ssh "$SERVER" "test -f '$PROD_DB'" || {
  echo "[ERR] 线上库不存在: $PROD_DB (设置 PROD_DB 或 REMOTE_BACKEND 环境变量覆盖)"
  exit 1
}

# ── 1. 本地 checkpoint WAL + 导出精简库 ──────────────────────────────────────
echo ""
echo "-> [1/5] 本地 checkpoint WAL + 导出 rank_tables 精简库..."
sqlite3 "$LOCAL_DB" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
"$LOCAL_PY" "$SCRIPT_DIR/scripts/export_admission_tables.py" \
  --export "$LOCAL_SYNC" --db "$LOCAL_DB" --tables rank_tables

# ── 2. 上传 ──────────────────────────────────────────────────────────────────
echo ""
echo "-> [2/5] 上传精简库 + 应用脚本到服务器..."
ssh "$SERVER" "mkdir -p '$REMOTE_TMP' '$REMOTE_BACKEND/scripts' '$REMOTE_BACKEND/db-backup'"
rsync -av --no-owner --no-group "$LOCAL_PAYLOAD" "$SERVER:$REMOTE_TMP/"
rsync -av --no-owner --no-group \
  "$SCRIPT_DIR/scripts/export_admission_tables.py" \
  "$SERVER:$REMOTE_BACKEND/scripts/"

# ── 3. 演练 / 正式应用 ──────────────────────────────────────────────────────
if [ $APPLY -eq 0 ]; then
  echo ""
  echo "-> [3/5] DRY-RUN: 线上当前 rank_tables 概况..."
  ssh "$SERVER" "$REMOTE_PY" - <<PY
import sqlite3
c = sqlite3.connect('$PROD_DB')
try:
    n = c.execute('SELECT COUNT(*) FROM rank_tables').fetchone()[0]
    print(f'  rank_tables: {n:,} 行 (将被替换)')
    for yr, p, rows in c.execute('SELECT year, COUNT(DISTINCT province), COUNT(*) FROM rank_tables GROUP BY year ORDER BY year'):
        print(f'    {yr}: {p} 省 {rows:,} 行')
except Exception as e:
    print(f'  rank_tables: 不存在 (将新建) - {e}')
c.close()
PY
  echo ""
  echo "[OK] 演练完成，未改动线上库。确认无误后用 --apply 正式写入。"
  echo "     本地精简库: $LOCAL_PAYLOAD"
  exit 0
fi

echo ""
echo "-> [3/5] 正式应用: 备份 -> ATTACH -> 替换 rank_tables..."
ssh "$SERVER" "
  set -e
  cp '$PROD_DB' '$REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS'
  echo '  backup: gaokao.db.bak-$TS'

  $REMOTE_PY $REMOTE_BACKEND/scripts/export_admission_tables.py \
    --apply '$REMOTE_PAYLOAD' --db '$PROD_DB' --tables rank_tables
"

# ── 4. 校验 ──────────────────────────────────────────────────────────────────
echo ""
echo "-> [4/5] 校验线上结果..."
ssh "$SERVER" "$REMOTE_PY" - <<PY
import sqlite3
c = sqlite3.connect('$PROD_DB')
n = c.execute('SELECT COUNT(*) FROM rank_tables').fetchone()[0]
print(f'  rank_tables: {n:,} 行')
for yr, p, rows in c.execute('SELECT year, COUNT(DISTINCT province), COUNT(*) FROM rank_tables GROUP BY year ORDER BY year'):
    print(f'    {yr}: {p} 省 {rows:,} 行')
c.close()
PY

# ── 5. 重启后端 ──────────────────────────────────────────────────────────────
echo ""
echo "-> [5/5] 重启后端使数据变更生效..."
ssh "$SERVER" "
  sudo systemctl restart gaokao-backend 2>/dev/null && echo '  OK: systemctl restarted' || {
    sudo supervisorctl restart gaokao-backend 2>/dev/null && echo '  OK: supervisorctl restarted' || echo '  WARN: manual restart needed'
  }
  sleep 2
"

# ── 清理 ──────────────────────────────────────────────────────────────────────
echo ""
echo "-> 清理临时文件..."
rm -f "$LOCAL_PAYLOAD" "$LOCAL_SYNC"
ssh "$SERVER" "rm -f '$REMOTE_PAYLOAD'"

echo ""
echo "========================================"
echo "  同步完成 ($TS)"
echo ""
echo "  回滚方案:"
echo "  ssh $SERVER 'cp $REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS $PROD_DB && sudo systemctl restart gaokao-backend'"
echo "========================================"
