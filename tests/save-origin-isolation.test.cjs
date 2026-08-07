const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const bridgeSrc = fs.readFileSync(path.join(root, 'js/bridge.js'), 'utf8');
const originSrc = fs.readFileSync(path.join(root, 'js/save_origin.js'), 'utf8');

/* 2026-07-29 事故的結構性成因：存檔資料夾是實體目錄、不分 origin，
   而 IndexedDB／localStorage／navigator.locks 全部以 origin 為界。
   兩個 port（127.0.0.1:5500 與 localhost:8341）因此各自以為自己是唯一的玩家，
   卻整夜對同一個 IC_autosave.json 互相整份覆寫。

   修法兩層：
   (a) 自動存檔一個 origin 一個檔名 → 互相覆寫不再發生
   (b) 回退讀舊檔名時先問過玩家 → 不再有「靜靜接手另一個網址的角色」 */

function makeFolder(files, writeLastModified) {
  const map = new Map();
  const size = (raw) => Buffer.byteLength(String(raw));
  Object.keys(files || {}).forEach((name) => {
    map.set(name, { name, raw: files[name].raw, lastModified: files[name].lastModified });
  });
  function handleFor(file) {
    return {
      getFile() {
        return Promise.resolve({
          size: size(file.raw),
          lastModified: file.lastModified,
          text: () => Promise.resolve(String(file.raw)),
          arrayBuffer: () => {
            const b = Buffer.from(String(file.raw));
            return Promise.resolve(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
          }
        });
      },
      createWritable() {
        return Promise.resolve({
          write(raw) { file.raw = raw; return Promise.resolve(); },
          close() { file.lastModified = writeLastModified; return Promise.resolve(); },
          abort() { return Promise.resolve(); }
        });
      }
    };
  }
  return {
    name: 'Saves',
    names: () => Array.from(map.keys()),
    getFile: (name) => map.get(name),
    async *values() {
      for (const f of map.values()) yield { kind: 'file', name: f.name, getFile: handleFor(f).getFile };
    },
    getFileHandle(name, opts) {
      if (!map.has(name)) {
        if (!opts || !opts.create) return Promise.reject(new Error('not found'));
        map.set(name, { name, raw: '', lastModified: 0 });
      }
      return Promise.resolve(handleFor(map.get(name)));
    }
  };
}

function makeLocalStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    key: (i) => Array.from(data.keys())[i] || null
  };
}

function loadSaveContext(origin) {
  const context = {
    console,
    localStorage: makeLocalStorage(),
    location: { origin, reload() {} },
    window: {},
    indexedDB: null,
    document: { addEventListener() {} },
    Blob, Response, TextDecoder,
    DecompressionStream: globalThis.DecompressionStream
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/save.js', 'js/storage.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), context, { filename: f });
  });
  return context;
}

function saveJson(level, stage, savedAt, savedBy) {
  const d = { version: 1, runId: 1, savedAt, player: { level }, stage: { current: stage, zone: 'desert' } };
  if (savedBy) d.savedBy = savedBy;
  return JSON.stringify(d);
}

/* ---- (a) 檔名帶 origin ---- */

test('自動存檔的檔名依 origin 決定，不同 port 不會是同一個檔案', () => {
  const a = loadSaveContext('http://127.0.0.1:5500');
  const b = loadSaveContext('http://localhost:8341');

  assert.equal(a.AUTO_FOLDER_FILE_V2, 'IC_autosave_http-127.0.0.1-5500.json');
  assert.equal(b.AUTO_FOLDER_FILE_V2, 'IC_autosave_http-localhost-8341.json');
  assert.notEqual(a.AUTO_FOLDER_FILE_V2, b.AUTO_FOLDER_FILE_V2,
    '兩個 port 若共用檔名，就會像 7/29 那樣整夜互相整份覆寫');
  assert.equal(a.AUTO_FOLDER_FILE_LEGACY_V2, 'IC_autosave.json', '舊檔名必須保留為讀取回退');
  assert.notEqual(a.AUTO_FOLDER_FILE_V2, a.AUTO_FOLDER_FILE_LEGACY_V2);
});

test('取不到 origin 時仍產生合法檔名，不得是 undefined 或 null', () => {
  const c = loadSaveContext(undefined);
  assert.equal(c.AUTO_FOLDER_FILE_V2, 'IC_autosave_local.json');
});

