@echo off
rem Desktop build (Electron), INTERNAL TEST mode: GM and internal tools enabled.
rem   - served as app://localhost, so the game's own localhost checks open GM tools
rem   - separate saves: %APPDATA%\idle-rpg-internal\saves (never mixed with release saves)
rem   - Steam is never connected in this mode
rem   - windowed, F12 devtools, F5 reload
rem Startup log: %APPDATA%\idle-rpg-internal\logs\desktop.log
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
  echo Electron install failed. Check the network, then run: npm.cmd install
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" . --dev --windowed --internal
exit /b 0
