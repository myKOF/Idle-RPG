[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$IncomingSha,
    [string]$CodexCommand = 'codex.cmd',
    [string]$AssetLibraryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
        & git --literal-pathspecs -C $Root add --all -- $relativePath
        if ($LASTEXITCODE -ne 0) { throw "Could not stage reported file: $relativePath" }
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
$command = Get-Command $CodexCommand -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $command) {
    throw 'Cannot find Codex CLI. Install/sign in to Codex, then run sync_ai_worktrees.bat again. The merge is preserved.'
}

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
    required = @('status', 'summary', 'tests', 'files', 'asset_files')
    properties = @{
        status = @{ type = 'string'; enum = @('resolved', 'blocked') }
        summary = @{ type = 'string' }
        tests = @{ type = 'array'; items = @{ type = 'string' } }
        files = @{ type = 'array'; items = @{ type = 'string' } }
        asset_files = @{ type = 'array'; items = @{ type = 'string' } }
    }
} | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText($schemaPath, $schema, $utf8)

$conflicts = Read-Git -Arguments @('diff', '--name-only', '--diff-filter=U')
$prompt = @"
The human user explicitly authorized sync_ai_worktrees.bat to resolve develop merge conflicts automatically.
You are the designated integrator for THIS pending merge only, in $Worktree.
Original HEAD: $originalHead
Incoming MERGE_HEAD: $IncomingSha
Initially conflicted paths:
$conflicts

Read AI_RULES.md, AGENTS.md, docs/AI_WORKFLOW.md, docs/AI_TASKS.md and prompts/codex.md.
This instruction authorizes working in the develop integration worktree and handling the known conflict sources;
do not ask again for permission for this merge. Work autonomously without delegating or creating chats.
Inspect git status and the base/ours/theirs revisions before editing. Preserve both sides' intended changes.
If Git reports dubious ownership under the Windows sandbox user, use git -c safe.directory="$Worktree" for this exact authorized repository only; do not alter global Git trust or use a wildcard.
Do not blindly take an entire side or choose the newer commit's content as a substitute for understanding it.
Make only necessary conflict, generated-data, cache, regression-test and task-record changes. Preserve any existing edits.
For Excel conflicts use supported spreadsheet/Excel APIs and validate preservation and normal reopening; never edit internal XML.
Excel is authoritative: regenerate the matching CSV and JS via existing tools. JSON/CSV fields changed independently should both survive.
Use NEW cache versions for combined JS/Worker/Preset changes and synchronize main/editor/Worker imports.
If necessary assets need preserving, follow the existing asset-library workflow, but do not stage or commit there.
Return only the required asset-library-relative paths in asset_files (empty array when none). The controller commits these before the game merge.
The configured asset library is: $AssetLibraryRoot
Run relevant tests and build. Compare known failing tests against the correct original baseline; never weaken assertions.
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
Push-Location -LiteralPath $Worktree
try {
    $OutputEncoding = $utf8
    $env:GIT_CONFIG_GLOBAL = $gitConfigPath
    # Native stderr is diagnostic output, not a PowerShell exception.
    $ErrorActionPreference = 'Continue'
    $prompt | & $command.Source @cliArguments 2>&1 | Tee-Object -FilePath $logPath | Out-Host
    $code = $LASTEXITCODE
} finally {
    $OutputEncoding = $previousEncoding
    $ErrorActionPreference = $previousPreference
    $env:GIT_CONFIG_GLOBAL = $previousGitConfig
    Pop-Location
}
if ($code -ne 0) { throw "Codex failed ($code). Merge preserved; see $logPath" }
if (-not (Test-Path -LiteralPath $summaryPath -PathType Leaf)) { throw "Codex did not return a result; see $logPath" }
$result = [IO.File]::ReadAllText($summaryPath, $utf8) | ConvertFrom-Json
if ($result.status -ne 'resolved' -or @($result.tests).Count -eq 0) {
    throw "Automatic resolution stopped: $($result.summary). Merge preserved; see $logPath"
}
Assert-MergeIdentity
# Git metadata remains protected inside the model sandbox. Only this controller stages files.
Stage-ReportedFiles -Root $Worktree -Files @($result.files)
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
if (@($result.asset_files).Count -gt 0) {
    if (-not $assetHead -or -not $assetIndexWasClean) { throw 'Necessary assets cannot be committed: missing repository or pre-existing staged work.' }
    $currentAssetHead = (& git -C $AssetLibraryRoot rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $currentAssetHead -ne $assetHead) { throw 'Asset HEAD changed during resolution; merge preserved.' }
    & git -C $AssetLibraryRoot diff --cached --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Other work was staged in the asset repository; merge preserved.' }
    Stage-ReportedFiles -Root $AssetLibraryRoot -Files @($result.asset_files)
    & git -C $AssetLibraryRoot diff --cached --check
    if ($LASTEXITCODE -ne 0) { throw 'Asset verification failed.' }
    & git -C $AssetLibraryRoot diff --cached --quiet
    if ($LASTEXITCODE -eq 1) {
        $assetCommitArguments = @('commit', '--only', '-m', '[Codex] fix: 保存自動合併必要素材', '--') + @($result.asset_files)
        & git --literal-pathspecs -C $AssetLibraryRoot @assetCommitArguments | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'Necessary asset commit failed; game merge preserved.' }
    } elseif ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged assets.' }
}
Assert-MergeIdentity
Write-Host "[Codex] Verified: $($result.summary)" -ForegroundColor Green
