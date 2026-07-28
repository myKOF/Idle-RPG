@echo off
setlocal
title Idle RPG - Sync AI Worktrees

set "REPO_ROOT=%~dp0"
set "SYNC_SCRIPT=%REPO_ROOT%tools\sync_ai_worktrees.ps1"
set "SYNC_EXIT=0"

if not exist "%SYNC_SCRIPT%" (
    echo ERROR: Cannot find "%SYNC_SCRIPT%".
    set "SYNC_EXIT=2"
    goto :finish
)

pushd "%REPO_ROOT%" >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SYNC_SCRIPT%" %*
set "SYNC_EXIT=%ERRORLEVEL%"
popd

echo.
if "%SYNC_EXIT%"=="0" (
    echo Sync completed successfully.
) else (
    echo Sync stopped with exit code %SYNC_EXIT%.
    echo Read the message above, resolve the problem, and run this file again.
)

:finish
echo.
if not "%SYNC_AI_NO_PAUSE%"=="1" pause
exit /b %SYNC_EXIT%
