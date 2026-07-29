const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const tabLockSrc = fs.readFileSync(path.join(root, 'js/tablock.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8');
const protocolSrc = fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---- 假的 Web Locks ----
   只實作本專案用到的語意：ifAvailable 拿不到時以 null 呼叫回呼，
   拿得到就在回呼回傳的 Promise 解決前一直持有。回呼一律非同步呼叫（與瀏覽器一致）。 */
function makeLocks() {
  const state = { held: false };
  return {
    state,
    api: {
      request(name, opts, cb) {
        opts = opts || {};
        if (state.held) {
          if (opts.ifAvailable) return Promise.resolve().then(() => cb(null));
          return new Promise(() => {}); // 排隊模式：本專案刻意不使用
        }
        state.held = true;
        return Promise.resolve().then(() => {
          const held = cb({ name });
          if (held && typeof held.then === 'function') {
            return held.then(() => { state.held = false; });
          }
          state.held = false;
        });
      }
    }
  };
}

function makeDom() {
  const byId = new Map();
  const make = (tag) => {
    const el = {
      tagName: tag,
      style: { cssText: '' },
      children: [],
      textContent: '',
      disabled: false,
      _id: '',
      get id() { return this._id; },
      set id(v) { this._id = v; byId.set(v, this); },
      setAttribute() {},
      addEventListener(type, fn) { if (type === 'click') el.onclick = fn; },
      appendChild(child) { el.children.push(child); return child; },
      focus() {},
      get parentNode() { return el._parent || null; }
    };
    return el;
  };
  const body = make('body');
  body.appendChild = (child) => { body.children.push(child); child._parent = body; return child; };
  body.removeChild = (child) => {
    body.children = body.children.filter((c) => c !== child);
    child._parent = null;
    if (child.id) byId.delete(child.id);
    return child;
  };
  return {
    byId,
    document: {
      // 解析中：模組只會註冊 DOMContentLoaded，由各測試自行呼叫 start()
      readyState: 'loading',
      body,
      createElement: make,
      getElementById: (id) => byId.get(id) || null,
      addEventListener() {}
    }
  };
}

function makeSessionStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    api: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k)
    }
  };
}

function loadTabLock(opts) {
  opts = opts || {};
  const locks = makeLocks();
  if (opts.lockHeldByOtherTab) locks.state.held = true;
  const dom = makeDom();
  const session = makeSessionStorage(opts.session);
  const log = [];
  const channels = [];
  const context = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    Promise,
    Date,
    setTimeout,
    clearTimeout,
    navigator: { locks: locks.api },
    document: dom.document,
    window: {},
    sessionStorage: session.api,
    location: { href: 'http://localhost/', reload() { log.push('reload'); } },
    hideLoadingScreen() { log.push('hideLoading'); },
    BroadcastChannel: function (name) {
      this.name = name;
      this.postMessage = (msg) => { log.push(['broadcast', msg.type]); };
      channels.push(this);
    },
    WorkerBridge: opts.workerBridge || {
      handoff(done) { log.push('handoff'); done(); }
    }
  };
  vm.createContext(context);
  vm.runInContext(tabLockSrc, context, { filename: 'js/tablock.js' });
  return { context, locks, dom, session, log, channels, TabLock: context.TabLock };
}

test('取得多分頁鎖的分頁才初始化遊戲，且持續持有鎖', async () => {
  const env = loadTabLock();
  const ran = [];
  env.TabLock.onGranted(() => ran.push('bridge'));
  env.TabLock.onGranted(() => ran.push('main'));

  env.TabLock._internal.start();
  await tick();

  assert.deepEqual(ran, ['bridge', 'main'], '應依註冊順序執行（bridge 先於 main）');
  assert.equal(env.locks.state.held, true, '成為控制分頁後必須持續持有鎖');
  assert.equal(env.TabLock.isHolder(), true);
  assert.equal(env.dom.byId.has('tab-lock-notice'), false, '控制分頁不應出現遮罩');
});

