'use strict';
/* 桌面版存檔（Steam 任務 C）：
   - electron/save-files.cjs：檔名白名單、原子寫入、上一版備份、同檔寫入排隊
   - js/desktop-save-dir.js：File System Access 目錄把手的替身
   - 端到端：真正的 save.js／storage.js 在桌面模式下把自動存檔、手動存檔寫成實體檔，開機讀得回來

   端到端那段的 ApexHost.saves 直接接到 save-files.cjs、寫進暫存資料夾——
   中間只少了 Electron 的 IPC 傳遞，遊戲端與磁碟端都是真的程式碼。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const SaveFiles = require('../electron/save-files.cjs');

const root = path.resolve(__dirname, '..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idle-rpg-saves-'));
}

/* ---- save-files.cjs ---- */

test('檔名白名單：只接受單層 *.json', () => {
  for (const ok of ['IC_autosave_app-game.json', 'IC_manual_20261117_120000.json', 'a.json']) {
    assert.equal(SaveFiles.validName(ok), true, ok);
  }
  for (const bad of ['../x.json', '..\\x.json', 'a/b.json', 'a\\b.json', 'x.txt', '.json', '.hidden.json',
    'C:x.json', 'x.json.bak', 'x..json', '', null, 'a'.repeat(200) + '.json']) {
    assert.equal(SaveFiles.validName(bad), false, String(bad));
  }
});

test('寫入、讀取、列出、刪除；不合法檔名直接拒絕', async () => {
  const dir = tempDir();
  const info = await SaveFiles.write(dir, 'a.json', 'hello');
  assert.equal(info.size, 5);
  assert.equal(SaveFiles.read(dir, 'a.json').data.toString(), 'hello');
  assert.equal(SaveFiles.read(dir, 'missing.json'), null);
  assert.deepEqual(SaveFiles.list(dir).map((f) => f.name), ['a.json']);
  SaveFiles.remove(dir, 'a.json');
  SaveFiles.remove(dir, 'a.json');   // 不存在也算成功
  assert.deepEqual(SaveFiles.list(dir), []);
  await assert.rejects(SaveFiles.write(dir, '../escape.json', 'x'));
  assert.throws(() => SaveFiles.read(dir, '../escape.json'));
  assert.equal(fs.existsSync(path.join(dir, '..', 'escape.json')), false);
});

test('覆寫時留下上一版 .bak，且不留暫存檔；.bak 與暫存檔不出現在清單裡', async () => {
  const dir = tempDir();
  await SaveFiles.write(dir, 'save.json', 'v1');
  await SaveFiles.write(dir, 'save.json', 'v2');
  assert.equal(fs.readFileSync(path.join(dir, 'save.json'), 'utf8'), 'v2');
  assert.equal(fs.readFileSync(path.join(dir, 'save.json.bak'), 'utf8'), 'v1');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['save.json', 'save.json.bak']);
  assert.deepEqual(SaveFiles.list(dir).map((f) => f.name), ['save.json']);
});

test('同一個檔案的寫入依呼叫順序完成，後送的內容不會被先送的蓋掉', async () => {
  const dir = tempDir();
  const big = Buffer.alloc(4 * 1024 * 1024, 1);   // 先送大檔，讓它比較慢完成
  await Promise.all([SaveFiles.write(dir, 's.json', big), SaveFiles.write(dir, 's.json', 'latest')]);
  assert.equal(fs.readFileSync(path.join(dir, 's.json'), 'utf8'), 'latest');
});

test('開機清掉上次中斷留下的暫存檔，不碰其他檔案', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'save.json.tmp-123-456'), 'half');
  fs.writeFileSync(path.join(dir, 'save.json'), 'ok');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep');
  assert.equal(SaveFiles.cleanupTemp(dir), 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.txt', 'save.json']);
});

/* ---- 遊戲端：在 vm 裡載入真正的 desktop-save-dir.js／save.js／storage.js ---- */

function hostFor(dir) {
  return {
    list: () => Promise.resolve(SaveFiles.list(dir)),
    read: (name) => Promise.resolve().then(() => {
      const r = SaveFiles.read(dir, name);
      return r && { data: new Uint8Array(r.data), size: r.size, mtimeMs: r.mtimeMs };
    }),
    write: (name, data) => SaveFiles.write(dir, name, data),
    remove: (name) => Promise.resolve(SaveFiles.remove(dir, name))
  };
}

function makeStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    key: (i) => Array.from(data.keys())[i] || null
  };
}

function loadGame(opts) {
  const context = {
    console,
    localStorage: makeStorage(),
    sessionStorage: makeStorage(),
    location: { origin: opts.origin || 'app://game', reload() {} },
    indexedDB: null,
    document: { addEventListener() {} },
    setTimeout, clearTimeout,
    Blob, Response, File, DOMException, TextEncoder, TextDecoder,
    CompressionStream: globalThis.CompressionStream,
    DecompressionStream: globalThis.DecompressionStream
  };
  context.window = context;
  if (opts.host) context.ApexHost = { isDesktop: true, saves: opts.host };
  if (opts.picker) context.showDirectoryPicker = opts.picker;
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/desktop-save-dir.js', 'js/save.js', 'js/storage.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
  });
  // IndexedDB 不在測試範圍：自動快取一律視為寫入成功、讀不到東西
  context.idbSetAutoV2 = (raw, cb) => { if (cb) cb(null); };
  context.idbGetAutoV2 = (cb) => cb(null);
  return context;
}

function saveJson(level, savedAt) {
  return JSON.stringify({ version: 1, runId: 1, savedAt, savedBy: 'app-game', player: { level }, stage: { current: 3, zone: 'desert' } });
}

