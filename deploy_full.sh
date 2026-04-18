#!/bin/bash
# 完整部署脚本：代码 + 全部省份数据
# 用法: bash deploy_full.sh
set -e

SERVER="root@43.143.206.19"
LOCAL_BACKEND="/Users/Admin/Desktop/claunde code gaokao/backend"
LOCAL_FRONTEND="/Users/Admin/Desktop/claunde code gaokao/frontend"
SCRIPT_DIR="/Users/Admin/Desktop/claunde code gaokao"

echo "========================================"
echo "  袁希高报引擎 · 完整部署"
echo "  包含：代码更新 + 全省数据同步"
echo "========================================"

echo ""
echo "→ [1/5] 同步后端代码（含 import_admission_records 接口）..."
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='gaokao.db' \
  "$LOCAL_BACKEND/" "$SERVER:/app/backend/"

echo ""
echo "→ [2/5] 同步前端..."
rsync -av \
  "$LOCAL_FRONTEND/lib/" "$SERVER:/app/frontend/lib/"
rsync -av \
  "$LOCAL_FRONTEND/app/globals.css" "$SERVER:/app/frontend/app/globals.css"
rsync -av \
  "$LOCAL_FRONTEND/app/page.tsx" "$SERVER:/app/frontend/app/page.tsx"
rsync -av \
  "$LOCAL_FRONTEND/app/layout.tsx" "$SERVER:/app/frontend/app/layout.tsx"
rsync -av \
  "$LOCAL_FRONTEND/app/results/page.tsx" "$SERVER:/app/frontend/app/results/page.tsx"
rsync -av \
  "$LOCAL_FRONTEND/app/admin/page.tsx" "$SERVER:/app/frontend/app/admin/page.tsx"
rsync -av \
  "$LOCAL_FRONTEND/components/PayModal.tsx" "$SERVER:/app/frontend/components/PayModal.tsx"
rsync -av \
  "$LOCAL_FRONTEND/components/SchoolCard.tsx" "$SERVER:/app/frontend/components/SchoolCard.tsx"

echo ""
echo "→ [3/5] 服务器构建前端..."
ssh "$SERVER" "cd /app/frontend && npm run build 2>&1 | tail -10"

echo ""
echo "→ [4/5] 重启后端服务..."
ssh "$SERVER" "sudo systemctl restart gaokao-backend && sleep 3 && echo '后端已重启'"

echo ""
echo "→ [5/5] 同步全省录取数据（广东2021-22 + 江苏2021-23 + 山东2021-24 + 广东物理2023-25）..."
echo "   预计需要 3-5 分钟..."
python3 "$SCRIPT_DIR/sync_guangdong_to_server.py"
echo ""
python3 "$SCRIPT_DIR/sync_all_provinces.py"

echo ""
echo "========================================"
echo "  ✅ 完整部署完成！"
echo "  访问: http://43.143.206.19"
echo "  后台: http://43.143.206.19/admin"
echo "========================================"
