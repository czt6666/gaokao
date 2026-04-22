#!/bin/bash
# 部署 mega.theyuanxi.cn（后端 8100 / 前端 3100）
# 用法: bash mega.theyuanxi_deploy.sh
set -e

SERVER="root@43.143.206.19"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_BACKEND="$SCRIPT_DIR/backend"
LOCAL_FRONTEND="$SCRIPT_DIR/frontend"
REMOTE_BACKEND="/app/mega/backend"
REMOTE_FRONTEND="/app/mega/frontend"
PYPI_MIRROR="${UV_PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"

echo "========================================"
echo "  袁希高报 · mega.theyuanxi.cn 部署"
echo "========================================"

# ── 1. 同步后端代码 ──
echo ""
echo "→ [1/5] 同步后端代码..."
rsync -av --delete --no-owner --no-group \
  --exclude='__pycache__' --exclude='*.pyc' \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' \
  --exclude='.venv' \
  --exclude='data/' \
  "$LOCAL_BACKEND/" "$SERVER:$REMOTE_BACKEND/"

# ── 2. 写入后端 .env ──
echo ""
echo "→ [2/5] 写入后端 .env..."
ssh "$SERVER" "cat > $REMOTE_BACKEND/.env" <<'EOF'
SITE_URL=https://mega.theyuanxi.cn
EOF

# ── 3. 注册 systemd 服务（仅首次）──
echo ""
echo "→ [3/5] 注册 systemd 服务（若不存在）..."
ssh "$SERVER" "
  if [ ! -f /etc/systemd/system/gaokao-mega-backend.service ]; then
    echo '  创建 gaokao-mega-backend.service...'
    sudo tee /etc/systemd/system/gaokao-mega-backend.service > /dev/null <<'UNIT'
[Unit]
Description=Gaokao Backend API (mega.theyuanxi.cn)
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/app/mega/backend
EnvironmentFile=/app/mega/backend/.env
Environment=PYTHONUNBUFFERED=1
ExecStart=/app/mega/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8100 --workers 1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable gaokao-mega-backend
  fi

  if [ ! -f /etc/systemd/system/gaokao-mega-frontend.service ]; then
    echo '  创建 gaokao-mega-frontend.service...'
    sudo tee /etc/systemd/system/gaokao-mega-frontend.service > /dev/null <<'UNIT'
[Unit]
Description=Gaokao Frontend Next.js (mega.theyuanxi.cn)
After=network.target gaokao-mega-backend.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/app/mega/frontend
Environment=NODE_ENV=production
Environment=PORT=3100
ExecStart=pnpm run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
    sudo systemctl daemon-reload
    sudo systemctl enable gaokao-mega-frontend
  fi
"

# ── 4. 同步前端、构建 ──
echo ""
echo "→ [4/5] 同步前端源码并构建..."
rsync -av --delete --no-owner --no-group \
  --exclude='node_modules' --exclude='.next' \
  --exclude='.env.local' --exclude='.env.production' \
  "$LOCAL_FRONTEND/" "$SERVER:$REMOTE_FRONTEND/"

ssh "$SERVER" "
  set -e
  echo 'NEXT_PUBLIC_API_URL=https://mega.theyuanxi.cn' > $REMOTE_FRONTEND/.env.production
  cd $REMOTE_FRONTEND
  if [ ! -d node_modules ]; then pnpm install; fi
  pnpm run build 2>&1 | tail -20
"

# ── 5. 安装后端依赖并重启 ──
echo ""
echo "→ [5/5] uv sync 并重启服务..."
ssh "$SERVER" "
  set -e
  cd $REMOTE_BACKEND
  uv sync -q --index-url $PYPI_MIRROR
  sudo systemctl restart gaokao-mega-backend
  sleep 2
  sudo systemctl restart gaokao-mega-frontend
  sudo systemctl is-active gaokao-mega-backend gaokao-mega-frontend
  echo '服务已重启'
"

echo ""
echo "========================================"
echo "  ✅ mega.theyuanxi.cn 部署完成！"
echo "  访问: https://mega.theyuanxi.cn"
echo "========================================"
