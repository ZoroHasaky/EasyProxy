#!/usr/bin/env bash
# EasyProxy 本地一键启动脚本 (Linux / macOS)

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/fronted"
DATA_DIR="$ROOT_DIR/data"

mkdir -p "$DATA_DIR"

echo "=========================================="
echo "       EasyProxy 本地开发环境启动         "
echo "=========================================="
echo "后端数据目录: $DATA_DIR"
echo "前端项目目录: $WEB_DIR"
echo ""

cleanup() {
    echo ""
    echo "正在关闭服务进程..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    echo "服务已停止。"
}
trap cleanup EXIT INT TERM

echo "[1/2] 正在启动后端服务 (Go :8080)..."
(cd "$BACKEND_DIR" && go run ./cmd/server -data "$DATA_DIR" -addr :8080) &
BACKEND_PID=$!

echo "[2/2] 正在启动前端开发服务 (Vite :5173)..."
(cd "$WEB_DIR" && npx vite --port 5173 --open) &
FRONTEND_PID=$!

echo ""
echo "服务启动完成！"
echo "-> 前端界面: http://localhost:5173"
echo "-> 后端接口: http://localhost:8080"
echo ""
echo "按 Ctrl + C 停止所有服务..."

wait
