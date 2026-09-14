'use strict';
/* ============================================================
   vfx-preset-thumbs.test.cjs — 「瀏覽特效」的縮圖

   受測對象：
     tools/vfx/preset-thumbs.cjs   取景、快取、素材來源
     tools/vfx/editor-server.cjs   GET /__thumbs/<presetId>.png
     tools/vfx/editor/*            瀏覽特效彈窗的接線

   需求（2026-09-14）：使用者為了「複製一個特效來改」，一直用作業系統的檔案視窗
   找 JSON。改成在編輯器裡用縮圖找，找到直接開或複製成新特效。

   測試不綁定任何正式 preset 的內容（使用者隨時會重編）；要量畫面時用沙箱裡
   自己產生的素材，不依賴本機的外部素材庫。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const thumbs = require('../tools/vfx/preset-thumbs.cjs');
const raster = require('../tools/vfx/vfx-raster.cjs');
const editorServer = require('../tools/vfx/editor-server.cjs');

const REPO = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

function tmpDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-thumb-' + tag + '-')); }

function pngHeader(buf) {
  assert.ok(Buffer.isBuffer(buf), '要回傳 Buffer');
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '要是 PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function spritePreset(id, layer) {
  return JSON.stringify({
    schemaVersion: 1, id: id, duration: 1, loop: false,
    layers: [Object.assign({ id: 'a', type: 'sprite', assetId: 'missing/none.png' }, layer || {})]
  });
}

/* 沙箱 repo：一份只有一張素材的索引。librarySide=true 時素材放在「外部素材庫」，
   否則放在隨 Git 出貨的 images/vfx/assets——兩條讀取路徑各驗一次。 */
function sandbox(assetId, librarySide) {
  const base = tmpDir('repo');
  const repoRoot = path.join(base, 'repo');
  const library = path.join(base, 'library');
  fs.mkdirSync(path.join(repoRoot, 'vfx'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'vfx', 'asset-index.json'), JSON.stringify({
    libraryId: 'test-lib',
    assets: [{ assetId: assetId, relativePath: assetId, contentHash: 'sha256:test-' + assetId }]
  }));
  const dir = librarySide ? library : path.join(repoRoot, 'images', 'vfx', 'assets');
  fs.mkdirSync(dir, { recursive: true });
  /* 64×64 不透明白色方塊：在深色底上一定看得到，外框也量得準 */
  const W = 64, rgba = new Uint8Array(W * W * 4).fill(255);
  fs.writeFileSync(path.join(dir, assetId), raster.encodePng(rgba, W, W));
  return { repoRoot: repoRoot, assetRoots: librarySide ? { 'test-lib': library } : {} };
}

function contentOfPng(png) {
  const img = raster.decodePng(png);
  return thumbs._internal.contentOf({ rgba: img.rgba || img.data, w: img.width, h: img.height });
}

test('THUMB-1 素材讀不到也要產生縮圖：固定大小的 PNG', function () {
  const png = thumbs.renderThumbnail({
    repoRoot: REPO, assetRoots: {}, cacheDir: tmpDir('cache'),
    presetText: spritePreset('thumb-test-missing')
  });
  const h = pngHeader(png);
  assert.equal(h.width, thumbs.THUMB_SIZE);
  assert.equal(h.height, thumbs.THUMB_SIZE);
});

test('THUMB-2 同樣的內容直接回快取；內容一變就重畫', function () {
  const cacheDir = tmpDir('cache');
  const text = spritePreset('thumb-test-cache');
  const a = thumbs.renderThumbnail({ repoRoot: REPO, assetRoots: {}, cacheDir, presetText: text });
  const b = thumbs.renderThumbnail({ repoRoot: REPO, assetRoots: {}, cacheDir, presetText: text });
  assert.strictEqual(a, b, '第二次要直接回記憶體裡那一份');
  assert.equal(fs.readdirSync(cacheDir).filter((f) => /\.png$/.test(f)).length, 1,
    '也要寫一份到暫存資料夾，伺服器重開才不必全部重畫');
  const c = thumbs.renderThumbnail({
    repoRoot: REPO, assetRoots: {}, cacheDir, presetText: spritePreset('thumb-test-cache', { alpha: 0.5 })
  });
  assert.notStrictEqual(c, a, 'preset 改了就不能回舊圖');
});

test('THUMB-3 自動取景：偏離中心、放得很大的圖層，縮圖裡仍然置中而且不被切掉', function () {
  const sb = sandbox('frame-box.png', true);
  const png = thumbs.renderThumbnail({
    repoRoot: sb.repoRoot, assetRoots: sb.assetRoots, cacheDir: tmpDir('cache'),
    presetText: spritePreset('thumb-test-framing', {
      assetId: 'frame-box.png', position: { x: 300, y: -200 }, scale: { x: 3, y: 3 }
    })
  });
  const c = contentOfPng(png);
  const S = thumbs.THUMB_SIZE;
  assert.ok(c.count > 100, '要真的畫出東西（讀得到外部素材庫），實得 ' + c.count + ' 個像素');
  assert.ok(c.x0 > 0 && c.y0 > 0 && c.x1 < S - 1 && c.y1 < S - 1,
    '內容不能碰到邊（被切掉）：' + JSON.stringify(c));
  const cx = (c.x0 + c.x1) / 2, cy = (c.y0 + c.y1) / 2;
  assert.ok(Math.abs(cx - S / 2) < S * 0.1 && Math.abs(cy - S / 2) < S * 0.1,
    '內容要在中間：' + JSON.stringify(c));
  assert.ok(Math.max(c.x1 - c.x0, c.y1 - c.y0) > S * 0.6,
    '要放大到看得清楚，不是縮成一小點：' + JSON.stringify(c));
});

