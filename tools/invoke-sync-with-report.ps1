[CmdletBinding()]
param(
    [string]$RepositoryPath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$SyncArguments
)

# Run the existing sync in a child process so even exit/parameter errors are logged.
# This wrapper only reads Git state; all Git mutations remain in the sync script.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = Split-Path -Parent $PSScriptRoot
}
$utf8 = New-Object Text.UTF8Encoding($false)
$started = [DateTimeOffset]::Now
$repository = [IO.Path]::GetFullPath($RepositoryPath)
$runName = 'sync-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$exitCode = 1

function Read-DiagnosticCommand {
    param([string]$Command, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $Command @Arguments 2>&1
        $code = $LASTEXITCODE
        $value = ($output | ForEach-Object { $_.ToString() }) -join "`n"
        if ($code -ne 0) { return "[exit $code] $value" }
        return $value
    } catch { return $_.Exception.Message }
    finally { $ErrorActionPreference = $previous }
}

function Read-DiagnosticGit {
    param([string]$Root, [string[]]$Arguments)
    return Read-DiagnosticCommand -Command 'git' -Arguments (@('-C', $Root) + $Arguments)
}

function Find-DiagnosticWorktrees {
    $map = @{}
    $root = $null
    $listing = Read-DiagnosticGit -Root $repository -Arguments @('worktree', 'list', '--porcelain')
    foreach ($line in ($listing -split "\r?\n")) {
        if ($line -match '^worktree (.+)$') { $root = $Matches[1] }
        elseif ($root -and $line -match '^branch refs/heads/(develop|ai/(antigravity|claude|codex))$') {
            $map[$Matches[1]] = $root
        }
    }
    return $map
}

function Find-ConflictAttempts {
    $map = Find-DiagnosticWorktrees
    if (-not $map.ContainsKey('develop')) { return }
    $gitDirectory = Read-DiagnosticGit -Root $map['develop'] -Arguments @('rev-parse', '--absolute-git-dir')
    $parent = Join-Path $gitDirectory 'sync-auto-conflicts'
    if (Test-Path -LiteralPath $parent -PathType Container) {
        Get-ChildItem -LiteralPath $parent -Directory | ForEach-Object { $_.FullName }
    }
}

function Add-ReportBlock {
    param([Text.StringBuilder]$Report, [string]$Title, [string]$Value)
    # A console log can contain Markdown fences, including model-generated code.
    $longest = 2
    foreach ($match in [regex]::Matches($Value, '`+')) { $longest = [Math]::Max($longest, $match.Length) }
    $fence = ('`' * ($longest + 1)) -join ''
    [void]$Report.AppendLine("`n## $Title`n")
    [void]$Report.AppendLine($fence + 'text')
    [void]$Report.AppendLine($Value)
    [void]$Report.AppendLine($fence)
}

try {
    $reportDirectory = Join-Path $repository 'logs\sync-ai-worktrees'
    [void][IO.Directory]::CreateDirectory($reportDirectory)
    $logPath = Join-Path $reportDirectory ($runName + '.log')
    $writer = New-Object IO.StreamWriter($logPath, $false, $utf8)
} catch {
    # A read-only/missing project folder must not prevent an error report.
    $reportDirectory = Join-Path ([IO.Path]::GetTempPath()) 'Idle-RPG-sync-reports'
    [void][IO.Directory]::CreateDirectory($reportDirectory)
    $logPath = Join-Path $reportDirectory ($runName + '.log')
    $writer = New-Object IO.StreamWriter($logPath, $false, $utf8)
}
$writer.AutoFlush = $true
$reportPath = Join-Path $reportDirectory ($runName + '.md')
$previousAttempts = @{}
$previousEncoding = [Console]::OutputEncoding
try {
    foreach ($attempt in @(Find-ConflictAttempts)) { $previousAttempts[$attempt] = $true }
    [Console]::OutputEncoding = $utf8
    $syncScript = Join-Path $PSScriptRoot 'sync_ai_worktrees.ps1'
    $childArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $syncScript, '-RepositoryPath', $repository) + @($SyncArguments)
    # Windows PowerShell maps redirected native stderr to ErrorRecord objects.
    # Keep it in the report without terminating on ordinary git progress output.
    $ErrorActionPreference = 'Continue'
    & (Join-Path $PSHOME 'powershell.exe') @childArguments 2>&1 | ForEach-Object {
        $line = $_.ToString()
        $writer.WriteLine($line)
        Write-Host $line
    }
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 1 }
} catch {
    $writer.WriteLine($_.ToString())
    Write-Host $_.ToString() -ForegroundColor Red
    $exitCode = 1
} finally {
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = $previousEncoding
    $writer.Dispose()
}

