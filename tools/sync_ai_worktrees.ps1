[CmdletBinding()]
param(
    [string]$RepositoryPath,
    [ValidateNotNullOrEmpty()]
    [string]$Remote = 'origin',
    [switch]$ValidateOnly,
    [switch]$SyncRemoteFirst,
    [switch]$SkipAssetLibrary
)

# Usage:
#   powershell -ExecutionPolicy Bypass -File .\tools\sync_ai_worktrees.ps1 -ValidateOnly
#   powershell -ExecutionPolicy Bypass -File .\tools\sync_ai_worktrees.ps1
#   sync_ai_worktrees.bat                         # 預設先同步所有必要的遠端分支
#   sync_ai_worktrees.bat -SkipAssetLibrary       # 只同步程式碼，不碰 VFX 素材庫

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

# ---- VFX 素材庫（Effects-Materials）----
#
# 那是另一個 Git 儲存庫：單一分支、沒有 Worktree，也不參與 develop 的合併。
# 與上面那套多 Worktree 整合完全無關，所以流程獨立：fetch → pull --rebase → push。
#
# 它的失敗不會中斷程式碼同步。理由很實際：素材庫是使用者持續丟新圖進去的地方，
# 工作區「有未提交變更」是常態而不是意外。讓它擋住三個 AI 分支的整合，等於
# 每次加了一張圖就不能同步程式碼。所以這裡只警告，最後再統一回報。

# 有些 git 指令本來就可能失敗（例如沒有 upstream 時的 rev-parse），
# 那不是錯誤而是答案。$ErrorActionPreference = 'Stop' 之下，原生指令的
# stderr 一旦被重導就會變成終止性錯誤，所以呼叫期間先降成 Continue。
function Get-GitTextSoft {
    param(
        [Parameter(Mandatory = $true)][string]$Worktree,
        [Parameter(Mandatory = $true)][string[]]$GitArguments
    )

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & git -C $Worktree @GitArguments 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
        return (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    } finally {
        $ErrorActionPreference = $previous
    }
}

# 與 Invoke-Git 同形，但回傳結束碼而不是丟例外。stderr 不重導，讓 git 的
# 進度訊息照常出現在畫面上——那正是使用者要看的同步紀錄。
function Invoke-GitSoft {
    param(
        [Parameter(Mandatory = $true)][string]$Worktree,
        [Parameter(Mandatory = $true)][string[]]$GitArguments
    )

    Write-Host ('git -C "{0}" {1}' -f $Worktree, ($GitArguments -join ' ')) -ForegroundColor DarkGray
    & git -C $Worktree @GitArguments
    return $LASTEXITCODE
}

# 路徑一律不寫死。素材庫在每台電腦上的位置不同，專案早就規定「絕對路徑只存在
# 於本機設定，絕不進入 Git」（見 tools/vfx/vfx-library-root.cjs 檔頭），
# 所以這裡呼叫同一支模組的 CLI，不在 PowerShell 裡再實作一次解析順序。
function Get-AssetLibraryRoot {
    param([string]$Repository)

    $module = Join-Path $Repository 'tools\vfx\vfx-library-root.cjs'
    if (-not (Test-Path -LiteralPath $module)) { return $null }

    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & node $module 2>$null
        if ($LASTEXITCODE -ne 0) { return $null }
    } finally {
        $ErrorActionPreference = $previous
    }
    $root = (($output | ForEach-Object { $_.ToString() }) -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($root)) { return $null }
    return $root
}

