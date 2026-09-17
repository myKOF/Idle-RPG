'use strict';
/* ============================================================
   vfx-editor-launcher.test.cjs — 雙擊「啟動VFX編輯器.bat」之後發生的事

   受測對象：
     啟動VFX編輯器.bat                   只放 ASCII 的殼：確認有 Node、轉交參數、失敗時 pause
     tools/vfx/launch-editor.cjs          找出本副本的舊伺服器 → 關掉 → 開新的 → 開頁面
     tools/vfx/editor_server_window.bat   伺服器視窗本體
     tools/vfx/editor-server.cjs          匯出給啟動器的常數、視窗說明

   2026-09-17 使用者回報兩件事：
     1. 啟動器判定伺服器過期那一段，說明文字被 cmd 拆碎、當成指令執行；
        其中「echo     taskkill /F /PID 那個PID」的 echo 被吃掉，taskkill 真的跑了
     2. 叫使用者去關舊伺服器的視窗——但那台可能沒有視窗、或已經當掉關不了。
        使用者提議：開新的時候自動把舊的關掉再重開
   W7／W7B／W8 原本在 vfx-editor-save.test.cjs，這次跟著啟動器一起改寫、搬到這裡。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const childProcess = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const editorServer = require('../tools/vfx/editor-server.cjs');
const launcher = require('../tools/vfx/launch-editor.cjs');
const ids = editorServer.launcher;

const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

/* ---------------- W7／W7B／W8 ---------------- */

test('W7 啟動器與伺服器對身分標記、埠範圍、關閉端點的認知一致：只有伺服器那一份', function () {
  const serverSrc = read('tools/vfx/editor-server.cjs');
  assert.ok(ids, 'editor-server.cjs 要匯出 launcher 常數');
  assert.equal(ids.WHOAMI_MARK, serverSrc.match(/const WHOAMI_MARK = '([^']+)'/)[1]);
  assert.equal(ids.WHOAMI_FRESH_MARK, serverSrc.match(/const WHOAMI_FRESH_MARK = '([^']+)'/)[1]);
  assert.equal(ids.WHOAMI_PATH, serverSrc.match(/const WHOAMI_PATH = '([^']+)'/)[1]);
  assert.equal(ids.SHUTDOWN_PATH, serverSrc.match(/const SHUTDOWN_PATH = '([^']+)'/)[1]);
  assert.equal(ids.PORT_BASE, Number(serverSrc.match(/const PORT_BASE = (\d+)/)[1]));
  assert.equal(ids.PORT_TRIES, Number(serverSrc.match(/const PORT_TRIES = (\d+)/)[1]));

  /* 兩邊各寫一份的話，遲早會有一邊改了另一邊沒改 */
  const src = read('tools/vfx/launch-editor.cjs');
  assert.ok(/require\('\.\/editor-server\.cjs'\)\.launcher/.test(src), '啟動器要讀伺服器匯出的常數');
  assert.ok(!/2836\d/.test(src), '埠號不得寫死在啟動器裡');
  assert.ok(src.indexOf(ids.WHOAMI_MARK) < 0, '身分標記不得寫死在啟動器裡');
});

