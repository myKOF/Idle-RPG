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
        throw ('Git command failed (exit {0}): git -C "{1}" {2}' -f $LASTEXITCODE, $Worktree, ($GitArguments -join ' '))
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
        throw ('Git command failed (exit {0}): git -C "{1}" {2}`n{3}' -f
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
                    throw "Branch $branch is checked out in multiple worktrees."
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
        throw "Wrong branch in $Worktree. Expected $ExpectedBranch, found $actualBranch."
    }

    $status = Get-GitText -Worktree $Worktree -GitArguments @('status', '--porcelain=v1', '--untracked-files=normal')
    if ($status) {
        throw "Worktree is not clean. Commit or resolve these changes first:`n$Worktree`n$status"
    }
}

try {
    $repository = (Resolve-Path -LiteralPath $RepositoryPath).Path
    $worktrees = Get-WorktreeMap -AnyWorktree $repository
    $requiredBranches = @($developBranch) + $agentBranches

    Write-Step 'Discover required worktrees'
    foreach ($branch in $requiredBranches) {
        if (-not $worktrees.ContainsKey($branch)) {
            throw "No worktree is checked out for $branch. Check git worktree list."
        }
        Write-Host ('[FOUND] {0} -> {1}' -f $branch, $worktrees[$branch]) -ForegroundColor Green
    }

    Write-Step 'Validate branches and clean status'
    foreach ($branch in $requiredBranches) {
        Assert-CleanWorktree -Worktree $worktrees[$branch] -ExpectedBranch $branch
        Write-Host ('[OK] {0}' -f $branch) -ForegroundColor Green
    }

    $developWorktree = $worktrees[$developBranch]
    $remoteUrl = Get-GitText -Worktree $developWorktree -GitArguments @('remote', 'get-url', $Remote)
    Write-Host ('Remote: {0} ({1})' -f $Remote, $remoteUrl)

    if ($ValidateOnly) {
        Write-Step 'Validation complete; no pull, push, or merge was run'
        return
    }

    Write-Step "Fetch $Remote"
    Invoke-Git -Worktree $developWorktree -GitArguments @('fetch', '--prune', $Remote)

    Write-Step 'Fast-forward and push all AI branches'
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
            throw "$Remote/$branch changed after it was pushed. Stopping to protect concurrent work."
        }
    }

    Write-Step 'Merge all AI branches in the develop worktree'
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

    Write-Step 'Fast-forward develop back into all AI branches and push'
    foreach ($branch in $agentBranches) {
        $worktree = $worktrees[$branch]
        Assert-CleanWorktree -Worktree $worktree -ExpectedBranch $branch

        $currentHead = Get-GitText -Worktree $worktree -GitArguments @('rev-parse', 'HEAD')
        if ($currentHead -ne $pushedHeads[$branch]) {
            throw "$branch received a new commit during integration. Stopping to protect concurrent work."
        }

        Invoke-Git -Worktree $worktree -GitArguments @('merge', '--ff-only', "$Remote/$developBranch")
        Invoke-Git -Worktree $worktree -GitArguments @('push', $Remote, "${branch}:${branch}")
    }

    Write-Step 'Completed'
    $finalHead = Get-GitText -Worktree $developWorktree -GitArguments @('rev-parse', '--short', 'HEAD')
    Write-Host "develop and all AI branches now point to $finalHead." -ForegroundColor Green
} catch {
    Write-Host "`nSync stopped:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host 'No automatic reset or merge --abort was run. Inspect the last worktree shown above.' -ForegroundColor Yellow
    exit 1
}