test('鎖已被其他分頁持有時完全不初始化，只顯示可接管的遮罩', async () => {
  const env = loadTabLock({ lockHeldByOtherTab: true });
  const ran = [];
  env.TabLock.onGranted(() => ran.push('init'));

  env.TabLock._internal.start();
  await tick();

  assert.deepEqual(ran, [], '拿不到鎖就不得建立 Worker／initUI／讀存檔');
  assert.equal(env.TabLock.isHolder(), false);
  const overlay = env.dom.byId.get('tab-lock-notice');
  assert.ok(overlay, '應顯示多分頁遮罩');
  assert.equal(env.dom.byId.get('tab-lock-btn').textContent, '在此分頁接管');
  assert.ok(env.log.includes('hideLoading'), '遮罩出現時要收掉 Loading 動畫，否則底下會一直轉');
});

test('接管：廣播讓位要求後輪詢取得鎖，成功才初始化', async () => {
  const env = loadTabLock({ lockHeldByOtherTab: true });
  const ran = [];
  env.TabLock.onGranted(() => ran.push('init'));
  env.TabLock._internal.start();
  await tick();

  env.dom.byId.get('tab-lock-btn').onclick();
  await tick();
  assert.deepEqual(env.log.filter((e) => Array.isArray(e)), [['broadcast', 'yield-request']]);
  assert.deepEqual(ran, [], '對方還沒讓位前不得開機');

  env.locks.state.held = false; // 對方讓位
  await sleep(400);             // 輪詢間隔 250ms
  assert.deepEqual(ran, ['init']);
  assert.equal(env.locks.state.held, true);
});

test('讓位：必須先落地完成才放開鎖並重載', async () => {
  const order = [];
  let finishHandoff;
  const env = loadTabLock({
    workerBridge: {
      handoff(done) { order.push('handoff-start'); finishHandoff = done; }
    }
  });
  env.TabLock.onGranted(() => {});
  env.TabLock._internal.start();
  await tick();

  env.channels[0].onmessage({ data: { type: 'yield-request' } });
  assert.deepEqual(order, ['handoff-start']);
  assert.equal(env.locks.state.held, true, '存檔還沒落地完成就放開鎖，接管方會讀到舊資料');
  assert.equal(env.log.includes('reload'), false);

  finishHandoff(); // 落地完成
  await tick();
  assert.equal(env.locks.state.held, false, '落地完成後才釋出鎖');
  assert.ok(env.log.includes('reload'), '讓位後重載，避免畫面停在凍結的舊數值');
  assert.ok(env.session.map.get('idlerpg.tablock.yielded'), '需留下讓位旗標');
});

test('讓位後重載回來的分頁不自動搶鎖，避免兩個分頁互搶', async () => {
  const env = loadTabLock({ session: { 'idlerpg.tablock.yielded': String(Date.now()) } });
  const ran = [];
  env.TabLock.onGranted(() => ran.push('init'));

  env.TabLock._internal.start();
  await tick();

  assert.deepEqual(ran, [], '剛讓位就搶回來會來回互搶');
  assert.equal(env.locks.state.held, false, '不搶鎖，把空窗留給接管方');
  assert.ok(env.dom.byId.get('tab-lock-notice'), '仍顯示遮罩，玩家可自行按接管');
  assert.equal(env.session.map.has('idlerpg.tablock.yielded'), false, '旗標只擋一次');
});

test('過期的讓位旗標不再擋搶鎖', async () => {
  const env = loadTabLock({ session: { 'idlerpg.tablock.yielded': String(Date.now() - 60000) } });
  const ran = [];
  env.TabLock.onGranted(() => ran.push('init'));

  env.TabLock._internal.start();
  await tick();

  assert.deepEqual(ran, ['init'], '玩家隔很久自己按 F5 時應照常開機');
});

test('瀏覽器不支援 Web Locks 時照常開機（不能因此讓玩家完全不能玩）', async () => {
  const env = loadTabLock();
  env.context.navigator = {};
  const ran = [];
  env.TabLock.onGranted(() => ran.push('init'));
  env.TabLock._internal.start();
  await tick();
  assert.deepEqual(ran, ['init']);
});

