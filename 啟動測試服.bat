@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，無法啟動測試服控制台。
  pause
  exit /b 1
)

rem 先關閉舊的 Idle-RPG 測試服控制台，再重新開啟新版。
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ports = 8124..8144; foreach ($port in $ports) { $connection = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1; if ($connection -and $connection.OwningProcess -gt 4) { try { $api = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $port + '/api/servers') -TimeoutSec 1; if ($null -ne $api.servers) { Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue } } catch {} } }; $items = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'test_server_manager\.cjs' }; $items | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo 啟動測試服控制台，網頁開啟中...
powershell.exe -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 1000"
powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "$workDir = '%~dp0'; $stdoutLog = Join-Path $env:TEMP 'idle-rpg-test-server-manager.stdout.log'; $stderrLog = Join-Path $env:TEMP 'idle-rpg-test-server-manager.stderr.log'; Remove-Item -LiteralPath $stdoutLog,$stderrLog -Force -ErrorAction SilentlyContinue; Start-Process -FilePath 'node.exe' -ArgumentList @('tools\test_server_manager.cjs','--open','--quiet') -WorkingDirectory $workDir -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog"
powershell.exe -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 3000"
echo 網頁控制台已開啟，背景服務持續執行；此視窗即將關閉。
powershell.exe -NoProfile -NonInteractive -Command "Start-Sleep -Milliseconds 1000"
exit /b 0
endlocal
