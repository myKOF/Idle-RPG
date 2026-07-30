const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const workerSrc = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8');
const storageSrc = fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8');
const protocolSrc = fs.readFileSync(path.join(root, 'js/worker/protocol.js'), 'utf8');

/* 2026-07-29 事故：兩個分頁整夜掛機，早上回來時任何操作都要等十秒，其中一個分頁還跳出
   「離線 6 小時」——但分頁從未關閉。

   成因是自動存檔的節流基準用「這次 loop 模擬掉的遊戲秒數」累加。正常運行時一次 loop
   就是一步 TICK_MS，遊戲時間等於真實時間，看不出差別；但分頁被瀏覽器凍結數小時後，
   Worker 會累積大筆欠帳，一次 loop 補掉數十秒遊戲時間，於是：
     自動存檔 15 秒一次 → 每個 loop（0.1 秒）一次      （約 150 倍）
     資料夾同步 10 分鐘一次 → 約 1.3 秒一次            （約 450 倍）
   每一次都是「整份存檔序列化 → 跨執行緒複製 → 主執行緒 gzip 與 IndexedDB／檔案寫入」，
   主執行緒因此被塞滿，watchdog 收不到訊息就把正在工作的 Worker 判死並重啟，
   重啟丟掉欠帳、改用固定費率的離線收益結算——那就是玩家看到的「離線 6 小時」。

   本檔鎖住修好後的四件事：節流基準是真實時間、落地端會合併同種類寫入、
   savedAt 帶著欠帳走、watchdog 在補進度期間放寬判定。 */

function loadWorkerContext(initialNow = 100000, perfStepMs = 0) {
  const clock = { now: initialNow, perf: 0 };
  const context = {
    console,
    location: { search: '' },
    performance: { now: () => (clock.perf += perfStepMs) },
    importScripts() {},
    self: { postMessage() {} },
    setInterval() { return 1; },
    clearInterval() {},
    Date: { now: () => clock.now },
    PERSIST_KINDS: { SHUTDOWN: 'shutdown', AUTO: 'auto', FOLDER: 'folder' }
  };
  vm.createContext(context);
  vm.runInContext(workerSrc, context, { filename: 'js/worker/sim.worker.js' });
  context.reportError = (where, err) => { throw err; };
  context.updateShownRes = () => {};
  context.maintainGemShop = () => {};
  context.checkForgeUnlockNotice = () => {};
  context.emitTick = () => {};
  context.simStep = () => {};
  return { context, clock };
}

// 已開機、跟得上進度的 Worker：時間基準全部對齊當下（與 boot 結尾做的事相同）
function markBooted(context, clock) {
  context._booted = true;
  context._lastTickAt = clock.now;
  context._lastEmitAt = clock.now;
  context._lastAutoAt = clock.now;
  context._lastFolderAt = clock.now;
}

test('補欠帳期間，自動存檔與資料夾同步仍以真實時間節流', () => {
  // 每次讀 performance.now 前進 1ms → CPU 預算 30ms 約補 30 步，一次 loop 補不完
  const { context, clock } = loadWorkerContext(100000, 1);
  markBooted(context, clock);
  const persists = [];
  context.requestPersist = (kind) => persists.push(kind);

  // 分頁被瀏覽器凍結 8 小時後回到前景
  clock.now += 8 * 3600 * 1000;
  context.loop();
  assert.ok(context._catchupDebt > 3600,
    `凍結 8 小時應留下大筆欠帳，實際 ${context._catchupDebt} 秒`);

  // 這一次 loop 本來就該存（距上次已 8 小時），從這裡開始計數
  persists.length = 0;

  // 回到前景後的 100 次 loop＝真實時間 10 秒
  for (let i = 0; i < 100; i++) { clock.now += 100; context.loop(); }
  assert.ok(context._catchupDebt > 0, '前提檢查：這 10 秒內欠帳應仍未補完');
  assert.equal(persists.filter((k) => k === 'auto').length, 0,
    '真實時間才過 10 秒（< AUTOSAVE_SEC），不得因為模擬掉大量遊戲時間就存檔');
  assert.equal(persists.filter((k) => k === 'folder').length, 0,
    '真實時間才過 10 秒（<< FOLDER_AUTOSAVE_SEC），不得同步資料夾');

  // 再跑到真實時間滿 20 秒：該存的還是要存，節流不是停用
  for (let i = 0; i < 100; i++) { clock.now += 100; context.loop(); }
  assert.equal(persists.filter((k) => k === 'auto').length, 1,
    '真實時間過 20 秒應剛好存一次自動存檔');
});

