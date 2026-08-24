@echo off
chcp 65001 >nul
title EasyProxy Local Dev Server

echo ==========================================
echo        EasyProxy 本地开发环境启动
echo ==========================================
echo.

set ROOT_DIR=%~dp0
set BACKEND_DIR=%ROOT_DIR%backend
set WEB_DIR=%ROOT_DIR%fronted
set DATA_DIR=%ROOT_DIR%data

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo [1/2] 正在启动后端服务 (Go :8080)...
start "EasyProxy-Backend" /D "%BACKEND_DIR%" go run ./cmd/server -data "%DATA_DIR%" -addr :8080

echo [2/2] 正在启动前端开发服务 (Vite :5173)...
start "EasyProxy-Frontend" /D "%WEB_DIR%" cmd /c "npx vite --port 5173 --open"

echo.
echo ==========================================
echo 前后端服务已在独立窗口中启动完成！
echo - 前端地址: http://localhost:5173
echo - 后端地址: http://localhost:8080
echo ==========================================
echo.
pause
