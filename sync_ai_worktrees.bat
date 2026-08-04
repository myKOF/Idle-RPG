@echo off
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
