const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeLocalStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
    key(index) { return Array.from(data.keys())[index] || null; }
  };
}

function loadSaveContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    localStorage: makeLocalStorage(),
    location: { reload() {} },
    window: {},
    document: { addEventListener() {} },
    Blob,
    Response,
    TextDecoder,
    TextEncoder,
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function loadMigrationContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    localStorage: makeLocalStorage(),
    location: { reload() {} },
    window: {},
    document: { addEventListener() {} },
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/skills.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('gzip 存檔可往返解壓，且明顯小於原始 JSON', async (t) => {
  const context = loadSaveContext();
  if (typeof context.CompressionStream !== 'function') {
    t.skip('目前 Node 執行環境沒有 CompressionStream');
    return;
  }

  const raw = JSON.stringify({ version: 1, factory: { conveyor: Array(200).fill({ rarity: 2, level: 270, name: '傳說的裝備' }) } });
  const compressed = await context.encodeSavePayloadV2(raw);

  assert.ok(compressed instanceof ArrayBuffer);
  assert.equal(new Uint8Array(compressed)[0], 0x1f);
  assert.ok(compressed.byteLength < Buffer.byteLength(raw));
  assert.equal(await context.decodeSavePayloadV2(compressed), raw);
});

test('舊版純 JSON 存檔仍可直接讀取', async () => {
  const context = loadSaveContext();
  const raw = JSON.stringify({ version: 1, player: { level: 42 } });

  assert.equal(await context.decodeSavePayloadV2(raw), raw);
  assert.equal(context.parseSaveTextV2(raw).version, 1);
  assert.equal(context.parseSaveTextV2(raw).player.level, 42);
});

test('載入舊存檔時會裁掉超過 20,000 件的輸送帶尾端', () => {
  const context = loadMigrationContext();
  const data = context.newGameState();
  data.factory.conveyor = Array.from({ length: 20005 }, (_, index) => ({
    id: 'item-' + index,
    name: '普通的裝備',
    rarity: 0,
    level: 1,
    affixes: [],
    sockets: []
  }));

  const migrated = context.migrateSave(data);

  assert.equal(migrated.factory.conveyor.length, 20000);
  assert.equal(migrated.factory.conveyor[0].id, 'item-0');
  assert.equal(migrated.factory.conveyor[19999].id, 'item-19999');
});
