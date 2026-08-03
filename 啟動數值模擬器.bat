@echo off
chcp 65001 > nul
setlocal
cd /d "%~dp0"

rem Launcher for the simulation dashboard. Keep this file ASCII-only outside
rem echo lines: chcp switches the codepage mid-file, and cmd parses the batch
rem incrementally, so multi-byte text in rem/command positions gets mangled and
rem executed as commands. Design notes live in tools/sim_server.cjs.
rem
rem Also: this file MUST keep CRLF line endings.  Saved with LF only, cmd
rem desyncs mid-file and starts executing fragments of words ("'uted' is not
rem recognized", "2>&1 was unexpected at this time").  Editors that default to
rem LF will silently break this launcher.

rem Port handling: 28342 is not ours exclusively -- other tools have taken it
rem (Codex's runtime kernel listens there).  The old check was "does anything
rem answer on this port"; a foreign 200 made this script believe our server was
rem already up and open the browser straight into a 404 with no clue why.
rem So we verify identity via /__whoami, and the server itself walks up to the
rem next free port and writes its choice to sim_server.port.
set PORTFILE=sim_server.port
rem The identity mark must include the directory being served.  All five parallel
rem worktrees (claude/codex/antigravity/develop/production) ship this same launcher,
rem so a bare project name makes them indistinguishable.  Launching from claude while
rem the develop copy had a server up made this script report "already running" and
rem open the develop dashboard -- you end up testing code you did not change.
rem %CD% is this file own directory (see the cd /d at the top) and matches the ROOT
rem the server reports via /__whoami.
set MARK=idle-rpg-sim-server %CD%
set LOG=sim_server.log
set PORT=28342

echo ========================================================
echo 正在啟動放置型 RPG 模擬伺服器...
echo ========================================================

rem Already running?  Trust the port file only after /__whoami confirms it.
if exist "%PORTFILE%" set /p PORT=<%PORTFILE%
call :probe %PORT%
if not errorlevel 1 (
  echo 伺服器已在執行中（連接埠 %PORT%），直接開啟儀表板。
  goto :open
)

rem Own console window, not start /b: /b ties node to this console and closing
rem it can take the server down with it.  Log instead of nul so failures show.
start "蒙地卡羅模擬測試服 - 關閉此視窗即停止伺服器" cmd /c "tools\sim_server_window.bat" "%LOG%" "%PORT%"

rem Poll until the port actually answers.  A fixed 1s wait raced the ~1050ms
rem cold start and the browser opened first -> ERR_CONNECTION_REFUSED.
rem Re-read the port file every round: the server may have shifted to 28343+.
echo 等待伺服器就緒...
set /a TRIES=0
:wait
set /a TRIES+=1
if exist "%PORTFILE%" set /p PORT=<%PORTFILE%
call :probe %PORT%
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
echo.
echo 目前占用 28342~28351 這段連接埠的程序：
netstat -ano | findstr LISTENING | findstr ":2834"
echo 若上面列出的不是本專案的 node，就是別的程式占走了整段連接埠。
echo --------------------------------------------------------
pause
exit /b 1

:open
set URL=http://127.0.0.1:%PORT%/monte_carlo_app.html
echo.
echo 正在開啟數據儀表板 (%URL%)...
start "" "%URL%"
exit /b 0

rem ---- probe <port> : errorlevel 0 only when OUR server answers there ----
:probe
curl -s --max-time 1 http://127.0.0.1:%~1/__whoami 2>nul | find /i "%MARK%" > nul
exit /b %errorlevel%
