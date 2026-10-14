'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'js', name), 'utf8');
const quiet = { log() {}, info() {}, warn() {}, error() {} };

function bridge() {
  const posted = [], writes = [], timers = [];
  let worker;
  const ctx = { console: quiet, location: { search: '', href: 'http://localhost/' },
    document: { hidden: false, addEventListener() {} }, performance: { now: () => 0 },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {}, TabLock: { onGranted() {} },
    SaveStorage: { persist(kind, json, meta, done) { writes.push({ kind, json, meta, done }); } },
    Worker: function () { worker = this; this.postMessage = msg => posted.push(msg); this.terminate = () => {}; }
  };
  vm.createContext(ctx); vm.runInContext(read('worker/protocol.js'), ctx); vm.runInContext(read('bridge.js'), ctx);
  ctx.WorkerBridge.start({});
  const send = data => worker.onmessage({ data });
  send({ type: ctx.MSG_OUT.BOOTED, protocolVersion: ctx.WORKER_PROTOCOL_VERSION });
  const persist = token => send({ type: ctx.MSG_OUT.PERSIST, token, kind: ctx.PERSIST_KINDS.AUTO_NOW, payload: { json: '{"progress":17}', meta: { id: 'auto_current' } } });
  const ack = token => { const cmd = posted.filter(p => p.type === ctx.MSG_IN.CMD).at(-1); send({ type: ctx.MSG_OUT.ACK, id: cmd.id, ok: true, result: token }); };
  return { ctx, posted, writes, timers, persist, ack };
}

test('立即存檔必須等真正落地；重複操作共用同一請求', async () => {
  const b = bridge(); let settled = false;
  const promise = b.ctx.WorkerBridge.saveAutoNow();
  assert.equal(b.ctx.WorkerBridge.saveAutoNow(), promise);
  promise.then(() => { settled = true; });
  b.persist('p1'); b.ack('p1'); await Promise.resolve(); await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(b.writes[0].meta.id, 'auto_current');
  b.writes[0].done(null); assert.equal(await promise, true);
  assert.equal(b.posted.at(-1).ok, true);
});

test('落地早於ACK仍能正確對應同一存檔token', async () => {
  const b = bridge(); const promise = b.ctx.WorkerBridge.saveAutoNow();
  b.persist('p2'); b.writes[0].done(null); b.ack('p2');
  assert.equal(await promise, true);
});

test('落地失敗傳回錯誤，不能把ACK當成存檔成功', async () => {
  const b = bridge(); const promise = b.ctx.WorkerBridge.saveAutoNow();
  b.persist('p3'); b.ack('p3'); b.writes[0].done(new Error('QuotaExceeded'));
  await assert.rejects(promise, /QuotaExceeded/);
  assert.equal(b.posted.at(-1).ok, false);
});

test('逾時後的晚回覆不完成新的存檔操作', async () => {
  const b = bridge(); const old = b.ctx.WorkerBridge.saveAutoNow();
  b.persist('old'); b.ack('old'); b.timers.find(t => t.ms === 10000).fn();
  await assert.rejects(old, /逾時/);
  const next = b.ctx.WorkerBridge.saveAutoNow(); let settled = false;
  next.then(() => { settled = true; }); b.persist('next'); b.ack('next'); b.writes[0].done(null);
  await Promise.resolve(); await Promise.resolve(); assert.equal(settled, false);
  b.writes[1].done(null); assert.equal(await next, true);
});

test('正式Worker從權威G產生auto_current，保留補進度savedAt語意', () => {
  const sent = [];
  const ctx = { console: quiet, location: { search: '' }, performance: { now: () => 0 },
    importScripts() {}, self: { postMessage: msg => sent.push(msg) }, setInterval() {}, clearInterval() {},
    setTimeout() {}, clearTimeout() {}, Date: { now: () => 5000000 } };
  vm.createContext(ctx); vm.runInContext(read('worker/protocol.js'), ctx); vm.runInContext(read('worker/sim.worker.js'), ctx);
  ctx.G = { savedAt: 123, player: { level: 88 }, progress: 'worker-authority' };
  ctx.saveRecMeta = () => ({ id: 'auto_current', kind: 'auto', level: 88 });
  ctx.AUTO_FOLDER_FILE_V2 = 'IC_autosave.json'; ctx._catchupDebt = 3600;
  ctx.DETERMINISTIC_STEPS = true;
  const token = ctx.COMMAND_IMPL['save.auto']();
  const message = sent.find(m => m.token === token);
  assert.equal(message.kind, 'autoNow');
  assert.equal(message.payload.meta.id, 'auto_current');
  const save = JSON.parse(message.payload.json);
  assert.equal(save.progress, 'worker-authority'); assert.equal(save.savedAt, 1400000);
  assert.equal(ctx.requestPersist(ctx.PERSIST_KINDS.AUTO), null, '未要求的決定論自動寫入仍禁止');
});

