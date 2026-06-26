#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# 2026 一分一段（rank_tables）— 同步线上
#
# 与 migrate_2026_to_prod.sh（同步 admission_records / admission_2026）互补：
# 这个只同步 rank_tables 的 year=2026 数据，来源是本地
# data/rank_2026_merged.json（由 scripts/merge_import_rank_2026.py 生成的大 JSON）。
#
# 做法：本地重新生成大 JSON → 上传 JSON + apply_rank_json.py → 线上事务内
# 「删 year=2026 旧数据 + 插新」→ 重启后端。只动 rank_tables 的 2026，不碰其他表/年份。
# 短表（山西，只发了高分段）默认不写，避免按 per-province MAX(year) 盖掉旧年完整数据。
#
# 用法（在 backend 目录）：
#   bash sync_rank_2026_to_prod.sh                 # 演练：生成+上传+打印线上将被替换的行数
#   bash sync_rank_2026_to_prod.sh --apply         # 正式：备份 → 替换 year=2026 → 重启后端
#
# 环境变量（可选）：SERVER / REMOTE_BACKEND / PROD_DB / REMOTE_PY
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="${SERVER:-root@43.143.206.19}"
REMOTE_BACKEND="${REMOTE_BACKEND:-/app/backend}"
PROD_DB="${PROD_DB:-$REMOTE_BACKEND/gaokao.db}"
REMOTE_PY="${REMOTE_PY:-$REMOTE_BACKEND/.venv/bin/python}"
REMOTE_TMP="${REMOTE_TMP:-/app/data}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_PY="$SCRIPT_DIR/.venv/bin/python"
MERGED_JSON="$SCRIPT_DIR/data/rank_2026_merged.json"
APPLY_SCRIPT="$SCRIPT_DIR/scripts/apply_rank_json.py"
TS="$(date +%Y%m%d-%H%M%S)"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

echo "========================================"
echo "  2026 一分一段同步线上 (rank_tables)"
echo "  $([ $APPLY -eq 1 ] && echo '正式写入' || echo '演练 DRY-RUN')"
echo "  服务器: $SERVER   线上库: $PROD_DB"
echo "========================================"

ssh "$SERVER" "test -f '$PROD_DB'" || { echo "[ERR] 线上库不存在: $PROD_DB"; exit 1; }

# ── 1. 本地重新生成大 JSON（从 staging 校验+合并，仅干净表）────────────────────
echo ""
echo "-> [1/4] 本地重新生成 rank_2026_merged.json..."
"$LOCAL_PY" "$SCRIPT_DIR/scripts/merge_import_rank_2026.py" --no-import | tail -n 20
[ -f "$MERGED_JSON" ] || { echo "[ERR] 未生成 $MERGED_JSON"; exit 1; }

# ── 2. 上传 JSON + 应用脚本 ──────────────────────────────────────────────────
echo ""
echo "-> [2/4] 上传大 JSON + apply_rank_json.py..."
ssh "$SERVER" "mkdir -p '$REMOTE_TMP' '$REMOTE_BACKEND/scripts' '$REMOTE_BACKEND/db-backup'"
rsync -av --no-owner --no-group "$MERGED_JSON" "$SERVER:$REMOTE_TMP/rank_2026_merged.json"
rsync -av --no-owner --no-group "$APPLY_SCRIPT" "$SERVER:$REMOTE_BACKEND/scripts/"

# ── 3. 演练 / 正式应用 ──────────────────────────────────────────────────────
if [ $APPLY -eq 0 ]; then
  echo ""
  echo "-> [3/4] DRY-RUN: 线上将被替换的行数..."
  ssh "$SERVER" "$REMOTE_PY $REMOTE_BACKEND/scripts/apply_rank_json.py \
    --json '$REMOTE_TMP/rank_2026_merged.json' --db '$PROD_DB'"
  echo ""
  echo "[OK] 演练完成，未改动线上库。确认无误后用 --apply 正式写入。"
  exit 0
fi

echo ""
echo "-> [3/4] 正式应用: 备份 → 替换 year=2026..."
ssh "$SERVER" "
  set -e
  cp '$PROD_DB' '$REMOTE_BACKEND/db-backup/gaokao.db.bak-rank-$TS'
  echo '  backup: db-backup/gaokao.db.bak-rank-$TS'
  $REMOTE_PY $REMOTE_BACKEND/scripts/apply_rank_json.py \
    --json '$REMOTE_TMP/rank_2026_merged.json' --db '$PROD_DB' --apply
"

# ── 4. 重启后端 ──────────────────────────────────────────────────────────────
echo ""
echo "-> [4/4] 重启后端使 2026 一分一段生效..."
ssh "$SERVER" "
  sudo systemctl restart gaokao-backend 2>/dev/null && echo '  OK: systemctl restarted' || {
    sudo supervisorctl restart gaokao-backend 2>/dev/null && echo '  OK: supervisorctl restarted' || echo '  WARN: 需手动重启'
  }
  sleep 2
"
ssh "$SERVER" "rm -f '$REMOTE_TMP/rank_2026_merged.json'"

echo ""
echo "========================================"
echo "  rank_tables 2026 同步完成 ($TS)"
echo "  回滚: ssh $SERVER 'cp $REMOTE_BACKEND/db-backup/gaokao.db.bak-rank-$TS $PROD_DB && sudo systemctl restart gaokao-backend'"
echo "========================================"