test('寫入一律用自己的檔名，永遠不碰舊檔名', async () => {
  const context = loadSaveContext('http://localhost:8341');
  context._saveDir = makeFolder({
    'IC_autosave.json': { raw: saveJson(99, 500, 1000), lastModified: 1000 }
  }, 5000);
  context.idbGetAutoV2 = (cb) => cb(saveJson(7, 3, 2000));

  await context.syncAutoSaveToFolderV2();

  assert.ok(context._saveDir.names().includes('IC_autosave_http-localhost-8341.json'),
    '應寫進自己這個 origin 的檔案');
  assert.equal(context._saveDir.getFile('IC_autosave.json').lastModified, 1000,
    '舊檔名必須原封不動——它可能是別的網址的存檔');
});

/* ---- 讀取與回退 ---- */

test('讀得到自己的檔案時直接採用，不去碰舊檔名', async () => {
  const context = loadSaveContext('http://localhost:8341');
  context._saveDir = makeFolder({
    'IC_autosave_http-localhost-8341.json': { raw: saveJson(42, 88, 9000), lastModified: 9000 },
    'IC_autosave.json': { raw: saveJson(999, 700, 99000), lastModified: 99000 }
  }, 0);

  const res = await new Promise((r) => context.readFolderAutoV2(r));
  assert.equal(res.source, 'own');
  assert.equal(res.data.player.level, 42,
    '即使舊檔名那份比較新，也不能拿別的網址的存檔蓋掉自己的');
});

test('自己的檔案不存在時回退舊檔名，並標記成需要確認的來源', async () => {
  const context = loadSaveContext('http://localhost:8341');
  context._saveDir = makeFolder({
    'IC_autosave.json': { raw: saveJson(310, 640, 7000), lastModified: 7000 }
  }, 0);

  const res = await new Promise((r) => context.readFolderAutoV2(r));
  assert.equal(res.source, 'legacy', '回退讀到的存檔必須標記出來，開機流程才知道要先問玩家');
  assert.equal(res.fname, 'IC_autosave.json');
  assert.equal(res.data.player.level, 310, '回退本身必須成立，否則既有玩家升級後等同存檔消失');
});

/* ---- (b) 開機來源判定 ---- */

function readBootSave(context, folderFiles, cacheJson) {
  context.window.showDirectoryPicker = function () {};
  context.idbGetDir = (cb) => cb(context._storedDir);
  context._storedDir = makeFolder(folderFiles, 0);
  context._storedDir.requestPermission = () => Promise.resolve('granted');
  context.idbGetAutoV2 = (cb) => cb(cacheJson || null);
  return new Promise((r) => context.SaveStorage.readBootSave((save, info) => r({ save, info })));
}

test('開機採用自己的檔案時直接放行，不打擾玩家', async () => {
  const context = loadSaveContext('http://localhost:8341');
  const { save, info } = await readBootSave(context, {
    'IC_autosave_http-localhost-8341.json': { raw: saveJson(50, 120, 8000), lastModified: 8000 }
  });
  assert.equal(save.player.level, 50);
  assert.equal(info.source, 'own');
});

test('開機回退到舊檔名時標記 legacy，並備妥拒絕接手時的替代存檔', async () => {
  const context = loadSaveContext('http://localhost:8341');
  const { save, info } = await readBootSave(
    context,
    { 'IC_autosave.json': { raw: saveJson(310, 640, 90000), lastModified: 90000 } },
    saveJson(12, 20, 1000)
  );
  assert.equal(save.player.level, 310);
  assert.equal(info.source, 'legacy');
  assert.equal(info.fname, 'IC_autosave.json');
  assert.equal(info.fallback.player.level, 12,
    '玩家拒絕接手時要有東西可退回，否則只能開新局');
});

test('檔名是自己的、內容卻標記著別的 origin 時，一樣要確認', async () => {
  const context = loadSaveContext('http://localhost:8341');
  const { info } = await readBootSave(context, {
    'IC_autosave_http-localhost-8341.json': {
      raw: saveJson(50, 120, 8000, 'http-127.0.0.1-5500'), lastModified: 8000
    }
  });
  assert.equal(info.source, 'foreign');
  assert.equal(info.savedBy, 'http-127.0.0.1-5500');
});

