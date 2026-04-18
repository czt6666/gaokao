#!/bin/bash
echo "→ 停止后端 (8000) 和前端 (3000)..."
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "  ✓ 后端已停止" || echo "  - 后端未在运行"
lsof -ti:3000 | xargs kill -9 2>/dev/null && echo "  ✓ 前端已停止" || echo "  - 前端未在运行"
echo "完成。"
