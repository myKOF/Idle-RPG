@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo ========================================================
echo 🌐 正在啟動放置型 RPG 模擬伺服器...
echo ========================================================

rem 啟動後台服務 (tools/sim_server.cjs)
start /b node tools/sim_server.cjs > nul 2>&1

timeout /t 1 /nobreak > nul

echo.
echo 📊 正在開啟數據儀表板 (http://127.0.0.1:28342/monte_carlo_app.html)...
start http://127.0.0.1:28342/monte_carlo_app.html
exit
