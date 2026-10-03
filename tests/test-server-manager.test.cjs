const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '..');
const { isRelevantEndpoint } = require(path.join(root, 'tools', 'test_server_manager.cjs'));

test('測試服控制台提供啟動、列表、開啟與關閉介面', () => {
  const manager = fs.readFileSync(path.join(root, 'tools/test_server_manager.cjs'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'tools/test_server_manager.html'), 'utf8');
  const batch = fs.readFileSync(path.join(root, '啟動測試服.bat'), 'utf8');

  assert.match(manager, /\/api\/servers\/start/);
  assert.match(manager, /\/api\/sources/);
  assert.match(manager, /getSourceRoots/);
  assert.match(manager, /sourceKey/);
  assert.match(manager, /\/api\/servers\/stop/);
  assert.match(manager, /createStaticServer/);
  assert.match(manager, /server\.close/);
  assert.match(manager, /REGISTRY_FILE/);
  assert.match(manager, /persistRegistry/);
  assert.match(manager, /spawn\(process\.execPath/);
  assert.match(manager, /detached: true/);
  assert.match(manager, /--server/);
  assert.match(manager, /launchDetachedManager/);
  assert.match(manager, /Get-NetTCPConnection/);
  assert.match(manager, /httpListenerProcesses/);
  assert.match(manager, /serve\\\.ps1/);
  assert.match(manager, /discoverLocalServers/);
  assert.match(manager, /isRelevantEndpoint/);
  assert.match(manager, /managed: false/);
  assert.match(manager, /taskkill\.exe/);
  assert.match(manager, /stopExternalServerByPid/);
  assert.match(manager, /payload\.pid/);
  assert.match(html, /id="start"/);
  assert.match(html, /id="sourceRoot"/);
  assert.match(html, /\/api\/sources/);
  assert.match(html, /id="refresh"/);
  assert.match(html, /data-stop/);
  assert.match(html, /data-external/);
  assert.match(html, /Idle-RPG 測試服（PowerShell）/);
  assert.match(html, /前往/);
  assert.match(html, /function serverWindowName\(port\)/);
  assert.match(html, /target="\$\{escapeHtml\(targetName\)\}"/);
  assert.match(html, /window\.open\(url, serverWindowName\(port\)\)/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.match(html, /開啟瀏覽器/);
  assert.match(batch, /test_server_manager\.cjs/);
  assert.match(batch, /--launch-manager/);
  assert.match(batch, /Invoke-RestMethod -Uri \('http:\/\/127\.0\.0\.1:' \+ \$port \+ '\/api\/servers'\)/);
  assert.doesNotMatch(batch, /Get-CimInstance Win32_Process[\s\S]*test_server_manager\\\.cjs/);
});

test('刷新時會保留 HttpListener / HTTP.sys 啟動的測試服', () => {
  assert.equal(isRelevantEndpoint({
    processName: 'powershell',
    commandLine: 'powershell.exe -File .claude\\serve.ps1 -Port 8321',
  }), true);
  assert.equal(isRelevantEndpoint({ processName: 'System' }), true);
});

// 以 CLI 入口執行正式控制台；替身只隔離網路、開瀏覽器與延遲，不改重試邏輯。
function launchManager(occupiedCount, { open = true, errorCode = 'EADDRINUSE' } = {}) {
  const attempts = [], opens = [], timers = [], pending = [];
  const server = new EventEmitter();
  server.listen = (port, host, onListening) => {
    attempts.push({ port, host });
    if (onListening) server.once('listening', onListening);
    pending.push(() => {
      if (attempts.length <= occupiedCount) server.emit('error', Object.assign(new Error(errorCode), { code: errorCode }));
      else server.emit('listening');
    });
    return server;
  };
  const module = { exports: {} };
  function isolatedRequire(id) {
    if (id === 'http') return { createServer: () => server };
    if (id === 'child_process') return {
      spawn(file, args, options) { opens.push({ file, args, options }); return { unref() {} }; }
    };
    return require(id);
  }
  isolatedRequire.main = module;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'tools/test_server_manager.cjs'), 'utf8'), {
    module, require: isolatedRequire, __dirname: path.join(root, 'tools'),
    __filename: path.join(root, 'tools/test_server_manager.cjs'), console,
    process: { argv: ['node', 'manager', '--quiet', ...(open ? ['--open'] : [])], pid: 12345 },
    setTimeout(fn) { timers.push(fn); }
  });
  function drain() {
    while (pending.length) pending.shift()();
    while (timers.length) timers.shift()();
  }
  return { server, attempts, opens, drain };
}

for (const occupiedCount of [0, 1, 5, 20]) {
  test(`控制台 CLI：${occupiedCount} 個連續 Port 被占用，成功後只開最終地址一頁`, () => {
    const launch = launchManager(occupiedCount);
    launch.drain();
    assert.deepEqual(launch.attempts.map(a => a.port), Array.from({ length: occupiedCount + 1 }, (_, i) => 8124 + i));
    assert.equal(launch.opens.length, 1);
    assert.deepEqual(Array.from(launch.opens[0].args), ['/c', 'start', '', `http://127.0.0.1:${8124 + occupiedCount}/`]);
    assert.equal(launch.opens[0].options.windowsHide, true);
    assert.equal(launch.server.listenerCount('listening'), 0);
    // 啟動重試專用的錯誤處理不能在已啟動後殘留。
    assert.equal(launch.server.listenerCount('error'), 0);
  });
}

test('控制台 CLI：未指定 --open，即使換 Port 也不開網頁', () => {
  const launch = launchManager(5, { open: false });
  launch.drain();
  assert.equal(launch.attempts.length, 6);
  assert.equal(launch.opens.length, 0);
});

test('控制台 CLI：Port 全部占用或其他啟動錯誤不開網頁，也不留下成功回呼', () => {
  for (const [occupiedCount, errorCode, expectedAttempts] of [[21, 'EADDRINUSE', 21], [1, 'EACCES', 1]]) {
    const launch = launchManager(occupiedCount, { errorCode });
    assert.throws(() => launch.drain(), error => error.code === errorCode);
    assert.equal(launch.attempts.length, expectedAttempts);
    assert.equal(launch.opens.length, 0);
    assert.equal(launch.server.listenerCount('listening'), 0);
  }
});
