'use strict';
/* ============================================================
   save-as-dialog.cjs — VFX Editor「另存新檔」的 Windows 存檔視窗
   （「重新命名」問新名字也用它，見 askPresetId 的 purpose）

   2026-09-14 使用者要求：另存新檔不要用網頁的輸入框，要跟「載入 Preset」一樣
   叫 Windows 的視窗。

   ---- 為什麼由伺服器開，而不是頁面自己叫瀏覽器的存檔視窗 API ----
   瀏覽器那個 API（showSaveFilePicker）有兩個硬傷，都正好打在「另存新檔不能動到舊檔」上：
     1. 使用者選到既有檔案時，Chrome 在把檔案交給頁面之前就先把它清成 0 bytes
        （Chromium issue 40717501）。頁面連拒絕的機會都沒有：手滑點到原本那份，原檔就沒了。
     2. 頁面只拿得到 handle、拿不到路徑，無法確認存在 repo 的 vfx/presets 底下；
        存到別處遊戲讀不到，分組檔也不會跟著寫。
   編輯器伺服器本來就跑在同一台 Windows 上。由它用 WinForms 的 SaveFileDialog 開視窗：
   那個視窗只回傳路徑、不碰檔案，路徑也看得到。真正的寫入仍然走既有的
   PUT /vfx/presets/<id>.json，這裡只負責「問名字」。

   ---- 流程 ----
   askPresetId：開視窗 → 檢查選到的路徑（資料夾、副檔名、id 規則、是否已經存在）→
   有問題就先跳訊息框說明原因、再重開視窗；沒問題回 { id }。
   id 規則沿用 preset-id-policy（由呼叫端傳入），這裡不另寫一份。

   ---- 與 PowerShell 的介面 ----
   腳本是常數，輸入一律走環境變數、不拼進腳本文字：檔名裡有引號或 $ 也不會變成程式碼。
   輸出是 UTF-8 文字的 base64，stdout 上只有 ASCII，不必管主控台的字碼頁。
   ============================================================ */

const fs = require('fs');
const path = require('path');

const TITLE = '另存新檔（存到 vfx\\presets）';
/* 「重新命名」也用這個視窗問新名字（2026-09-18）：一樣要看得到資料夾裡已經有哪些名字，
   一樣不收既有的檔案。差別只有標題與選到既有檔案時的說明。 */
const RENAME_TITLE = '重新命名（輸入新名字，存在 vfx\\presets）';
/* 連續幾次選到不能用的名字就放棄，回報原因給頁面。不設上限的話，
   使用者關不掉的其實是一個一直重開的視窗。 */
const MAX_ROUNDS = 5;

/* 只放 ASCII；標題、資料夾、預設檔名、提示訊息全部從環境變數讀。
   VFX_SAVE_DRYRUN=1 時不開視窗，把收到的設定原樣回傳——給測試實際跑一次用。

   腳本裡的兩個眉角（說明寫在這裡，腳本本身維持純 ASCII）：
     - SetProcessDPIAware：PowerShell 沒有宣告 DPI 感知，高解析度螢幕上視窗會被放大成
       一片模糊。這一步要編譯一小段 C#，失敗就略過，不影響開視窗。
     - 看不見的 TopMost 表單當擁有者：伺服器不是前景程式，沒有它的話視窗常常開在
       瀏覽器後面。 */
const DIALOG_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Out-Result([string]$text) {
  [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)))
}
try {
  Add-Type -Namespace VfxEditor -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
  [void][VfxEditor.Dpi]::SetProcessDPIAware()
} catch { }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$nl = [string][char]10

$dlg = New-Object System.Windows.Forms.SaveFileDialog
$dlg.Title = $env:VFX_SAVE_TITLE
$dlg.InitialDirectory = $env:VFX_SAVE_DIR
$dlg.FileName = $env:VFX_SAVE_NAME
$dlg.Filter = 'VFX Preset (*.json)|*.json'
$dlg.DefaultExt = 'json'
$dlg.AddExtension = $true
$dlg.OverwritePrompt = $false
$dlg.CheckPathExists = $true
$dlg.RestoreDirectory = $true

