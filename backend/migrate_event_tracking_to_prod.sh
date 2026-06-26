#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# 使用埋点（PDF 下载 / AI 提问）上线 — 表结构校验 + 索引补齐（幂等）
#
# ⚠ 重要：本次后端改动【没有新增表 / 新增列】。
#   pdf_download / ai_chat 只是写入已存在的 user_events 表的 event_type 字段，
#   线上早已有这张表（/api/track、后台查询记录一直在用）。
#   因此上线只需：服务器 git pull + 重启后端，无需迁移数据。
#
# 本脚本是「保险」：只做幂等校验 —— 确认 user_events 列齐全、
#   并 CREATE INDEX IF NOT EXISTS 补上「使用埋点」统计页用到的索引。
#   可反复运行，不会丢任何数据。
#
# 用法（在 backend 目录）：
#   bash migrate_event_tracking_to_prod.sh            # 演练：只打印线上现状，不写库
#   bash migrate_event_tracking_to_prod.sh --apply    # 正式：补列/补索引 + ANALYZE + 重启
#
# 环境变量（可选，默认同 migrate_2026_to_prod.sh）：
#   SERVER          服务器地址（默认 root@43.143.206.19）
#   REMOTE_BACKEND  线上 backend 目录（默认 /app/backend）
#   PROD_DB         线上库路径（默认 $REMOTE_BACKEND/gaokao.db）
#   REMOTE_PY       服务器 python（默认 $REMOTE_BACKEND/.venv/bin/python）
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SERVER="${SERVER:-root@43.143.206.19}"
REMOTE_BACKEND="${REMOTE_BACKEND:-/app/backend}"
PROD_DB="${PROD_DB:-$REMOTE_BACKEND/gaokao.db}"
REMOTE_PY="${REMOTE_PY:-$REMOTE_BACKEND/.venv/bin/python}"

TS="$(date +%Y%m%d-%H%M%S)"

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

echo "========================================"
echo "  使用埋点上线 — user_events 校验/补索引（幂等）"
echo "  $([ $APPLY -eq 1 ] && echo '正式写入' || echo '演练 DRY-RUN')"
echo "  服务器: $SERVER"
echo "  线上库: $PROD_DB"
echo "========================================"

ssh "$SERVER" "test -f '$PROD_DB'" || {
  echo "[ERR] 线上库不存在: $PROD_DB (用 PROD_DB / REMOTE_BACKEND 覆盖)"
  exit 1
}

# log_event() 写入的列（必须存在，否则埋点会静默失败）
NEEDED_COLS="user_id session_id event_type event_data page province rank_input subject exam_mode c_major c_city c_nature c_tier ip user_agent created_at"
# 后台「使用埋点」统计页 GROUP BY / ORDER BY 用到的索引
#   name|definition  —— CREATE INDEX IF NOT EXISTS 幂等创建
INDEXES="
ix_user_events_type_created|user_events(event_type, created_at)
ix_user_events_province_created|user_events(province, created_at)
ix_user_events_user_created|user_events(user_id, created_at)
ix_user_events_rank|user_events(rank_input)
"

# 列的建表类型（仅当线上缺列时才 ADD COLUMN 用）
declare_col() {
  case "$1" in
    user_id|rank_input) echo "INTEGER" ;;
    event_data|user_agent) echo "TEXT" ;;
    created_at) echo "DATETIME" ;;
    session_id) echo "VARCHAR(64)" ;;
    event_type) echo "VARCHAR(50)" ;;
    page) echo "VARCHAR(100)" ;;
    province) echo "VARCHAR(10)" ;;
    subject|c_major) echo "VARCHAR(50) DEFAULT ''" ;;
    exam_mode|c_city|c_nature|c_tier) echo "VARCHAR(20) DEFAULT ''" ;;
    ip) echo "VARCHAR(45)" ;;
    *) echo "TEXT" ;;
  esac
}

if [ $APPLY -eq 0 ]; then
  echo ""
  echo "-> DRY-RUN: 线上 user_events 现状..."
  ssh "$SERVER" "$REMOTE_PY" - "$PROD_DB" "$NEEDED_COLS" <<'PY'
import sqlite3, sys
db, needed = sys.argv[1], sys.argv[2].split()
c = sqlite3.connect(db)
tbls = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_events'")]
if not tbls:
    print("  [!] user_events 表不存在（异常：线上应已有此表）。--apply 会自动建表。")
    sys.exit(0)
