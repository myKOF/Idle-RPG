@echo off
chcp 65001 > nul
cd /d "%~dp0..\.."

rem This file IS the VFX editor server console window.  The launcher
rem (tools\vfx\launch-editor.cjs) starts it as
rem   start "title" cmd /c tools\vfx\editor_server_window.bat
rem with nothing quoted after /c, because cmd strips the outer quote pair when
rem the command line both starts and ends with one -- and then silently runs
rem nothing.  See the sim launcher comments for the measured cases.
rem
rem ASCII ONLY, echo lines included.  Measured 2026-09-17: under chcp 65001 cmd
rem lost its place inside a run of long Chinese echo lines and executed the
rem fragments as commands.  The banner that explains this window is printed by
rem editor-server.cjs itself when VFX_EDITOR_WINDOW=1.  Keep CRLF line endings.
rem
rem The server script is started by ABSOLUTE path on purpose: the launcher tells
rem this worktree's servers apart by their command line, which is the only way
rem to recognise one that has hung and no longer answers /__whoami.
rem
rem Server output is NOT redirected to a log.  Unlike the sim server this one
rem prints things worth reading every run (chosen port, resolved asset library
rem root) and its most common failure -- no Asset Library Root configured on
rem this machine -- is a message that must stay visible.

set VFX_EDITOR_WINDOW=1
node "%CD%\tools\vfx\editor-server.cjs"

rem Exit code 0 means the editor page or the launcher asked us to stop.  The
rem server otherwise runs until killed, so 0 can only mean that.  A requested
rem shutdown is not a failure: close the window instead of holding it open with
rem a pause nobody needs to read.
if "%ERRORLEVEL%"=="0" exit /b 0

rem If node exits on its own something went wrong.  The server printed the
rem reason above, plus a hint for the most common cause; keep it readable.
pause