if ($env:VFX_SAVE_DRYRUN -eq '1') {
  Out-Result ('DRYRUN' + $nl + $dlg.Title + $nl + $dlg.InitialDirectory + $nl + $dlg.FileName + $nl + $env:VFX_SAVE_MESSAGE)
  exit 0
}

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$owner.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
try {
  if ($env:VFX_SAVE_MESSAGE) {
    [void][System.Windows.Forms.MessageBox]::Show($owner, $env:VFX_SAVE_MESSAGE, $env:VFX_SAVE_TITLE,
      [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)
  }
  $result = $dlg.ShowDialog($owner)
} finally {
  $owner.Close()
}
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Out-Result ('OK' + $nl + $dlg.FileName)
} else {
  Out-Result 'CANCEL'
}
`;

function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return fs.existsSync(full) ? full : 'powershell.exe';
}

/* -STA：WinForms 的視窗要在單執行緒 apartment 裡開。-NoProfile：不載入使用者的 profile。 */
function powershellArgs() {
  return ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(DIALOG_SCRIPT, 'utf16le').toString('base64')];
}

/* stdout 是 base64；解開後第一行是結果種類，第二行起是內容。 */
function parseDialogOutput(stdout) {
  const text = Buffer.from(String(stdout || '').trim(), 'base64').toString('utf8');
  const nl = text.indexOf('\n');
  const kind = nl < 0 ? text : text.slice(0, nl);
  const rest = nl < 0 ? '' : text.slice(nl + 1);
  if (kind === 'CANCEL') return { canceled: true };
  if (kind === 'OK' && rest) return { path: rest };
  if (kind === 'DRYRUN') {
    const parts = rest.split('\n');
    return {
      dryRun: true, title: parts[0], initialDir: parts[1], fileName: parts[2],
      message: parts.slice(3).join('\n')
    };
  }
  throw new Error('存檔視窗回傳了無法解讀的結果：' + JSON.stringify(text.slice(0, 80)));
}

/* PowerShell 的錯誤有時包成 CLIXML，挑出看得懂的文字就好。 */
function readableError(stderr) {
  return String(stderr || '')
    .replace(/#< CLIXML/g, ' ')
    .replace(/_x000D__x000A_/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/* opts：initialDir、fileName、title、message（選填：先跳訊息框再開視窗）、
   dryRun（測試用：不開視窗，把收到的設定原樣回傳）。
   deps：platform、execFile（測試注入）。
   回傳 Promise：{ canceled: true } 或 { path }；不是 Windows 時以 code 'UNSUPPORTED' 拒絕。 */
function runWindowsDialog(opts, deps) {
  const d = deps || {};
  const platform = d.platform || process.platform;
  if (platform !== 'win32') {
    const err = new Error('只有 Windows 有這個存檔視窗');
    err.code = 'UNSUPPORTED';
    return Promise.reject(err);
  }
  const execFile = d.execFile || require('child_process').execFile;
  const env = Object.assign({}, process.env, {
    VFX_SAVE_DIR: opts.initialDir || '',
    VFX_SAVE_NAME: opts.fileName || '',
    VFX_SAVE_TITLE: opts.title || TITLE,
    VFX_SAVE_MESSAGE: opts.message || '',
    VFX_SAVE_DRYRUN: opts.dryRun ? '1' : ''
  });
  return new Promise(function (resolve, reject) {
    execFile(powershellPath(), powershellArgs(), { env: env, maxBuffer: 1024 * 1024 },
      function (err, stdout, stderr) {
        if (err) {
          return reject(new Error('存檔視窗開不起來：' + (readableError(stderr) || err.message)));
        }
        try { resolve(parseDialogOutput(stdout)); } catch (e) { reject(e); }
      });
  });
}

function samePath(a, b, platform) {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return (platform || process.platform) === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/* 選到的完整路徑 → { id } 或 { problem }。
   資料夾必須正好是 vfx/presets（子資料夾也不行：清單與匯出都只看那一層），
   副檔名 .json，檔名照 preset-id-policy。
   檔名轉小寫：以前的輸入框也是這樣處理，Windows 的檔名本來就不分大小寫。 */
function chosenPresetId(chosen, presetsDir, policy, platform) {
  const full = path.resolve(String(chosen || ''));
  if (!samePath(path.dirname(full), presetsDir, platform)) {
    return { problem: '只能存在 vfx\\presets 資料夾裡。剛才選的位置是：' + path.dirname(full) };
  }
  const base = path.basename(full);
  if (!/\.json$/i.test(base)) {
    return { problem: '檔名要以 .json 結尾。剛才輸入的是：' + base };
  }
  const id = base.slice(0, base.length - '.json'.length).toLowerCase();
  const idProblem = policy.presetIdProblem(id);
  if (idProblem) return { problem: '「' + base + '」不能當成特效名稱：' + idProblem };
  return { id: id };
}

/* 問出一個可以另存的 preset id。
   opts：presetsDir、suggested（建議名稱，不含副檔名）、policy（preset-id-policy）、
   purpose（'rename'＝重新命名，此時 suggested 就是目前的名字；其餘＝另存新檔）、
   runDialog（預設 runWindowsDialog）、maxRounds、platform。
   回傳 Promise：{ canceled: true }、{ id }，或連續 maxRounds 次都不能用時 { problem }。
   既有檔案一律不收：另存新檔不會覆寫，覆寫請用「儲存到 repo」；重新命名也不會蓋掉別的特效。 */
function askPresetId(opts) {
  const run = opts.runDialog || runWindowsDialog;
  const maxRounds = opts.maxRounds || MAX_ROUNDS;
  const renaming = opts.purpose === 'rename';
  function existsProblem(id) {
    if (!renaming) return '已經有一份「' + id + '」了。另存新檔不會覆寫既有的特效，請換一個名字。';
    /* 視窗預填的就是目前的名字，沒改就按下去最常見：說清楚，不要讓人以為那個名字被別人占了 */
    if (id === opts.suggested) return '「' + id + '」就是目前的名字。請輸入新的名字。';
    return '已經有一份「' + id + '」了。重新命名不會蓋掉別的特效，請換一個名字。';
  }
  function round(n, fileName, message) {
    return Promise.resolve(run({
      initialDir: opts.presetsDir, fileName: fileName, title: renaming ? RENAME_TITLE : TITLE,
      message: message
    })).then(function (picked) {
      if (!picked || picked.canceled) return { canceled: true };
      const r = chosenPresetId(picked.path, opts.presetsDir, opts.policy, opts.platform);
      let problem = r.problem;
      if (!problem && fs.existsSync(path.join(opts.presetsDir, r.id + '.json'))) {
        problem = existsProblem(r.id);
      }
      if (!problem) return { id: r.id };
      if (n + 1 >= maxRounds) return { problem: problem };
      return round(n + 1, path.basename(String(picked.path)), problem);
    });
  }
  return round(0, opts.suggested ? opts.suggested + '.json' : '', '');
}

module.exports = {
  TITLE: TITLE,
  RENAME_TITLE: RENAME_TITLE,
  DIALOG_SCRIPT: DIALOG_SCRIPT,
  powershellArgs: powershellArgs,
  parseDialogOutput: parseDialogOutput,
  runWindowsDialog: runWindowsDialog,
  chosenPresetId: chosenPresetId,
  askPresetId: askPresetId
};
