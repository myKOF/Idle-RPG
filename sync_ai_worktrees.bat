@echo off
rem Syncs the AI worktrees AND the VFX asset library (Effects-Materials).
rem Both live in tools\sync_ai_worktrees.ps1; this file only launches it.
rem Comments here stay ASCII on purpose: after chcp 65001, multi-byte text on a
rem non-echo line can be re-parsed as a command. See test W8 in vfx-editor-save.
chcp 65001 >nul
setlocal

set "REPO_ROOT=%~dp0"
set "SYNC_SCRIPT=%REPO_ROOT%tools\sync_ai_worktrees.ps1"
set "SYNC_EXIT=0"

if not exist "%SYNC_SCRIPT%" (
    echo ERROR: Cannot find "%SYNC_SCRIPT%".
    set "SYNC_EXIT=2"
    goto :finish
)

pushd "%REPO_ROOT%" >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SYNC_SCRIPT%" -SyncRemoteFirst %*
set "SYNC_EXIT=%ERRORLEVEL%"
popd

:finish
echo.
if not "%SYNC_AI_NO_PAUSE%"=="1" pause
exit /b %SYNC_EXIT%
