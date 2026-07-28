[CmdletBinding()]
param(
    [string]$RepositoryPath,
    [ValidateNotNullOrEmpty()]
    [string]$Remote = 'origin',
    [switch]$ValidateOnly
)

# Usage:
#   powershell -ExecutionPolicy Bypass -File .\tools\sync_ai_worktrees.ps1 -ValidateOnly
#   powershell -ExecutionPolicy Bypass -File .\tools\sync_ai_worktrees.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($Host.Name -eq 'ConsoleHost') {
    $Host.UI.RawUI.WindowTitle = 'Idle RPG - 同步 AI Worktree'
}

if ([string]::IsNullOrWhiteSpace($RepositoryPath)) {
    $RepositoryPath = Split-Path -Parent $PSScriptRoot
}

$developBranch = 'develop'
$agentBranches = @(
    'ai/antigravity',
    'ai/claude',
    'ai/codex'
)

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Worktree,
        [Parameter(Mandatory = $true)]
        [string[]]$GitArguments
    )

    Write-Host ('git -C "{0}" {1}' -f $Worktree, ($GitArguments -join ' ')) -ForegroundColor DarkGray
    & git -C $Worktree @GitArguments
    if ($LASTEXITCODE -ne 0) {
        throw ('Git 指令執行失敗（結束碼 {0}）：git -C "{1}" {2}' -f $LASTEXITCODE, $Worktree, ($GitArguments -join ' '))
    }
}

function Get-GitText {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Worktree,
        [Parameter(Mandatory = $true)]
        [string[]]$GitArguments
    )

    $output = & git -C $Worktree @GitArguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ('Git 指令執行失敗（結束碼 {0}）：git -C "{1}" {2}`n{3}' -f
            $LASTEXITCODE, $Worktree, ($GitArguments -join ' '), ($output -join "`n"))
    }
    return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}

function Get-WorktreeMap {
    param([string]$AnyWorktree)

    $porcelain = Get-GitText -Worktree $AnyWorktree -GitArguments @('worktree', 'list', '--porcelain')
    $map = @{}
    $path = $null
    $branch = $null

    foreach ($line in @(($porcelain -split "\r?\n")) + @('')) {
        if ($line -match '^worktree (.+)$') {
            $path = $Matches[1]
        } elseif ($line -match '^branch refs/heads/(.+)$') {
            $branch = $Matches[1]
        } elseif ([string]::IsNullOrWhiteSpace($line)) {
            if ($path -and $branch) {
                if ($map.ContainsKey($branch)) {
                    throw "分支 $branch 同時簽出於多個 Worktree。"
                }
                $map[$branch] = $path
            }
            $path = $null
            $branch = $null
        }
    }

    return $map
}

function Assert-CleanWorktree {
    param(
        [string]$Worktree,
        [string]$ExpectedBranch
    )

    $actualBranch = Get-GitText -Worktree $Worktree -GitArguments @('branch', '--show-current')
    if ($actualBranch -ne $ExpectedBranch) {
        throw "$Worktree 的分支不正確。應為 $ExpectedBranch，目前為 $actualBranch。"
    }

    $status = Get-GitText -Worktree $Worktree -GitArguments @('status', '--porcelain=v1', '--untracked-files=normal')
    if ($status) {
        throw "Worktree 尚有未提交變更。請先提交或處理下列內容：`n$Worktree`n$status"
    }
}

