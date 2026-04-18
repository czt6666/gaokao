#!/usr/bin/env bash
# 在「服务器上」执行一次：创建测试环境目录与 Python venv（不覆盖已有 .env / 数据库）
# 用法: sudo bash /app/mega/bootstrap_staging_on_server.sh
# 部署脚本 rsync 不会上传本文件到 mega 目录时，可手动 scp 到服务器后执行。

set -euo pipefail
ROOT=/app/mega
mkdir -p "$ROOT/backend" "$ROOT/frontend"
cd "$ROOT/backend"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -U pip
  if [[ -f requirements.txt ]]; then .venv/bin/pip install -r requirements.txt; fi
fi
echo "完成。请将 systemd 单元安装为 gaokao-staging-backend / gaokao-staging-frontend，"
echo "在 $ROOT/backend/.env 写入 SITE_URL=https://mega.theyuanxi.cn，再用 deploy/rsync_deploy.sh staging 同步代码。"
