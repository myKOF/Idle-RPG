@echo off
rem Desktop build (Electron), dev mode: windowed, F12 devtools, F5 reload.
rem Launches electron.exe directly with "start" so this console closes right away.
rem Startup log: %APPDATA%\idle-rpg\logs\desktop.log
rem (Need console output? run "npm.cmd run desktop:dev" in a terminal instead.)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" call npm.cmd install
rem npm says "up to date" when the electron package exists but its binary
rem download (postinstall) never ran or failed; run the downloader directly.
if not exist "node_modules\electron\dist\electron.exe" if exist "node_modules\electron\install.js" (
  echo Downloading Electron binary...
  node "node_modules\electron\install.js"
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron install failed. Check the network, then run: npm.cmd install  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" . --dev --windowed
exit /b 0
