'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const now = 1806300000000;
const quiet = { log() {}, info() {}, warn() {}, error() {} };

function worker() {
  const sent = [];
  const ctx = {
    console: quiet, performance: { now: () => 0 },
    location: { origin: 'app://localhost', hostname: 'localhost', search: '' },
    setTimeout() { return 1; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    Date: class extends Date { static now() { return now; } },
    Math, JSON, URL, URLSearchParams, postMessage: message => sent.push(message)
  };
  ctx.self = ctx;
  ctx.window = ctx;
  ctx.document = {};
  ctx.importScripts = (...files) => files.forEach(file => {
    const clean = String(file).split(/[?#]/)[0];
    vm.runInContext(fs.readFileSync(path.join(root, 'js/worker', clean), 'utf8'), ctx, { filename: clean });
  });
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8'), ctx);
  ctx.G = ctx.newGameState();
  ctx.G.savedAt = 123;
  ctx.installStorageGuards();
  ctx.doSalvage = () => { ctx.G.player.scrap += 7; return { scrap: 7 }; };
  return { ctx, sent, persists: () => sent.filter(message => message.type === ctx.MSG_OUT.PERSIST) };
}

function item(id, locked = false) {
  return { id, locked, rarity: 0, level: 1, affixes: [], sockets: [] };
}

test('一鍵分解前保存完整權威快照，使用既有自動存檔及補進度時間', () => {
  const env = worker();
  env.ctx.G.inventory = [item('target'), item('keep', true)];
  env.ctx.G.player.scrap = 10;
  env.ctx._catchupDebt = 3600;
  const result = env.ctx.COMMAND_IMPL['item.salvageBulk']({});
  assert.equal(result.count, 1);
  assert.equal(result.scrap, 7);
  assert.deepEqual(Array.from(env.ctx.G.inventory, it => it.id), ['keep']);
  assert.equal(env.ctx.G.player.scrap, 17);

  const messages = env.persists();
  assert.equal(messages.length, 1);
  const message = messages[0];
  assert.equal(message.kind, env.ctx.PERSIST_KINDS.AUTO);
  assert.equal(message.payload.meta.kind, 'auto');
  assert.equal(message.payload.meta.id, 'auto_current');
  assert.equal(message.payload.meta.fname, env.ctx.AUTO_FOLDER_FILE_V2);
  assert.doesNotMatch(message.payload.meta.fname, /manual|before_bulk/);
  const saved = JSON.parse(message.payload.json);
  assert.deepEqual(saved.inventory.map(it => it.id), ['target', 'keep']);
  assert.equal(saved.player.scrap, 10, '快照必須在分解獎勵之前');
  assert.equal(saved.savedAt, now - 3600000);
  assert.equal(saved.savedBy, env.ctx.SAVE_ORIGIN_TAG_V2);

  env.ctx.onSaveResult({ token: message.token, ok: false, error: 'disk full' });
  assert.equal(env.ctx.G.savedAt, 123, '存檔失敗沿用原本的時間回退與錯誤回報');
});

test('沒有可分解目標時不建立任何存檔；決定論測試不自動落地', () => {
  const env = worker();
  for (const inventory of [[], [item('locked', true)]]) {
    env.ctx.G.inventory = inventory;
    assert.equal(env.ctx.COMMAND_IMPL['item.salvageBulk']({}).count, 0);
    assert.equal(env.persists().length, 0);
  }
  env.ctx.DETERMINISTIC_STEPS = true;
  env.ctx.G.inventory = [item('target')];
  assert.equal(env.ctx.COMMAND_IMPL['item.salvageBulk']({}).count, 1);
  assert.equal(env.persists().length, 0);
});

function storage(desktop) {
  const files = new Map(), manuals = [];
  let cache = null, autoMeta = null;
  const ctx = {
    console: quiet, setTimeout, clearTimeout, requestIdleCallback: fn => fn(),
    _saveDir: desktop ? { isDesktop: true } : null,
    SAVE_KEY: 'legacy', AUTO_FOLDER_FILE_V2: 'IC_autosave_app-localhost.json',
    localStorage: { removeItem() {} },
    idbSetAutoV2(json, done) { cache = json; done(null); },
    writeAutoMetaV2(meta) { autoMeta = meta; },
    writeRawToFolder(fname, json) { files.set(fname, json); return Promise.resolve({ lastModified: now }); },
    saveFolderMetaV2(meta) { manuals.push(meta); },
    putSaveRecord(meta) { manuals.push(meta); return true; }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/storage.js'), 'utf8'), ctx);
  return {
    files, manuals, cache: () => cache, autoMeta: () => autoMeta,
    persist: message => new Promise((resolve, reject) => ctx.SaveStorage.persist(
      message.kind, message.payload.json, message.payload.meta, err => err ? reject(err) : resolve()))
  };
}

for (const desktop of [false, true]) {
  test(`${desktop ? '桌面' : '無資料夾網頁'}：反覆分解只更新自動存檔，主動另存仍獨立保留`, async () => {
    const env = worker(), disk = storage(desktop);
    for (let i = 0; i < 12; i++) {
      env.ctx.G.inventory = [item('target-' + i)];
      env.ctx.COMMAND_IMPL['item.salvageBulk']({});
      const message = env.persists().at(-1);
      assert.ok(message, '分解必須送出保護存檔');
      await disk.persist(message);
      env.ctx.onSaveResult({ token: message.token, ok: true });
    }
    assert.equal(disk.manuals.length, 0);
    assert.equal(disk.autoMeta().id, 'auto_current');
    assert.deepEqual(JSON.parse(disk.cache()).inventory.map(it => it.id), ['target-11']);
    assert.equal(disk.files.size, desktop ? 1 : 0);
    if (desktop) {
      assert.deepEqual([...disk.files.keys()], [env.ctx.AUTO_FOLDER_FILE_V2]);
      assert.equal(disk.files.get(env.ctx.AUTO_FOLDER_FILE_V2), disk.cache());
    }

    env.ctx.COMMAND_IMPL['save.manual']({ label: '' });
    const manual = env.persists().at(-1);
    assert.equal(manual.kind, env.ctx.PERSIST_KINDS.MANUAL);
    assert.equal(manual.payload.meta.kind, 'manual');
    assert.match(manual.payload.meta.fname, /^IC_manual_/);
    await disk.persist(manual);
    assert.equal(disk.manuals.length, 1);
    assert.equal(disk.files.size, desktop ? 2 : 0);
  });
}
