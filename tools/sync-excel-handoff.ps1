# Controller-only Excel operations. The model supplies data, never executable code.
# A PowerShell 7 caller can leave PSModulePath pointing at its incompatible utility
# module. Load the controller's own native module, including Get-FileHash.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
}
function Assert-SyncExcelPath {
    param([string]$Root, [string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = $Root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Excel path escapes its allowed directory.' }
    $item = Get-Item -LiteralPath $full -ErrorAction Stop
    while ($item -and $item.FullName.Length -ge $Root.Length) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Excel handoff refuses linked files or directories.' }
        $item = if ($item -is [IO.DirectoryInfo]) { $item.Parent } else { $item.Directory }
    }
    return $full
}

function New-SyncExcelContext {
    param([string]$Root, [string]$RunDirectory, [string[]]$Conflicts, [string]$Updater)
    $books = @{}
    $private = Join-Path $RunDirectory 'native-excel'
    [void][IO.Directory]::CreateDirectory($private)
    foreach ($relative in $Conflicts) {
        if ($relative -notmatch '^config/Excel/[^/\\]+\.xlsx$') { continue }
        $absolute = Assert-SyncExcelPath -Root $Root -Path (Join-Path $Root $relative)
        $backup = Join-Path $private ([guid]::NewGuid().ToString('N') + '.xlsx')
        $inputStream = $null; $backupStream = $null
        try {
            $inputStream = [IO.File]::Open($absolute, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
            $backupStream = [IO.File]::Open($backup, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $inputStream.CopyTo($backupStream)
        } finally {
            if ($backupStream) { $backupStream.Dispose() }
            if ($inputStream) { $inputStream.Dispose() }
        }
        $books[$relative] = @{ Path = $absolute; Hash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash; Backup = $backup; Bytes = [IO.File]::ReadAllBytes($backup) }
    }
    $trustedUpdater = $null
    if ($books.Count) {
        # Snapshot the approved implementation BEFORE launching the writable sandbox.
        # Execute the captured in-memory block, never re-read sandbox-writable code.
        $trustedUpdater = [ScriptBlock]::Create([IO.File]::ReadAllText($Updater))
        Copy-Item -LiteralPath $Updater -Destination (Join-Path $private 'excel-update-sheets.ps1')
    }
    $plansRelative = 'logs/sync-excel-plans/' + (Split-Path $RunDirectory -Leaf)
    $plans = Join-Path $Root $plansRelative
    [void][IO.Directory]::CreateDirectory($plans)
    [PSCustomObject]@{ Root = $Root; Books = $books; Private = $private; Plans = $plans; PlansRelative = $plansRelative; Updater = $trustedUpdater }
}

function Test-SyncExcelNormalOpen {
    param([string]$Path)
    $excel = $null; $book = $null
    # Short, unique verification paths avoid Excel's legacy path-length restrictions
    # and any recovery state associated with an earlier attempt at the same name.
    $verificationCopy = Join-Path ([IO.Path]::GetTempPath()) ('sx-' + [guid]::NewGuid().ToString('N') + '.xlsx')
    Copy-Item -LiteralPath $Path -Destination $verificationCopy
    try {
        $excel = New-Object -ComObject Excel.Application
        $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.EnableEvents = $false; $excel.AutomationSecurity = 3
        # The OM default CorruptLoad=xlNormalLoad (0) does not attempt recovery.
        # https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.open
        # RepairMode is not a supported Workbook property; do not treat null as proof.
        $book = $excel.Workbooks.Open($verificationCopy, 0, $true)
        if (-not $book.Saved) { throw 'Excel normal reopening requires saving.' }
        $sheets = @()
        foreach ($sheet in $book.Worksheets) {
            $sheets += @{ name = $sheet.Name; rows = $sheet.UsedRange.Rows.Count; columns = $sheet.UsedRange.Columns.Count; shapes = $sheet.Shapes.Count }
        }
        [PSCustomObject]@{ version = [string]$excel.Version; normal_open = $true; corrupt_load = 0; sheets = $sheets }
    } finally {
        if ($book) { $book.Close($false); $book = $null }
        $sheet = $null
        if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
        [GC]::Collect(); [GC]::WaitForPendingFinalizers()
        if (Test-Path -LiteralPath $verificationCopy) { Remove-Item -LiteralPath $verificationCopy }
    }
}

function Invoke-SyncExcelHandoff {
    param($Context, [object[]]$Requests)
    if (-not $Requests.Count -or $Requests.Count -ne $Context.Books.Count) { throw 'Excel handoff must cover every originally conflicted workbook exactly once.' }
    $seen = @{}; $prepared = @()
    foreach ($request in $Requests) {
        $relative = [string]$request.workbook
        if (-not $Context.Books.ContainsKey($relative) -or $seen.ContainsKey($relative)) { throw 'Excel workbook was not originally authorized or was requested twice.' }
        $seen[$relative] = $true
        $entry = $Context.Books[$relative]
        [void](Assert-SyncExcelPath -Root $Context.Root -Path $entry.Path)
        if ((Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash -ne $entry.Hash) { throw "Excel source changed during planning: $relative" }
        $dataRelative = [string]$request.data_file
        if ([IO.Path]::IsPathRooted($dataRelative) -or $dataRelative -match '(^|[\\/])\.\.([\\/]|$)' -or $dataRelative -notmatch '\.json$') { throw 'Excel data_file must be a relative JSON plan.' }
        $dataPath = Assert-SyncExcelPath -Root $Context.Plans -Path (Join-Path $Context.Root $dataRelative)
        if ((Get-Item -LiteralPath $dataPath).Length -gt 20MB) { throw 'Excel plan exceeds the size limit.' }
        $text = [IO.File]::ReadAllText($dataPath)
        $data = $text | ConvertFrom-Json
        if (-not @($data.sheets).Count) { throw 'Excel plan has no sheets.' }
        foreach ($sheet in $data.sheets) {
            if (-not $sheet.name -or -not @($sheet.rows).Count -or @($sheet.rows).Count -gt 100000) { throw 'Invalid Excel sheet or row count.' }
            foreach ($row in $sheet.rows) {
                if ($row -isnot [Array] -or $row.Count -gt 256) { throw 'Excel rows must be bounded arrays of cell values.' }
                foreach ($cell in $row) {
                    if ($null -ne $cell -and $cell -isnot [string] -and $cell -isnot [ValueType]) { throw 'Excel cells must be scalar values.' }
                }
            }
        }
        $privateData = Join-Path $Context.Private ([guid]::NewGuid().ToString('N') + '.json')
        [IO.File]::WriteAllText($privateData, $text, (New-Object Text.UTF8Encoding($false)))
        $prepared += @{ Relative = $relative; Entry = $entry; Data = $privateData }
    }
    $receipts = @(); $validated = @()
    foreach ($p in $prepared) {
        [void](Assert-SyncExcelPath -Root $Context.Root -Path $p.Entry.Path)
        if ((Get-FileHash -LiteralPath $p.Entry.Path -Algorithm SHA256).Hash -ne $p.Entry.Hash) { throw 'Excel source changed before native update.' }
        # Update a private candidate; even failed native validation leaves the real source intact.
        $candidate = Join-Path $Context.Private ([guid]::NewGuid().ToString('N') + '.xlsx')
        Copy-Item -LiteralPath $p.Entry.Path -Destination $candidate
        # The existing updater intentionally accepts absent optional JSON properties.
        # Keep its standalone semantics without relaxing the controller's strict mode.
        & {
            param($UpdaterScript, $PlanPath, $CandidatePath)
            Set-StrictMode -Off
            & $UpdaterScript -DataPath $PlanPath -WorkbookPath $CandidatePath
        } $Context.Updater $p.Data $candidate | Out-Host
        $verified = Test-SyncExcelNormalOpen -Path $candidate
        $validated += @{ Plan = $p; Candidate = $candidate; Verification = $verified }
    }
    # Validate ALL candidates and source hashes before replacing any real workbook.
    foreach ($v in $validated) {
        $p = $v.Plan
        [void](Assert-SyncExcelPath -Root $Context.Root -Path $p.Entry.Path)
        if ((Get-FileHash -LiteralPath $p.Entry.Path -Algorithm SHA256).Hash -ne $p.Entry.Hash) { throw 'Excel source changed while the candidate was being verified.' }
    }
    $locked = @(); $writing = $false
    try {
        # Pin every original before replacing any, closing the final user-save race.
        foreach ($v in $validated) {
            $p = $v.Plan
            [void](Assert-SyncExcelPath -Root $Context.Root -Path $p.Entry.Path)
            $stream = [IO.File]::Open($p.Entry.Path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
            $locked += @{ Stream = $stream; Value = $v }
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $actual = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') } finally { $sha.Dispose() }
            if ($actual -ne $p.Entry.Hash) { throw 'Excel source changed before replacement.' }
        }
        $writing = $true
        foreach ($lock in $locked) {
            $v = $lock.Value; $p = $v.Plan; $bytes = [IO.File]::ReadAllBytes($v.Candidate)
            $lock.Stream.Position = 0; $lock.Stream.SetLength($bytes.Length); $lock.Stream.Write($bytes, 0, $bytes.Length); $lock.Stream.Flush()
            $receipts += [PSCustomObject]@{ workbook = $p.Relative; sha256 = (Get-FileHash -LiteralPath $v.Candidate -Algorithm SHA256).Hash; verification = $v.Verification }
        }
    } catch {
        if ($writing) {
            foreach ($lock in $locked) {
                $bytes = $lock.Value.Plan.Entry.Bytes
                $lock.Stream.Position = 0; $lock.Stream.SetLength($bytes.Length); $lock.Stream.Write($bytes, 0, $bytes.Length); $lock.Stream.Flush()
            }
        }
        throw
    } finally { foreach ($lock in $locked) { $lock.Stream.Dispose() } }
    return $receipts
}
