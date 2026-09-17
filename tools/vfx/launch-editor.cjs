'use strict';
/* ============================================================
   launch-editor.cjs — 「啟動VFX編輯器.bat」的本體

   雙擊啟動器之後：
     1. 找出「本副本」所有正在跑的編輯器伺服器——不管程式新舊、有沒有當掉
     2. 全部關掉：有回應的走 POST /__shutdown（伺服器視窗會自己關）；
        沒回應、或關不掉的，用 PID 強制結束（連同它的伺服器視窗）
     3. 開一個新的「VFX 編輯器伺服器」視窗，等它就緒
     4. 用瀏覽器開編輯器頁面

   ---- 為什麼一律重開，不沿用 ----
   原本是「程式沒過期就沿用、過期就叫使用者去關視窗」。但伺服器常常不是從這個
   啟動器開的（AI 工具的預覽伺服器根本沒有視窗），也可能已經當掉、關不了——
   使用者就卡在一個沒有出路的畫面（2026-09-17 回報）。使用者提議：開新的時候
   自動把舊的關掉。一律重開只多花一兩秒，換來「雙擊一次，一定是新的伺服器」。

   ---- 為什麼邏輯不寫在 .bat 裡 ----
   同一天實測：cmd 在 chcp 65001 下讀到一段很長的中文 echo 時讀檔位置錯位，
   從字的中間開始讀，把碎片當成指令執行——其中一段是說明文字裡的
   「taskkill /F /PID 那個PID」，taskkill 真的跑了。這類錯位在 .bat 裡防不完，
   所以 .bat 只放 ASCII，中文訊息與流程都在這裡。

   ---- 怎麼認出「本副本」的伺服器 ----
   五份工作副本共用同一段埠、跑同一支伺服器，只看埠會關到別人的。
     - 有回應的：GET /__whoami 回報它服務的目錄，與本副本相同才算
     - 沒回應的（當掉）：看 node 的命令列。伺服器視窗用絕對路徑啟動
       editor-server.cjs（見 editor_server_window.bat），路徑在本副本底下才算
   兩條都認不出來的行程一律不碰。強制結束前會重新確認一次 PID 還是同一個行程，
   不會因為 PID 被系統重用而殺到別的程式。
   ============================================================ */

const http = require('http');
const path = require('path');
const childProcess = require('child_process');

const libraryRoot = require('./vfx-library-root.cjs');
const presetIdPolicy = require('./editor/preset-id-policy.js');
/* 身分標記、埠範圍、關閉端點都讀伺服器自己匯出的常數，不在這裡另外寫一份（W7） */
const identity = require('./editor-server.cjs').launcher;

const REPO_ROOT = libraryRoot.REPO_ROOT;
const WINDOW_TITLE = 'VFX 編輯器伺服器 - 關閉此視窗即停止';
/* 冷啟動要載入 Core 與縮圖模組，慢的電腦要好幾秒；原本 .bat 等 10 秒偶爾不夠 */
const READY_TIMEOUT_MS = 20000;
const STOP_TIMEOUT_MS = 4000;
const LINE = '========================================================';

function portRange() {
  const out = [];
  for (let i = 0; i < identity.PORT_TRIES; i++) out.push(identity.PORT_BASE + i);
  return out;
}

function rangeText() {
  const ports = portRange();
  return ports[0] + '~' + ports[ports.length - 1];
}

