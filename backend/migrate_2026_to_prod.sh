#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# 2026 数据重建 — 全量替换式同步线上
#
# 本次是基于新版 xlsx 重建 admission_records + admission_2026 两张表，
# 不是增量更新，因此采用「导出精简库 -> 上传 -> 服务器 ATTACH 替换两表」方案。
#
# 精简库只含两张表（~190MB gzip），远小于 2.9GB 全库。
# 应用时自动 ALTER 补列（新字段 major_full 等不会丢），事务内 DELETE + INSERT。
#
# 用法（在 backend 目录）：
#   bash migrate_2026_to_prod.sh                 # 演练：导出 + 上传 + 统计，不写库
#   bash migrate_2026_to_prod.sh --apply         # 正式：导出 + 上传 + 替换两表 + 重启
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

LOCAL_SYNC="$SCRIPT_DIR/admission_sync_${TS}.db"
LOCAL_PAYLOAD="${LOCAL_SYNC}.gz"
REMOTE_PAYLOAD="$REMOTE_TMP/admission_sync_${TS}.db.gz"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

echo "========================================"
echo "  2026 数据重建 — 全量替换同步"
echo "  $([ $APPLY -eq 1 ] && echo '正式写入' || echo '演练 DRY-RUN')"
echo "  服务器: $SERVER"
echo "  线上库: $PROD_DB"
echo "========================================"

ssh "$SERVER" "test -f '$PROD_DB'" || {
  echo "[ERR] 线上库不存在: $PROD_DB (设置 PROD_DB 或 REMOTE_BACKEND 环境变量覆盖)"
  exit 1
}

# ── 1. 本地导出精简库 ────────────────────────────────────────────────────────
echo ""
echo "-> [1/5] 本地导出精简库 (admission_records + admission_2026)..."
"$LOCAL_PY" "$SCRIPT_DIR/scripts/export_admission_tables.py" \
  --export "$LOCAL_SYNC" --db "$LOCAL_DB"

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
  echo "-> [3/5] DRY-RUN: 线上当前两表行数..."
  ssh "$SERVER" "$REMOTE_PY" - <<PY
import sqlite3
c = sqlite3.connect('$PROD_DB')
for tbl in ('admission_records', 'admission_2026'):
    try:
        n = c.execute(f'SELECT COUNT(*) FROM {tbl}').fetchone()[0]
        print(f'  {tbl}: {n:,} 行 (将被替换)')
    except Exception as e:
        print(f'  {tbl}: 不存在 (将新建) - {e}')
c.close()
PY
  echo ""
  echo "[OK] 演练完成，未改动线上库。确认无误后用 --apply 正式写入。"
  echo "     本地精简库: $LOCAL_PAYLOAD"
  exit 0
fi

echo ""
echo "-> [3/5] 正式应用: 备份 -> ATTACH -> 替换两表..."
ssh "$SERVER" "
  set -e
  cp '$PROD_DB' '$REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS'
  echo '  backup: gaokao.db.bak-$TS'

  $REMOTE_PY $REMOTE_BACKEND/scripts/export_admission_tables.py \
    --apply '$REMOTE_PAYLOAD' --db '$PROD_DB'
"

# ── 4. 校验 ──────────────────────────────────────────────────────────────────
echo ""
echo "-> [4/5] 校验线上结果..."
ssh "$SERVER" "$REMOTE_PY" - <<PY
import sqlite3
c = sqlite3.connect('$PROD_DB')

for tbl in ('admission_records', 'admission_2026'):
    n = c.execute(f'SELECT COUNT(*) FROM {tbl}').fetchone()[0]
    print(f'  {tbl}: {n:,} 行')

# 科类分布
print('  derived_category 分布:')
for cat, cnt in c.execute("SELECT derived_category, COUNT(*) FROM admission_records GROUP BY derived_category ORDER BY COUNT(*) DESC"):
    print(f'    {cat or \"(空)\":8s} {cnt:>10,}')

# subject_must 覆盖（分科类省份应 100%）
filled = c.execute("SELECT COUNT(*) FROM admission_records WHERE derived_category IN ('物理类','历史类') AND subject_must != ''").fetchone()[0]
total = c.execute("SELECT COUNT(*) FROM admission_records WHERE derived_category IN ('物理类','历史类')").fetchone()[0]
if total:
    print(f'  分科类省份 subject_must 覆盖: {filled:,}/{total:,} ({filled*100/total:.1f}%)')

# 年份
print('  年份分布:')
for yr, cnt in c.execute("SELECT year, COUNT(*) FROM admission_records GROUP BY year ORDER BY year"):
    print(f'    {yr}: {cnt:>10,}')
c.close()
PY

# ── 5. 重启后端 ──────────────────────────────────────────────────────────────
echo ""
echo "-> [5/5] 重启后端使代码 + 数据变更生效..."

LOCAL_BRANCH=$(git -C "$SCRIPT_DIR" branch --show-current)
echo "  本地分支: $LOCAL_BRANCH"
echo "  ⚠ 请确认服务器已 git pull 部署代码变更（recommend_core.py / main.py / importers/）"
echo ""

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
rm -f "$LOCAL_PAYLOAD" "$LOCAL_SYNC"
ssh "$SERVER" "rm -f '$REMOTE_PAYLOAD'"

echo ""
echo "========================================"
echo "  同步完成 ($TS)"
echo ""
echo "  回滚方案:"
echo "  ssh $SERVER 'cp $REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS $PROD_DB && sudo systemctl restart gaokao-backend'"
echo "========================================"
