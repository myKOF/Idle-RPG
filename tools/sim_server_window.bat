@echo off
chcp 65001 > nul
cd /d "%~dp0.."

rem This file IS the server console window.  It exists so the window can explain
rem itself: the launcher runs node with all output redirected to a log, leaving a
rem blank black window that looks abandoned and gets closed by mistake.
rem
rem It deliberately takes NO arguments.  The launcher invokes it as
rem   start "title" cmd /c tools\sim_server_window.bat
rem with nothing quoted after /c, because cmd strips the outer quote pair when the
rem command line both starts and ends with one -- and then silently runs nothing.
rem Both `cmd /c "x.bat" "A"` and `start "t" "x.bat" "A"` were measured doing
rem exactly that, with the stale log still in place so it looked like a crash.
rem
rem Keep CRLF line endings and keep non-echo lines ASCII-only (see the launcher).
rem
rem The dashboard URL is not printed here: the port is only known after node picks
rem it, and the launcher already prints it and opens the browser.

set LOG=sim_server.log

echo ========================================================
echo   蒙地卡羅模擬測試服（Idle-RPG Sim Server）執行中
echo ========================================================
echo.
echo   這個視窗就是伺服器本體，不是殘留的命令列。
echo   關掉它 = 停止伺服器，正在跑的模擬會一起中斷。
echo.
echo   服務的目錄   %CD%
echo   詳細記錄     %LOG%
echo   儀表板網址   請看啟動器視窗（瀏覽器會自動開啟）
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
rem reason stays readable instead of the console vanishing.
echo.
echo ========================================================
echo   伺服器已結束（結束代碼 %ERRORLEVEL%）。
echo   原因請看 %LOG%
echo ========================================================
pause
