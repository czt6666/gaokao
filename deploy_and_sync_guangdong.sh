#!/bin/bash
# 部署代码 + 同步广东数据到服务器
# 用法: bash deploy_and_sync_guangdong.sh
set -e

SERVER="root@43.143.206.19"
LOCAL_BACKEND="/Users/Admin/Desktop/claunde code gaokao/backend"

echo "========================================"
echo "  步骤1: 同步后端代码（含新import接口）"
echo "========================================"
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='gaokao.db' \
  "$LOCAL_BACKEND/" "$SERVER:/app/backend/"

echo ""
echo "========================================"
echo "  步骤2: 重启后端服务"
echo "========================================"
ssh "$SERVER" "sudo systemctl restart gaokao-backend && sleep 3 && echo '后端已重启'"

echo ""
echo "========================================"
echo "  步骤3: 同步广东物理类录取数据 (8868条)"
echo "========================================"
python3 "/Users/Admin/Desktop/claunde code gaokao/sync_guangdong_to_server.py"

echo ""
echo "========================================"
echo "  ✅ 完成！广东物理类数据已更新"
echo "========================================"
