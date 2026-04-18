#!/bin/bash
# macOS: 双击或在终端执行，停止本机高考项目常用端口上的进程（后端 8000、前端 3000）。
set -euo pipefail

echo "Stopping processes on ports 8000 (backend) and 3000 (frontend)..."
if lsof -ti:8000 | xargs kill -9 2>/dev/null; then
  echo "  Backend (8000) stopped."
else
  echo "  Backend (8000) was not running."
fi
if lsof -ti:3000 | xargs kill -9 2>/dev/null; then
  echo "  Frontend (3000) stopped."
else
  echo "  Frontend (3000) was not running."
fi
echo "Done."