test('W7B 認得出本副本的伺服器：有回應的看 /__whoami，當掉的看命令列；別的副本、別的程式一律不碰', function () {
  const mine = 'D:\\MyGame\\Idle-RPG\\claude';
  const other = 'D:\\MyGame\\Idle-RPG\\codex';
  const who = (dir, mark) => ids.WHOAMI_MARK + ' ' + dir + '\n' +
    (mark === undefined ? ids.WHOAMI_FRESH_MARK : mark) + '\n';

  assert.deepEqual(launcher.parseWhoami(who(mine), mine), { ours: true, fresh: true });
  assert.deepEqual(launcher.parseWhoami(who('d:/mygame/idle-rpg/CLAUDE'), mine), { ours: true, fresh: true },
    'Windows 的路徑不分大小寫、不分斜線方向');
  assert.deepEqual(launcher.parseWhoami(who(other), mine), { ours: false, fresh: true }, '別的副本不算');
  assert.deepEqual(launcher.parseWhoami(who(mine, 'idle-rpg-vfx-editor-stale'), mine), { ours: true, fresh: false });
  assert.deepEqual(launcher.parseWhoami(ids.WHOAMI_MARK + ' ' + mine + '\n', mine), { ours: true, fresh: false },
    '舊到沒有新舊標記的伺服器也算不新：新舊用白名單判定');
  assert.ok(ids.WHOAMI_FRESH_MARK.indexOf(ids.WHOAMI_MARK + ' ') !== 0,
    '新舊標記不得以「身分標記＋空白」開頭，否則會被誤認成身分行');

  const script = (dir) => dir + '\\tools\\vfx\\editor-server.cjs';
  const snapshot = {
    processes: [
      /* 伺服器視窗開的、已經當掉：不聽任何埠，只能靠命令列認 */
      { ProcessId: 10, ParentProcessId: 9, Name: 'node.exe', CommandLine: 'node "' + script(mine) + '"' },
      { ProcessId: 9, ParentProcessId: 1, Name: 'cmd.exe', CommandLine: 'cmd /c tools\\vfx\\editor_server_window.bat' },
      /* AI 工具的預覽伺服器：相對路徑，只能靠埠上的 /__whoami 認 */
      { ProcessId: 20, ParentProcessId: 2, Name: 'node.exe', CommandLine: 'node tools/vfx/editor-server.cjs --port 28362' },
      { ProcessId: 30, ParentProcessId: 3, Name: 'node.exe', CommandLine: 'node "' + script(other) + '"' },
      { ProcessId: 40, ParentProcessId: 4, Name: 'node.exe', CommandLine: 'node tools\\vfx\\launch-editor.cjs ""' },
      { ProcessId: 50, ParentProcessId: 5, Name: 'python.exe', CommandLine: 'python -m http.server 28365' }
    ],
    listeners: [
      { LocalPort: 28362, OwningProcess: 20 },
      { LocalPort: 28363, OwningProcess: 30 },
      { LocalPort: 28365, OwningProcess: 50 }
    ]
  };
  /* 28365 假設也回了同樣的身分——但佔著它的不是 node，不能當成伺服器殺掉 */
  const found = launcher.ourServers(snapshot, [{ port: 28362, fresh: true }, { port: 28365, fresh: true }], mine);
  const byPid = Object.fromEntries(found.map((s) => [s.pid, s]));
  assert.deepEqual(Object.keys(byPid).map(Number).sort((a, b) => a - b), [10, 20],
    '只有本副本的那兩台：' + JSON.stringify(found));
  assert.equal(byPid[10].windowPid, 9, '伺服器視窗要一起記下來，強制結束時連視窗一起關');
  assert.equal(byPid[10].port, null);
  assert.equal(byPid[20].port, 28362);
  assert.equal(byPid[20].windowPid, null);
});

