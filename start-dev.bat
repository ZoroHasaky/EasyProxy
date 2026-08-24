@echo off
setlocal
title EasyProxy Local Development

echo ==========================================
echo       EasyProxy Local Development
echo ==========================================
echo.

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "WEB_DIR=%ROOT_DIR%fronted"
set "DATA_DIR=%ROOT_DIR%data"

if not exist "%BACKEND_DIR%\NUL" (
  echo Backend directory not found: "%BACKEND_DIR%"
  exit /b 1
)

if not exist "%WEB_DIR%\NUL" (
  echo Frontend directory not found: "%WEB_DIR%"
  exit /b 1
)

if not exist "%DATA_DIR%\NUL" mkdir "%DATA_DIR%"

echo [1/2] Starting backend (Go :8080)...
start "EasyProxy-Backend" /D "%BACKEND_DIR%" go run ./cmd/server -data "%DATA_DIR%" -addr :8080

echo [2/2] Starting frontend (Vite :5173)...
start "EasyProxy-Frontend" /D "%WEB_DIR%" cmd /c "npx vite --port 5173 --open"

echo.
echo ==========================================
echo Backend and frontend started in separate windows.
echo - Frontend: http://localhost:5173
echo - Backend:  http://localhost:8080
echo ==========================================
echo.
pause
endlocal
