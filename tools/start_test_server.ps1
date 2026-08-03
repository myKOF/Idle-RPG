[CmdletBinding()]
param(
  [ValidateSet('menu', 'start', 'list', 'stop')]
  [string]$Action = 'menu',
  [int]$Port = 0,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serverScript = Join-Path $root '.claude\serve.ps1'
$rootKey = $root -replace '[^A-Za-z0-9_-]', '_'
$registryDir = Join-Path $env:TEMP ("idle-rpg-test-servers-{0}" -f $rootKey)

function Get-RecordPath([int]$RecordPort) {
  return (Join-Path $registryDir ("server-{0}.json" -f $RecordPort))
}

function Test-ManagedProcess($Record) {
  $process = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f [int]$Record.Pid) -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $commandLine = [string]$process.CommandLine
  return ($commandLine -match 'serve\.ps1' -and $commandLine -match ("-Port\s+{0}(\s|$)" -f [int]$Record.Port))
}

function Get-ManagedServers {
  $servers = @()
  if (-not (Test-Path -LiteralPath $registryDir -PathType Container)) {
    return $servers
  }

  foreach ($file in (Get-ChildItem -LiteralPath $registryDir -Filter 'server-*.json' -File)) {
    try {
      $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
      if (Test-ManagedProcess $record) {
        $servers += $record
      } else {
        Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
      }
    } catch {
      Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue
    }
  }
  return $servers
}

function Read-Port {
  if ($Port -eq 0) {
    $value = Read-Host 'Port (press Enter for 8123)'
    if ([string]::IsNullOrWhiteSpace($value)) {
      $script:Port = 8123
    } elseif (-not [int]::TryParse($value, [ref]$script:Port)) {
      throw 'Port must be an integer from 1 to 65535.'
    }
  }
  if ($script:Port -lt 1 -or $script:Port -gt 65535) {
    throw 'Port must be an integer from 1 to 65535.'
  }
  return $script:Port
}

function Start-TestServer {
  $selectedPort = Read-Port
  $existingRecord = Get-ManagedServers | Where-Object { [int]$_.Port -eq $selectedPort } | Select-Object -First 1
  if ($existingRecord) {
    Write-Host ("Test server is already running: {0}" -f $existingRecord.Url) -ForegroundColor Yellow
    if (-not $NoOpen) { Start-Process ([string]$existingRecord.Url) | Out-Null }
    return
  }

  if (-not (Test-Path -LiteralPath $serverScript -PathType Leaf)) {
    throw ("Server script not found: {0}" -f $serverScript)
  }

  $existing = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort $selectedPort -State Listen -ErrorAction SilentlyContinue
  if ($existing) {
    throw ("Port {0} is already in use. Choose another port." -f $selectedPort)
  }

  if (-not (Test-Path -LiteralPath $registryDir -PathType Container)) {
    New-Item -ItemType Directory -Path $registryDir -Force | Out-Null
  }

  $url = "http://127.0.0.1:$selectedPort/"
  $shell = (Get-Command powershell.exe -ErrorAction Stop).Source
  $quotedScript = '"' + $serverScript + '"'
  $argumentText = "-NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File $quotedScript -Port $selectedPort"
  $server = Start-Process -FilePath $shell -ArgumentList $argumentText -WorkingDirectory $root -WindowStyle Minimized -PassThru
  $ready = $false

  try {
    for ($i = 0; $i -lt 40; $i++) {
      Start-Sleep -Milliseconds 250
      try {
        $response = Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
          $ready = $true
          break
        }
      } catch {
        if ($server.HasExited) { break }
      }
    }
  } catch {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    throw
  }

  if (-not $ready) {
    if (-not $server.HasExited) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
    throw ("Test server did not start on port {0}. Check the server window for errors." -f $selectedPort)
  }

  $record = [ordered]@{
    Pid = $server.Id
    Port = $selectedPort
    Url = $url
    StartedAt = (Get-Date).ToString('s')
  }
  $record | ConvertTo-Json | Set-Content -LiteralPath (Get-RecordPath $selectedPort) -Encoding UTF8
  Write-Host ("Test server started: {0} (PID {1})" -f $url, $server.Id) -ForegroundColor Green
  if (-not $NoOpen) { Start-Process $url | Out-Null }
}

function Show-TestServers {
  $servers = @(Get-ManagedServers)
  if ($servers.Count -eq 0) {
    Write-Host 'No test servers started by this tool.' -ForegroundColor Yellow
    return
  }
  Write-Host ''
  Write-Host 'Running test servers:' -ForegroundColor Cyan
  foreach ($server in $servers) {
    Write-Host ("  Port {0} | PID {1} | {2} | started {3}" -f $server.Port, $server.Pid, $server.Url, $server.StartedAt)
  }
}

function Stop-TestServer {
  $servers = @(Get-ManagedServers)
  if ($servers.Count -eq 0) {
    Write-Host 'No test servers started by this tool.' -ForegroundColor Yellow
    return
  }

  $selectedPort = $Port
  if ($selectedPort -eq 0) {
    Show-TestServers
    $value = Read-Host 'Enter the port to close'
    if (-not [int]::TryParse($value, [ref]$selectedPort)) {
      throw 'Port must be an integer.'
    }
  }

  $server = $servers | Where-Object { [int]$_.Port -eq $selectedPort } | Select-Object -First 1
  if (-not $server) {
    throw ("No managed test server found on port {0}." -f $selectedPort)
  }

  Stop-Process -Id ([int]$server.Pid) -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Get-RecordPath $selectedPort) -Force -ErrorAction SilentlyContinue
  Write-Host ("Test server closed: port {0}" -f $selectedPort) -ForegroundColor Green
}

function Show-Menu {
  while ($true) {
    Write-Host ''
    Write-Host 'Idle-RPG test server' -ForegroundColor Cyan
    Write-Host '1. Start a test server'
    Write-Host '2. List running test servers'
    Write-Host '3. Stop a test server'
    Write-Host '0. Exit'
    $choice = Read-Host 'Choose an action'
    try {
      switch ($choice) {
        '1' { Start-TestServer }
        '2' { Show-TestServers }
        '3' { Stop-TestServer }
        '0' { return }
        default { Write-Host 'Please choose 0, 1, 2, or 3.' -ForegroundColor Yellow }
      }
    } catch {
      Write-Host $_.Exception.Message -ForegroundColor Red
    }
  }
}

switch ($Action) {
  'start' { Start-TestServer }
  'list' { Show-TestServers }
  'stop' { Stop-TestServer }
  default { Show-Menu }
}
