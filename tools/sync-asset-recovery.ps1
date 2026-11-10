# Back up ONLY untracked files shadowing newly tracked upstream assets.
# Files are moved into Git metadata, never deleted, staged or overwritten.
function Get-SyncAssetGit {
    param([string]$Worktree, [string[]]$Arguments, [switch]$AllowFailure)
    $preference = $ErrorActionPreference; $encoding = [Console]::OutputEncoding
    try {
        $ErrorActionPreference = 'Continue'
        [Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
        $output = @(& git -C $Worktree @Arguments 2>&1)
        $code = $LASTEXITCODE
        $value = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        if ($code -ne 0 -and -not $AllowFailure) { throw "Asset Git failed ($code): $value" }
        if ($AllowFailure) { return [pscustomobject]@{ Code = $code; Text = $value } }
        return $value
    } finally { $ErrorActionPreference = $preference; [Console]::OutputEncoding = $encoding }
}

function Assert-SyncAssetPath {
    param([string]$Root, [string]$Relative)
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '[:\\\x00]' -or
        $Relative -match '(^|/)(\.{1,2}|\.git)(/|$)' -or $Relative -match '(^|/)([^/]*[ .])(/|$)' -or
        [string]::IsNullOrWhiteSpace($Relative)) { throw 'Unsafe asset recovery path.' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $full.StartsWith($Root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Asset path escapes its root.' }
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked asset path: $cursor" }
        }
        if ($cursor -eq $Root) { break }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
    return $full
}

function Get-SyncAssetHash {
    param([string]$Path)
    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

function Save-SyncAssetRecord {
    param([string]$Path, $Record)
    $parent = [IO.Path]::GetDirectoryName($Path)
    foreach ($name in @([IO.Path]::GetFileName($Path), ([IO.Path]::GetFileName($Path) + '.new'), ([IO.Path]::GetFileName($Path) + '.previous'))) {
        [void](Assert-SyncAssetPath $parent $name)
    }
    $temp = $Path + '.new'
    [IO.File]::WriteAllText($temp, ($Record | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temp, $Path, ($Path + '.previous')) }
    else { [IO.File]::Move($temp, $Path) }
}

function Invoke-SyncAssetResidualRecovery {
    param([string]$Worktree, [string]$Target, [switch]$Disabled)
    $root = [IO.Path]::GetFullPath($Worktree).TrimEnd('\')
    $gitDirectory = (Get-SyncAssetGit $root @('rev-parse', '--absolute-git-dir')).Trim()
    $gitDirectory = [IO.Path]::GetFullPath($gitDirectory)
    $directory = Assert-SyncAssetPath $gitDirectory 'sync-asset-recovery'
    $pending = Assert-SyncAssetPath $gitDirectory 'sync-asset-recovery/pending.json'
    if ($Disabled) {
        if (Test-Path -LiteralPath $pending) { throw "Pending asset backup; recovery disabled: $pending" }
        return 'none'
    }
    if ($env:GIT_INDEX_FILE) { throw 'Asset recovery refuses an external GIT_INDEX_FILE.' }
    $top = [IO.Path]::GetFullPath((Get-SyncAssetGit $root @('rev-parse', '--show-toplevel')).Trim())
    if ($top -ne $root) { throw 'Asset root is not the repository root.' }
    [void](Assert-SyncAssetPath $root '.recovery-path-check')
    foreach ($name in @('index.lock', 'HEAD.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer')) {
        $path = (Get-SyncAssetGit $root @('rev-parse', '--path-format=absolute', '--git-path', $name)).Trim()
        if (Test-Path -LiteralPath $path) { throw "Asset Git operation/lock active: $path" }
    }
    $head = (Get-SyncAssetGit $root @('rev-parse', 'HEAD')).Trim()
    $branch = (Get-SyncAssetGit $root @('symbolic-ref', 'HEAD')).Trim()
    if ($Target -notmatch '^[a-f0-9]{40,64}$') { throw 'Invalid pinned upstream commit.' }
    $ancestor = Get-SyncAssetGit $root @('merge-base', '--is-ancestor', $head, $Target) -AllowFailure
    if ($ancestor.Code -ne 0) {
        if (Test-Path -LiteralPath $pending) { throw "Asset history changed during backup: $pending" }
        return 'none'
    }
    $sparse = Get-SyncAssetGit $root @('config', '--bool', 'core.sparseCheckout') -AllowFailure
    $flags = Get-SyncAssetGit $root @('ls-files', '-v', '-z')
    if ($sparse.Text.Trim() -eq 'true' -or @($flags.Split([char]0) | Where-Object { $_ -cmatch '^[a-zS] ' }).Count) { throw 'Sparse/hidden index entries prevent asset recovery.' }
    # Includes staged changes, conflicts and unstaged tracked changes.
    if ((Get-SyncAssetGit $root @('status', '--porcelain=v1', '--untracked-files=no')).Length) {
        if (Test-Path -LiteralPath $pending) { throw "Tracked assets changed during backup: $pending" }
        return 'none'
    }
    $tree = New-Object 'Collections.Generic.Dictionary[string,string]' ([StringComparer]::Ordinal)
    foreach ($entry in (Get-SyncAssetGit $root @('ls-tree', '-r', '-z', '--full-tree', $Target)).Split([char]0)) {
        if ($entry -match '^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$') { $tree.Add($Matches[3], $Matches[2]) }
    }
    $untracked = @((Get-SyncAssetGit $root @('ls-files', '--others', '--exclude-standard', '-z')).Split([char]0) | Where-Object { $_.Length })
    $tracked = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in (Get-SyncAssetGit $root @('ls-files', '--cached', '-z')).Split([char]0)) { if ($path.Length) { [void]$tracked.Add($path) } }
    $ignored = @((Get-SyncAssetGit $root @('ls-files', '--others', '--ignored', '--exclude-standard', '-z')).Split([char]0) | Where-Object { $_.Length })
    foreach ($path in $ignored) { if ($tree.ContainsKey($path)) { throw 'Ignored file overlaps incoming assets; preserved without recovery.' } }
    $resume = Test-Path -LiteralPath $pending
    if (-not $resume -and -not $untracked.Count) { return 'none' }
    # Do not sweep unrelated new artwork out of an active shared asset repository.
    foreach ($path in $untracked) {
        if (-not $tree.ContainsKey($path)) {
            if ($resume) { throw 'New unrelated asset appeared during pending backup.' }
            return 'none'
        }
    }
    [void][IO.Directory]::CreateDirectory($directory)
    $guardPath = Assert-SyncAssetPath $directory 'controller.lock'
    $guard = [IO.File]::Open($guardPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ($resume) {
            $record = Get-Content -LiteralPath $pending -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($record.Root -ne $root -or $record.Head -ne $head -or $record.Target -ne $Target -or $record.Branch -ne $branch -or $record.Id -notmatch '^\d{8}-\d{6}-[a-f0-9]{32}$') { throw "Asset backup identity changed: $pending" }
        } else {
            $items = @()
            foreach ($path in $untracked) {
                $source = Assert-SyncAssetPath $root $path
                $items += [pscustomobject]@{ Path = $path; Hash = (Get-SyncAssetHash $source); IncomingBlob = $tree[$path] }
            }
            $record = [pscustomobject]@{ Root = $root; Head = $head; Target = $Target; Branch = $branch; Id = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'); State = 'prepared'; Files = $items }
        }
        $backup = Assert-SyncAssetPath $directory $record.Id
        [void][IO.Directory]::CreateDirectory($backup)
        $recordPath = Join-Path $backup 'record.json'
        $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        if (-not @($record.Files).Count) { throw 'Empty asset backup record.' }
        # Validate the entire plan and all existing backups BEFORE moving any file.
        foreach ($file in $record.Files) {
            if (-not $seen.Add([string]$file.Path) -or $tracked.Contains([string]$file.Path) -or $file.Hash -notmatch '^[A-F0-9]{64}$' -or -not $tree.ContainsKey($file.Path) -or $tree[$file.Path] -ne $file.IncomingBlob) { throw 'Invalid asset backup receipt.' }
            $source = Assert-SyncAssetPath $root $file.Path
            $dest = Assert-SyncAssetPath $backup ('files/' + $file.Path)
            $saved = Test-Path -LiteralPath $dest
            if ($saved -and (Test-Path -LiteralPath $source)) { throw "New local file appeared after backup: $source" }
            $current = if ($saved) { $dest } else { $source }
            if ((Get-SyncAssetHash $current) -ne $file.Hash) { throw "Asset/backup changed: $current" }
        }
        foreach ($path in $untracked) { if (-not $seen.Contains($path)) { throw 'New untracked asset appeared during backup.' } }
        Save-SyncAssetRecord $recordPath $record
        if (-not $resume) { Save-SyncAssetRecord $pending $record }
        $index = (Get-SyncAssetGit $root @('rev-parse', '--path-format=absolute', '--git-path', 'index')).Trim()
        $indexHash = Get-SyncAssetHash $index
        Write-Host "[素材備份] $backup" -ForegroundColor Yellow
        foreach ($file in $record.Files) {
            $source = Assert-SyncAssetPath $root $file.Path
            $dest = Assert-SyncAssetPath $backup ('files/' + $file.Path)
            if (Test-Path -LiteralPath $dest) { continue }
            if ((Get-SyncAssetHash $index) -ne $indexHash -or (Get-SyncAssetHash $source) -ne $file.Hash) { throw 'Asset source/index changed before backup.' }
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))
            [void](Assert-SyncAssetPath $backup ('files/' + $file.Path))
            Move-Item -LiteralPath $source -Destination $dest -ErrorAction Stop
            if ((Get-SyncAssetHash $dest) -ne $file.Hash) { throw "Moved asset hash mismatch: $dest" }
        }
        if ((Get-SyncAssetHash $index) -ne $indexHash -or (Get-SyncAssetGit $root @('rev-parse', 'HEAD')).Trim() -ne $head -or
            (Get-SyncAssetGit $root @('symbolic-ref', 'HEAD')).Trim() -ne $branch -or
            (Get-SyncAssetGit $root @('status', '--porcelain=v1', '--untracked-files=all')).Length) { throw 'Asset repository changed during backup; retained receipt.' }
        $record.State = 'backed-up'
        Save-SyncAssetRecord $recordPath $record
        Remove-Item -LiteralPath $pending -ErrorAction Stop
        Write-Host "[素材備份完成] $(@($record.Files).Count) 個殘留檔案已保留，接續 fast-forward：$Target" -ForegroundColor Green
        return 'recovered'
    } finally { $guard.Dispose() }
}
