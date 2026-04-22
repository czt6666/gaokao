#!/bin/bash
# 部署 www.theyuanxi.cn（后端 8000 / 前端 3000）
# 用法: bash theyuanxi_deploy.sh
# 注意：服务器上的 backend/.env 与 frontend/.env.production 由运维手动维护，本脚本不覆盖。
set -e

SERVER="root@43.143.206.19"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BACKEND="$SCRIPT_DIR/backend"
LOCAL_FRONTEND="$SCRIPT_DIR/frontend"
REMOTE_BACKEND="/app/backend"
REMOTE_FRONTEND="/app/frontend"
PYPI_MIRROR="${UV_PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"

echo "========================================"
echo "  袁希高报 · theyuanxi.cn 部署"
echo "========================================"

# ── 1. 同步后端代码（保留服务器上的 .env / .venv / 数据库）──
echo ""
echo "→ [1/4] 同步后端代码..."
rsync -av --delete --no-owner --no-group \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
  --exclude='.venv' --exclude='venv/' \
  --exclude='data/' \
  "$LOCAL_BACKEND/" "$SERVER:$REMOTE_BACKEND/"
# --exclude='.env' \

# ── 2. 注册 systemd 服务（仅首次；不使用 EnvironmentFile，由 python-dotenv 读 .env）──
echo ""
echo "→ [2/4] 注册 systemd 服务（若不存在）..."
ssh "$SERVER" "
  if [ ! -f /etc/systemd/system/gaokao-backend.service ]; then
    echo '  创建 gaokao-backend.service...'
    sudo tee /etc/systemd/system/gaokao-backend.service > /dev/null <<'UNIT'
[Unit]
Description=Gaokao Backend API (theyuanxi.cn)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/app/backend
Environment=PYTHONUNBUFFERED=1
ExecStart=/app/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable gaokao-backend
  fi

  if [ ! -f /etc/systemd/system/gaokao-frontend.service ]; then
    echo '  创建 gaokao-frontend.service...'
    sudo tee /etc/systemd/system/gaokao-frontend.service > /dev/null <<'UNIT'
[Unit]
Description=Gaokao Frontend Next.js (theyuanxi.cn)
After=network.target gaokao-backend.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/app/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=pnpm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable gaokao-frontend
  fi
"

# ── 3. 同步前端源码并构建（保留服务器上的 .env.production / node_modules）──
echo ""
echo "→ [3/4] 同步前端源码并构建..."
rsync -av --delete --no-owner --no-group \
  --exclude='node_modules' --exclude='.next' \
  --exclude='.venv' \
  --exclude='.env.local' --exclude='.env.production' \
  "$LOCAL_FRONTEND/" "$SERVER:$REMOTE_FRONTEND/"

ssh "$SERVER" "
  set -e
  cd $REMOTE_FRONTEND
  if [ ! -d node_modules ]; then pnpm install; fi
  pnpm run build 2>&1 | tail -20
"

# ── 4. 重启服务（如需更新依赖，手动 ssh 后执行：cd /app/backend && uv sync --index-url $PYPI_MIRROR）──
echo ""
echo "→ [4/4] 重启服务..."
ssh "$SERVER" "
  set -e
  sudo systemctl restart gaokao-backend
  sleep 2
  sudo systemctl restart gaokao-frontend
  sudo systemctl is-active gaokao-backend gaokao-frontend
  echo '服务已重启'
"

echo ""
echo "========================================"
echo "  ✅ theyuanxi.cn 部署完成！"
echo "  访问: https://www.theyuanxi.cn"
echo "  后台: https://www.theyuanxi.cn/admin"
echo "========================================"
