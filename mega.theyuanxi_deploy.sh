#!/bin/bash
# 部署 mega.theyuanxi.cn（后端 8100 / 前端 3100）
# 用法: bash mega.theyuanxi_deploy.sh
set -e

SERVER="ubuntu@43.143.206.19"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BACKEND="$SCRIPT_DIR/backend"
LOCAL_FRONTEND="$SCRIPT_DIR/frontend"
REMOTE_BACKEND="/app/mega/backend"
REMOTE_FRONTEND="/app/mega/frontend"

echo "========================================"
echo "  袁希高报 · mega.theyuanxi.cn 部署"
echo "========================================"

# ── 1. 同步后端代码 ──
echo ""
echo "→ [1/5] 同步后端代码..."
rsync -av --delete \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='gaokao.db' --exclude='gaokao.db-shm' --exclude='gaokao.db-wal' \
  --exclude='.env' \
  --exclude='.venv' \
  --exclude='data/' \
  "$LOCAL_BACKEND/" "$SERVER:$REMOTE_BACKEND/"

# ── 2. 写入后端 .env ──
echo ""
echo "→ [2/5] 写入后端 .env..."
ssh "$SERVER" "cat > $REMOTE_BACKEND/.env" <<'EOF'
SITE_URL=https://mega.theyuanxi.cn
EOF

# ── 3. 确保 uv 环境存在并同步依赖 ──
# uv sync -i https://pypi.tuna.tsinghua.edu.cn/simple
# echo ""
# echo "→ [3/5] uv sync 后端依赖..."
# ssh "$SERVER" "cd $REMOTE_BACKEND && uv sync -q"

# ── 4. 注册 systemd 服务（仅首次）──
# echo ""
# echo "→ [4/5] 注册 systemd 服务（若不存在）..."
# ssh "$SERVER" "
#   if [ ! -f /etc/systemd/system/gaokao-mega-backend.service ]; then
#     echo '  创建 gaokao-mega-backend.service...'
#     sudo tee /etc/systemd/system/gaokao-mega-backend.service > /dev/null <<'UNIT'
# [Unit]
# Description=Gaokao Mega Backend API
# After=network.target

# [Service]
# Type=simple
# User=ubuntu
# WorkingDirectory=/app/mega/backend
# EnvironmentFile=/app/mega/backend/.env
# Environment=PATH=/app/mega/backend/.venv/bin
# ExecStart=/app/mega/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8100 --workers 1
# Restart=always
# RestartSec=3

# [Install]
# WantedBy=multi-user.target
# UNIT
#     sudo systemctl daemon-reload
#     sudo systemctl enable gaokao-mega-backend
#   fi

#   if [ ! -f /etc/systemd/system/gaokao-mega-frontend.service ]; then
#     echo '  创建 gaokao-mega-frontend.service...'
#     sudo tee /etc/systemd/system/gaokao-mega-frontend.service > /dev/null <<'UNIT'
# [Unit]
# Description=Gaokao Mega Frontend (Next.js)
# After=network.target

# [Service]
# Type=simple
# User=ubuntu
# WorkingDirectory=/app/mega/frontend
# ExecStart=/usr/bin/node /app/mega/frontend/node_modules/next/dist/bin/next start -p 3100
# Restart=always
# RestartSec=5
# Environment=NODE_ENV=production
# Environment=PORT=3100

# [Install]
# WantedBy=multi-user.target
# UNIT
#     sudo systemctl daemon-reload
#     sudo systemctl enable gaokao-mega-frontend
#   fi
# "

# ── 5. 同步前端、构建、重启 ──
echo ""
echo "→ [5/5] 同步前端源码、构建并重启所有服务..."
rsync -av --delete \
  --exclude='node_modules' --exclude='.next' \
  --exclude='.env.local' --exclude='.env.production' \
  "$LOCAL_FRONTEND/" "$SERVER:$REMOTE_FRONTEND/"

ssh "$SERVER" "
  if [ ! -d $REMOTE_FRONTEND/node_modules ]; then
    echo '  首次部署：pnpm install...'
    cd $REMOTE_FRONTEND && pnpm install -q
  fi

  echo 'NEXT_PUBLIC_API_URL=https://mega.theyuanxi.cn' > $REMOTE_FRONTEND/.env.production
  cd $REMOTE_FRONTEND && pnpm run build 2>&1 | tail -20

  sudo systemctl restart gaokao-mega-backend
  sleep 2
  sudo systemctl restart gaokao-mega-frontend
  echo '服务已重启'
"

echo ""
echo "========================================"
echo "  ✅ mega.theyuanxi.cn 部署完成！"
echo "  访问: https://mega.theyuanxi.cn"
echo "========================================"
