@echo off
setlocal
title EasyProxy Local Development

echo ==========================================
echo       EasyProxy Local Development
echo ==========================================
echo.

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "WEB_DIR=%ROOT_DIR%frontend"
set "DATA_DIR=%ROOT_DIR%data"

if not exist "%BACKEND_DIR%" (
  echo Backend directory not found: "%BACKEND_DIR%"
  goto :error
)

if not exist "%WEB_DIR%" (
  echo Frontend directory not found: "%WEB_DIR%"
  goto :error
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"

echo [1/2] Starting backend (Go :8080)...
start "EasyProxy-Backend" /D "%BACKEND_DIR%" cmd /k go run ./cmd/server -data "%DATA_DIR%" -addr :8080

echo [2/2] Starting frontend (Vite :5173)...
start "EasyProxy-Frontend" /D "%WEB_DIR%" cmd /k "npx vite --port 5173 --open"

echo.
echo ==========================================
echo Backend and frontend started in separate windows.
echo - Frontend: http://localhost:5173
echo - Backend:  http://localhost:8080
echo ==========================================
echo.
pause
endlocal
exit /b 0

:error
echo.
echo Unable to start EasyProxy. Please check the message above.
pause
exit /b 1
