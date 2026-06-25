#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# 把 admission_2026 + admission_records 两张表的数据「直接」发到线上替换。
# 不在服务器上重新计算/去重，纯数据传输：
#   1. 本地把这两张表导出成一个小载荷库 migration_2026_payload.db
#   2. gzip 后 scp 到服务器
#   3. 服务器上用载荷整表替换这两张表（其余表 users/orders/... 完全不碰）
#
# 用法（在 backend 目录）：
#   bash migrate_2026_to_prod.sh           # 演练：本地建载荷 + 传输 + 线上统计将替换多少，不写
#   bash migrate_2026_to_prod.sh --apply   # 正式：备份线上库 → 停服务 → 整表替换 → 重启 → 校验
#
# ⚠️ 整表替换：线上这两张表会被本地版本整体覆盖。admission_records 属参考数据，
#    本地应为线上的超集（线上 base + 本次回填）。执行前已自动备份，附回滚命令。
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="root@43.143.206.19"
REMOTE_BACKEND="/app/backend"
PROD_DB="$REMOTE_BACKEND/gaokao.db"               # 线上库（如 .env 的 DATABASE_URL 指向别处请改）
REMOTE_PY="$REMOTE_BACKEND/.venv/bin/python"      # 服务器 python（无 .venv 改: uv run python）
REMOTE_TMP="/app/data"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD="$SCRIPT_DIR/migration_2026_payload.db"
TS="$(date +%Y%m%d-%H%M%S)"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

echo "========================================"
echo "  2026 两表数据直传线上  ($([ $APPLY -eq 1 ] && echo 正式写入 || echo 演练DRY-RUN))"
echo "  服务器: $SERVER   线上库: $PROD_DB"
echo "========================================"

ssh "$SERVER" "test -f '$PROD_DB'" || { echo "✗ 线上库不存在: $PROD_DB（确认路径后改 PROD_DB）"; exit 1; }

# ── 1. 本地构建载荷库 ────────────────────────────────────────────────────────
echo ""
echo "→ [1/4] 本地导出载荷库（admission_2026 全量 + admission_records 增量）..."
# ⚠️ backup = 上次已同步到线上的库快照（线上现状基线），增量只含相对它的新增。
#    首次同步用 gaokao.db.bak-before-2026import；后续每批同步前重新快照、改这里。
BASELINE="${BASELINE:-$SCRIPT_DIR/gaokao.db.bak-before-batch2}"
"$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/migrate_2026_build_payload.py" \
  --src "$SCRIPT_DIR/gaokao.db" \
  --backup "$BASELINE" \
  --out "$PAYLOAD"

# ── 2. 压缩并传输 ────────────────────────────────────────────────────────────
echo ""
echo "→ [2/4] 压缩 + 传输载荷库到服务器 ..."
gzip -f -k "$PAYLOAD"                              # 生成 $PAYLOAD.gz，保留原文件
ssh "$SERVER" "mkdir -p '$REMOTE_TMP'"
rsync -av --no-owner --no-group "$PAYLOAD.gz" "$SERVER:$REMOTE_TMP/"
rsync -av --no-owner --no-group \
  "$SCRIPT_DIR/migrate_2026_apply_payload.py" "$SERVER:$REMOTE_TMP/"
# 派生字段回填脚本 + 依赖（放 /app/data/，自带 scripts/ 子目录，脚本按相对路径找依赖）
ssh "$SERVER" "mkdir -p '$REMOTE_TMP/scripts'"
rsync -av --no-owner --no-group "$SCRIPT_DIR/backfill_derived_fields.py" "$SERVER:$REMOTE_TMP/"
rsync -av --no-owner --no-group \
  "$SCRIPT_DIR/scripts/batch_type_map.py" \
  "$SCRIPT_DIR/scripts/subject_rule_map.py" \
  "$SCRIPT_DIR/scripts/subject_requirement_expr.py" \
  "$SERVER:$REMOTE_TMP/scripts/"
ssh "$SERVER" "gunzip -f '$REMOTE_TMP/migration_2026_payload.db.gz'"

REMOTE_PAYLOAD="$REMOTE_TMP/migration_2026_payload.db"

# ── 3. 演练 / 正式替换 ───────────────────────────────────────────────────────
if [ $APPLY -eq 0 ]; then
  echo ""
  echo "→ [3/4] DRY-RUN：线上统计将替换多少行（不写库）..."
  ssh "$SERVER" "$REMOTE_PY $REMOTE_TMP/migrate_2026_apply_payload.py --db '$PROD_DB' --payload '$REMOTE_PAYLOAD'"
  echo ""
  echo "→ 派生字段回填 DRY-RUN（线上当前库，未含本次新增省）..."
  ssh "$SERVER" "$REMOTE_PY $REMOTE_TMP/backfill_derived_fields.py --db '$PROD_DB'"
  echo ""
  echo "✓ 演练完成，未改动线上库。确认无误后用 --apply 正式写入。"
  exit 0
fi

echo ""
echo "→ [3/4] 正式替换：备份 → 停后端 → 整表替换 → 重启 ..."
ssh "$SERVER" "
  set -e
  mkdir -p $REMOTE_BACKEND/db-backup
  echo '  备份线上库 → db-backup/gaokao.db.bak-$TS'
  cp '$PROD_DB' '$REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS'
  echo '  停 gaokao-backend（避免 SQLite 写锁竞争）'
  sudo systemctl stop gaokao-backend
  echo '  整表替换'
  $REMOTE_PY $REMOTE_TMP/migrate_2026_apply_payload.py --db '$PROD_DB' --payload '$REMOTE_PAYLOAD' --apply
  echo '  回填派生字段 batch_type/subject/is_985（幂等，仅补空缺）'
  $REMOTE_PY $REMOTE_TMP/backfill_derived_fields.py --db '$PROD_DB' --apply
  echo '  重启 gaokao-backend'
  sudo systemctl start gaokao-backend
  sleep 2
  sudo systemctl is-active gaokao-backend
"

# ── 4. 校验 ──────────────────────────────────────────────────────────────────
echo ""
echo "→ [4/4] 校验线上结果 ..."
ssh "$SERVER" "$REMOTE_PY - <<PY
import sqlite3
c = sqlite3.connect('$PROD_DB').cursor()
print('  admission_2026 行数:', c.execute('SELECT COUNT(*) FROM admission_2026').fetchone()[0])
print('  admission_2026 省份数:', c.execute('SELECT COUNT(DISTINCT province) FROM admission_2026').fetchone()[0])
print('  admission_records 行数:', c.execute('SELECT COUNT(*) FROM admission_records').fetchone()[0])
PY"

echo ""
echo "========================================"
echo "  ✅ 迁移完成。回滚命令（如需）："
echo "  ssh $SERVER 'systemctl stop gaokao-backend && cp $REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS $PROD_DB && systemctl start gaokao-backend'"
echo "========================================"
