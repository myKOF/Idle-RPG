@echo off
chcp 65001 > nul
cd /d "%~dp0..\.."

rem This file IS the VFX editor server console window.  It exists so the window
rem can explain itself instead of looking like an abandoned black box.
rem
rem It deliberately takes NO arguments.  The launcher invokes it as
rem   start "title" cmd /c tools\vfx\editor_server_window.bat
rem with nothing quoted after /c, because cmd strips the outer quote pair when
rem the command line both starts and ends with one -- and then silently runs
rem nothing.  See the sim launcher comments for the measured cases.
rem
rem Keep CRLF line endings and keep non-echo lines ASCII-only: chcp switches the
rem codepage mid-file and cmd parses batch incrementally, so multi-byte text in
rem rem/command positions gets mangled and executed as commands.
rem
rem Server output is NOT redirected to a log.  Unlike the sim server this one
rem prints things worth reading every run (chosen port, resolved asset library
rem root) and its most common failure -- no Asset Library Root configured on
rem this machine -- is a one-line message that must stay visible.

echo ========================================================
echo   VFX 編輯器伺服器執行中
echo ========================================================
echo.
echo   這個視窗就是伺服器本體，不是殘留的命令列。
echo   關掉它 = 停止伺服器，編輯器頁面會失去連線。
echo.
echo   服務的目錄
echo     %CD%
echo.
echo   要結束：關掉這個視窗，或在這裡按 Ctrl+C。
echo ========================================================
echo.

node tools/vfx/editor-server.cjs

rem If node exits on its own something went wrong -- hold the window open so the
rem reason stays readable instead of the console vanishing.
echo.
echo ========================================================
echo   伺服器已結束，結束代碼：
echo     %ERRORLEVEL%
echo.
echo   最常見的原因：這台電腦還沒設定素材庫位置。
echo   把 vfx\library.local.example.json 複製成 vfx\library.local.json，
echo   再把裡面的路徑改成這台電腦上 effects-materials 的實際位置。
echo ========================================================
pause
