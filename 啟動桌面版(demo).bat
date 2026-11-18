@echo off
rem Desktop build (Electron), DEMO edition (Steam closed beta) from source.
rem   - GAME_EDITION = 'demo': demo multipliers and open ranges from game_parameters "11-Demo"
rem   - separate saves: %APPDATA%\idle-rpg-demo\saves (never mixed with the full game)
rem   - Steam uses demoAppId in electron/steam-config.json (0 = not connected)
rem   - windowed, F12 devtools, F5 reload
rem Startup log: %APPDATA%\idle-rpg-demo\logs\desktop.log
rem Packaged demo for Steam: npm.cmd run desktop:pack:demo  (output dist\demo\win-unpacked)
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
start "" "node_modules\electron\dist\electron.exe" . --dev --windowed --demo
exit /b 0
