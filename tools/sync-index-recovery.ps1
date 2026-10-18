# Dot-sourced by sync_ai_worktrees.ps1. All backups live in worktree Git metadata.
function Get-SyncIndexHash {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

function Get-SyncRecoveryDirectory {
    param([string]$Worktree)
    return [IO.Path]::GetFullPath((Join-Path (Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', '--absolute-git-dir')) 'sync-index-recovery'))
}

function Save-SyncRecoveryRecord {
    param([string]$Directory, $Record)
    $json = $Record | ConvertTo-Json -Depth 5
    $encoding = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText((Join-Path $Record.Backup 'record.json'), $json, $encoding)
    [IO.File]::WriteAllText((Join-Path $Directory 'pending.json'), $json, $encoding)
}

function Open-SyncRecoveryGuard {
    param([string]$Directory)
    [void][IO.Directory]::CreateDirectory($Directory)
    return [IO.File]::Open((Join-Path $Directory 'controller.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
}

function Get-SyncIndexFlags {
    param([string]$Worktree)
    $listing = Get-GitText -Worktree $Worktree -GitArguments @('ls-files', '-v', '-z')
    foreach ($entry in $listing.Split([char]0)) {
        if ($entry.Length -lt 3) { continue }
        $tag = $entry.Substring(0, 1)
        if ($tag -ceq 'S' -or $tag -ceq 's' -or $tag -cmatch '[a-z]') {
            [pscustomobject]@{ Path = $entry.Substring(2); Skip = $tag -in @('S', 's'); Assume = $tag -cmatch '[a-z]' }
        }
    }
}

function Assert-SyncRecoveryIdle {
    param([string]$Worktree)
    if ($env:GIT_INDEX_FILE) { throw '自動 index 修復不接受外部 GIT_INDEX_FILE；已保留現場。' }
    $arguments = @('rev-parse', '--path-format=absolute')
    foreach ($name in @('index.lock', 'HEAD.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer')) {
        $arguments += @('--git-path', $name)
    }
    foreach ($path in ((Get-GitText -Worktree $Worktree -GitArguments $arguments) -split "\r?\n")) {
        if (Test-Path -LiteralPath $path) { throw "偵測到 Git 操作或鎖定：$path；不自動刪除或中止。" }
    }
}

function Assert-SyncRecoveryIdentity {
    param([string]$Worktree, $Record)
    Assert-SyncRecoveryIdle -Worktree $Worktree
    if ((Get-GitText -Worktree $Worktree -GitArguments @('symbolic-ref', '--short', 'HEAD')) -ne $Record.Branch -or
        (Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', 'HEAD')) -ne $Record.Before -or
        (Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', $Record.Ref)) -ne $Record.Target) {
        throw 'index 修復的分支、原 HEAD 或目標已移動，保留現場。'
    }
    $index = Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', '--path-format=absolute', '--git-path', 'index')
    if ((Get-SyncIndexHash -Path $index) -ne $Record.IndexHash) {
        throw 'index 在同步失敗後有其他變更，不覆蓋新工作。'
    }
    $expectedIndex = if ($Record.State -eq 'index-restored') { $Record.Target } else { $Record.Before }
    & git -C $Worktree diff --cached --quiet $expectedIndex --
    if ($LASTEXITCODE -ne 0) { throw 'index 內容不符合已記錄的提交，保留暫存工作。' }
    & git -C $Worktree merge-base --is-ancestor $Record.Before $Record.Target
    if ($LASTEXITCODE -ne 0) { throw '修復目標不是 fast-forward，不自動處理。' }
}

function Repair-SyncIndex {
    param([string]$Worktree, [string]$Directory, $Record)
    Assert-SyncRecoveryIdentity -Worktree $Worktree -Record $Record
    if ((Get-GitTextSoft -Worktree $Worktree -GitArguments @('config', '--bool', 'core.sparseCheckout')) -eq 'true') {
        throw '稀疏簽出不在自動 index 修復範圍內；已保留備份。'
    }
    $flags = @(Get-SyncIndexFlags -Worktree $Worktree)
    $previousIndex = $env:GIT_INDEX_FILE
    $previousLocks = $env:GIT_OPTIONAL_LOCKS
    Write-Host "[index] 備份與完整比對：$($Record.Backup)" -ForegroundColor Cyan
    try {
        $env:GIT_INDEX_FILE = Join-Path $Record.Backup ('verify-' + [guid]::NewGuid().ToString('N') + '.index')
        $env:GIT_OPTIONAL_LOCKS = '0'
        # A fresh index forces content comparison instead of trusting old stat caches.
        $code = Invoke-GitSoft -Worktree $Worktree -GitArguments @('read-tree', $Record.Target)
        if ($code -ne 0) { throw '無法建立獨立驗證 index。' }
        foreach ($flag in @(Get-SyncIndexFlags -Worktree $Worktree)) {
            $code = Invoke-GitSoft -Worktree $Worktree -GitArguments @('update-index', '--no-skip-worktree', '--no-assume-unchanged', '--', $flag.Path)
            if ($code -ne 0) { throw '無法解除驗證 index 的隱藏旗標。' }
        }
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $differences = & git -C $Worktree -c core.fsmonitor=false -c core.ignorestat=false -c core.safecrlf=false diff --exit-code --no-ext-diff --no-textconv --name-status 2>&1
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        if ($code -ne 0) { throw "工作檔案尚未完整符合固定目標，或有額外修改；不修復：`n$($differences -join "`n")" }
        if (Get-GitText -Worktree $Worktree -GitArguments @('ls-files', '--others', '--exclude-standard')) {
            throw '工作區有目標提交之外的未追蹤檔案，不自動修復。'
        }
    } finally {
        $env:GIT_INDEX_FILE = $previousIndex
        $env:GIT_OPTIONAL_LOCKS = $previousLocks
    }
    Assert-SyncRecoveryIdentity -Worktree $Worktree -Record $Record
    # Only Git metadata changes. No checkout, reset, lock deletion, or history rewrite.
    $code = Invoke-GitSoft -Worktree $Worktree -GitArguments @('read-tree', $Record.Target)
    if ($code -ne 0) { throw 'index 仍無法寫入，保留備份與工作檔案。' }
    foreach ($flag in $flags) {
        if (-not (Get-GitTextSoft -Worktree $Worktree -GitArguments @('ls-files', '--error-unmatch', '--', $flag.Path))) { continue }
        if ($flag.Skip) {
            if ((Invoke-GitSoft -Worktree $Worktree -GitArguments @('update-index', '--skip-worktree', '--', $flag.Path)) -ne 0) { throw '無法還原 index 旗標。' }
        }
        if ($flag.Assume) {
            if ((Invoke-GitSoft -Worktree $Worktree -GitArguments @('update-index', '--assume-unchanged', '--', $flag.Path)) -ne 0) { throw '無法還原 index 旗標。' }
        }
    }
    $index = Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', '--path-format=absolute', '--git-path', 'index')
    $Record.IndexHash = Get-SyncIndexHash -Path $index
    $Record.State = 'index-restored'
    Save-SyncRecoveryRecord -Directory $Directory -Record $Record
    # Compare-and-swap prevents rewinding a concurrent commit made after validation.
    $code = Invoke-GitSoft -Worktree $Worktree -GitArguments @('update-ref', '-m', '[Codex] sync: 修復 index 並完成 fast-forward', "refs/heads/$($Record.Branch)", $Record.Target, $Record.Before)
    if ($code -ne 0) { throw '分支更新失敗，未回退或覆蓋其他提交；保留修復紀錄。' }
    Assert-CleanWorktree -Worktree $Worktree -ExpectedBranch $Record.Branch
    $Record.State = 'recovered'
    Save-SyncRecoveryRecord -Directory $Directory -Record $Record
    Remove-Item -LiteralPath (Join-Path $Directory 'pending.json')
    Write-Host "[index] 自動修復完成，繼續同步：$($Record.Target)" -ForegroundColor Green
}

function Resume-SyncIndexRecovery {
    param([string]$Worktree, [switch]$ReadOnly)
    $directory = Get-SyncRecoveryDirectory -Worktree $Worktree
    $pending = Join-Path $directory 'pending.json'
    if (-not (Test-Path -LiteralPath $pending -PathType Leaf)) { return }
    if ($ReadOnly -or $NoIndexRecovery) { throw "有待處理的 index 修復；預檢／停用模式保留現場：$pending" }
    $guard = Open-SyncRecoveryGuard -Directory $directory
    try {
        if (-not (Test-Path -LiteralPath $pending -PathType Leaf)) { return }
        $record = [IO.File]::ReadAllText($pending) | ConvertFrom-Json
        $backup = [IO.Path]::GetFullPath($record.Backup)
        if ($record.Branch -notmatch '^(develop|ai/(claude|codex|antigravity))$' -or
            $record.Before -notmatch '^[a-f0-9]{40,64}$' -or $record.Target -notmatch '^[a-f0-9]{40,64}$' -or
            -not $backup.StartsWith($directory.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath (Join-Path $backup 'index.before') -PathType Leaf)) {
            throw 'index 修復紀錄不完整，保留現場。'
        }
        if ($record.State -eq 'prepared') {
            # A normal FF may have finished just before the controller was interrupted.
            Assert-CleanWorktree -Worktree $Worktree -ExpectedBranch $record.Branch
            $head = Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', 'HEAD')
            if ($head -notin @($record.Before, $record.Target)) { throw '中斷後分支已移動，不猜測處理。' }
            Remove-Item -LiteralPath $pending
            return
        }
        if ($record.State -notin @('index-write-failed', 'index-restored', 'recovered')) { throw '未知 index 修復狀態，保留現場。' }
        if ($record.State -in @('index-restored', 'recovered') -and
            (Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', 'HEAD')) -eq $record.Target) {
            Assert-CleanWorktree -Worktree $Worktree -ExpectedBranch $record.Branch
            Remove-Item -LiteralPath $pending
            return
        }
        Write-Host "[index] 接續修復紀錄：$pending" -ForegroundColor Cyan
        Repair-SyncIndex -Worktree $Worktree -Directory $directory -Record $record
    } finally { $guard.Dispose() }
}

function Invoke-SyncFastForward {
    param([string]$Worktree, [string]$Ref)
    $heads = (Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', 'HEAD', $Ref)) -split "\r?\n"
    $before = $heads[0]; $target = $heads[1]
    if ($before -eq $target) { Write-Host 'Already up to date.'; return }
    & git -C $Worktree merge-base --is-ancestor $target $before
    if ($LASTEXITCODE -eq 0) {
        Write-Host 'Already up to date.'
        return
    }
    & git -C $Worktree merge-base --is-ancestor $before $target
    if ($LASTEXITCODE -ne 0) { throw "$Ref 無法 fast-forward，不自動改寫歷史。" }
    Assert-SyncRecoveryIdle -Worktree $Worktree
    $branch = Get-GitText -Worktree $Worktree -GitArguments @('symbolic-ref', '--short', 'HEAD')
    Assert-CleanWorktree -Worktree $Worktree -ExpectedBranch $branch
    $directory = Get-SyncRecoveryDirectory -Worktree $Worktree
    $guard = Open-SyncRecoveryGuard -Directory $directory
    try {
        if (Test-Path -LiteralPath (Join-Path $directory 'pending.json')) { throw '另一輪同步留下待修復 index，保留現場。' }
        $backup = Join-Path $directory ([guid]::NewGuid().ToString('N'))
        [void][IO.Directory]::CreateDirectory($backup)
        $index = Get-GitText -Worktree $Worktree -GitArguments @('rev-parse', '--path-format=absolute', '--git-path', 'index')
        Copy-Item -LiteralPath $index -Destination (Join-Path $backup 'index.before')
        $record = [pscustomobject]@{ Branch = $branch; Before = $before; Target = $target; Ref = $Ref; Backup = $backup; IndexHash = (Get-SyncIndexHash -Path $index); State = 'prepared' }
        Save-SyncRecoveryRecord -Directory $directory -Record $record
        $lines = New-Object 'Collections.Generic.List[string]'
        Write-Host ('git -C "{0}" merge --ff-only {1}' -f $Worktree, $target) -ForegroundColor DarkGray
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            & git -C $Worktree merge --ff-only $target 2>&1 | ForEach-Object {
                $line = $_.ToString(); $lines.Add($line); Write-Host $line
            }
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $previousPreference }
        $output = $lines -join "`n"
        [IO.File]::WriteAllText((Join-Path $backup 'git.log'), $output, (New-Object Text.UTF8Encoding($false)))
        if ($code -eq 0) {
            Assert-CleanWorktree -Worktree $Worktree -ExpectedBranch $branch
            Remove-Item -LiteralPath (Join-Path $directory 'pending.json')
            return
        }
        if ($output -notmatch '(?im)\bunable to write new index file\b') {
            Remove-Item -LiteralPath (Join-Path $directory 'pending.json')
            throw "Fast-forward 失敗（結束碼 $code），不是可接管的 index 寫入失敗：`n$output"
        }
        $record.State = 'index-write-failed'
        Save-SyncRecoveryRecord -Directory $directory -Record $record
        Write-Host "[index] 寫入失敗，修復備份：$backup" -ForegroundColor Cyan
        if ($NoIndexRecovery) { throw "index 寫入失敗，-NoIndexRecovery 已停用修復。備份：$backup" }
        Repair-SyncIndex -Worktree $Worktree -Directory $directory -Record $record
    } finally { $guard.Dispose() }
}
