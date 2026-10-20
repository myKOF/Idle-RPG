param(
  [Parameter(Mandatory = $true)][string]$Root,
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$run = Split-Path -Parent $Manifest
$queue = Split-Path -Parent (Split-Path -Parent $run)
$lock = $null
$excel = $null
$book = $null
$streams = @{}
$sources = @{}
$written = New-Object 'System.Collections.Generic.List[string]'
$exitCode = 1
function Read-Json($file) { Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json }
function Write-Json($file, $value) {
  $json = ConvertTo-Json -InputObject $value -Depth 40
  [IO.File]::WriteAllText($file, $json, (New-Object Text.UTF8Encoding($false)))
}
function Hash-File($file) {
  $inputStream = [IO.File]::OpenRead($file)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($inputStream)).Replace('-', '') }
  finally { $sha.Dispose(); $inputStream.Dispose() }
}
function Cell-Value($cell) {
  if ($cell.HasFormula) { return @{ formula = [string]$cell.Formula } }
  return $cell.Value2
}
function Equal-Value($a, $b) {
  if (($null -eq $a -or $a -ceq '') -and ($null -eq $b -or $b -ceq '')) { return $true }
  return (ConvertTo-Json -InputObject $a -Compress -Depth 5) -ceq (ConvertTo-Json -InputObject $b -Compress -Depth 5)
}
function Set-Cell($cell, $value) {
  if ($null -eq $value) { $cell.ClearContents() | Out-Null }
  elseif ($value -is [pscustomobject]) { $cell.Formula = [string]$value.formula }
  elseif ($value -is [string]) {
    # Excel must retain text literally, even if it starts with =, +, - or an apostrophe.
    $format = $cell.NumberFormat
    $cell.NumberFormat = '@'
    $cell.Value2 = $value
    $cell.NumberFormat = $format
  } elseif ($value -is [bool]) { $cell.Value2 = $value }
  else { $cell.Value2 = [double]$value }
}
function Open-Book($file, $readOnly) {
  # UpdateLinks=0, normal load only. A repair load is never accepted.
  $b = $excel.Workbooks.Open($file, 0, $readOnly)
  if (-not $b.Saved -or $b.RepairMode) { $b.Close($false); throw "Excel 開啟需要修復或重新儲存：$file" }
  if (-not $readOnly -and $b.ReadOnly) { $b.Close($false); throw "Excel 副本為唯讀，不能安全儲存：$file" }
  return $b
}
try {
  $lockPath = Join-Path $queue '.merge.lock'
  $lock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
  $patches = Read-Json $Manifest
  $receipts = @()
  foreach ($dir in (Get-ChildItem -LiteralPath (Join-Path $queue 'archive') -Directory)) {
    $receiptPath = Join-Path $dir.FullName 'commit-started.json'
    if (Test-Path -LiteralPath $receiptPath) { $receipts += (Read-Json $receiptPath) }
  }
  # Check every source before starting Excel; keep exclusive access while taking the snapshot.
  foreach ($p in $patches) {
    foreach ($c in $p.patch.changes) {
      if ($sources.ContainsKey($c.workbook)) { continue }
      $source = Join-Path (Join-Path $Root 'config/Excel') $c.workbook
      $owner = Join-Path (Split-Path -Parent $source) ('~$' + $c.workbook)
      try { $s = [IO.File]::Open($source, 'Open', 'ReadWrite', 'None') }
      catch { throw "請先儲存並關閉 Excel：$($c.workbook)（來源仍被占用：$($_.Exception.Message)）" }
      if (Test-Path -LiteralPath $owner) { Write-Output "[param-patches] 來源已取得獨占鎖，保留並略過殘留鎖定檔：$owner" }
      try {
        $backup = Join-Path $run ('original-' + $c.workbook)
        $copy = [IO.File]::Create($backup)
        try { $s.CopyTo($copy) } finally { $copy.Dispose() }
      } finally { $s.Dispose() }
      $candidate = Join-Path $run ('merged-' + $c.workbook)
      Copy-Item -LiteralPath $backup -Destination $candidate
      $sources[$c.workbook] = @{ path = $source; backup = $backup; candidate = $candidate;
        hash = (Hash-File $backup) }
    }
  }
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.EnableEvents = $false
  $excel.AskToUpdateLinks = $false
  $excel.AutomationSecurity = 3
  $records = New-Object 'System.Collections.Generic.List[object]'
  foreach ($name in $sources.Keys) {
    $book = Open-Book $sources[$name].candidate $false
    foreach ($p in $patches) {
      foreach ($c in $p.patch.changes) {
        if ($c.workbook -ine $name) { continue }
        $sheet = $book.Worksheets.Item($c.sheet)
        $used = $sheet.UsedRange
        $lastCol = $used.Column + $used.Columns.Count - 1
        $lastRow = $used.Row + $used.Rows.Count - 1
        $headers = @{}
        for ($col = 1; $col -le $lastCol; $col++) {
          $label = [string]$sheet.Cells.Item($c.headerRow, $col).Value2
          if (-not $label) { continue }
          # Case sensitive header lookup is enforced below, even though PowerShell hashtables are not.
          if (-not $headers.ContainsKey($label)) { $headers[$label] = @() }
          $headers[$label] += $col
        }
        $keyColumns = @{}
        foreach ($label in @($c.column) + @($c.key.PSObject.Properties.Name)) {
          if (-not $headers.ContainsKey($label) -or $headers[$label].Count -ne 1) {
            throw "$name / $($c.sheet)：欄名不存在或重複：$label"
          }
          $col = $headers[$label][0]
          if ([string]$sheet.Cells.Item($c.headerRow, $col).Value2 -cne $label) { throw "欄名大小寫不同：$label" }
          $keyColumns[$label] = $col
        }
        $matches = @()
        for ($row = $c.headerRow + 1; $row -le $lastRow; $row++) {
          $match = $true
          foreach ($k in $c.key.PSObject.Properties) {
            if (-not (Equal-Value (Cell-Value $sheet.Cells.Item($row, $keyColumns[$k.Name])) $k.Value)) { $match = $false; break }
          }
          if ($match) { $matches += $row }
        }
        if ($matches.Count -ne 1) { throw "$name / $($c.sheet)：主鍵必須只命中一列，實際 $($matches.Count) 列：$($c.key | ConvertTo-Json -Compress)" }
        $cell = $sheet.Cells.Item($matches[0], $keyColumns[$c.column])
        if ($cell.MergeCells) { throw "不支援合併儲存格：$name / $($c.sheet) / $($cell.Address())" }
        $recovered = $false
        foreach ($receipt in $receipts) {
          $requestMatch = @($receipt.requests | Where-Object { $_.file -ceq $p.file -and $_.hash -ieq $p.hash }).Count
          $workbookMatch = @($receipt.workbooks | Where-Object { $_.workbook -ieq $name -and $_.hash -ieq $sources[$name].hash }).Count
          if ($requestMatch -and $workbookMatch) { $recovered = $true; break }
        }
        $records.Add(@{ workbook = $name; sheet = $c.sheet; address = $cell.Address(); task = $p.patch.task; agent = $p.patch.agent;
          key = $c.key; column = $c.column; before = $c.before; after = $c.after; current = (Cell-Value $cell);
          approval = $c.approval; recovered = $recovered; requestFile = $p.file })
      }
    }
    $book.Close($false); $book = $null
  }
  $snapshot = Join-Path $run 'snapshot.json'
  $decisionFile = Join-Path $run 'decision.json'
  Write-Json $snapshot @($records.ToArray())
  & $NodePath (Join-Path $PSScriptRoot 'param-patches.cjs') --decide $snapshot $decisionFile
  if ($LASTEXITCODE -ne 0) { throw '無法判斷參數合併。' }
  $decision = Read-Json $decisionFile
  if (@($decision.conflicts).Count) {
    foreach ($c in $decision.conflicts) {
      Write-Host "[衝突] $($c.workbook) / $($c.sheet) / $($c.address) / $($c.column) — $($c.reason)"
      Write-Host ('  原值：' + (ConvertTo-Json -InputObject $c.before -Compress -Depth 5))
      Write-Host ('  Excel：' + (ConvertTo-Json -InputObject $c.current -Compress -Depth 5))
      Write-Host ('  Agent：' + (ConvertTo-Json -InputObject $c.after -Compress -Depth 5))
      foreach ($proposal in $c.proposals) { Write-Host ('  提案：' + (ConvertTo-Json -InputObject $proposal -Compress -Depth 5)) }
    }
    throw '有衝突，整批未套用。請由使用者決定衝突格內容；待套用檔與報告均保留。'
  }
  foreach ($name in $sources.Keys) {
    $actions = @($decision.actions | Where-Object { $_.workbook -ieq $name })
    if (-not $actions.Count) { continue }
    $book = Open-Book $sources[$name].candidate $false
    foreach ($a in $actions) { Set-Cell ($book.Worksheets.Item($a.sheet).Range($a.address)) $a.after }
    $book.Save()
    $book.Close($false); $book = $null
    $book = Open-Book $sources[$name].candidate $true
    foreach ($a in $actions) {
      if (-not (Equal-Value (Cell-Value $book.Worksheets.Item($a.sheet).Range($a.address)) $a.after)) {
        throw "儲存後驗證失敗：$name / $($a.address)"
      }
    }
    $book.Close($false); $book = $null
  }
  $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel); $excel = $null
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  # Acquire ALL originals before writing any. Excel opening or saving during preparation aborts the batch.
  foreach ($name in $sources.Keys) {
    $src = $sources[$name]
    $streams[$name] = [IO.File]::Open($src.path, 'Open', 'ReadWrite', 'None')
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($streams[$name])).Replace('-', '') }
    finally { $sha.Dispose() }
    if ($hash -ne $src.hash) { throw "準備期間檔案已變更，未覆蓋：$name" }
  }
  # Never consume a request that another Agent changed while this run was preparing.
  foreach ($p in $patches) {
    if ((Hash-File $p.file) -ine $p.hash) { throw "待套用檔已變更：$($p.file)" }
  }
  $workbookReceipts = @()
  foreach ($name in $sources.Keys) {
    $workbookReceipts += @{ workbook = $name; hash = (Hash-File $sources[$name].candidate) }
  }
  Write-Json (Join-Path $run 'commit-started.json') @{ workbooks = $workbookReceipts;
    requests = @($patches | ForEach-Object { @{ file = $_.file; hash = $_.hash } }) }
  foreach ($name in $sources.Keys) {
    if (-not @($decision.actions | Where-Object { $_.workbook -ieq $name }).Count) { continue }
    $s = $streams[$name]
    $bytes = [IO.File]::ReadAllBytes($sources[$name].candidate)
    $written.Add($name)
    $s.Position = 0; $s.Write($bytes, 0, $bytes.Length); $s.SetLength($bytes.Length); $s.Flush($true)
  }
  foreach ($s in $streams.Values) { $s.Dispose() }; $streams.Clear()
  # Moving requests only after every workbook succeeds makes an interrupted run safe to retry.
  foreach ($p in $patches) { Move-Item -LiteralPath $p.file -Destination (Join-Path $run (Split-Path -Leaf $p.file)) }
  $written.Clear()
  Write-Host "[param-patches] 已合併 $(@($decision.actions).Count) 格；備份與紀錄：$run"
  $exitCode = 0
} catch {
  $failureMessage = $_.Exception.Message
  try { Write-Json (Join-Path $run 'failure.json') @{ error = $failureMessage } } catch {}
  # Restore through the held exclusive streams if a write failed. Backup remains even if rollback fails.
  foreach ($name in $written) {
    if (-not $streams.ContainsKey($name)) { continue }
    try {
      $bytes = [IO.File]::ReadAllBytes($sources[$name].backup)
      $s = $streams[$name]; $s.Position = 0; $s.Write($bytes, 0, $bytes.Length); $s.SetLength($bytes.Length); $s.Flush($true)
    } catch { Write-Host "[回復失敗] 請保留並使用備份：$($sources[$name].backup)" }
  }
  Write-Host "[param-patches] $failureMessage"
  Write-Host "Excel／CSV／遊戲套用流程已停止。待套用內容及備份位置：$run"
} finally {
  if ($null -ne $book) { try { $book.Close($false) } catch {} }
  if ($null -ne $excel) { try { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) } catch {} }
  foreach ($s in $streams.Values) { $s.Dispose() }
  if ($null -ne $lock) { $lock.Dispose() }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
exit $exitCode