test('瀏覽器本機快取永遠不必確認——它的作用域就是 origin', async () => {
  const context = loadSaveContext('http://localhost:8341');
  const { save, info } = await readBootSave(context, {}, saveJson(66, 200, 50000));
  assert.equal(save.player.level, 66);
  assert.equal(info.source, 'own');
});

/* ---- (b) 確認關卡 ---- */

function loadOriginGate() {
  function el(tag) {
    const node = {
      tag, style: {}, children: [], listeners: {}, textContent: '',
      setAttribute() {}, focus() {},
      appendChild(c) { node.children.push(c); c.parentNode = node; return c; },
      removeChild(c) { node.children = node.children.filter((x) => x !== c); },
      addEventListener(ev, fn) { (node.listeners[ev] || (node.listeners[ev] = [])).push(fn); }
    };
    return node;
  }
  const body = el('body');
  const context = {
    console, Date, Number, String,
    AUTO_FOLDER_FILE_V2: 'IC_autosave_http-localhost-8341.json',
    document: { createElement: el, body }
  };
  vm.createContext(context);
  vm.runInContext(originSrc, context, { filename: 'js/save_origin.js' });
  const buttons = () => {
    const out = [];
    (function walk(n) { if (n.tag === 'button') out.push(n); n.children.forEach(walk); })(body);
    return out;
  };
  return { context, body, buttons };
}

test('自己的存檔與空存檔直接放行，正式環境玩家不會看到確認視窗', () => {
  const { context, body } = loadOriginGate();
  const seen = [];
  context.SaveOrigin.gate({ player: { level: 5 } }, { source: 'own' }, (s) => seen.push(s));
  context.SaveOrigin.gate(null, { source: 'legacy' }, (s) => seen.push(s));
  assert.equal(seen.length, 2);
  assert.equal(seen[1], null);
  assert.equal(body.children.length, 0, '不該有任何遮罩');
});

test('回退接手時攔下開機並詢問；玩家同意才載入那份存檔', () => {
  const { context, body, buttons } = loadOriginGate();
  const save = { player: { level: 310 }, stage: { current: 640 }, savedAt: 1750000000000 };
  let booted = 'NOT-CALLED';
  context.SaveOrigin.gate(save, { source: 'legacy', fname: 'IC_autosave.json', fallback: null },
    (s) => { booted = s; });

  assert.equal(booted, 'NOT-CALLED', '玩家還沒回答就開機，等於又一次靜靜接手');
  assert.equal(body.children.length, 1, '應顯示確認遮罩');

  buttons()[0].listeners.click[0]();          // 接手這份存檔
  assert.equal(booted, save);
  assert.equal(body.children.length, 0, '決定後遮罩必須移除');
});

test('玩家拒絕接手時改用本機存檔，沒有本機存檔就開新局', () => {
  const fallback = { player: { level: 12 } };
  let env = loadOriginGate();
  let booted = 'NOT-CALLED';
  env.context.SaveOrigin.gate({ player: { level: 310 } },
    { source: 'legacy', fname: 'IC_autosave.json', fallback: fallback }, (s) => { booted = s; });
  env.buttons()[1].listeners.click[0]();      // 不接手
  assert.equal(booted, fallback);

  env = loadOriginGate();
  booted = 'NOT-CALLED';
  env.context.SaveOrigin.gate({ player: { level: 310 } },
    { source: 'foreign', fname: 'x.json', savedBy: 'http-127.0.0.1-5500', originTag: 'http-localhost-8341', fallback: null },
    (s) => { booted = s; });
  env.buttons()[1].listeners.click[0]();
  assert.equal(booted, null, '沒有替代存檔時應開新局，而不是硬吃別的網址那份');
});

/* ---- 接線 ---- */

test('接線：save_origin 早於 bridge 載入，且開機流程確實經過它', () => {
  const originAt = html.indexOf('js/save_origin.js');
  const bridgeAt = html.indexOf('js/bridge.js');
  const storageAt = html.indexOf('js/storage.js');
  assert.ok(originAt > 0, 'index.html 必須載入 js/save_origin.js');
  assert.ok(storageAt < originAt && originAt < bridgeAt,
    'save_origin 需在 storage 之後、bridge 之前載入');
  assert.match(bridgeSrc, /SaveOrigin\.gate\(save, info, function \(approved\)/,
    '開機必須經過確認關卡，不能直接把讀到的存檔丟給 Worker');
});