function persist(ctx, kind, json, meta) {
  return new Promise((resolve, reject) => ctx.SaveStorage.persist(kind, json, meta, (err) => (err ? reject(err) : resolve())));
}

function decodeFile(file) {
  const buf = fs.readFileSync(file);
  return (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString('utf8');
}

test('網頁版沒有 ApexHost：DesktopSaveDir 為 null，資料夾把手照舊從瀏覽器取得', async () => {
  const ctx = loadGame({ origin: 'http://localhost:8124' });
  assert.equal(ctx.DesktopSaveDir, null);
  const got = await new Promise((r) => ctx.idbGetDir(r));
  assert.equal(got, null);   // 測試環境沒有 IndexedDB，網頁版路徑回 null
});

test('桌面版：idbGetDir 交出固定的存檔資料夾，且永遠不叫出資料夾選擇器', async () => {
  const dir = tempDir();
  let pickerCalls = 0;
  const ctx = loadGame({ host: hostFor(dir), picker: () => { pickerCalls++; return Promise.reject(new Error('不該被呼叫')); } });
  const got = await new Promise((r) => ctx.idbGetDir(r));
  assert.equal(got, ctx.DesktopSaveDir);
  assert.equal(got.isDesktop, true);
  assert.equal(await got.requestPermission({ mode: 'readwrite' }), 'granted');
  const res = await new Promise((resolve) => ctx.openSaveFolderV2((err, r) => resolve({ err, r }), true));
  assert.equal(res.err, null);
  assert.equal(pickerCalls, 0, '桌面版的存檔資料夾固定，按「開啟」也不能讓玩家改選');
});

test('桌面版：每次自動存檔都寫出存檔檔（Steam Cloud 才拿得到最新進度），內容可解回原本的 JSON', async () => {
  const dir = tempDir();
  const ctx = loadGame({ host: hostFor(dir) });
  ctx._saveDir = ctx.DesktopSaveDir;
  const json = saveJson(12, 1000);
  await persist(ctx, 'auto', json, { savedAt: 1000 });
  const file = path.join(dir, 'IC_autosave_app-game.json');
  assert.ok(fs.existsSync(file), '自動存檔沒有寫成檔案');
  assert.equal(decodeFile(file), json);

  const json2 = saveJson(13, 2000);
  await persist(ctx, 'autoNow', json2, { savedAt: 2000 });   // 關窗存檔
  assert.equal(decodeFile(file), json2);
  assert.equal(decodeFile(file + '.bak'), json, '覆寫前的那一份要留成 .bak');
});

test('桌面版：手動存檔寫成 IC_manual_*.json，並出現在存檔清單索引', async () => {
  const dir = tempDir();
  const ctx = loadGame({ host: hostFor(dir) });
  ctx._saveDir = ctx.DesktopSaveDir;
  const meta = { id: 'manual_x', kind: 'manual', runId: 1, savedAt: 3000, fname: 'IC_manual_20261117_120000.json', level: 5, stage: 2, zone: 'desert' };
  await persist(ctx, 'manual', saveJson(5, 3000), meta);
  assert.ok(fs.existsSync(path.join(dir, meta.fname)));
  assert.ok(ctx.saveIndexV2().some((r) => r.fname === meta.fname), '手動存檔沒有進清單');
});

test('桌面版：開機從存檔資料夾讀回最新進度（即使環境沒有 showDirectoryPicker）', async () => {
  const dir = tempDir();
  const writer = loadGame({ host: hostFor(dir) });
  writer._saveDir = writer.DesktopSaveDir;
  await persist(writer, 'auto', saveJson(42, 5000), { savedAt: 5000 });

  const reader = loadGame({ host: hostFor(dir) });   // 新的一次開機，例如換台電腦後 Steam Cloud 把檔案拉下來
  const booted = await new Promise((resolve) => reader.SaveStorage.readBootSave((save, info) => resolve({ save, info })));
  assert.ok(booted.save, '開機沒讀到存檔');
  assert.equal(booted.save.player.level, 42);
  assert.equal(booted.info.source, 'own', '自己寫的存檔檔不該觸發接手確認');
  assert.equal(reader._saveDir, reader.DesktopSaveDir);
});

test('替身把手：不存在的檔案回 NotFoundError；values() 列出全部存檔；removeEntry 刪得掉', async () => {
  const dir = tempDir();
  const ctx = loadGame({ host: hostFor(dir) });
  const d = ctx.DesktopSaveDir;
  await assert.rejects(d.getFileHandle('nope.json', { create: false }), (e) => e.name === 'NotFoundError');
  const fh = await d.getFileHandle('IC_manual_a.json', { create: true });
  const w = await fh.createWritable({ keepExistingData: false });
  await w.write('{"version":1}');
  await w.close();
  const file = await fh.getFile();
  assert.equal(await file.text(), '{"version":1}');
  assert.ok(file.lastModified > 0);
  const names = [];
  for await (const ent of d.values()) names.push(ent.kind + ':' + ent.name);
  assert.deepEqual(names, ['file:IC_manual_a.json']);
  await d.removeEntry('IC_manual_a.json');
  assert.equal(fs.existsSync(path.join(dir, 'IC_manual_a.json')), false);
});

test('替身把手：abort 之後磁碟上的舊檔不受影響', async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 's.json'), 'old');
  const ctx = loadGame({ host: hostFor(dir) });
  const fh = await ctx.DesktopSaveDir.getFileHandle('s.json', { create: true });
  const w = await fh.createWritable();
  await w.write('new');
  await w.abort();
  assert.equal(fs.readFileSync(path.join(dir, 's.json'), 'utf8'), 'old');
});

test('接線：desktop-save-dir.js 在 save.js 之前載入', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const a = html.indexOf('js/desktop-save-dir.js');
  const b = html.indexOf('js/save.js');
  assert.ok(a > 0 && b > a);
});