# 回傳 'synced' / 'skipped' / 'failed'。只有 'failed' 會影響最終結束碼。
function Sync-AssetLibrary {
    param(
        [string]$Repository,
        [switch]$ReadOnly
    )

    Write-Step '同步 VFX 素材庫'

    $root = Get-AssetLibraryRoot -Repository $Repository
    if (-not $root) {
        Write-Host '[略過] 本機沒有設定素材庫位置，或設定的路徑不存在。' -ForegroundColor Yellow
        Write-Host '       設定方式：node tools\vfx\vfx-library-root.cjs --help' -ForegroundColor DarkGray
        return 'skipped'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
        Write-Host ('[略過] {0} 不是 Git 儲存庫，沒有東西可以同步。' -f $root) -ForegroundColor Yellow
        return 'skipped'
    }
    Write-Host ('素材庫：{0}' -f $root)

    # 分支與遠端都問 git，不寫死 master／origin：換一個素材庫或改了分支名，
    # 寫死的那一份會安靜地同步到錯的地方。
    $branch = Get-GitTextSoft -Worktree $root -GitArguments @('branch', '--show-current')
    if ([string]::IsNullOrWhiteSpace($branch)) {
        Write-Host '[略過] 素材庫目前不在任何分支上（detached HEAD），不自動處理。' -ForegroundColor Yellow
        return 'skipped'
    }
    $upstream = Get-GitTextSoft -Worktree $root -GitArguments @(
        'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}')
    if ([string]::IsNullOrWhiteSpace($upstream)) {
        Write-Host ('[略過] 素材庫的 {0} 沒有設定 upstream，無法判斷要 pull／push 到哪裡。' -f $branch) -ForegroundColor Yellow
        return 'skipped'
    }
    Write-Host ('分支：{0} → {1}' -f $branch, $upstream)

    if ($ReadOnly) {
        Write-Host '[預檢] 未執行 fetch、pull 或 push。' -ForegroundColor Yellow
        return 'skipped'
    }

    if ((Invoke-GitSoft -Worktree $root -GitArguments @('fetch', '--prune')) -ne 0) {
        Write-Host '[失敗] 素材庫 fetch 失敗。' -ForegroundColor Red
        return 'failed'
    }

    # 有未提交變更就不 pull／push。rebase 會直接拒絕，而 push 半套上去只會讓
    # 下次更難收拾。這不是錯誤，是「這台電腦上還有沒整理完的素材」，
    # 所以只警告並把它留給使用者決定。
    $status = Get-GitTextSoft -Worktree $root -GitArguments @(
        'status', '--porcelain=v1', '--untracked-files=normal')
    if ($status) {
        Write-Host '[略過] 素材庫有未提交的變更，只做了 fetch，未 pull／push：' -ForegroundColor Yellow
        Write-Host $status -ForegroundColor DarkGray
        Write-Host '       請先在素材庫 commit（或清掉不要的檔案）再同步一次。' -ForegroundColor Yellow
        return 'skipped'
    }

    if ((Invoke-GitSoft -Worktree $root -GitArguments @('pull', '--rebase')) -ne 0) {
        Write-Host '[失敗] 素材庫 pull --rebase 失敗，未 push。請人工處理後再同步一次。' -ForegroundColor Red
        return 'failed'
    }
    if ((Invoke-GitSoft -Worktree $root -GitArguments @('push')) -ne 0) {
        Write-Host '[失敗] 素材庫 push 失敗。' -ForegroundColor Red
        return 'failed'
    }

    $head = Get-GitTextSoft -Worktree $root -GitArguments @('rev-parse', '--short', 'HEAD')
    Write-Host ('[完成] 素材庫 {0} 目前指向 {1}。' -f $branch, $head) -ForegroundColor Green
    return 'synced'
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

    # 素材庫先做。放在最前面而不是最後：程式碼那段是多 Worktree 的整合，任何一步
    # 失敗都會整個中止，擺在後面就等於「只要程式碼同步出事，素材庫永遠不會同步」。
    $assetLibraryResult = 'skipped'
    if ($SkipAssetLibrary) {
        Write-Step '略過 VFX 素材庫（-SkipAssetLibrary）'
    } else {
        $assetLibraryResult = Sync-AssetLibrary -Repository $repository -ReadOnly:$ValidateOnly
    }

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

    if ($SyncRemoteFirst) {
        Write-Step '先 Fetch 所有遠端分支'
        Invoke-Git -Worktree $developWorktree -GitArguments @('fetch', '--all', '--prune')

        Write-Step '先 Pull 所有必要分支（rebase）'
        foreach ($branch in $requiredBranches) {
            Invoke-Git -Worktree $worktrees[$branch] -GitArguments @('pull', '--rebase', $Remote, $branch)
        }
    }

    Write-Step "更新遠端 $Remote"
    Invoke-Git -Worktree $developWorktree -GitArguments @('fetch', '--prune', $Remote)

    Write-Step 'Fast-forward 並推送所有 AI 分支'
    $pushedHeads = @{}
    foreach ($branch in $agentBranches) {
        $worktree = $worktrees[$branch]
        # 同上：緊接在 fetch --prune 之後，用 merge 對遠端追蹤參照動作即可，
        # 不必再 pull 一次（同樣的 FETCH_HEAD 重複項會讓 --ff-only 直接 fatal）。
        Invoke-Git -Worktree $worktree -GitArguments @('merge', '--ff-only', "$Remote/$branch")
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
    # 用 merge 而不是 pull：上面幾行才剛 fetch --prune 過，遠端追蹤參照已經是最新的，
    # 這裡再 pull 只是多一次網路往返，而且會把結果押在 FETCH_HEAD 上。
    #
    # 實際踩過：pull 的 fetch 沒有覆蓋掉前一次 fetch --prune 寫進 FETCH_HEAD 的
    # develop 那一行，於是檔案裡出現兩筆同 SHA、同樣標記為 for-merge 的 develop，
    # git 回 "fatal: Cannot fast-forward to multiple branches." 而整個同步中止
    # （當下 develop 與 origin/develop 其實完全相同，0 ahead 0 behind，
    #   也就是說失敗的是一個本來就沒事要做的步驟）。
    # merge --ff-only 直接對 $Remote/$developBranch 動作，完全不碰 FETCH_HEAD，
    # 語意不變而且與下方「fast-forward 回各 AI 分支」那段一致。
    Invoke-Git -Worktree $developWorktree -GitArguments @('merge', '--ff-only', "$Remote/$developBranch")
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

    # 素材庫的失敗留到這裡才影響結束碼：程式碼已經整合完了，那是事實，
    # 不該因為另一個儲存庫出事就報成整體失敗；但也不能靜靜吞掉。
    if ($assetLibraryResult -eq 'failed') {
        Write-Host "`n注意：程式碼同步已完成，但 VFX 素材庫同步失敗（原因見上方）。" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "`n同步已停止：" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host '未自動執行 reset 或 merge --abort。請檢查上方最後顯示的 Worktree。' -ForegroundColor Yellow
    exit 1
}
