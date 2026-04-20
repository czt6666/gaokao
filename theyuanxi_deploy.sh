#!/bin/bash
# 部署 www.theyuanxi.cn（前端 3000 / 后端 8000）
# 用法: bash theyuanxi_deploy.sh
set -e

SERVER="root@43.143.206.19"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BACKEND="$SCRIPT_DIR/backend"
LOCAL_FRONTEND="$SCRIPT_DIR/frontend"
REMOTE_BACKEND="/app/backend"
REMOTE_FRONTEND="/app/frontend"

echo "========================================"
echo "  袁希高报 · theyuanxi.cn 部署"
echo "========================================"

echo ""
echo "→ [1/4] 同步后端代码..."
rsync -av --delete \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='gaokao.db' --exclude='gaokao.db-shm' --exclude='gaokao.db-wal' \
  --exclude='.env' \
  --exclude='data/' \
  "$LOCAL_BACKEND/" "$SERVER:$REMOTE_BACKEND/"

echo ""
echo "→ [2/4] 写入后端 .env..."
ssh "$SERVER" "cat > $REMOTE_BACKEND/.env" <<'EOF'
SITE_URL=https://www.theyuanxi.cn
EOF

echo ""
echo "→ [3/4] 同步前端源码并构建..."
rsync -av --delete \
  --exclude='node_modules' --exclude='.next' \
  --exclude='.env.local' --exclude='.env.production' \
  "$LOCAL_FRONTEND/" "$SERVER:$REMOTE_FRONTEND/"

# 写入生产环境变量后构建
ssh "$SERVER" "
  echo 'NEXT_PUBLIC_API_URL=https://www.theyuanxi.cn' > $REMOTE_FRONTEND/.env.production
  cd $REMOTE_FRONTEND
  pnpm run build 2>&1 | tail -20
"

echo ""
echo "→ [4/4] 重启服务..."
ssh "$SERVER" "
  sudo systemctl restart gaokao-backend
  sleep 2
  sudo systemctl restart gaokao-frontend
  echo '服务已重启'
"

echo ""
echo "========================================"
echo "  ✅ theyuanxi.cn 部署完成！"
echo "  访问: https://www.theyuanxi.cn"
echo "  后台: https://www.theyuanxi.cn/admin"
echo "========================================"