test('W8 啟動器的兩支 .bat：CRLF、整個檔案只能是 ASCII（echo 行也一樣）', function () {
  /* 2026-09-17 實測：cmd 在 chcp 65001 下讀到一段很長的中文 echo 時讀檔位置錯位，
     從字的中間開始讀，把碎片當成指令執行——其中一段是說明文字裡的
     「taskkill /F /PID 那個PID」。以前的規則（中文只准出現在 echo 行）不夠，
     中文一律交給 Node 印（launch-editor.cjs、editor-server.cjs）。 */
  ['啟動VFX編輯器.bat', 'tools/vfx/editor_server_window.bat'].forEach(function (rel) {
    const raw = fs.readFileSync(path.join(REPO, rel));
    assert.ok(raw.includes(Buffer.from('\r\n')), rel + ' 必須是 CRLF');
    assert.equal((raw.toString('latin1').match(/[^\r]\n/g) || []).length, 0, rel + ' 不得有單獨的 LF 行尾');
    /* 0x0B 之類的控制字元代表路徑字面量在產生過程被轉義吃掉了（tools\vfx → tools+VT+fx） */
    assert.equal((raw.toString('latin1').match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) || []).length, 0,
      rel + ' 含異常控制字元，路徑字面量可能被轉義破壞');
    raw.toString('utf8').split('\r\n').forEach(function (line, i) {
      assert.ok(!/[^\x00-\x7f]/.test(line),
        rel + ':' + (i + 1) + ' 不得含 ASCII 以外的字元（中文一律由 Node 印）：' + line);
    });
  });

  const bat = read('啟動VFX編輯器.bat');
  assert.ok(/^node tools\\vfx\\launch-editor\.cjs "%~1"\r?$/m.test(bat),
    '參數要加引號轉交：裸的 %1 裡如果有 &，cmd 會把後面當成下一個指令');
  assert.ok(/if not "%RC%"=="0" pause/.test(bat), '失敗時要 pause，否則錯誤訊息閃一下就不見');
  /* rem 註解裡可以提到這次的事故，擋的是真正會執行的那幾行 */
  const commands = bat.split('\r\n').filter((l) => !/^\s*rem(\s|$)/i.test(l)).join('\n');
  assert.ok(!/taskkill/i.test(commands), '.bat 裡不再有 taskkill：關伺服器是 launch-editor.cjs 的事');

  const win = read('tools/vfx/editor_server_window.bat');
  assert.ok(/^node "%CD%\\tools\\vfx\\editor-server\.cjs"\r?$/m.test(win),
    '伺服器要用絕對路徑啟動：當掉、不回應的伺服器只能靠命令列裡的路徑認出來');
  assert.ok(/^set VFX_EDITOR_WINDOW=1\r?$/m.test(win), '視窗說明改由伺服器印，要告訴它自己在視窗裡');
  assert.ok(/process\.env\.VFX_EDITOR_WINDOW/.test(read('tools/vfx/editor-server.cjs')));
});

/* ---------------- 主流程（注入假的副作用） ---------------- */

function fakeDeps(over) {
  const calls = [];
  const logs = [];
  const d = Object.assign({
    log: (s) => logs.push(String(s)),
    platform: 'win32',
    scan: () => Promise.resolve([]),
    snapshot: () => Promise.resolve({ processes: [], listeners: [] }),
    stopAll: (servers, hits) => {
      calls.push(['stopAll', servers.map((s) => s.pid), hits.map((h) => h.port)]);
      return Promise.resolve([]);
    },
    startServerWindow: () => { calls.push(['start']); },
    waitReady: () => { calls.push(['waitReady']); return Promise.resolve(28361); },
    openBrowser: (url) => { calls.push(['open', url]); },
    listening: () => Promise.resolve('  TCP    127.0.0.1:28361    0.0.0.0:0    LISTENING    4321')
  }, over || {});
  return { d: d, calls: calls, logs: logs };
}