test('節流累加器已完全移除，不得再以模擬出的遊戲時間當基準', () => {
  assert.doesNotMatch(workerSrc, /_autosaveAcc|_folderAcc|_emitAcc/,
    '舊的遊戲時間累加器應已改為真實時間的時間戳（_lastAutoAt / _lastFolderAt / _lastEmitAt）');
  assert.match(workerSrc, /now - _lastAutoAt >= AUTOSAVE_SEC \* 1000/);
  assert.match(workerSrc, /now - _lastFolderAt >= FOLDER_AUTOSAVE_SEC \* 1000/);
});

test('savedAt 記的是「模擬推進到的時刻」，未補完的欠帳不會被當成已結算', () => {
  const { context, clock } = loadWorkerContext(5000000);
  markBooted(context, clock);
  context.G = { savedAt: 0 };
  context.saveRecMeta = () => ({ id: 'auto_current', kind: 'auto' });
  context.AUTO_FOLDER_FILE_V2 = 'IC_autosave.json';
  context.MSG_OUT = { PERSIST: 'persist' };
  context.post = () => {};

  // 跟得上進度時：savedAt 就是當下
  context._catchupDebt = 0;
  context.requestPersist('auto');
  assert.equal(context.G.savedAt, clock.now);

  // 還有一小時沒補完時：savedAt 必須往回扣，那一小時才會由下次開機的離線結算補回
  context._catchupDebt = 3600;
  context.requestPersist('auto');
  assert.equal(context.G.savedAt, clock.now - 3600 * 1000,
    'savedAt 若照實寫成寫入時刻，未模擬的那一小時會被離線結算誤認為已結算而蒸發');
});

/* ---- 落地端（主執行緒）---- */

function loadStorageContext() {
  const writes = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    _saveDir: null,                       // 未連接資料夾：folder 寫入直接視為成功
    _legacyPayloadsCompactedV2: true,
    SAVE_KEY: 'infinite_conquest_save_v1',
    localStorage: { removeItem() {} },
    writeAutoMetaV2() {},
    idbSetAutoV2(json, done) { writes.push(json); setTimeout(() => done(), 0); }
  };
  vm.createContext(context);
  vm.runInContext(storageSrc, context, { filename: 'js/storage.js' });
  return { context, writes };
}

/* 等待非同步寫入佇列結算完畢。
   原本固定 `setTimeout(60)`：節流佇列本身沒有 60 毫秒的保證，測試檔一多、機器一忙就會在
   回呼到齊前先斷言（實測整包並行跑時約 1/3 機率誤判），所以改成輪詢到條件成立為止，
   逾時才失敗。不改動被測邏輯，只是把「等固定時間」換成「等真正的結束條件」。 */
async function waitUntil(cond, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 2000);
  while (!cond()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
  return true;
}

test('連續多筆自動存檔只會實際寫入最新的一份，且每一筆都收到結果', async () => {
  const { context, writes } = loadStorageContext();
  const results = [];
  for (let i = 0; i < 20; i++) {
    context.SaveStorage.persist('auto', 'payload-' + i, {}, (err) => results.push(err));
  }
  assert.ok(await waitUntil(() => results.length === 20), '寫入回呼未在時限內到齊，實際 ' + results.length + '/20');

  assert.ok(writes.length <= 2,
    `20 筆請求不該變成 20 次寫入（每一份都會被下一份蓋掉），實際 ${writes.length} 次`);
  assert.equal(writes[writes.length - 1], 'payload-19',
    '最後落地的必須是最新那一份，不能是佇列裡的舊資料');
  assert.equal(results.length, 20,
    '被合併掉的請求仍須回報結果：bridge.js 靠它遞減 _pendingWrites，Worker 靠它決定 savedAt 是否退回');
  assert.ok(results.every((e) => !e), '寫入成功時不得回報錯誤');
});

test('合併後的寫入若失敗，被它取代的每一筆都要收到同一個錯誤', async () => {
  const { context } = loadStorageContext();
  const boom = new Error('quota exceeded');
  context.idbSetAutoV2 = () => { throw boom; };
  const results = [];
  for (let i = 0; i < 5; i++) {
    context.SaveStorage.persist('auto', 'payload-' + i, {}, (err) => results.push(err));
  }
  assert.ok(await waitUntil(() => results.length === 5), '寫入回呼未在時限內到齊，實際 ' + results.length + '/5');

  assert.equal(results.length, 5, '每一筆都必須收到結果');
  assert.ok(results.every((e) => e && e.message === 'quota exceeded'),
    '回報成功卻沒真的寫進去，會讓 savedAt 停在從未落地的時間點上');
});

