@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

rem Launcher for the simulation dashboard. Keep this file ASCII-only outside
rem echo lines: chcp switches the codepage mid-file, and cmd parses the batch
rem incrementally, so multi-byte text in rem/command positions gets mangled and
rem executed as commands. Design notes live in tools/sim_server.cjs.

set PORT=28342
set URL=http://127.0.0.1:%PORT%/monte_carlo_app.html
set LOG=sim_server.log

echo ========================================================
echo 正在啟動放置型 RPG 模擬伺服器...
echo ========================================================

rem Already running? do not start a second one (port would be taken).
curl -s -o nul --max-time 1 http://127.0.0.1:%PORT%/ 2>nul
if not errorlevel 1 (
  echo 伺服器已在執行中，直接開啟儀表板。
  goto :open
)

rem Own console window, not start /b: /b ties node to this console and closing
rem it can take the server down with it.  Log instead of nul so failures show.
start "Idle-RPG Sim Server (close this window to stop)" /min cmd /c "node tools/sim_server.cjs > %LOG% 2>&1"

rem Poll until the port actually answers.  A fixed 1s wait raced the ~1050ms
rem cold start and the browser opened first -> ERR_CONNECTION_REFUSED.
echo 等待伺服器就緒...
set /a TRIES=0
:wait
set /a TRIES+=1
curl -s -o nul --max-time 1 http://127.0.0.1:%PORT%/ 2>nul
if not errorlevel 1 goto :open
if %TRIES% GEQ 40 goto :failed
ping -n 1 -w 250 127.0.0.1 > nul
goto :wait

:failed
echo.
echo 伺服器在 10 秒內沒有就緒，以下是它的輸出：
echo --------------------------------------------------------
if exist "%LOG%" (
  type "%LOG%"
) else (
  echo 沒有產生 %LOG%，多半是找不到 node 指令。
  echo 請確認已安裝 Node.js，並在命令列執行 node -v 確認可用。
)
echo --------------------------------------------------------
pause
exit /b 1

:open
echo.
echo 正在開啟數據儀表板 (%URL%)...
start "" "%URL%"
exit /b 0