/* Windows 的路徑不分大小寫，也不分 / 與 \ */
function normalPath(p) {
  return path.resolve(String(p || '')).replace(/\//g, '\\').toLowerCase();
}

/* ---------------- 參數 ---------------- */

/* 第一個參數是要開的 preset（.bat 原樣轉交）。沒給就開空場景——以前預設開 lightning-orb-field，
   一打開編輯器看到的是別人的特效（2026-09-17 使用者要求改成空場景）。
   不合法就不帶進網址（同樣開空場景）並說明原因：這個值會進網址與 start 指令，不能照單全收。
   --no-browser 給驗證用：不開瀏覽器。 */
function parseArgs(argv) {
  const list = (argv || []).map(String);
  const noBrowser = list.indexOf('--no-browser') >= 0;
  const raw = (list.filter(function (a) { return a !== '--no-browser'; })[0] || '').trim();
  if (!raw) return { preset: '', rawPreset: '', presetProblem: null, noBrowser: noBrowser };
  const problem = presetIdPolicy.presetIdProblem(raw);
  return {
    preset: problem ? '' : raw, rawPreset: raw,
    presetProblem: problem || null, noBrowser: noBrowser
  };
}

function editorUrl(port, preset) {
  return 'http://127.0.0.1:' + port + '/tools/vfx/editor/index.html' + (preset ? '?preset=' + preset : '');
}

/* ---------------- 認伺服器 ---------------- */

/* /__whoami 的回應 → { ours, fresh }。
   第一行是「標記 空白 目錄」，第二行是新舊標記。fresh 用白名單：
   舊到還沒有這套標記的伺服器什麼都不回報，那也算不新。 */
function parseWhoami(body, repoRoot) {
  const lines = String(body || '').split(/\r?\n/).map(function (l) { return l.trim(); });
  const prefix = identity.WHOAMI_MARK + ' ';
  const target = normalPath(repoRoot);
  const ours = lines.some(function (l) {
    return l.indexOf(prefix) === 0 && normalPath(l.slice(prefix.length)) === target;
  });
  return { ours: ours, fresh: lines.indexOf(identity.WHOAMI_FRESH_MARK) >= 0 };
}

function request(port, method, urlPath, body, timeoutMs) {
  return new Promise(function (resolve) {
    const data = body === undefined ? null : Buffer.from(body, 'utf8');
    const req = http.request({
      host: '127.0.0.1', port: port, path: urlPath, method: method, agent: false,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', function () { resolve(null); });
    });
    req.setTimeout(timeoutMs, function () { req.destroy(); });
    req.on('error', function () { resolve(null); });
    req.end(data || undefined);
  });
}

/* 掃埠：回傳回報「本副本」的那幾個 { port, fresh }。沒回應的埠直接略過。 */
function scan(opts) {
  const o = opts || {};
  const repoRoot = o.repoRoot || REPO_ROOT;
  return Promise.all((o.ports || portRange()).map(function (port) {
    return request(port, 'GET', identity.WHOAMI_PATH, undefined, o.timeoutMs || 800)
      .then(function (res) {
        if (!res || res.status !== 200) return null;
        const who = parseWhoami(res.text, repoRoot);
        return who.ours ? { port: port, fresh: who.fresh } : null;
      });
  })).then(function (list) { return list.filter(Boolean); });
}

/* node／cmd 行程與這段埠的監聽，一次問完（PowerShell 開一次大約一秒）。
   輸出強制 UTF-8：命令列裡可能有中文路徑，主控台預設的字碼頁會把它弄壞。 */
function systemSnapshot() {
  const ports = portRange();
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    "$procs = @(Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='cmd.exe'\" | " +
      'Select-Object ProcessId, ParentProcessId, Name, CommandLine)',
    '$listen = @(Get-NetTCPConnection -State Listen -LocalPort (' + ports[0] + '..' +
      ports[ports.length - 1] + ') -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess)',
    '@{ processes = $procs; listeners = $listen } | ConvertTo-Json -Depth 3 -Compress'
  ].join('; ');
  return new Promise(function (resolve) {
    childProcess.execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      function (err, stdout) {
        if (err) return resolve({ processes: [], listeners: [], error: String(err.message || err) });
        try {
          const j = JSON.parse(stdout);
          resolve({ processes: [].concat(j.processes || []), listeners: [].concat(j.listeners || []) });
        } catch (e) {
          resolve({ processes: [], listeners: [], error: '行程清單無法解析' });
        }
      });
  });
}

/* 要關掉的伺服器行程：{ pid, port, windowPid }。
     - 回報本副本的埠 → 監聽那個埠的 node
     - 命令列指向本副本 editor-server.cjs 的 node（當掉、不回應的也認得出來）
   windowPid 是它的伺服器視窗（父行程是跑 editor_server_window.bat 的 cmd）：
   強制結束時連視窗一起關，不留一個停在「按任意鍵繼續」的空殼。 */
