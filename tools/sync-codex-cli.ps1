# Locate an already installed CLI even when Explorer has an older PATH.
# This file only defines functions; sourcing it does not launch Codex.
function Find-SyncCodexCli {
    param([string]$Command = 'codex.cmd')

    $automatic = $Command -in @('codex.cmd', 'codex', 'codex.exe')
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    $names = if ($automatic) { @($Command, 'codex.exe', 'codex.cmd') } else { @($Command) }
    foreach ($name in $names) {
        foreach ($found in @(Get-Command $name -CommandType Application -ErrorAction SilentlyContinue)) {
            if ($found.Source) { $candidates.Add($found.Source) }
        }
    }
    if ($automatic) {
        if ($env:APPDATA) { $candidates.Add((Join-Path $env:APPDATA 'npm\codex.cmd')) }
        if ($env:LOCALAPPDATA) {
            $desktopBin = Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\bin'
            if (Test-Path -LiteralPath $desktopBin -PathType Container) {
                foreach ($directory in @(Get-ChildItem -LiteralPath $desktopBin -Directory | Sort-Object LastWriteTime -Descending)) {
                    $candidates.Add((Join-Path $directory.FullName 'codex.exe'))
                }
            }
        }
    }
    $failures = New-Object 'System.Collections.Generic.List[string]'
    foreach ($candidate in @($candidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { continue }
        if ([IO.Path]::GetExtension($candidate) -notin @('.exe', '.cmd', '.bat')) { continue }
        $previousPreference = $ErrorActionPreference
        try {
            # Broken npm shims must not hide a working desktop installation.
            $ErrorActionPreference = 'Continue'
            $version = (& $candidate --version 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -ne 0 -or $version -notmatch '^codex-cli\s+\S+') {
                $failures.Add("$candidate (version check failed)")
                continue
            }
            $help = (& $candidate exec --help 2>&1 | Out-String)
            if ($LASTEXITCODE -ne 0) {
                $failures.Add("$candidate (exec help failed)")
                continue
            }
            $required = @('--ignore-user-config', '--ephemeral', '--sandbox', '--add-dir', '--output-schema', '--output-last-message')
            if (@($required | Where-Object { -not $help.Contains($_) }).Count -gt 0) {
                $failures.Add("$candidate (required exec options missing)")
                continue
            }
            Write-Host "[Codex] CLI: $candidate ($version)" -ForegroundColor DarkGray
            return $candidate
        } catch {
            $failures.Add("$candidate (could not start)")
        } finally { $ErrorActionPreference = $previousPreference }
    }
    $details = if ($failures.Count) { "`nChecked: " + ($failures -join "`n") } else { '' }
    $searched = if ($automatic) { 'Checked PATH, npm and the Codex desktop installation.' } else { 'Checked only the explicitly specified command.' }
    throw "Cannot find Codex CLI (missing or incompatible): $Command. $searched Install/sign in to Codex or pass -CodexCommand with a working CLI path. The merge is preserved.$details"
}