try {
    $repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
    $worktrees = Get-WorktreeMap -AnyWorktree $repository
    $requiredBranches = @($developBranch) + $agentBranches

    Write-Step '探索必要的 Worktree'
    foreach ($branch in $requiredBranches) {
        if (-not $worktrees.ContainsKey($branch)) {
            throw "找不到已簽出 $branch 的 Worktree。請檢查 git worktree list。"
        }
        Write-Host ('[找到] {0} -> {1}' -f $branch, $worktrees[$branch]) -ForegroundColor Green
    }

    Write-Step '檢查分支與工作區狀態'
    foreach ($branch in $requiredBranches) {
        Assert-CleanWorktree -Worktree $worktrees[$branch] -ExpectedBranch $branch
        Write-Host ('[正常] {0}' -f $branch) -ForegroundColor Green
    }

    $developWorktree = $worktrees[$developBranch]
    $remoteUrl = Get-GitText -Worktree $developWorktree -GitArguments @('remote', 'get-url', $Remote)
    Write-Host ('遠端：{0}（{1}）' -f $Remote, $remoteUrl)

    if ($ValidateOnly) {
        Write-Step '預檢完成；未執行 pull、push 或 merge'
        return
    }

    Write-Step "更新遠端 $Remote"
    Invoke-Git -Worktree $developWorktree -GitArguments @('fetch', '--prune', $Remote)

    Write-Step 'Fast-forward 並推送所有 AI 分支'
    $pushedHeads = @{}
    foreach ($branch in $agentBranches) {
        $worktree = $worktrees[$branch]
        Invoke-Git -Worktree $worktree -GitArguments @('pull', '--ff-only', $Remote, $branch)
        Invoke-Git -Worktree $worktree -GitArguments @('push', $Remote, "${branch}:${branch}")
        $pushedHeads[$branch] = Get-GitText -Worktree $worktree -GitArguments @('rev-parse', 'HEAD')
    }

    Invoke-Git -Worktree $developWorktree -GitArguments @('fetch', '--prune', $Remote)
    foreach ($branch in $agentBranches) {
        $remoteHead = Get-GitText -Worktree $developWorktree -GitArguments @('rev-parse', "$Remote/$branch")
        if ($remoteHead -ne $pushedHeads[$branch]) {
            throw "$Remote/$branch 在推送後又有新變更。為保護並行工作，已停止同步。"
        }
    }

    Write-Step '在 develop Worktree 合併所有 AI 分支'
    Invoke-Git -Worktree $developWorktree -GitArguments @('pull', '--ff-only', $Remote, $developBranch)
    foreach ($branch in $agentBranches) {
        Invoke-Git -Worktree $developWorktree -GitArguments @(
            'merge',
            '--no-ff',
            "$Remote/$branch",
            '-m',
            "merge: integrate $branch"
        )
    }

    Assert-CleanWorktree -Worktree $developWorktree -ExpectedBranch $developBranch
    Invoke-Git -Worktree $developWorktree -GitArguments @('push', $Remote, "${developBranch}:${developBranch}")
    Invoke-Git -Worktree $developWorktree -GitArguments @('fetch', '--prune', $Remote)

    Write-Step '將 develop fast-forward 回所有 AI 分支並推送'
    foreach ($branch in $agentBranches) {
        $worktree = $worktrees[$branch]
        Assert-CleanWorktree -Worktree $worktree -ExpectedBranch $branch

        $currentHead = Get-GitText -Worktree $worktree -GitArguments @('rev-parse', 'HEAD')
        if ($currentHead -ne $pushedHeads[$branch]) {
            throw "$branch 在整合期間收到新的 commit。為保護並行工作，已停止同步。"
        }

        Invoke-Git -Worktree $worktree -GitArguments @('merge', '--ff-only', "$Remote/$developBranch")
        Invoke-Git -Worktree $worktree -GitArguments @('push', $Remote, "${branch}:${branch}")
    }

    Write-Step '同步完成'
    $finalHead = Get-GitText -Worktree $developWorktree -GitArguments @('rev-parse', '--short', 'HEAD')
    Write-Host "develop 與所有 AI 分支目前都指向 $finalHead。" -ForegroundColor Green
} catch {
    Write-Host "`n同步已停止：" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host '未自動執行 reset 或 merge --abort。請檢查上方最後顯示的 Worktree。' -ForegroundColor Yellow
    exit 1
}
