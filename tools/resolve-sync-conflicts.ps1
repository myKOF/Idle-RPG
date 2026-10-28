[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$IncomingSha,
    [string]$CodexCommand = 'codex.cmd',
    [string]$AssetLibraryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'sync-codex-cli.ps1')
. (Join-Path $PSScriptRoot 'sync-excel-handoff.ps1')

function Read-Git {
    param([string[]]$Arguments)
    $result = & git -C $Worktree @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Git verification failed: $($Arguments -join ' ')" }
    return (($result | ForEach-Object { $_.ToString() }) -join "`n").Trim()
}

function Assert-MergeIdentity {
    if ((Read-Git -Arguments @('branch', '--show-current')) -ne 'develop' -or
        (Read-Git -Arguments @('rev-parse', 'HEAD')) -ne $originalHead -or
        (Read-Git -Arguments @('rev-parse', 'MERGE_HEAD')) -ne $IncomingSha) {
        throw 'The branch or merge parents changed. Stopping without committing.'
    }
}

function Stage-ReportedFiles {
    param([string]$Root, [object[]]$Files)
    foreach ($relativePath in $Files) {
        if ([string]::IsNullOrWhiteSpace($relativePath) -or [IO.Path]::IsPathRooted($relativePath) -or
            $relativePath -match '(^|[\\/])\.git([\\/]|$)' -or $relativePath -match '[\r\n\x00]') {
            throw 'Codex reported an invalid file path; merge preserved.'
        }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $Root $relativePath))
        if (-not $fullPath.StartsWith($Root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            (Test-Path -LiteralPath $fullPath -PathType Container)) { throw 'Reported path escapes the worktree or names a directory.' }
        if (-not (Test-Path -LiteralPath $fullPath)) {
            # Git already removes clean incoming deletions from the merge index.
            # Re-adding that absent path fails; accept only an exact staged deletion.
            & git --literal-pathspecs -C $Root diff --cached --quiet --no-renames --diff-filter=D -- $relativePath
            $deletionCheck = $LASTEXITCODE
            if ($deletionCheck -eq 1) { continue }
            if ($deletionCheck -ne 0) { throw "Could not verify reported deletion: $relativePath" }
        }
        & git --literal-pathspecs -C $Root add --all -- $relativePath
        if ($LASTEXITCODE -ne 0) { throw "Could not stage reported file: $relativePath" }
    }
}

