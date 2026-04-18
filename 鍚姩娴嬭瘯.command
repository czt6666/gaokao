#!/bin/bash
# 高考志愿决策引擎 — 一键启动
# 双击此文件即可启动所有服务并打开浏览器

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$DIR/backend"
FRONTEND="$DIR/frontend"

echo "========================================"
echo "  高考志愿决策引擎 · 正在启动..."
echo "========================================"

# 清理旧进程（避免端口冲突）
echo "→ 清理旧进程..."
lsof -ti:8000 | xargs kill -9 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1

# 启动后端
echo "→ 启动后端 (端口 8000)..."
osascript -e "
tell application \"Terminal\"
    do script \"echo '=== 后端 ===' && cd '$BACKEND' && python3 -m uvicorn main:app --reload --port 8000\"
    set bounds of front window to {0, 0, 800, 500}
end tell"

# 等后端启动
echo "→ 等待后端就绪..."
for i in $(seq 1 20); do
    if curl -s http://localhost:8000/api/health > /dev/null 2>&1; then
        echo "  ✓ 后端已就绪"
        break
    fi
    sleep 1
    echo "  ... 等待中 ($i/20)"
done

# 启动前端
echo "→ 启动前端 (端口 3000)..."
osascript -e "
tell application \"Terminal\"
    do script \"echo '=== 前端 ===' && cd '$FRONTEND' && npm run dev\"
    set bounds of front window to {820, 0, 1620, 500}
end tell"

# 等前端启动
echo "→ 等待前端就绪..."
for i in $(seq 1 30); do
    if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "  ✓ 前端已就绪"
        break
    fi
    sleep 1
    echo "  ... 等待中 ($i/30)"
done

# 打开浏览器
echo "→ 打开浏览器..."
open "http://localhost:3000"

echo ""
echo "========================================"
echo "  ✅ 启动完成！"
echo "  前端: http://localhost:3000"
echo "  后端: http://localhost:8000/api/health"
echo ""
echo "  关闭测试：直接关掉两个终端窗口即可"
echo "========================================"
