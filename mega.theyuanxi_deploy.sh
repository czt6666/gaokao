#!/bin/bash
# 部署 www.mega.theyuanxi.cn（后端 8100 / 前端 3100）
# 用法: bash mega.theyuanxi_deploy.sh
# 环境变量：本地维护 backend/.env.production 和 frontend/.env.production
set -e

SERVER="root@43.143.206.19"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BACKEND="$SCRIPT_DIR/backend"
LOCAL_FRONTEND="$SCRIPT_DIR/frontend"
REMOTE_BACKEND="/app/mega/backend"
REMOTE_FRONTEND="/app/mega/frontend"
PYPI_MIRROR="${UV_PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"
DOMAIN="www.mega.theyuanxi.cn"

echo "========================================"
echo "  袁希高报 · mega.theyuanxi.cn 部署"
echo "========================================"

# ── 0. 同步环境变量（先传 .env，确保重启后新配置已生效）──
echo ""
echo "→ [0/4] 同步环境变量..."
if [ -f "$LOCAL_BACKEND/.env.production" ]; then
  echo "  同步 backend/.env.production → server:$REMOTE_BACKEND/.env"
  rsync -av --no-owner --no-group "$LOCAL_BACKEND/.env.production" "$SERVER:$REMOTE_BACKEND/.env"
fi
if [ -f "$LOCAL_FRONTEND/.env.production" ]; then
  echo "  同步 frontend/.env.production → server:$REMOTE_FRONTEND/.env.production"
  rsync -av --no-owner --no-group "$LOCAL_FRONTEND/.env.production" "$SERVER:$REMOTE_FRONTEND/.env.production"
fi

# ── 1. 同步后端代码（不删除目标端文件；保留 .venv / 数据库）──
echo ""
echo "→ [1/4] 同步后端代码..."
rsync -av --no-owner --no-group \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
  --exclude='.venv' --exclude='venv/' \
  --exclude='data/' \
  --exclude='.env' \
  "$LOCAL_BACKEND/" "$SERVER:$REMOTE_BACKEND/"

# ── 2. 同步前端源码（不删除目标端文件；保留 node_modules / .next）──
echo ""
echo "→ [2/4] 同步前端源码..."
rsync -av --no-owner --no-group \
  --exclude='node_modules' --exclude='.next' \
  --exclude='.env.local' --exclude='.env.production' \
  "$LOCAL_FRONTEND/" "$SERVER:$REMOTE_FRONTEND/"

# ── 3. 前端构建 ──
echo ""
echo "→ [3/4] 前端构建..."
ssh "$SERVER" "
  set -e
  cd $REMOTE_FRONTEND
  if [ ! -d node_modules ]; then pnpm install; fi
  # 强制注入 mega 域名对应的 API 地址
  echo 'NEXT_PUBLIC_API_URL=https://$DOMAIN' > .env.production
  pnpm run build 2>&1 | tail -20
"

# ── 4. 重启服务 ──
echo ""
echo "→ [4/4] 重启服务..."
ssh "$SERVER" "
  set -e
  sudo systemctl restart gaokao-mega-backend
  sleep 2
  sudo systemctl restart gaokao-mega-frontend
  sudo systemctl is-active gaokao-mega-backend gaokao-mega-frontend
  echo '服务已重启'
"

echo ""
echo "========================================"
echo "  ✅ mega.theyuanxi.cn 部署完成！"
echo "  访问: https://$DOMAIN"
echo "========================================"
