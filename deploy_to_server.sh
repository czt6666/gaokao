#!/bin/bash
# 一键部署到服务器
# 用法: bash deploy_to_server.sh
# 需要提前能 ssh root@43.143.206.19

SERVER="root@43.143.206.19"
LOCAL_BACKEND="/Users/Admin/Desktop/claunde code gaokao/backend"
LOCAL_FRONTEND="/Users/Admin/Desktop/claunde code gaokao/frontend"

echo "========================================"
echo "  袁希高报引擎 · 部署到服务器"
echo "========================================"

# ── 1. 同步后端 ──
echo ""
echo "→ [1/4] 同步后端代码..."
rsync -av --exclude='__pycache__' --exclude='*.pyc' --exclude='gaokao.db' \
  "$LOCAL_BACKEND/" "$SERVER:/app/backend/"

# ── 2. 同步前端源码 ──
echo ""
echo "→ [2/4] 同步前端源码（lib + 所有页面 + 全局样式）..."
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

# ── 3. 在服务器上重新构建前端 ──
echo ""
echo "→ [3/4] 服务器上构建前端（约60秒）..."
ssh "$SERVER" "cd /app/frontend && npm run build 2>&1 | tail -20"

# ── 4. 重启后端 + 前端服务 ──
echo ""
echo "→ [4/4] 重启服务..."
ssh "$SERVER" "sudo systemctl restart gaokao-backend && sudo systemctl restart gaokao-frontend 2>/dev/null || pm2 restart all 2>/dev/null; echo '服务已重启'"

# ── 5. 清理污染的 user_events 数据 ──
echo ""
echo "→ [5/5] 清理 user_events 表中的污染数据..."
ssh "$SERVER" "sqlite3 /app/backend/gaokao.db \"DELETE FROM user_events WHERE event_type NOT IN ('page_view','query_submit','export_click','school_click','add_to_form','compare_add','pay_click','unlock_click','email_click','pay_success','login'); SELECT changes() || ' rows cleaned';\" "

echo ""
echo "========================================"
echo "  ✅ 部署完成！"
echo "  访问: http://43.143.206.19"
echo "  后台: http://43.143.206.19/admin"
echo "========================================"
