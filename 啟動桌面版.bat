@echo off
rem Desktop build (Electron), dev mode: windowed, F12 devtools, F5 reload.
rem Uses npm.cmd so the PowerShell execution policy does not matter.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" call npm.cmd install
call npm.cmd run desktop:dev