test('THUMB-4 外部素材庫沒有的素材，改用隨 Git 出貨的那一份', function () {
  const sb = sandbox('shipped-box.png', false);
  const png = thumbs.renderThumbnail({
    repoRoot: sb.repoRoot, assetRoots: { 'test-lib': tmpDir('empty-library') }, cacheDir: tmpDir('cache'),
    presetText: spritePreset('thumb-test-shipped', { assetId: 'shipped-box.png' })
  });
  assert.ok(contentOfPng(png).count > 100, '素材庫缺檔時要讀 images/vfx/assets 那一份');
});

test('THUMB-5 快取鍵含素材的 contentHash：同一份 preset，素材換了也要重畫', function () {
  const hashes = { 'a.png': 'sha256:1' };
  const preset = { layers: [{ assetId: 'a.png' }, { water: { atlas: 'a.png' } }] };
  const k1 = thumbs._internal.usedAssetsKey(preset, hashes);
  const k2 = thumbs._internal.usedAssetsKey(preset, { 'a.png': 'sha256:2' });
  assert.ok(/a\.png=sha256:1/.test(k1), '要找得到用到的素材，連巢狀結構裡的也算');
  assert.notEqual(k1, k2);
});

function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    const req = http.request({ host: '127.0.0.1', port: port, path: urlPath, agent: false }, function (res) {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('THUMB-6 伺服器：GET /__thumbs/<id>.png 回 PNG；id 不合法回 400、沒有這份回 404', async function () {
  const server = editorServer.__testOnly.createServer({
    repoRoot: REPO, assetRoots: {}, thumbCacheDir: tmpDir('server-cache')
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const ids = fs.readdirSync(path.join(REPO, 'vfx', 'presets'))
      .filter((f) => /\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
    assert.ok(ids.length > 0);
    let res = await get(port, '/__thumbs/' + ids[0] + '.png');
    assert.equal(res.status, 200, res.body.toString('utf8').slice(0, 200));
    assert.equal(res.type, 'image/png');
    pngHeader(res.body);

    for (const bad of ['/__thumbs/..%2Fsecret.png', '/__thumbs/Bad_Id.png',
      '/__thumbs/' + ids[0] + '.json', '/__thumbs/.png']) {
      res = await get(port, bad);
      assert.equal(res.status, 400, bad + ' 要回 400');
    }
    res = await get(port, '/__thumbs/zzz-not-a-preset.png');
    assert.equal(res.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('THUMB-7 Editor：瀏覽特效的按鈕與彈窗、捲到才載入縮圖、複製成新特效走「另存新檔」', function () {
  const html = read('tools/vfx/editor/index.html');
  ['btn-browse', 'preset-browser', 'pb-search', 'pb-grid', 'pb-close', 'pb-count'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') >= 0, '缺少 #' + id);
  });
  const css = read('tools/vfx/editor/editor.css');
  assert.ok(/\.browser-box\s*\{[^}]*resize:\s*both/.test(css), '瀏覽特效的框要能自己拉大小');
  assert.ok(/#preset-browser\[hidden\]\s*\{\s*display:\s*none/.test(css),
    '少了 [hidden] 那條，彈窗會從一載入就蓋在編輯器上');

  const src = read('tools/vfx/editor/editor.js');
  const body = function (name) {
    const at = src.indexOf('function ' + name + '(');
    assert.ok(at >= 0, '找不到 function ' + name);
    const rest = src.slice(at);
    return rest.slice(0, rest.indexOf('\n  }'));
  };
  assert.ok(/IntersectionObserver/.test(body('renderPresetBrowser')), '縮圖要捲到才載入');
  assert.ok(/comboFilter\(/.test(body('renderPresetBrowser')), '搜尋沿用下拉那一套，不另寫比對規則');
  assert.ok(/\/__thumbs\//.test(body('presetCard')));
  assert.ok(/saveAsPreset\(\)/.test(body('duplicatePreset')) && /saveAs=1/.test(body('duplicatePreset')),
    '複製成新特效要走另存新檔，不另寫一套複製檔案的邏輯');
  assert.ok(/isDirty\(\)/.test(body('duplicatePreset')), '未存檔要先問');
  assert.ok(/replaceState/.test(body('clearSaveAsRequest')), '用完要把 saveAs 旗標從網址拿掉');
  const boot = body('boot');
  assert.ok(/saveAsRequested\(\)/.test(boot) && /clearSaveAsRequest\(/.test(boot),
    '開好那一份之後要接著另存');

  const server = read('tools/vfx/editor-server.cjs');
  ['preset-thumbs.cjs', 'preset-render.cjs', 'vfx-raster.cjs', 'contact-sheet.cjs'].forEach(function (f) {
    assert.ok(server.indexOf("'" + f + "'") >= 0, f + ' 要列進 RESTART_REQUIRED_FILES');
  });
});