test('Storage立即寫入自動快取，不要求資料夾、不建立手動檔', () => {
  let callback, strict, stored, meta, result;
  const ctx = { console: quiet, setTimeout, clearTimeout, _saveDir: null,
    idbSetAutoV2(json, done, opts) { stored = json; callback = done; strict = opts.strict; },
    writeAutoMetaV2(value) { meta = value; } };
  vm.createContext(ctx); vm.runInContext(read('storage.js'), ctx);
  ctx.SaveStorage.persist('autoNow', 'authoritative-json', { id: 'auto_current' }, err => { result = err || 'ok'; });
  assert.equal(stored, 'authoritative-json'); assert.equal(strict, true); assert.equal(result, undefined);
  callback(null); assert.equal(result, 'ok'); assert.equal(meta.id, 'auto_current');
});

test('Storage不吞掉IndexedDB失敗', () => {
  const failure = new Error('disk full'); let result;
  const ctx = { setTimeout, clearTimeout, idbSetAutoV2(json, done) { done(failure); }, writeAutoMetaV2() { throw Error('不應寫metadata'); } };
  vm.createContext(ctx); vm.runInContext(read('storage.js'), ctx);
  ctx.SaveStorage.persist('autoNow', '{}', {}, err => { result = err; }); assert.equal(result, failure);
});

test('較早排程的auto不能在玩家立即存檔完成後覆蓋新進度', () => {
  const idle = [], writes = [], done = [];
  const ctx = { setTimeout, clearTimeout, _saveDir: null, SAVE_KEY: 'legacy',
    localStorage: { removeItem() {} }, requestIdleCallback(fn) { idle.push(fn); }, writeAutoMetaV2() {},
    idbSetAutoV2(json, callback, opts) { writes.push({ json, callback, strict: !!(opts && opts.strict) }); } };
  vm.createContext(ctx); vm.runInContext(read('storage.js'), ctx);
  ctx.SaveStorage.persist('auto', 'older', {}, err => done.push(['older', err]));
  ctx.SaveStorage.persist('autoNow', 'latest', {}, err => done.push(['latest', err]));
  assert.equal(writes.length, 0); idle.shift()(); assert.equal(writes[0].json, 'older');
  writes[0].callback(null); assert.equal(writes[1].json, 'latest'); assert.equal(writes[1].strict, true);
  assert.equal(done.length, 1); writes[1].callback(null); assert.equal(done.length, 2);
  assert.equal(idle.length, 0, '立即寫入不得再次排idle，亦不得殘留舊auto');
});

test('更新快照取代待寫的立即存檔時，仍保留嚴格落地確認', () => {
  const idle = [], writes = [], results = [];
  const ctx = { setTimeout, clearTimeout, _saveDir: null, SAVE_KEY: 'legacy', localStorage: { removeItem() {} },
    requestIdleCallback(fn) { idle.push(fn); }, writeAutoMetaV2() {},
    idbSetAutoV2(json, callback, opts) { writes.push({ json, callback, strict: !!(opts && opts.strict) }); } };
  vm.createContext(ctx); vm.runInContext(read('storage.js'), ctx);
  ctx.SaveStorage.persist('auto', 'first', {}, () => {});
  ctx.SaveStorage.persist('autoNow', 'manual-request', {}, err => results.push(err));
  ctx.SaveStorage.persist('auto', 'newest', {}, err => results.push(err));
  idle.shift()(); writes[0].callback(null);
  assert.equal(writes[1].json, 'newest'); assert.equal(writes[1].strict, true);
  const error = new Error('write failed'); writes[1].callback(error);
  assert.equal(results.length, 2); assert.ok(results.every(e => e === error));
});

function idbWriter(encode = value => Promise.resolve(value)) {
  let tx;
  const ctx = { _autoWriteSeqV2: 0, _autoRawV2: null, AUTO_CACHE_KEY_V2: 'auto', encodeSavePayloadV2: encode,
    idbKV(cb) { cb({ transaction() { tx = { objectStore: () => ({ put() {} }) }; return tx; } }); } };
  vm.createContext(ctx);
  const fn = read('save.js').match(/function idbSetAutoV2\([\s\S]*?(?=\nfunction idbGetAutoV2)/)[0];
  vm.runInContext(fn, ctx); return { ctx, tx: () => tx };
}

test('IndexedDB交易完成才成功，onerror加onabort只回報一次', async () => {
  const b = idbWriter(); let count = 0, result;
  b.ctx.idbSetAutoV2('{}', err => { count++; result = err; }, { strict: true }); await Promise.resolve();
  assert.equal(count, 0); b.tx().error = new Error('quota'); b.tx().onerror(); b.tx().onabort();
  assert.equal(count, 1); assert.match(result.message, /quota/);
});

test('壓縮失敗／資料庫無法開啟／嚴格寫入被取代皆不得回報成功', async () => {
  let result;
  const bad = idbWriter(() => Promise.reject(new Error('compression')));
  bad.ctx.idbSetAutoV2('{}', err => { result = err; }); await Promise.resolve(); await Promise.resolve();
  assert.match(result.message, /compression/);
  const noDb = idbWriter(); noDb.ctx.idbKV = cb => cb(null);
  noDb.ctx.idbSetAutoV2('{}', err => { result = err; }); await Promise.resolve(); assert.match(result.message, /儲存空間/);
  const race = idbWriter(); race.ctx.idbSetAutoV2('older', err => { result = err; }, { strict: true });
  race.ctx.idbSetAutoV2('newer', () => {}); await Promise.resolve(); assert.match(result.message, /取代/);
});
