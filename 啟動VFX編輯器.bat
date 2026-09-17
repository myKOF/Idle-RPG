@echo off
rem One-click launcher for the VFX editor.  Optional argument: a preset id to
rem open instead of the default, e.g. a shortcut with hit-fire baked in.
rem
rem Everything happens in tools\vfx\launch-editor.cjs: it closes every editor
rem server of THIS worktree (current, outdated or hung), starts a fresh one in
rem its own window and opens the page.  This file only checks that Node exists
rem and keeps the window open when something went wrong.
rem
rem ASCII ONLY -- no Chinese anywhere in this file, not even in echo lines.
rem Measured 2026-09-17: under chcp 65001 cmd lost its place inside a run of
rem long Chinese echo lines, started reading mid-character and executed the
rem fragments.  One fragment was "taskkill /F /PID ..." from a help text, and
rem it ran.  The old rule (Chinese allowed in echo lines only) was not enough,
rem so Chinese text is printed by Node.  Keep CRLF line endings as well: LF
rem desyncs cmd the same way.  tests/vfx-editor-launcher.test.cjs W8 pins both.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

rem Quoted on purpose: a bare %1 containing & would run as a second command.
node tools\vfx\launch-editor.cjs "%~1"
set RC=%ERRORLEVEL%
if not "%RC%"=="0" pause
exit /b %RC%

:nonode
echo.
echo Node.js was not found, so the VFX editor cannot start.
echo Install Node.js, then open a new command prompt and run: node -v
echo.
pause
exit /b 1
