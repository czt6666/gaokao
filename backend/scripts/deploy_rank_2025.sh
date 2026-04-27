#!/bin/bash
# 部署 2025 一分一段表到线上
# 用法: 在本地 Git Bash / WSL 中执行此脚本

SERVER="root@43.143.206.19"
REMOTE_DIR="/app/backend"
LOCAL_SQL="data/rank_tables_2025_export.sql"

set -e

echo "=== 1. 备份线上数据库 ==="
ssh "$SERVER" "cp $REMOTE_DIR/gaokao.db $REMOTE_DIR/gaokao.db.backup.\$(date +%Y%m%d_%H%M%S) && echo '备份完成'"

echo "=== 2. 上传 SQL 文件 ==="
scp "$LOCAL_SQL" "$SERVER:$REMOTE_DIR/rank_tables_2025_export.sql"

echo "=== 3. 线上导入 SQL ==="
ssh "$SERVER" "cd $REMOTE_DIR && python3 -c \"
import sqlite3, sys
conn = sqlite3.connect('gaokao.db')
cur = conn.cursor()
cur.execute('DELETE FROM rank_tables WHERE year=2025')
deleted = cur.rowcount
with open('rank_tables_2025_export.sql', 'r', encoding='utf-8') as f:
    sql = f.read()
# 跳过 BEGIN/COMMIT 包装，逐条执行 INSERT
lines = [l for l in sql.split(';') if 'INSERT INTO rank_tables' in l]
for line in lines:
    conn.execute(line.strip() + ';')
conn.commit()
cur.execute('SELECT COUNT(*) FROM rank_tables WHERE year=2025')
inserted = cur.fetchone()[0]
print(f'删除旧数据: {deleted} 条')
print(f'插入新数据: {inserted} 条')
conn.close()
\""

echo "=== 4. 清理远程临时文件 ==="
ssh "$SERVER" "rm -f $REMOTE_DIR/rank_tables_2025_export.sql"

echo "=== 部署完成 ==="
