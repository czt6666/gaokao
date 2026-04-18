#!/bin/bash
# macOS: 双击运行，在「终端」里分别打开后端与前端开发服务，并打开浏览器。
# 依赖：本机已安装 Python3、Node/npm，且项目在默认目录结构下。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$DIR/backend"
FRONTEND="$DIR/frontend"

echo "========================================"
echo "  Gaokao — starting local dev..."
echo "========================================"

echo "[1/5] Freeing ports 8000 and 3000..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
sleep 1

echo "[2/5] Starting backend (uvicorn, port 8000)..."
osascript -e "
tell application \"Terminal\"
    do script \"echo '=== Backend (8000) ===' && cd '$BACKEND' && python3 -m uvicorn main:app --reload --port 8000\"
    set bounds of front window to {0, 0, 800, 500}
end tell"

echo "[3/5] Waiting for backend /api/health ..."
for i in $(seq 1 20); do
  if curl -s http://localhost:8000/api/health >/dev/null 2>&1; then
    echo "  Backend is up."
    break
  fi
  sleep 1
  echo "  ... waiting ($i/20)"
done

echo "[4/5] Starting frontend (npm run dev, port 3000)..."
osascript -e "
tell application \"Terminal\"
    do script \"echo '=== Frontend (3000) ===' && cd '$FRONTEND' && npm run dev\"
    set bounds of front window to {820, 0, 1620, 500}
end tell"

echo "[5/5] Waiting for frontend..."
for i in $(seq 1 30); do
  if curl -s http://localhost:3000 >/dev/null 2>&1; then
    echo "  Frontend is up."
    break
  fi
  sleep 1
  echo "  ... waiting ($i/30)"
done

echo "Opening browser..."
open "http://localhost:3000" || true

echo ""
echo "========================================"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000/api/health"
echo "  To stop:  run stop-services.command or close Terminal windows."
echo "========================================"