try {
    $finished = [DateTimeOffset]::Now
    $outcome = if ($exitCode -eq 0) { '成功' } else { '失敗／已停止' }
    $report = New-Object Text.StringBuilder
    [void]$report.AppendLine('# AI 工作區同步報告')
    [void]$report.AppendLine("`n- 結果：$outcome")
    [void]$report.AppendLine("- 結束碼：$exitCode")
    [void]$report.AppendLine('- 開始時間：' + $started.ToString('o'))
    [void]$report.AppendLine('- 結束時間：' + $finished.ToString('o'))
    [void]$report.AppendLine("- 執行工作區：$repository")
    [void]$report.AppendLine("- PowerShell：$($PSVersionTable.PSVersion)")
    [void]$report.AppendLine("- 原始紀錄：$logPath")
    [void]$report.AppendLine("`n可直接將本檔傳給 Codex 排查。以下 Git 狀態為執行結束後的唯讀快照；是否完成各分支／素材庫同步，請以執行紀錄與個別狀態為準。")
    Add-ReportBlock -Report $report -Title '傳入參數' -Value ((@('-RepositoryPath', $repository) + @($SyncArguments)) | ConvertTo-Json -Compress)
    Add-ReportBlock -Report $report -Title '完整主控台輸出（stdout 與 stderr）' -Value ([IO.File]::ReadAllText($logPath, $utf8))
    Add-ReportBlock -Report $report -Title '工具版本' -Value ((Read-DiagnosticCommand -Command git -Arguments @('--version')) + "`n" + (Read-DiagnosticCommand -Command node -Arguments @('--version')))
    Add-ReportBlock -Report $report -Title 'Git Worktree 清單' -Value (Read-DiagnosticGit -Root $repository -Arguments @('worktree', 'list', '--porcelain'))
    $worktrees = Find-DiagnosticWorktrees
    $module = Join-Path $repository 'tools\vfx\vfx-library-root.cjs'
    if (Test-Path -LiteralPath $module -PathType Leaf) {
        $assetRoot = (Read-DiagnosticCommand -Command node -Arguments @($module)).Trim()
        if ($assetRoot -and -not $assetRoot.StartsWith('[exit ') -and
            (Test-Path -LiteralPath $assetRoot -PathType Container -ErrorAction SilentlyContinue)) { $worktrees['素材庫'] = $assetRoot }
    }
    foreach ($branch in @('develop', 'ai/antigravity', 'ai/claude', 'ai/codex', '素材庫')) {
        if (-not $worktrees.ContainsKey($branch)) { continue }
        $root = $worktrees[$branch]
        $state = "工作區：$root`n" + (Read-DiagnosticGit -Root $root -Arguments @('status', '--short', '--branch'))
        foreach ($ref in @('HEAD', '@{upstream}', 'MERGE_HEAD')) {
            $value = Read-DiagnosticGit -Root $root -Arguments @('rev-parse', '--verify', $ref)
            if ($ref -eq 'MERGE_HEAD' -and $value.StartsWith('[exit ')) { $value = '無待完成合併' }
            $state += "`n${ref}: $value"
        }
        $state += "`n未解衝突：`n" + (Read-DiagnosticGit -Root $root -Arguments @('-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=U'))
        Add-ReportBlock -Report $report -Title "$branch 狀態" -Value $state
    }
    foreach ($attempt in @(Find-ConflictAttempts)) {
        if ($previousAttempts.ContainsKey($attempt)) { continue }
        foreach ($name in @('parents.txt', 'conflicts.txt', 'result.json')) {
            $file = Join-Path $attempt $name
            if (Test-Path -LiteralPath $file -PathType Leaf) {
                Add-ReportBlock -Report $report -Title "本輪自動解衝突：$attempt / $name" -Value ([IO.File]::ReadAllText($file))
            }
        }
    }
    [IO.File]::WriteAllText($reportPath, $report.ToString(), $utf8)
    Write-Host "`n同步報告（可直接傳給 Codex）：$reportPath" -ForegroundColor Cyan
    $latest = Join-Path $reportDirectory 'latest.md'
    [IO.File]::WriteAllText($latest, $report.ToString(), $utf8)
    Write-Host "最新報告：$latest" -ForegroundColor Cyan
} catch {
    # Preserve the sync exit code, and at least provide the full captured output.
    Write-Host "`n報告匯出未完成：$($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "已保存主控台紀錄：$logPath" -ForegroundColor Yellow
    if ($exitCode -eq 0) { $exitCode = 1 }
}
exit $exitCode
