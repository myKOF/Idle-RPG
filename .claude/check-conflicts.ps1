# 改檔前的衝突預檢
#
# 用途：在動任何檔案之前，查出「別的工作副本或分支是否也碰了同一支檔案」。
# 規則見 AI_RULES.md 第 3.2 節：查到衝突必須先告知使用者並取得同意，才可以修改。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/check-conflicts.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .claude/check-conflicts.ps1 js/ui.js index.html
#
# 不帶檔案：列出全部副本的未提交檔案與各分支未合併的 commit 數（總覽）。
# 帶檔案　：逐支檔案判定，並在結尾給出「可以改／要先問」的結論。
#
# ⚠️ 這支腳本查得到的是**磁碟上的狀態**。查不到的兩類仍需人判斷：
#    1. 只存在於其他 AI 對話裡、尚未寫入磁碟的修改
#    2. 語意衝突——兩邊改不同檔案卻互相破壞（例如協議欄位改了、對方仍讀舊形狀）

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Files)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$now = Get-Date

# 由 git 自己列出 worktree，不寫死路徑（新增副本時不必改這支腳本）
$worktrees = @()
$current = $null
foreach ($line in (git -C $repo worktree list --porcelain)) {
  if ($line -like 'worktree *') { $current = @{ Path = $line.Substring(9) } }
  elseif ($line -like 'branch *') {
    $current.Branch = $line.Substring(7) -replace '^refs/heads/', ''
    $worktrees += [pscustomobject]$current
  }
}
$selfPath = (git -C $repo rev-parse --show-toplevel) -replace '/', '\'
$selfBranch = git -C $repo rev-parse --abbrev-ref HEAD

# 每個副本的未提交檔案（含最後寫入時間，用來分辨「正在改」與「忘了收」）
$dirty = @{}
foreach ($w in $worktrees) {
  foreach ($entry in (git -C $w.Path status --porcelain)) {
    if (-not $entry) { continue }
    $path = $entry.Substring(3).Trim('"')
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[1] } # 改名
    $full = Join-Path $w.Path $path
    $age = $null
    if (Test-Path $full) { $age = [math]::Round(($now - (Get-Item $full).LastWriteTime).TotalMinutes, 1) }
    if (-not $dirty.ContainsKey($path)) { $dirty[$path] = @() }
    $dirty[$path] += [pscustomobject]@{
      Branch = $w.Branch; Path = $w.Path; Status = $entry.Substring(0, 2); AgeMin = $age
      IsSelf = ($w.Path -replace '/', '\') -eq $selfPath
    }
  }
}

# 只看真正會併回 develop 的協作分支。production 是分離的發行線（合併方向是
# develop → production），把它算進來只會噴出上百筆無關 commit，把真訊號淹掉。
$branches = (git -C $repo for-each-ref --format='%(refname:short)' refs/heads) |
  Where-Object { $_ -ne $selfBranch -and ($_ -like 'ai/*' -or $_ -eq 'develop') }

$MaxCommitsShown = 5

if (-not $Files -or $Files.Count -eq 0) {
  Write-Output '=== 未提交變更（依副本）==='
  if ($dirty.Count -eq 0) { Write-Output '  全部副本乾淨' }
  foreach ($path in ($dirty.Keys | Sort-Object)) {
    foreach ($d in $dirty[$path]) {
      $tag = ''
      if ($d.IsSelf) { $tag = '（本副本）' }
      Write-Output ("  {0,-16} {1,-34} {2} 分鐘前 {3}" -f $d.Branch, $path, $d.AgeMin, $tag)
    }
  }
  Write-Output ''
  Write-Output '=== 各分支未合併進 develop 的 commit ==='
  foreach ($b in $branches) {
    if ($b -eq 'develop') { continue }
    $n = git -C $repo rev-list --count "develop..$b"
    Write-Output ("  {0,-16} {1} 個" -f $b, $n)
  }
  exit 0
}

$blocked = @()
foreach ($file in $Files) {
  $norm = $file -replace '\\', '/'
  Write-Output "=== $norm ==="
  $hit = $false

  # (1) 其他副本的未提交修改——最危險，因為 git 分支比對完全看不到
  if ($dirty.ContainsKey($norm)) {
    foreach ($d in $dirty[$norm]) {
      if ($d.IsSelf) {
        Write-Output ("  本副本有未提交修改（{0} 分鐘前）" -f $d.AgeMin)
        continue
      }
      $hit = $true
      Write-Output ("  ⚠ {0} 有未提交修改（{1}，{2} 分鐘前）→ {3}" -f $d.Branch, $d.Status.Trim(), $d.AgeMin, $d.Path)
    }
  }

  # (2) 已提交但尚未合併進 develop 的修改
  foreach ($b in $branches) {
    if ($b -eq 'develop') { continue }
    $commits = git -C $repo log --oneline "develop..$b" -- $norm
    if ($commits) {
      $hit = $true
      Write-Output ("  ⚠ {0} 有 {1} 筆未合併 commit 動到本檔：" -f $b, @($commits).Count)
      @($commits) | Select-Object -First $MaxCommitsShown | ForEach-Object { Write-Output "      $_" }
      if (@($commits).Count -gt $MaxCommitsShown) {
        Write-Output ("      …另有 {0} 筆" -f (@($commits).Count - $MaxCommitsShown))
      }
    }
  }

  # (3) develop 上、我這條分支還沒有的修改（合併回來時會撞到）
  $behind = git -C $repo log --oneline "$selfBranch..develop" -- $norm
  if ($behind) {
    $hit = $true
    Write-Output ("  ⚠ develop 有 {0} 筆本分支尚未納入的修改：" -f @($behind).Count)
    @($behind) | Select-Object -First $MaxCommitsShown | ForEach-Object { Write-Output "      $_" }
  }

  if (-not $hit) { Write-Output '  無其他副本或分支的修改' }
  else { $blocked += $norm }
  Write-Output ''
}

Write-Output '=== 結論 ==='
if ($blocked.Count -eq 0) {
  Write-Output '可以直接改：沒有偵測到磁碟上的衝突來源。'
  Write-Output '（仍需自行判斷語意衝突：共用契約、協議欄位、存檔格式、數值表）'
} else {
  Write-Output '要先問使用者，以下檔案有其他來源的修改：'
  foreach ($f in $blocked) { Write-Output "  - $f" }
  exit 2
}