cols = {r[1] for r in c.execute("PRAGMA table_info(user_events)")}
miss = [x for x in needed if x not in cols]
print(f"  行数: {c.execute('SELECT COUNT(*) FROM user_events').fetchone()[0]:,}")
print(f"  列: {'全部齐全 ✓' if not miss else '缺少 -> ' + ', '.join(miss)}")
idx = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='user_events'")}
for name in ("ix_user_events_type_created","ix_user_events_province_created","ix_user_events_user_created","ix_user_events_rank"):
    print(f"  索引 {name}: {'存在 ✓' if name in idx else '缺失 (将创建)'}")
# 已有埋点事件类型分布
print("  现有 event_type 分布:")
for et, n in c.execute("SELECT event_type, COUNT(*) FROM user_events GROUP BY event_type ORDER BY COUNT(*) DESC LIMIT 15"):
    print(f"    {et or '(空)':16s} {n:>8,}")
c.close()
PY
  echo ""
  echo "[OK] 演练完成，未改动线上库。确认后用 --apply 正式执行。"
  exit 0
fi

echo ""
echo "-> [1/3] 备份线上库..."
ssh "$SERVER" "
  set -e
  mkdir -p '$REMOTE_BACKEND/db-backup'
  cp '$PROD_DB' '$REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS'
  echo '  backup: gaokao.db.bak-$TS'
"

echo ""
echo "-> [2/3] 校验/补齐列 + 补索引 + ANALYZE（幂等）..."
# 把列类型映射打包传过去
COLDEFS=""
for col in $NEEDED_COLS; do COLDEFS="$COLDEFS$col=$(declare_col "$col");"; done

ssh "$SERVER" "$REMOTE_PY" - "$PROD_DB" "$NEEDED_COLS" "$COLDEFS" "$INDEXES" <<'PY'
import sqlite3, sys
db = sys.argv[1]
needed = sys.argv[2].split()
coldefs = dict(p.split("=",1) for p in sys.argv[3].split(";") if p)
indexes = [l for l in sys.argv[4].strip().splitlines() if l.strip()]

c = sqlite3.connect(db)
cur = c.cursor()

# 0. 表不存在则按当前模型建表（极端兜底，正常不会触发）
exists = cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_events'").fetchone()
if not exists:
    print("  user_events 不存在 -> 建表")
    cur.execute("""CREATE TABLE user_events (
        id INTEGER PRIMARY KEY,
        user_id INTEGER, session_id VARCHAR(64), event_type VARCHAR(50),
        event_data TEXT, page VARCHAR(100), province VARCHAR(10), rank_input INTEGER,
        subject VARCHAR(50) DEFAULT '', exam_mode VARCHAR(20) DEFAULT '',
        c_major VARCHAR(50) DEFAULT '', c_city VARCHAR(20) DEFAULT '',
        c_nature VARCHAR(20) DEFAULT '', c_tier VARCHAR(20) DEFAULT '',
        created_at DATETIME, ip VARCHAR(45), user_agent TEXT
    )""")

# 1. 补缺列（ADD COLUMN 无 IF NOT EXISTS，先查 PRAGMA）
cols = {r[1] for r in cur.execute("PRAGMA table_info(user_events)")}
added = []
for col in needed:
    if col not in cols:
        cur.execute(f"ALTER TABLE user_events ADD COLUMN {col} {coldefs.get(col,'TEXT')}")
        added.append(col)
print(f"  补列: {', '.join(added) if added else '无（列已齐全）'}")

# 2. 补索引（幂等）
for line in indexes:
    name, ddl = line.split("|", 1)
    cur.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {ddl}")
print(f"  索引: 已确保 {len(indexes)} 个 (IF NOT EXISTS)")

# 3. 更新优化器统计
cur.execute("ANALYZE")
c.commit()
c.close()
print("  ANALYZE 完成")
PY

echo ""
echo "-> [3/3] 重启后端使代码变更生效..."
echo "  ⚠ 请确认服务器已 git pull 部署本次代码变更："
echo "     backend/services/event_log.py (新增)"
echo "     backend/routers/report.py / agent.py / admin.py"
echo "     frontend/app/admin/page.tsx（前端另行构建部署）"
echo ""
ssh "$SERVER" "
  sudo systemctl restart gaokao-backend 2>/dev/null && echo '  OK: systemctl restarted' || {
    sudo supervisorctl restart gaokao-backend 2>/dev/null && echo '  OK: supervisorctl restarted' || echo '  WARN: 需手动重启'
  }
  sleep 2
"

echo ""
echo "========================================"
echo "  完成 ($TS)"
echo "  回滚（仅库）:"
echo "  ssh $SERVER 'cp $REMOTE_BACKEND/db-backup/gaokao.db.bak-$TS $PROD_DB && sudo systemctl restart gaokao-backend'"
echo "========================================"
