@echo off
chcp 65001 >nul
cd /d %~dp0
title 译码 CodeLens 本地服务器
echo ============================================
echo   译码 CodeLens · 正在启动本地服务器
echo   启动后会自动打开浏览器：http://localhost:8080
echo   关闭本窗口即停止服务
echo ============================================
echo.

where python >nul 2>nul
if %errorlevel%==0 (
    start "" "http://localhost:8080/"
    python -m http.server 8080
    goto :eof
)

where node >nul 2>nul
if %errorlevel%==0 (
    start "" "http://localhost:8080/"
    npx -y http-server . -p 8080 -c-1
    goto :eof
)

echo 未找到 Python 或 Node.js。
echo 也可以直接双击 codelens 文件夹里的 index.html 使用（功能完整，无需服务器）。
pause
