const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

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

function makeFolder(files, writeLastModified) {
  const map = new Map();
  const payloadSize = (raw) => {
    if (raw instanceof ArrayBuffer) return raw.byteLength;
    if (ArrayBuffer.isView(raw)) return raw.byteLength;
    return Buffer.byteLength(String(raw));
  };
  const payloadText = (raw) => {
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString('utf8');
    return String(raw);
  };
  const payloadArrayBuffer = (raw) => {
    if (raw instanceof ArrayBuffer) return raw.slice(0);
    if (ArrayBuffer.isView(raw)) return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    const buf = Buffer.from(String(raw));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  };
  Object.keys(files || {}).forEach((name) => {
    map.set(name, {
      name,
      raw: files[name].raw,
      lastModified: files[name].lastModified,
      size: payloadSize(files[name].raw)
    });
  });

  function handleFor(file) {
    return {
      getFile() {
        return Promise.resolve({
          size: payloadSize(file.raw),
          lastModified: file.lastModified,
          text: () => Promise.resolve(payloadText(file.raw)),
          arrayBuffer: () => Promise.resolve(payloadArrayBuffer(file.raw))
        });
      },
      createWritable() {
        return Promise.resolve({
          write(raw) {
            file.raw = raw;
            file.size = payloadSize(raw);
            return Promise.resolve();
          },
          close() {
            file.lastModified = writeLastModified;
            return Promise.resolve();
          },
          abort() { return Promise.resolve(); }
        });
      }
    };
  }

  return {
    name: 'Save',
    getFile(name) { return map.get(name); },
    async *values() {
      for (const file of map.values()) {
        yield { kind: 'file', name: file.name, getFile: handleFor(file).getFile };
      }
    },
    getFileHandle(name, opts) {
      if (!map.has(name)) {
        if (!opts || !opts.create) return Promise.reject(new Error('not found'));
        map.set(name, { name, raw: '', lastModified: 0, size: 0 });
      }
      return Promise.resolve(handleFor(map.get(name)));
    }
  };
}

function loadSaveContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    localStorage: makeLocalStorage(),
    location: { reload() {} },
    window: {},
    indexedDB: null,
    document: { addEventListener() {} },
    Blob,
    Response,
    TextDecoder,
    DecompressionStream: globalThis.DecompressionStream
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function saveData(level, stage, zone, savedAt) {
  return JSON.stringify({
    version: 1,
    runId: 1,
    savedAt,
    player: { level },
    stage: { current: stage, zone }
  });
}

test('folder scan rebuilds manual save metadata from file modified time', async () => {
  const context = loadSaveContext();
  const fname = 'IC_manual_existing.json';
  context.localStorage.setItem(context.SAVE_INDEX_KEY, JSON.stringify([
    { id: 'existing_id', kind: 'manual', runId: 1, savedAt: 1000, fname, level: 1, stage: 1, zone: 'plains' },
    { id: 'missing_id', kind: 'manual', runId: 1, savedAt: 9999, fname: 'IC_manual_missing.json', level: 99, stage: 99, zone: 'swamp' }
  ]));
  context._saveDir = makeFolder({
    [fname]: { raw: saveData(42, 270, 'swamp', 2000), lastModified: 7000 }
  }, 0);

  await context.scanManualMetadataV2();

  const list = context.saveIndexV2();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'existing_id');
  assert.equal(list[0].fname, fname);
  assert.equal(list[0].savedAt, 7000);
  assert.equal(list[0].level, 42);
  assert.equal(list[0].stage, 270);
  assert.equal(list[0].zone, 'swamp');
});

test('folder scan reads gzip manual save metadata', async (t) => {
  if (typeof DecompressionStream !== 'function') {
    t.skip('目前 Node 執行環境沒有 DecompressionStream');
    return;
  }

  const context = loadSaveContext();
  const fname = 'IC_manual_gzip.json';
  context._saveDir = makeFolder({
    [fname]: { raw: zlib.gzipSync(saveData(77, 515, 'swamp', 3000)), lastModified: 8000 }
  }, 0);

  await context.scanManualMetadataV2();

  const list = context.saveIndexV2();
  assert.equal(list.length, 1);
  assert.equal(list[0].fname, fname);
  assert.equal(list[0].savedAt, 8000);
  assert.equal(list[0].level, 77);
  assert.equal(list[0].stage, 515);
  assert.equal(list[0].zone, 'swamp');
});

test('manual save writes current game state and records the folder modified time', async () => {
  const context = loadSaveContext();
  context._saveDir = makeFolder({}, 9000);
  context.G = {
    version: 1,
    runId: 1,
    savedAt: 1234,
    player: { level: 5501 },
    stage: { current: 270, zone: 'swamp' }
  };
  context.idbGetAutoV2 = (cb) => cb(saveData(11, 23, 'plains', 1111));
  context.idbSetAutoV2 = (raw, done) => { context._cachedAuto = raw; if (done) done(); };

  const rec = await context.createManualSaveToFolderV2();
  const written = context._saveDir.getFile(rec.fname);
  const writtenData = JSON.parse(written.raw);
  const list = context.saveIndexV2();

  assert.equal(writtenData.player.level, 5501);
  assert.equal(writtenData.stage.current, 270);
  assert.equal(written.lastModified, 9000);
  assert.equal(rec.savedAt, 9000);
  assert.equal(list[0].savedAt, 9000);
});

test('auto folder sync records the folder modified time in auto metadata', async () => {
  const context = loadSaveContext();
  context._saveDir = makeFolder({}, 12000);
  context.idbGetAutoV2 = (cb) => cb(saveData(18, 45, 'desert', 3000));

  await context.syncAutoSaveToFolderV2();

  const autoMeta = JSON.parse(context.localStorage.getItem(context.AUTO_META_KEY_V2));
  assert.equal(context._saveDir.getFile('IC_autosave.json').lastModified, 12000);
  assert.equal(autoMeta.savedAt, 12000);
  assert.equal(autoMeta.level, 18);
  assert.equal(autoMeta.stage, 45);
  assert.equal(autoMeta.zone, 'desert');
});
