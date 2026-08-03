@echo off
chcp 65001 > nul
cd /d "%~dp0.."

rem This file is the server console window.  It exists so the window can explain
rem itself: the launcher used to run node with all output redirected to a log,
rem leaving a blank black window that looks abandoned and gets closed by mistake.
rem
rem Keep CRLF line endings and keep non-echo lines ASCII-only -- same constraints
rem as the launcher, and for the same reason (chcp switches codepage mid-file).
rem
rem Server output still goes to the log rather than here: it refreshes progress
rem continuously and would scroll this notice away within seconds.

set LOG=%~1
if "%LOG%"=="" set LOG=sim_server.log
set PORT=%~2
if "%PORT%"=="" set PORT=28342

echo ========================================================
echo   蒙地卡羅模擬測試服（Idle-RPG Sim Server）執行中
echo ========================================================
echo.
echo   這個視窗就是伺服器本體，不是殘留的命令列。
echo   關掉它 = 停止伺服器，正在跑的模擬會一起中斷。
echo.
echo   儀表板網址   http://127.0.0.1:%PORT%/
echo   服務的目錄   %CD%
echo   詳細記錄     %LOG%
echo.
echo   模擬進度請看瀏覽器上的儀表板。
echo   伺服器訊息全部寫進上面那個 log 檔，所以這裡不會再有輸出，
echo   看起來沒動靜是正常的。
echo.
echo   要結束測試服：關掉這個視窗，或在這裡按 Ctrl+C。
echo ========================================================
echo.

node tools/sim_server.cjs > "%LOG%" 2>&1

rem If node exits on its own something went wrong -- hold the window open so the
rem reason is readable instead of the console vanishing.
echo.
echo ========================================================
echo   伺服器已結束（結束代碼 %ERRORLEVEL%）。
echo   原因請看 %LOG%
echo ========================================================
pause