/* ---- 存活監測（主執行緒）---- */

function loadBridgeContext(initialNow = 1000000) {
  const clock = { now: initialNow };
  const intervals = [];
  const posted = [];
  let workerStub = null;

  function WorkerStub() {
    this.onmessage = null;
    this.onerror = null;
    this.postMessage = (msg) => posted.push(msg);
    this.terminate = () => {};
    workerStub = this;
  }

  const context = {
    console,
    location: { search: '', href: 'http://localhost:5500/' },
    document: { hidden: false, addEventListener() {} },
    performance: { now: () => 0 },
    Date: { now: () => clock.now },
    Promise,
    Error,
    Object,
    JSON,
    Worker: WorkerStub,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval() {},
    setTimeout: () => 0,          // 重啟排程不真的執行，測試只看有沒有被判死
    clearTimeout() {},
    TabLock: { onGranted() {} },  // 攔住檔尾的自動開機，由測試自己呼叫 start()
    SaveStorage: { readBootSave(cb) { cb(null); }, maxRunId: () => 1 }
  };
  vm.createContext(context);
  vm.runInContext(protocolSrc, context, { filename: 'js/worker/protocol.js' });
  vm.runInContext(bridgeSrc, context, { filename: 'js/bridge.js' });

  context.WorkerBridge.start({ save: null, maxRunId: 1 });
  const watchdog = intervals.find((t) => t.ms === 3000).fn;
  const send = (msg) => workerStub.onmessage({ data: msg });
  send({ type: context.MSG_OUT.BOOTED, protocolVersion: context.WORKER_PROTOCOL_VERSION });

  const events = [];
  context.WorkerBridge.on('workerRestarting', (e) => events.push(e));
  context.WorkerBridge.on('workerDead', (e) => events.push(e));

  return { context, clock, watchdog, send, posted, events };
}

test('Worker 跟得上進度時，靜默逾時照舊判死', () => {
  const { context, clock, watchdog, send, events } = loadBridgeContext();
  send({ type: context.MSG_OUT.TICK, view: {}, catchup: 0 });

  clock.now += 6000;   // > STALL_AFTER_MS 5 秒 → 送出 PING
  watchdog();
  clock.now += 5000;   // > PONG_TIMEOUT_MS 4 秒 → 判死
  watchdog();

  assert.equal(events.length, 1, '沒有補進度時應照舊在約 10 秒內判定失效');
  assert.equal(context.WorkerBridge.status().alive, false);
});

test('Worker 正在補進度時放寬門檻，不把忙碌的 Worker 當成死掉', () => {
  const { context, clock, watchdog, send, events } = loadBridgeContext();
  send({ type: context.MSG_OUT.TICK, view: {}, catchup: 8 * 3600 });
  assert.equal(context.WorkerBridge.status().catchupSec, 8 * 3600);

  // 同樣的 11 秒靜默：跟得上進度的情況已經判死了，補進度中不該有任何動作
  clock.now += 6000;
  watchdog();
  clock.now += 5000;
  watchdog();
  assert.deepEqual(events, [], '補進度期間 11 秒靜默不得判死——重啟會丟掉已補完的進度');
  assert.equal(context.WorkerBridge.status().alive, true);

  // 但門檻是放寬不是停用：真的久到不合理仍要判死
  clock.now += 30000;   // 累計 41 秒 > CATCHUP_STALL_AFTER_MS 30 秒 → 送 PING
  watchdog();
  clock.now += 25000;   // > CATCHUP_PONG_TIMEOUT_MS 20 秒 → 判死
  watchdog();
  assert.equal(events.length, 1, '放寬後的門檻仍必須抓得到真正的死亡');
});

test('Worker 回報欠帳，主執行緒才有依據放寬門檻', () => {
  assert.match(workerSrc, /catchup: _catchupDebt > CATCHUP_REPORT_MIN_SEC/,
    'tick 必須帶上欠帳，否則主執行緒無從分辨「忙」與「死」');
  assert.match(bridgeSrc, /stats\.catchupSec = msg\.catchup \|\| 0;/);
});