function Repair-IncomingBlankEof {
    # The model sandbox protects agent instruction directories. The controller can
    # remove a purely mechanical Git whitespace error before starting the model,
    # but only from a staged file still identical to the incoming commit.
    $changed = Read-Git -Arguments @('diff', '--cached', '--name-only', '--diff-filter=AM', '-z')
    foreach ($relativePath in ($changed -split "`0")) {
        if (-not $relativePath -or [IO.Path]::IsPathRooted($relativePath) -or
            $relativePath -match '(^|[\\/])\.git([\\/]|$)') { continue }
        $fullPath = [IO.Path]::GetFullPath((Join-Path $Worktree $relativePath))
        if (-not $fullPath.StartsWith($Worktree.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $fullPath -PathType Leaf) -or
            ((Get-Item -LiteralPath $fullPath).Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
        $directory = (Get-Item -LiteralPath $fullPath).Directory
        $linkedParent = $false
        while ($directory -and $directory.FullName.Length -ge $Worktree.Length) {
            if ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) { $linkedParent = $true; break }
            $directory = $directory.Parent
        }
        if ($linkedParent) { continue }
        $incomingBlob = Read-Git -Arguments @('ls-tree', '--format=%(objectname)', $IncomingSha, '--', $relativePath)
        $indexBlob = Read-Git -Arguments @('rev-parse', ":$relativePath")
        if (-not $incomingBlob -or $indexBlob -ne $incomingBlob -or
            (Read-Git -Arguments @('hash-object', "--path=$relativePath", '--', $fullPath)) -ne $incomingBlob) { continue }
        $previousPreference = $ErrorActionPreference
        try {
            $ErrorActionPreference = 'Continue'
            $check = (& git -C $Worktree -c core.quotePath=false diff HEAD --check -- $relativePath 2>&1 | Out-String)
            if ($LASTEXITCODE -ne 2 -or $check -notmatch '(?m):\d+: new blank line at EOF\.') { continue }
        } finally { $ErrorActionPreference = $previousPreference }
        $bytes = [IO.File]::ReadAllBytes($fullPath)
        if ($bytes -contains 0) { continue }
        # Single-byte roundtrip preserves UTF-8/BOM and every non-newline byte.
        $encoding = [Text.Encoding]::GetEncoding(28591)
        $text = $encoding.GetString($bytes)
        $fixed = [regex]::Replace($text, '(\r?\n)(?:[ \t]*\r?\n)+\z', '$1')
        if ($fixed -eq $text) { continue }
        Assert-MergeIdentity
        # Recheck immediately before writing; preserve any concurrently edited file.
        if ((Read-Git -Arguments @('hash-object', "--path=$relativePath", '--', $fullPath)) -ne $incomingBlob) {
            throw "Incoming file changed during whitespace verification: $relativePath"
        }
        [IO.File]::WriteAllBytes($fullPath, $encoding.GetBytes($fixed))
        # Persist this controller-owned correction in the index so a failed model
        # invocation can be resumed without losing its exact staging provenance.
        Stage-ReportedFiles -Root $Worktree -Files @($relativePath)
        Write-Host "[Codex] Removed incoming blank line at EOF: $relativePath" -ForegroundColor DarkGray
        $relativePath
    }
}

$Worktree = (Resolve-Path -LiteralPath $Worktree).Path
$originalHead = Read-Git -Arguments @('rev-parse', 'HEAD')
Assert-MergeIdentity
$assetHead = $null
$assetIndexWasClean = $false
if ($AssetLibraryRoot -and (Test-Path -LiteralPath (Join-Path $AssetLibraryRoot '.git'))) {
    $assetHead = (& git -C $AssetLibraryRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect asset repository.' }
    & git -C $AssetLibraryRoot diff --cached --quiet
    $assetIndexWasClean = $LASTEXITCODE -eq 0
}
$commandPath = Find-SyncCodexCli -Command $CodexCommand

# Store outside tracked files, separately for each worktree and attempt.
$gitDirectory = Read-Git -Arguments @('rev-parse', '--absolute-git-dir')
$commonDirectory = Read-Git -Arguments @('rev-parse', '--path-format=absolute', '--git-common-dir')
$runDirectory = Join-Path $gitDirectory ('sync-auto-conflicts\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($runDirectory)
$utf8 = New-Object Text.UTF8Encoding($false)
$summaryPath = Join-Path $runDirectory 'result.json'
$schemaPath = Join-Path $runDirectory 'schema.json'
$promptPath = Join-Path $runDirectory 'prompt.txt'
$logPath = Join-Path $runDirectory 'codex.log'
[IO.File]::WriteAllText((Join-Path $runDirectory 'parents.txt'), "$originalHead`n$IncomingSha`n", $utf8)
[IO.File]::WriteAllText((Join-Path $runDirectory 'conflicts.txt'), (Read-Git -Arguments @('ls-files', '--unmerged')), $utf8)
$schema = @{
    type = 'object'; additionalProperties = $false
    required = @('status', 'summary', 'tests', 'files', 'asset_files', 'excel_updates')
    properties = @{
        status = @{ type = 'string'; enum = @('resolved', 'blocked', 'needs_excel') }
        summary = @{ type = 'string' }
        tests = @{ type = 'array'; items = @{ type = 'string' } }
        files = @{ type = 'array'; items = @{ type = 'string' } }
        asset_files = @{ type = 'array'; items = @{ type = 'string' } }
        excel_updates = @{ type = 'array'; items = @{
            type = 'object'; additionalProperties = $false; required = @('workbook', 'data_file')
            properties = @{ workbook = @{ type = 'string' }; data_file = @{ type = 'string' } }
        } }
    }
} | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($schemaPath, $schema, $utf8)

$normalizedIncomingFiles = @(Repair-IncomingBlankEof)
[IO.File]::WriteAllText((Join-Path $runDirectory 'controller-whitespace.txt'), ($normalizedIncomingFiles -join "`n"), $utf8)
$conflicts = Read-Git -Arguments @('diff', '--name-only', '--diff-filter=U')
$excelContext = New-SyncExcelContext -Root $Worktree -RunDirectory $runDirectory -Conflicts @($conflicts -split "`n") -Updater (Join-Path $PSScriptRoot 'excel-update-sheets.ps1')
$prompt = @"
The human user explicitly authorized sync_ai_worktrees.bat to resolve develop merge conflicts automatically.
You are the designated integrator for THIS pending merge only, in $Worktree.
Original HEAD: $originalHead
Incoming MERGE_HEAD: $IncomingSha
Initially conflicted paths:
$conflicts
The controller removed only extra blank lines at EOF from unchanged incoming files:
$($normalizedIncomingFiles -join "`n")
Preserve those mechanical corrections; protected instruction files do not need further editing for that whitespace.

Read AI_RULES.md, AGENTS.md, docs/AI_WORKFLOW.md, docs/AI_TASKS.md and prompts/codex.md.
Keep command output bounded; the task history is large, so locate relevant/current entries with rg and bounded reads.
This instruction authorizes working in the develop integration worktree and handling the known conflict sources;
do not ask again for permission for this merge. Work autonomously without delegating or creating chats.
Inspect git status and the base/ours/theirs revisions before editing. Preserve both sides' intended changes.
If Git reports dubious ownership under the Windows sandbox user, use git -c safe.directory="$Worktree" for this exact authorized repository only; do not alter global Git trust or use a wildcard.
Do not blindly take an entire side or choose the newer commit's content as a substitute for understanding it.
Make only necessary conflict, generated-data, cache, regression-test and task-record changes. Preserve any existing edits.
For original Excel conflicts DO NOT start Excel COM in the sandbox or edit the XLSX yourself: its Windows logon session cannot support Excel.
Instead inspect base/ours/theirs read-only, preserve both intents and create JSON DATA plans using the existing tools/excel-update-sheets.ps1 format.
Write those JSON plans ONLY under $($excelContext.PlansRelative)/ in the worktree. They are ignored recovery files, not files to stage.
Return status=needs_excel and excel_updates=[{workbook:"config/Excel/Name.xlsx",data_file:"$($excelContext.PlansRelative)/plan.json"}].
Cover every originally conflicted XLSX once; do not request other workbooks. Do not modify the workbook bytes during planning.
The controller applies the data with a trusted native Excel updater outside the sandbox, verifies normal reopening and checks the original hash.
It then invokes you for a SECOND validation pass with native receipts. Only that pass returns resolved after regenerating CSV/JS and running tests/build.
Use excel_updates=[] for blocked, resolved or non-Excel tasks. Never edit XLSX XML or generate host-executable scripts.
Excel is authoritative: regenerate the matching CSV and JS via existing tools. JSON/CSV fields changed independently should both survive.
Use NEW cache versions for combined JS/Worker/Preset changes and synchronize main/editor/Worker imports.
If necessary assets need preserving, follow the existing asset-library workflow, but do not stage or commit there.
Return only the required asset-library-relative paths in asset_files (empty array when none). The controller commits these before the game merge.
The configured asset library is: $AssetLibraryRoot
Run relevant tests and build. Compare known failing tests against the correct original baseline; never weaken assertions.
Run git diff HEAD --check against the COMPLETE merged result, including originally staged incoming files.
Repair whitespace errors there as necessary; git diff --check alone misses already staged incoming changes.
Record the resolution and validation in docs/AI_TASKS.md. Return every edited/added/deleted file as a repository-relative path in files.
DO NOT run git add, commit, or write Git metadata in either repository: the sandbox protects indexes; the controller stages reported files.
DO NOT commit the GAME repository: the parent script verifies and creates the merge commit.
DO NOT push, fetch, pull, rebase, switch branch, reset, clean, abort the merge, modify other worktrees, or invoke any sync script.
Keep HEAD and MERGE_HEAD unchanged. Do not leave temporary files or omit any changed file from the files result.
If the intent cannot be determined safely, a dependency/Excel lock prevents validation, or tests introduce a regression,
leave the merge intact and return status=blocked with the concrete reason. Do not pretend success or discard work.
If command execution is rejected by sandbox policy, stop immediately; do not retry alternate shells or seek broader permissions.
Return status=resolved only after removing conflict markers in the working files and completing validation; tests must list actual commands and results.
The index will still contain unmerged entries until the parent script stages your reported files. This is expected, not a failure.
"@
[IO.File]::WriteAllText($promptPath, $prompt, $utf8)
Write-Host "[Codex] Automatically resolving merge; log: $logPath" -ForegroundColor Cyan
$cliArguments = @('-a', 'never', 'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'workspace-write',
    '-c', 'sandbox_mode=workspace-write', '--cd', $Worktree,
    '--add-dir', $commonDirectory, '--output-schema', $schemaPath, '--output-last-message', $summaryPath, '--color', 'never')
# Keep the already configured Windows sandbox implementation while excluding desktop model aliases.
$codexSettingsDirectory = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$codexSettings = Join-Path $codexSettingsDirectory 'config.toml'
if (Test-Path -LiteralPath $codexSettings -PathType Leaf) {
    $settingsText = [IO.File]::ReadAllText($codexSettings)
    $windowsSection = [regex]::Match($settingsText, '(?ms)^\[windows\]\s*\r?\n(?<body>.*?)(?=^\[|\z)')
    $implementation = [regex]::Match($windowsSection.Groups['body'].Value, '(?m)^\s*sandbox\s*=\s*"(mxc|elevated|unelevated)"')
    if ($implementation.Success) { $cliArguments += @('-c', ('windows.sandbox=' + $implementation.Groups[1].Value)) }
}
if ($AssetLibraryRoot -and (Test-Path -LiteralPath $AssetLibraryRoot -PathType Container)) {
    $cliArguments += @('--add-dir', $AssetLibraryRoot)
}
$cliArguments += '-'
$previousEncoding = $OutputEncoding
$previousPreference = $ErrorActionPreference
$previousGitConfig = $env:GIT_CONFIG_GLOBAL
# Windows sandbox commands run as a different OS user. Trust this exact, user-authorized
# checkout through a child-process-only config, never safe.directory=* or a global edit.
$gitConfigPath = Join-Path $runDirectory 'git-config'
$escapedWorktree = $Worktree.Replace('\', '/').Replace('"', '\"')
$temporaryGitConfig = "[safe]`n`tdirectory = `"$escapedWorktree`"`n"
if ($AssetLibraryRoot) {
    $escapedAssetRoot = $AssetLibraryRoot.Replace('\', '/').Replace('"', '\"')
    $temporaryGitConfig += "`tdirectory = `"$escapedAssetRoot`"`n"
}
[IO.File]::WriteAllText($gitConfigPath, $temporaryGitConfig, $utf8)
function Invoke-SyncModelPhase {
    param([string]$ModelPrompt)
    Push-Location -LiteralPath $Worktree
    try {
        $OutputEncoding = $utf8
        $env:GIT_CONFIG_GLOBAL = $gitConfigPath
        $ErrorActionPreference = 'Continue'
        $ModelPrompt | & $commandPath @cliArguments 2>&1 | Tee-Object -FilePath $logPath -Append | Out-Host
        $phaseCode = $LASTEXITCODE
    } finally {
        $OutputEncoding = $previousEncoding
        $ErrorActionPreference = $previousPreference
        $env:GIT_CONFIG_GLOBAL = $previousGitConfig
        Pop-Location
    }
    if ($phaseCode -ne 0) { throw "Codex failed ($phaseCode). Merge preserved; see $logPath" }
    if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) { throw "Codex did not return a result; see $logPath" }
    return ([IO.File]::ReadAllText($summaryPath, $utf8) | ConvertFrom-Json)
}
$result = Invoke-SyncModelPhase -ModelPrompt $prompt
$reportedFiles = @($result.files)
$reportedAssets = @($result.asset_files)
$receipts = @()
if ($result.status -eq 'needs_excel') {
    Assert-MergeIdentity
    $requests = if ($result.PSObject.Properties['excel_updates']) { @($result.excel_updates) } else { @() }
    [IO.File]::WriteAllText((Join-Path $runDirectory 'excel-planning-result.json'), ($result | ConvertTo-Json -Depth 16), $utf8)
    $receipts = @(Invoke-SyncExcelHandoff -Context $excelContext -Requests $requests)
    $receiptText = ConvertTo-Json -InputObject $receipts -Depth 10
    [IO.File]::WriteAllText((Join-Path $runDirectory 'native-excel-receipts.json'), $receiptText, $utf8)
    Assert-MergeIdentity
    $validationPrompt = $prompt + @"

SECOND AND FINAL PASS: native Excel handoff is COMPLETE. Do not return needs_excel again or touch the XLSX bytes.
The approved updater saved and reopened the candidates normally outside the sandbox. Native receipts:
$receiptText
Regenerate matching CSV and JS from the actual updated XLSX with existing tools, resolve remaining references/cache conflicts,
then run relevant regression tests, build and complete-result whitespace checks. Native Excel opening validation is already satisfied;
do not attempt COM from the sandbox. Record actual commands/results and return resolved only on successful integration.
Return all files from this pass PLUS those already changed during planning; exclude ignored JSON plans. Return excel_updates=[].
"@
    [IO.File]::WriteAllText((Join-Path $runDirectory 'validation-prompt.txt'), $validationPrompt, $utf8)
    $result = Invoke-SyncModelPhase -ModelPrompt $validationPrompt
    $reportedFiles += @($result.files) + @($receipts | ForEach-Object { $_.workbook })
    $reportedAssets += @($result.asset_files)
} elseif ($excelContext.Books.Count -and $result.status -eq 'resolved') {
    throw 'Excel conflicts require the native controller handoff before resolved can be accepted.'
}
if ($result.status -ne 'resolved' -or @($result.tests).Count -eq 0) {
    throw "Automatic resolution stopped: $($result.summary). Merge preserved; see $logPath"
}
Assert-MergeIdentity
foreach ($receipt in $receipts) {
    $verifiedPath = Assert-SyncExcelPath -Root $Worktree -Path (Join-Path $Worktree $receipt.workbook)
    if ((Get-FileHash -LiteralPath $verifiedPath -Algorithm SHA256).Hash -ne $receipt.sha256) { throw 'Excel changed after native validation; merge preserved.' }
}
# Git metadata remains protected inside the model sandbox. Only this controller stages files.
Stage-ReportedFiles -Root $Worktree -Files @($reportedFiles + $normalizedIncomingFiles | Select-Object -Unique)
if (Read-Git -Arguments @('diff', '--name-only', '--diff-filter=U')) { throw "Unresolved files remain; see $logPath" }
& git -C $Worktree diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Staged diff contains whitespace errors or conflict markers.' }
& git -C $Worktree diff --quiet
if ($LASTEXITCODE -ne 0) { throw 'Unstaged changes remain; merge preserved.' }
if (Read-Git -Arguments @('ls-files', '--others', '--exclude-standard')) { throw 'Untracked files remain; merge preserved.' }

# Verify independently instead of trusting the model's final answer alone.
$build = Join-Path $Worktree 'tools\build_check.cjs'
if (-not (Test-Path -LiteralPath $build -PathType Leaf)) { throw 'Required tools/build_check.cjs is missing.' }
Push-Location -LiteralPath $Worktree
try {
    & node $build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Independent build failed. Merge preserved; see $logPath" }
} finally { Pop-Location }
Assert-MergeIdentity
# The verifier must not leave a modified working tree either.
& git -C $Worktree diff --quiet
if ($LASTEXITCODE -ne 0 -or (Read-Git -Arguments @('ls-files', '--others', '--exclude-standard'))) {
    throw 'Build left working-tree changes; merge preserved.'
}
& git -C $Worktree diff --cached --check
if ($LASTEXITCODE -ne 0) { throw 'Final staged verification failed.' }
$assetFiles = @($reportedAssets | Select-Object -Unique)
if ($assetFiles.Count -gt 0) {
    if (-not $assetHead -or -not $assetIndexWasClean) { throw 'Necessary assets cannot be committed: missing repository or pre-existing staged work.' }
    $currentAssetHead = (& git -C $AssetLibraryRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $currentAssetHead -ne $assetHead) { throw 'Asset HEAD changed during resolution; merge preserved.' }
    & git -C $AssetLibraryRoot diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Other work was staged in the asset repository; merge preserved.' }
    Stage-ReportedFiles -Root $AssetLibraryRoot -Files $assetFiles
    & git -C $AssetLibraryRoot diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw 'Asset verification failed.' }
    & git -C $AssetLibraryRoot diff --cached --quiet
    if ($LASTEXITCODE -eq 1) {
        $assetCommitArguments = @('commit', '--only', '-m', '[Codex] fix: 保存自動合併必要素材', '--') + $assetFiles
        & git --literal-pathspecs -C $AssetLibraryRoot @assetCommitArguments | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Necessary asset commit failed; game merge preserved.' }
    } elseif ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged assets.' }
}
Assert-MergeIdentity
Write-Host "[Codex] Verified: $($result.summary)" -ForegroundColor Green
