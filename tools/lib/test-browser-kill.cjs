'use strict';
// 依命令列找出並關閉「測試用無畫面瀏覽器」。共用給 headless-browser.cjs、看門狗與 kill-test-browsers.cjs。
// 只認得 msedge.exe / chrome.exe 的主行程（命令列沒有 --type=），子行程用 taskkill /T 整棵一起關。
const cp = require('node:child_process');
const os = require('node:os');

const MARKER = '--idle-rpg-test-browser';

function runPowerShell(script) {
  const out = cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000,
  });
  return out.trim();
}

// 回傳所有瀏覽器主行程：{ pid, parentPid, name, startMs, commandLine, parentAlive, parentName }
function listBrowserMains() {
  if (process.platform !== 'win32') return [];
  const script = [
    '$all = @{}; Get-CimInstance Win32_Process | ForEach-Object { $all[[int]$_.ProcessId] = $_ }',
    "$rows = $all.Values | Where-Object { ($_.Name -eq 'msedge.exe' -or $_.Name -eq 'chrome.exe') -and $_.CommandLine -and $_.CommandLine -notmatch '--type=' } | ForEach-Object {",
    '  $par = $all[[int]$_.ParentProcessId]',
    '  [pscustomobject]@{ pid = [int]$_.ProcessId; parentPid = [int]$_.ParentProcessId; name = $_.Name;',
    '    startMs = [int64](($_.CreationDate.ToUniversalTime() - [datetime]\'1970-01-01\').TotalMilliseconds);',
    '    commandLine = $_.CommandLine; parentAlive = [bool]$par; parentName = $(if ($par) { $par.Name } else { \'\' }) }',
    '}',
    '@($rows) | ConvertTo-Json -Compress -Depth 3',
  ].join('\n');
  const text = runPowerShell(script);
  if (!text) return [];
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [data];
}

function userDataDirOf(commandLine) {
  const m = /--user-data-dir=(?:"([^"]+)"|(\S+))/.exec(commandLine || '');
  return m ? (m[1] || m[2]) : '';
}

function isUnder(child, parent) {
  const a = String(child).replace(/\//g, '\\').toLowerCase();
  const b = String(parent).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() + '\\';
  return a.startsWith(b);
}

// 測試用瀏覽器：無畫面，而且是本工具標記的，或設定檔放在系統暫存資料夾。使用者自己開的瀏覽器一律不算。
function isTestBrowser(proc) {
  const cmd = proc.commandLine || '';
  if (!/--headless\b/.test(cmd)) return false;
  if (cmd.includes(MARKER)) return true;
  const dir = userDataDirOf(cmd);
  return !!dir && isUnder(dir, os.tmpdir());
}

function killTree(pid) {
  try {
    cp.execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

// 關掉所有用這個設定檔資料夾的瀏覽器（含 Edge 自動更新後用同一組參數重新拉起來的那份）。
function killByProfileDir(profileDir) {
  if (process.platform !== 'win32' || !profileDir) return 0;
  const targets = listBrowserMains().filter(p => {
    const dir = userDataDirOf(p.commandLine);
    return dir && dir.replace(/\//g, '\\').toLowerCase() === String(profileDir).replace(/\//g, '\\').toLowerCase();
  });
  targets.forEach(p => killTree(p.pid));
  return targets.length;
}

module.exports = { MARKER, listBrowserMains, userDataDirOf, isTestBrowser, killTree, killByProfileDir };