function ourServers(snapshot, hits, repoRoot) {
  const script = normalPath(path.join(repoRoot, 'tools', 'vfx', 'editor-server.cjs'));
  const procs = (snapshot && snapshot.processes) || [];
  const listeners = (snapshot && snapshot.listeners) || [];
  const byPid = new Map(procs.map(function (p) { return [Number(p.ProcessId), p]; }));
  const found = new Map();

  function isNode(p) { return !!p && /(^|\\)node\.exe$/i.test(String(p.Name || '')); }

  function add(pid, port) {
    const proc = byPid.get(pid);
    if (!isNode(proc)) return;                  // 只碰 node：監聽那個埠的若是別的程式，不是我們的伺服器
    const entry = found.get(pid) || { pid: pid, port: null, windowPid: null };
    if (port) entry.port = port;
    const parent = byPid.get(Number(proc.ParentProcessId));
    if (parent && /cmd\.exe$/i.test(String(parent.Name || '')) &&
        /editor_server_window\.bat/i.test(String(parent.CommandLine || ''))) {
      entry.windowPid = Number(parent.ProcessId);
    }
    found.set(pid, entry);
  }

  (hits || []).forEach(function (hit) {
    listeners.forEach(function (l) {
      if (Number(l.LocalPort) === hit.port) add(Number(l.OwningProcess), hit.port);
    });
  });
  procs.forEach(function (p) {
    if (!isNode(p)) return;
    const cmd = String(p.CommandLine || '').replace(/\//g, '\\').toLowerCase();
    if (cmd.indexOf(script) < 0) return;
    const listen = listeners.find(function (l) { return Number(l.OwningProcess) === Number(p.ProcessId); });
    add(Number(p.ProcessId), listen ? Number(listen.LocalPort) : null);
  });
  return Array.from(found.values());
}

/* ---------------- 關伺服器 ---------------- */

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function taskkill(pid, tree) {
  return new Promise(function (resolve) {
    const args = ['/PID', String(pid)].concat(tree ? ['/T'] : []).concat(['/F']);
    childProcess.execFile('taskkill', args, { windowsHide: true }, function (err) { resolve(!err); });
  });
}

/* 等到這些 PID 都結束、這些埠也不再以本副本身分回應；時間到就回報還剩哪些。 */
function waitStopped(pids, hitPorts, timeoutMs, scanFn) {
  const until = Date.now() + timeoutMs;
  return new Promise(function (resolve) {
    (function poll() {
      const alivePids = pids.filter(alive);
      scanFn({ ports: hitPorts, timeoutMs: 400 }).then(function (still) {
        const ports = still.map(function (h) { return h.port; });
        if ((!alivePids.length && !ports.length) || Date.now() >= until) {
          return resolve({ pids: alivePids, ports: ports });
        }
        setTimeout(poll, 200);
      });
    })();
  });
}

/* 強制結束之前重新確認：那個 PID 現在還是本副本的伺服器嗎？
   從發現到強制結束之間隔了幾秒，PID 有可能已經被系統拿去給別的程式用。 */
function stillOurs(stuck, snapshotFn, repoRoot) {
  return snapshotFn().then(function (snap) {
    const now = ourServers(snap, [], repoRoot);
    const listeners = snap.listeners || [];
    return stuck.filter(function (s) {
      if (now.some(function (n) { return n.pid === s.pid; })) return true;
      /* 由埠認出來的（命令列不含本副本路徑，例如 AI 工具的預覽伺服器）：還是 node、還在聽同一個埠才算 */
      const proc = (snap.processes || []).find(function (p) { return Number(p.ProcessId) === s.pid; });
      return !!proc && /node\.exe$/i.test(String(proc.Name || '')) && !!s.port &&
        listeners.some(function (l) { return Number(l.OwningProcess) === s.pid && Number(l.LocalPort) === s.port; });
    });
  });
}

function describeServer(s) {
  return 'PID ' + s.pid + (s.port ? '，埠 ' + s.port : '，沒有回應') + (s.windowPid ? '，有伺服器視窗' : '');
}

/* 回傳關不掉的那些 { pid, port }，全部關掉就是空陣列。 */
function stopAll(servers, hits, log, deps) {
  const d = Object.assign({
    scan: scan, snapshot: systemSnapshot, kill: taskkill, repoRoot: REPO_ROOT, stopTimeoutMs: STOP_TIMEOUT_MS
  }, deps || {});
  const hitPorts = hits.map(function (h) { return h.port; });
  const responsive = servers.filter(function (s) { return s.port && hitPorts.indexOf(s.port) >= 0; });
  const hung = servers.filter(function (s) { return responsive.indexOf(s) < 0; });

  function force(list, reason) {
    list.forEach(function (s) {
      log('  PID ' + s.pid + reason + '，強制結束' + (s.windowPid ? '（連同它的伺服器視窗）' : ''));
    });
    return Promise.all(list.map(function (s) { return d.kill(s.windowPid || s.pid, !!s.windowPid); }));
  }

  return Promise.all([force(hung, ' 沒有回應')].concat(hits.map(function (h) {
    return request(h.port, 'POST', identity.SHUTDOWN_PATH, '{}', 1500);
  })))
    .then(function () {
      return waitStopped(servers.map(function (s) { return s.pid; }), hitPorts, d.stopTimeoutMs, d.scan);
    })
    .then(function (state) {
      const stuck = servers.filter(function (s) { return state.pids.indexOf(s.pid) >= 0; });
      if (!stuck.length) return state;
      return stillOurs(stuck, d.snapshot, d.repoRoot)
        .then(function (confirmed) { return force(confirmed, ' 關不掉'); })
        .then(function () {
          return waitStopped(stuck.map(function (s) { return s.pid; }), hitPorts, d.stopTimeoutMs, d.scan);
        });
    })
    .then(function (state) {
      const left = servers.filter(function (s) { return state.pids.indexOf(s.pid) >= 0; })
        .map(function (s) { return { pid: s.pid, port: s.port }; });
      state.ports.forEach(function (port) {
        if (!left.some(function (l) { return l.port === port; })) left.push({ pid: null, port: port });
      });
      return left;
    });
}

/* ---------------- 開伺服器、開頁面 ---------------- */

/* start "標題" cmd /c tools\vfx\editor_server_window.bat
   /c 後面刻意不加引號，理由見 editor_server_window.bat 開頭。
   windowsVerbatimArguments：命令列照字面交給 cmd，Node 不另外加引號或跳脫。 */
function startServerWindow() {
  const child = childProcess.spawn('cmd.exe',
    ['/d', '/s', '/c', 'start "' + WINDOW_TITLE + '" cmd /c tools\\vfx\\editor_server_window.bat'],
    { cwd: REPO_ROOT, detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
  child.unref();
}

/* 網址裡的 preset 已經過 preset-id-policy（只有小寫英數與連字號），埠是數字，
   所以不會有 & 之類的字元被 cmd 當成指令分隔。 */
function openBrowser(url) {
  const child = childProcess.spawn('cmd.exe', ['/d', '/s', '/c', 'start "" "' + url + '"'],
    { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
  child.unref();
}

/* 等到有一台「本副本、而且程式是新的」伺服器回應，回傳它的埠；逾時回傳 null。 */
function waitReady(timeoutMs, scanFn) {
  const scanner = scanFn || scan;
  const until = Date.now() + timeoutMs;
  return new Promise(function (resolve) {
    (function poll() {
      scanner({ timeoutMs: 500 }).then(function (hits) {
        const fresh = hits.find(function (h) { return h.fresh; });
        if (fresh) return resolve(fresh.port);
        if (Date.now() >= until) return resolve(null);
        setTimeout(poll, 300);
      });
    })();
  });
}

/* 失敗訊息附上這段埠目前被誰佔著 */
function listeningSummary() {
  const ports = portRange();
  return new Promise(function (resolve) {
    childProcess.execFile('netstat', ['-ano', '-p', 'tcp'], { windowsHide: true }, function (err, stdout) {
      if (err) return resolve('');
      resolve(String(stdout).split(/\r?\n/).filter(function (l) {
        return /LISTENING/.test(l) && ports.some(function (p) { return l.indexOf(':' + p + ' ') >= 0; });
      }).join('\n'));
    });
  });
}

/* ---------------- 主流程 ---------------- */

function defaultDeps() {
  return {
    log: function (s) { console.log(s); },
    platform: process.platform,
    scan: scan,
    snapshot: systemSnapshot,
    stopAll: stopAll,
    startServerWindow: startServerWindow,
    waitReady: waitReady,
    openBrowser: openBrowser,
    listening: listeningSummary
  };
}

function printListening(log, d) {
  return d.listening().then(function (text) {
    if (!text) return;
    log('');
    log('  目前占用 ' + rangeText() + ' 這段連接埠的程序：');
    log(text);
  });
}

/* 回傳結束代碼：0 成功（.bat 直接關窗）、1 失敗（.bat 會 pause 讓人看得到原因）。 */
function main(argv, deps) {
  const d = Object.assign(defaultDeps(), deps || {});
  const log = d.log;
  const args = parseArgs(argv);

  log(LINE);
  log('  VFX 編輯器');
  log(LINE);
  log('  工作副本');
  log('    ' + REPO_ROOT);
  log('  Preset');
  log('    ' + (args.preset || '（不指定，開空場景）'));
  log(LINE);
  if (args.presetProblem) {
    log('');
    log('  參數「' + args.rawPreset + '」不能當成特效名稱：' + args.presetProblem);
    log('  改開空場景');
  }
  if (d.platform !== 'win32') {
    log('');
    log('  這個啟動器只支援 Windows。其他系統請直接執行 node tools/vfx/editor-server.cjs');
    return Promise.resolve(1);
  }

  return d.scan().then(function (hits) {
    return d.snapshot().then(function (snap) {
      const servers = ourServers(snap, hits, REPO_ROOT);
      if (!hits.length && !servers.length) return [];
      log('');
      log('先關掉本副本正在執行的編輯器伺服器：');
      servers.forEach(function (s) { log('  ' + describeServer(s)); });
      hits.forEach(function (h) {
        if (!servers.some(function (s) { return s.port === h.port; })) log('  埠 ' + h.port + '（查不到 PID）');
      });
      return d.stopAll(servers, hits, log).then(function (left) {
        if (!left.length) log('  已關閉。');
        return left;
      });
    });
  }).then(function (left) {
    if (left.length) {
      log('');
      log(LINE);
      log('  有伺服器關不掉，沒有啟動新的');
      log(LINE);
      left.forEach(function (l) {
        log('  ' + (l.pid ? 'PID ' + l.pid : 'PID 查不到') + (l.port ? '，埠 ' + l.port : ''));
      });
      log('');
      log('  請開工作管理員 →「詳細資料」，結束上面列出的 PID，再執行一次本檔。');
      return printListening(log, d).then(function () { log(LINE); return 1; });
    }

    log('');
    log('啟動伺服器…');
    d.startServerWindow();
    log('等待伺服器就緒…');
    return d.waitReady(READY_TIMEOUT_MS).then(function (port) {
      if (!port) {
        log('');
        log(LINE);
        log('  伺服器在 ' + (READY_TIMEOUT_MS / 1000) + ' 秒內沒有就緒');
        log(LINE);
        log('  請看剛才開啟的「VFX 編輯器伺服器」視窗，錯誤原因會印在那裡');
        log('  （最常見的是這台電腦還沒設定素材庫位置）。');
        return printListening(log, d).then(function () { log(LINE); return 1; });
      }
      const url = editorUrl(port, args.preset);
      log('');
      log('正在開啟：');
      log('  ' + url);
      if (!args.noBrowser) d.openBrowser(url);
      return 0;
    });
  }).catch(function (e) {
    log('');
    log('啟動失敗：' + (e && e.stack || e));
    return 1;
  });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(function (code) { process.exitCode = code; });
}

module.exports = {
  parseArgs: parseArgs,
  editorUrl: editorUrl,
  parseWhoami: parseWhoami,
  ourServers: ourServers,
  scan: scan,
  stopAll: stopAll,
  waitReady: waitReady,
  main: main
};
