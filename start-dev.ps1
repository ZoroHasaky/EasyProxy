<#
.SYNOPSIS
    EasyProxy 本地一键启动脚本 (后端 Go + 前端 fronted)
.DESCRIPTION
    并发启动 Go 后端服务 (:8080) 与 fronted 前端 Vite 开发服务器 (:5173)，
    并在退出时自动清理子进程。
#>

$ErrorActionPreference = "Stop"

$RootDir = $PSScriptRoot
$BackendDir = Join-Path $RootDir "backend"
$WebDir = Join-Path $RootDir "fronted"
$DataDir = Join-Path $RootDir "data"

if (!(Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "       EasyProxy 本地开发环境启动         " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "后端数据目录: $DataDir" -ForegroundColor Gray
Write-Host "前端项目目录: $WebDir" -ForegroundColor Gray
Write-Host ""

# 启动 Go 后端服务
Write-Host "[1/2] 正在启动后端服务 (Go :8080)..." -ForegroundColor Yellow
$BackendProcess = Start-Process -FilePath "go" `
    -ArgumentList "run", "./cmd/server", "-data", $DataDir, "-addr", ":8080" `
    -WorkingDirectory $BackendDir `
    -PassThru

# 启动 Vite 前端服务
Write-Host "[2/2] 正在启动前端开发服务 (Vite :5173)..." -ForegroundColor Yellow
$FrontendProcess = Start-Process -FilePath "npx.cmd" `
    -ArgumentList "vite", "--port", "5173", "--open" `
    -WorkingDirectory $WebDir `
    -PassThru

Write-Host ""
Write-Host "服务启动完成！" -ForegroundColor Green
Write-Host "-> 前端界面: http://localhost:5173" -ForegroundColor Cyan
Write-Host "-> 后端接口: http://localhost:8080" -ForegroundColor Cyan
Write-Host ""
Write-Host "按 Ctrl + C 或回车键可一键退出并停止所有前后端进程..." -ForegroundColor DarkGray

try {
    # 保持主控制台挂起等待用户退出
    [Console]::ReadLine()
}
finally {
    Write-Host ""
    Write-Host "正在关闭前后端服务进程..." -ForegroundColor Yellow

    if ($FrontendProcess -and !$FrontendProcess.HasExited) {
        Stop-Process -Id $FrontendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($BackendProcess -and !$BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
    }

    Write-Host "所有服务已安全停止。" -ForegroundColor Green
}