test('LAUNCH-1 本副本已經有伺服器（就算程式是新的）：先關掉，再開新的、開頁面', async function () {
  const f = fakeDeps({
    scan: () => Promise.resolve([{ port: 28361, fresh: true }]),
    snapshot: () => Promise.resolve({
      processes: [{ ProcessId: 77, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node tools/vfx/editor-server.cjs' }],
      listeners: [{ LocalPort: 28361, OwningProcess: 77 }]
    })
  });
  const code = await launcher.main(['hit-fire'], f.d);
  assert.equal(code, 0, f.logs.join('\n'));
  assert.deepEqual(f.calls.map((c) => c[0]), ['stopAll', 'start', 'waitReady', 'open'], '順序：先關舊的，再開新的');
  assert.deepEqual(f.calls[0].slice(1), [[77], [28361]]);
  assert.equal(f.calls[3][1], 'http://127.0.0.1:28361/tools/vfx/editor/index.html?preset=hit-fire');
  assert.ok(f.logs.some((l) => /已關閉/.test(l)), '要讓使用者知道舊的已經關掉了');
});

test('LAUNCH-2 沒有舊伺服器：不去關任何東西，直接開新的', async function () {
  const f = fakeDeps();
  assert.equal(await launcher.main([''], f.d), 0);
  assert.deepEqual(f.calls.map((c) => c[0]), ['start', 'waitReady', 'open']);
  assert.equal(f.calls[2][1], 'http://127.0.0.1:28361/tools/vfx/editor/index.html?preset=' + launcher.DEFAULT_PRESET,
    '沒給參數就開預設的 preset');
});

test('LAUNCH-3 有伺服器關不掉：不啟動新的，列出真正的 PID，結束代碼 1（.bat 會 pause）', async function () {
  const f = fakeDeps({
    scan: () => Promise.resolve([{ port: 28361, fresh: false }]),
    snapshot: () => Promise.resolve({
      processes: [{ ProcessId: 4321, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node tools/vfx/editor-server.cjs' }],
      listeners: [{ LocalPort: 28361, OwningProcess: 4321 }]
    }),
    stopAll: () => Promise.resolve([{ pid: 4321, port: 28361 }])
  });
  assert.equal(await launcher.main([], f.d), 1);
  assert.deepEqual(f.calls.map((c) => c[0]), [], '舊的還在就不能開新的：兩台搶同一段埠只會更亂');
  const text = f.logs.join('\n');
  assert.ok(/PID 4321/.test(text), '要列出真正的 PID：\n' + text);
  assert.ok(!/那個PID/.test(text), '不能再出現要使用者自己填 PID 的說明');
});

test('LAUNCH-4 新的伺服器沒有就緒：不開瀏覽器、結束代碼 1，並指出去看伺服器視窗', async function () {
  const f = fakeDeps({ waitReady: () => Promise.resolve(null) });
  assert.equal(await launcher.main([], f.d), 1);
  assert.ok(!f.calls.some((c) => c[0] === 'open'));
  const text = f.logs.join('\n');
  assert.ok(/「VFX 編輯器伺服器」視窗/.test(text) && /素材庫/.test(text), text);
  assert.ok(/LISTENING/.test(text), '附上這段埠目前被誰佔著');
});

test('LAUNCH-5 參數不能當成特效名稱：改開預設的並說明；--no-browser 不開瀏覽器', async function () {
  const f = fakeDeps();
  assert.equal(await launcher.main(['x & calc', '--no-browser'], f.d), 0);
  assert.ok(!f.calls.some((c) => c[0] === 'open'), '--no-browser 不開瀏覽器');
  assert.ok(f.logs.some((l) => /不能當成特效名稱/.test(l)));
  assert.ok(f.logs.some((l) => l.indexOf('preset=' + launcher.DEFAULT_PRESET) >= 0),
    '網址裡只能出現通過 id 規則的名字——它會交給 cmd 的 start');
  assert.deepEqual(launcher.parseArgs(['hit-fire']), {
    preset: 'hit-fire', rawPreset: 'hit-fire', presetProblem: null, noBrowser: false
  });
});

/* ---------------- 關伺服器（真的網路、真的行程） ---------------- */

/* 假的編輯器伺服器：回報本副本的身分；stopOnShutdown=false 時收到關閉要求也不停 */
function fakeEditorServer(stopOnShutdown) {
  const got = [];
  const sockets = new Set();
  const server = http.createServer(function (req, res) {
    got.push([req.method, req.url, String(req.headers['content-type'] || '')]);
    if (req.method === 'GET' && req.url === ids.WHOAMI_PATH) {
      res.end(ids.WHOAMI_MARK + ' ' + REPO + '\n' + ids.WHOAMI_FRESH_MARK + '\n');
      return;
    }
    if (req.method === 'POST' && req.url === ids.SHUTDOWN_PATH) {
      res.end('{"ok":true}', function () { if (stopOnShutdown) close(); });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  server.on('connection', function (s) { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  let closed = false;
  function close() {
    if (closed) return Promise.resolve();
    closed = true;
    sockets.forEach((s) => s.destroy());
    return new Promise((r) => server.close(() => r()));
  }
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ port: server.address().port, got: got, close: close });
    });
  });
}

function idleNode() {
  return childProcess.spawn(process.execPath, ['-e', 'setInterval(function () {}, 1000)'], { stdio: 'ignore' });
}

test('LAUNCH-6 有回應的伺服器：用 JSON 的 POST /__shutdown 正常關閉，不強制結束', async function () {
  const fake = await fakeEditorServer(true);
  try {
    const hits = await launcher.scan({ ports: [fake.port] });
    assert.deepEqual(hits, [{ port: fake.port, fresh: true }], '要認得出本副本的伺服器');
    const killed = [];
    const left = await launcher.stopAll([], hits, () => {}, {
      kill: (pid) => { killed.push(pid); return Promise.resolve(true); }, stopTimeoutMs: 2000
    });
    assert.deepEqual(left, [], '關閉之後這個埠不該再回應');
    assert.ok(fake.got.some((g) => g[0] === 'POST' && g[1] === ids.SHUTDOWN_PATH && /application\/json/.test(g[2])),
      '要用 JSON 的 POST：伺服器的寫入防護只收 application/json');
    assert.deepEqual(killed, [], '正常關得掉就不強制結束');
  } finally {
    await fake.close();
  }
});

test('LAUNCH-7 當掉的直接強制結束；關不掉的在強制結束前重新確認 PID，被別的程式重用就不殺', async function () {
  /* (a) 不回應的伺服器：不必等，直接強制結束 */
  const hung = idleNode();
  try {
    const killed = [];
    const left = await launcher.stopAll([{ pid: hung.pid, port: null, windowPid: null }], [], () => {}, {
      kill: (pid, tree) => { killed.push([pid, tree]); hung.kill(); return Promise.resolve(true); },
      stopTimeoutMs: 3000
    });
    assert.deepEqual(killed, [[hung.pid, false]]);
    assert.deepEqual(left, []);
  } finally {
    hung.kill();
  }

  /* (b) 有回應、收到關閉要求卻沒停 */
  const stubborn = idleNode();
  const fake = await fakeEditorServer(false);
  try {
    const hits = [{ port: fake.port, fresh: true }];
    const servers = [{ pid: stubborn.pid, port: fake.port, windowPid: null }];

    const killed = [];
    const left = await launcher.stopAll(servers, hits, () => {}, {
      kill: (pid) => { killed.push(pid); return Promise.resolve(true); },
      snapshot: () => Promise.resolve({
        processes: [{ ProcessId: stubborn.pid, ParentProcessId: 1, Name: 'notepad.exe', CommandLine: 'notepad' }],
        listeners: []
      }),
      stopTimeoutMs: 300
    });
    assert.deepEqual(killed, [], '那個 PID 已經被別的程式拿去用了，不能強制結束');
    assert.deepEqual(left.map((l) => l.pid), [stubborn.pid], '關不掉的要回報給使用者');

    const killed2 = [];
    const left2 = await launcher.stopAll(servers, hits, () => {}, {
      kill: (pid) => { killed2.push(pid); stubborn.kill(); return fake.close().then(() => true); },
      snapshot: () => Promise.resolve({
        processes: [{ ProcessId: stubborn.pid, ParentProcessId: 1, Name: 'node.exe', CommandLine: 'node tools/vfx/editor-server.cjs' }],
        listeners: [{ LocalPort: fake.port, OwningProcess: stubborn.pid }]
      }),
      stopTimeoutMs: 1500
    });
    assert.deepEqual(killed2, [stubborn.pid], '確認還是同一台伺服器，就強制結束');
    assert.deepEqual(left2, []);
  } finally {
    stubborn.kill();
    await fake.close();
  }
});
