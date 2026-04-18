#!/usr/bin/env bash
# 一键同步代码到服务器并构建、重启 systemd。
# 用法（在仓库根目录）:
#   bash deploy/rsync_deploy.sh staging    # 测试版 → mega 对应目录与 staging 单元
#   bash deploy/rsync_deploy.sh prod       # 正式版 → /app 下与 prod 单元
#
# 首次使用: 复制 deploy/deploy.env.example → deploy/deploy.env ，填好 SSH_TARGET；
# 在服务器上按 deploy/nginx 与 deploy/systemd 完成目录、venv、systemd、nginx 配置。

set -euo pipefail

TARGET="${1:-}"
if [[ "$TARGET" != "prod" && "$TARGET" != "staging" ]]; then
  echo "用法: $0 prod | staging" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$SCRIPT_DIR/deploy/deploy.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE ，请复制 deploy/deploy.env.example 并填写。" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${SSH_TARGET:?请在 deploy.env 中设置 SSH_TARGET}"
: "${PROD_REMOTE_ROOT:?}"
: "${STAGING_REMOTE_ROOT:?}"

if [[ "$TARGET" == "prod" ]]; then
  REMOTE_ROOT="$PROD_REMOTE_ROOT"
  UNIT_BACKEND="${PROD_SYSTEMD_BACKEND:?}"
  UNIT_FRONTEND="${PROD_SYSTEMD_FRONTEND:?}"
  LABEL="正式版 (theyuanxi.cn / www)"
  if [[ "${PROD_CONFIRM:-1}" == "1" ]]; then
    read -r -p "即将部署到 PRODUCTION ($REMOTE_ROOT)。输入 yes 继续: " _ok
    if [[ "$_ok" != "yes" ]]; then
      echo "已取消。" >&2
      exit 1
    fi
  fi
else
  REMOTE_ROOT="$STAGING_REMOTE_ROOT"
  UNIT_BACKEND="${STAGING_SYSTEMD_BACKEND:?}"
  UNIT_FRONTEND="${STAGING_SYSTEMD_FRONTEND:?}"
  LABEL="测试版 (mega.theyuanxi.cn)"
fi

echo "========================================"
echo "  部署: $LABEL"
echo "  远端: $SSH_TARGET:$REMOTE_ROOT"
echo "========================================"

RSYNC_EXC_BACKEND=(
  --exclude='__pycache__' --exclude='*.pyc' --exclude='.venv' --exclude='*.db'
  --exclude='*.db-shm' --exclude='*.db-wal' --exclude='.env'
)
RSYNC_EXC_FRONTEND=(
  --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='.env.local'
)

echo ""
echo "→ [1/3] rsync 后端..."
rsync -avz "${RSYNC_EXC_BACKEND[@]}" \
  "$SCRIPT_DIR/backend/" "$SSH_TARGET:$REMOTE_ROOT/backend/"

echo ""
echo "→ [2/3] rsync 前端源码..."
rsync -avz "${RSYNC_EXC_FRONTEND[@]}" \
  "$SCRIPT_DIR/frontend/" "$SSH_TARGET:$REMOTE_ROOT/frontend/"

echo ""
echo "→ [3/3] 远端安装依赖、构建并重启服务..."
ssh "$SSH_TARGET" env \
  REMOTE_ROOT="$REMOTE_ROOT" \
  UNIT_BACKEND="$UNIT_BACKEND" \
  UNIT_FRONTEND="$UNIT_FRONTEND" \
  bash -s <<'REMOTE'
set -euo pipefail
BE="$REMOTE_ROOT/backend"
FE="$REMOTE_ROOT/frontend"
cd "$BE"
if [[ -d .venv ]]; then PIP="$BE/.venv/bin/pip"; else PIP=pip3; fi
"$PIP" install -q -r requirements.txt
cd "$FE"
if [[ -f package-lock.json ]]; then npm ci --omit=dev; else npm install --omit=dev; fi
npm run build
sudo systemctl restart "$UNIT_BACKEND" "$UNIT_FRONTEND"
sudo systemctl is-active "$UNIT_BACKEND" "$UNIT_FRONTEND"
REMOTE

echo ""
echo "========================================"
echo "  完成: $LABEL"
echo "========================================"