/* ---- bridge 端 ----
   交接的正確性完全取決於「存檔真的寫完了沒」，而主執行緒自己就是落地端，
   所以這條順序必須在 bridge 這一側釘住。 */
function loadBridge() {
  const writes = [];
  const posted = [];
  const order = [];
  let worker = null;
  const context = {
    console: { log() {}, info() {}, warn() {}, error() {} },
    Promise, Date, setTimeout, clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    performance: { now: () => 0 },
    location: { search: '', href: 'http://localhost/' },
    document: { hidden: false, addEventListener() {} },
    window: { addEventListener() {} },
    TabLock: { onGranted() {} },
    MINI: null,
    SaveStorage: {
      persist(kind, json, meta, done) {
        order.push('write-start:' + kind);
        writes.push({ kind, done });
      },
      readBootSave() {},
      maxRunId: () => 1
    },
    Worker: function () {
      this.postMessage = (msg) => posted.push(msg);
      this.terminate = () => order.push('terminate');
      worker = this;
    }
  };
  vm.createContext(context);
  vm.runInContext(protocolSrc, context, { filename: 'js/worker/protocol.js' });
  vm.runInContext(bridgeSrc, context, { filename: 'js/bridge.js' });
  return { context, writes, posted, order, getWorker: () => worker };
}

test('分頁交接：送出 app.handoff 並等到存檔真的落地才放手', async () => {
  const env = loadBridge();
  env.context.WorkerBridge.start({ save: null, maxRunId: 1 });
  const worker = env.getWorker();
  worker.onmessage({ data: { type: 'booted', protocolVersion: env.context.WORKER_PROTOCOL_VERSION } });

  env.context.WorkerBridge.handoff(() => env.order.push('handoff-done'));
  await tick();

  const cmd = env.posted.find((m) => m.type === 'cmd');
  assert.ok(cmd, '應送出指令');
  assert.equal(cmd.name, 'app.handoff');

  // Worker 先發 persist 再回 ack（postMessage 保證順序），主執行緒此時開始寫入
  worker.onmessage({
    data: { type: 'persist', token: 'p1', kind: 'shutdown', payload: { json: '{}', meta: {} } }
  });
  worker.onmessage({ data: { type: 'ack', id: cmd.id, ok: true } });
  await sleep(120);

  assert.equal(env.order.includes('handoff-done'), false, '寫入還沒完成就放手會讓接管方讀到舊存檔');

  env.writes[0].done(null); // 落地完成
  await sleep(120);

  assert.deepEqual(env.order, ['write-start:shutdown', 'terminate', 'handoff-done']);
});

test('Worker 已經死掉時交接不卡住', async () => {
  const env = loadBridge();
  env.context.WorkerBridge.start({ save: null, maxRunId: 1 });
  // 沒有 booted：Worker 根本沒起來
  let done = false;
  env.context.WorkerBridge.handoff(() => { done = true; });
  await tick();
  assert.equal(done, true, '卡在這裡會讓玩家兩個分頁都動不了');
});

test('接線：tablock 早於 bridge 載入，且 bridge 與 main 都改由 TabLock 啟動', () => {
  const tabLockAt = html.indexOf('js/tablock.js');
  const bridgeAt = html.indexOf('js/bridge.js');
  const mainAt = html.indexOf('js/main.js');
  assert.ok(tabLockAt > 0, 'index.html 必須載入 js/tablock.js');
  assert.ok(tabLockAt < bridgeAt && tabLockAt < mainAt, 'tablock 必須早於 bridge 與 main');
  // 允許中間有註解：這裡要驗的是「開機掛在 TabLock 上、進去第一件事就是讀存檔」
  assert.match(bridgeSrc, /TabLock\.onGranted\(function \(\) \{[\s\S]*?SaveStorage\.readBootSave/);
  assert.match(mainSrc, /TabLock\.onGranted\(function \(\) \{\s*initUI\(\);/);
  assert.doesNotMatch(mainSrc, /addEventListener\('DOMContentLoaded'/);
});
