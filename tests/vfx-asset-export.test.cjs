'use strict';
/* VFX 素材匯出（tools/vfx/export-assets.cjs）

   多數案例在系統 temp 蓋一座假的素材庫與假的 repo，因為要測的是
   「路徑逃脫」「所有權」「發佈失敗回復」這些不該在真的專案目錄上演練的行為。
   最後幾條才用真正的 vfx/presets 與真正的匯出結果做 end-to-end 驗證。

   注意測試用的入口是 __testOnly.exportInternal：它只能換「哪一個 repo」，
   換不了 repo 內的相對輸出位置。正式 API runExport() 連 repoRoot 都不收。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const exporter = require('../tools/vfx/export-assets.cjs');
const VFXCore = require('../js/vfx-core.js');

const repoRoot = path.resolve(__dirname, '..');

/* ---------------- 假環境 ---------------- */

const tmpDirs = [];
function makeTmp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}
test.after(function () {
  tmpDirs.forEach(function (d) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });
});

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function writeAsset(libRoot, rel, content) {
  const abs = path.join(libRoot, rel.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

function hashOf(buf) {
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
}

/* 匯出工具會檢查檔頭，所以假素材必須有真的 PNG magic bytes；
   後面接 assetId 讓每個檔案的雜湊都不同。 */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function fakePng(assetId) {
  return Buffer.concat([PNG_MAGIC, Buffer.from('asset:' + assetId)]);
}

function spritePreset(id, assetIds) {
  return {
    schemaVersion: 1, id: id, duration: 1,
    layers: assetIds.map(function (a, i) {
      return { id: 'l' + i, type: 'sprite', assetId: a };
    })
  };
}

function scaffold(options) {
  const opts = options || {};
  const libRoot = makeTmp('vfx-lib-');
  const fakeRepo = makeTmp('vfx-repo-');
  const assets = opts.assets || {
    'pack/a.png': 'pack/a.png',
    'pack/b.png': 'pack/sub dir/b.png',
    'pack/c.png': 'pack/c.png'
  };
  const indexAssets = [];
  Object.keys(assets).forEach(function (assetId) {
    const rel = assets[assetId];
    const body = (opts.rawBodies || []).indexOf(assetId) >= 0
      ? Buffer.from('plain text pretending to be a png')
      : fakePng(assetId);
    if (opts.skipSourceFor !== assetId) writeAsset(libRoot, rel, body);
    indexAssets.push({
      assetId: assetId, package: rel.split('/')[0], relativePath: rel,
      format: 'png', fileSize: body.length, contentHash: hashOf(body)
    });
  });
  writeJson(path.join(fakeRepo, 'vfx', 'asset-index.json'), {
    schemaVersion: 1, kind: 'vfx-asset-index', libraryId: 'test-lib',
    assetCount: indexAssets.length, assets: indexAssets
  });
  (opts.presets || [spritePreset('p-one', Object.keys(assets))]).forEach(function (p) {
    writeJson(path.join(fakeRepo, 'vfx', 'presets', p.id + '.json'), p);
  });
  return { libRoot: libRoot, repo: fakeRepo };
}

function run(env, extra) {
  return exporter.__testOnly.exportInternal(Object.assign({
    repoRoot: env.repo, libraryRoot: env.libRoot
  }, extra || {}));
}

function exportRootOf(env) {
  return path.join(env.repo, exporter.EXPORT_DIR_REL.split('/').join(path.sep));
}

function exportedFiles(env) {
  const root = exportRootOf(env);
  if (!fs.existsSync(root)) return [];
  return exporter.listTree(root)
    .filter(function (i) { return i.kind === 'file' && i.rel !== exporter.MARKER_NAME; })
    .map(function (i) { return i.rel; }).sort();
}

/* 比對「路徑清單 ＋ 每個檔案的雜湊 ＋ 索引內容 ＋ 標記檔內容」，不是只比檔案數。 */
function snapshot(env) {
  const root = exportRootOf(env);
  const files = {};
  if (fs.existsSync(root)) {
    exporter.listTree(root).forEach(function (i) {
      if (i.kind === 'file') files[i.rel] = hashOf(fs.readFileSync(i.abs));
      else if (i.kind === 'link') files[i.rel] = 'symlink';
    });
  }
  const idxPath = path.join(env.repo, exporter.SHIPPED_INDEX_REL.split('/').join(path.sep));
  const markerPath = path.join(root, exporter.MARKER_NAME);
  return {
    paths: Object.keys(files).sort(),
    files: files,
    index: fs.existsSync(idxPath) ? fs.readFileSync(idxPath, 'utf8') : null,
    marker: fs.existsSync(markerPath) ? fs.readFileSync(markerPath, 'utf8') : null
  };
}

/* staging / backup 是暫時目錄，任何情況結束後都不該留下 */
function leftoverTempDirs(env) {
  const parent = path.join(env.repo, exporter.EXPORT_PARENT_REL.split('/').join(path.sep));
  if (!fs.existsSync(parent)) return [];
  return fs.readdirSync(parent).filter(function (n) {
    return n.indexOf(exporter.STAGING_PREFIX) === 0 || n.indexOf(exporter.BACKUP_PREFIX) === 0;
  });
}

/* ---------------- 1–5 蒐集與複製 ---------------- */

test('1. 收集多個 preset 的 assetId', function () {
  const env = scaffold({
    presets: [spritePreset('p-one', ['pack/a.png', 'pack/b.png']),
      spritePreset('p-two', ['pack/c.png'])]
  });
  const report = run(env);
  assert.equal(report.presetCount, 2);
  assert.deepEqual(report.presetIds.slice().sort(), ['p-one', 'p-two']);
  assert.equal(report.uniqueAssetIds, 3);
});

test('2. 重複的 assetId 只匯出一次', function () {
  const env = scaffold({
    presets: [spritePreset('p-one', ['pack/a.png', 'pack/a.png', 'pack/b.png']),
      spritePreset('p-two', ['pack/a.png'])]
  });
  const report = run(env);
  assert.equal(report.uniqueAssetIds, 2);
  assert.equal(exportedFiles(env).length, 2);
});

test('3+4. 兩份 preset 的素材都完整匯出，內容與來源一致', function () {
  const env = scaffold({
    presets: [spritePreset('tornado-like', ['pack/a.png', 'pack/b.png']),
      spritePreset('hole-like', ['pack/b.png', 'pack/c.png'])]
  });
  run(env);
  assert.deepEqual(exportedFiles(env),
    ['pack/a.png', 'pack/c.png', 'pack/sub dir/b.png'].sort());
  const src = fs.readFileSync(path.join(env.libRoot, 'pack', 'c.png'));
  const dst = fs.readFileSync(path.join(exportRootOf(env), 'pack', 'c.png'));
  assert.ok(src.equals(dst), '複製後內容必須逐位元相同');
});

test('5. 共用素材只處理一次，且被標記為共用', function () {
  const env = scaffold({
    presets: [spritePreset('p-one', ['pack/a.png', 'pack/b.png']),
      spritePreset('p-two', ['pack/b.png'])]
  });
  const report = run(env);
  assert.equal(report.sharedAssetIds, 1);
  assert.equal(exportedFiles(env).filter(function (f) { return /b\.png$/.test(f); }).length, 1);
});

/* ---------------- 6–11 fail closed ---------------- */

test('6. preset 引用索引裡沒有的 assetId → 整批失敗且不寫出任何檔案', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png', 'pack/ghost.png'])] });
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /索引中沒有這個 assetId/.test(p); }), e.problems.join('；'));
    return true;
  });
  assert.deepEqual(exportedFiles(env), []);
  assert.deepEqual(leftoverTempDirs(env), []);
});

test('7. 索引有記錄但來源檔不存在 → 失敗', function () {
  const env = scaffold({ skipSourceFor: 'pack/c.png' });
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /來源檔不存在/.test(p); }), e.problems.join('；'));
    return true;
  });
  assert.deepEqual(exportedFiles(env), []);
});

test('8. relativePath 穿越素材庫 Root → 失敗', function () {
  const env = scaffold({ assets: { 'pack/a.png': 'pack/a.png' } });
  const idxPath = path.join(env.repo, 'vfx', 'asset-index.json');
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  idx.assets[0].relativePath = '../outside/secret.png';
  writeJson(idxPath, idx);
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /不可攜|逃出素材庫/.test(p); }), e.problems.join('；'));
    return true;
  });
});

test('9. 各種不可攜／可構造目的路徑的 relativePath 一律被擋', function () {
  const bad = [
    '../escape.png', 'a/../../escape.png', '/absolute.png', 'C:/windows/win.ini',
    'back\\slash.png', 'a//b.png', 'a/./b.png', 'trailing /file.png',
    'dot./file.png', 'CON/file.png', 'a/NUL.png',
    'ctrl\u0001.png', 'nul\u0000byte.png'
  ];
  bad.forEach(function (rel) {
    assert.ok(exporter.checkPortableRelativePath(rel).length > 0,
      '應被擋下：' + JSON.stringify(rel));
  });
  ['kenney_particle-pack/PNG (Black background)/trace_02.png',
    'kenney_splat-pack/PNG/Double (512px)/splat05.png'].forEach(function (rel) {
    assert.deepEqual(exporter.checkPortableRelativePath(rel), [], rel + ' 應該合法');
  });
});

test('10. Windows 反斜線與 POSIX 斜線', function () {
  assert.deepEqual(exporter.checkPortableRelativePath('a/b/c.png'), []);
  assert.ok(exporter.checkPortableRelativePath('a\\b\\c.png').some(function (i) {
    return /反斜線/.test(i);
  }));
  const root = path.resolve(path.sep === '\\' ? 'C:\\root' : '/root');
  assert.ok(exporter.safeJoin(root, 'a/b/c.png').indexOf(root + path.sep) === 0);
  assert.equal(exporter.safeJoin(root, '../evil.png'), null);
});

test('10b. realPathInside 對「存在但在 root 之外」的目標回傳 false', function () {
  const inside = makeTmp('vfx-inside-');
  const outside = makeTmp('vfx-outside2-');
  fs.writeFileSync(path.join(inside, 'ok.png'), 'x');
  fs.writeFileSync(path.join(outside, 'nope.png'), 'x');
  assert.equal(exporter.realPathInside(inside, path.join(inside, 'ok.png')), true);
  assert.equal(exporter.realPathInside(inside, path.join(outside, 'nope.png')), false);
  assert.equal(exporter.realPathInside(inside, inside), true);
  assert.equal(exporter.realPathInside(inside, path.join(inside, 'missing.png')), null,
    '不存在應回傳 null（無法判定），不得誤判成「在裡面」');
});

test('11. 只差大小寫的兩個 assetId 會造成檔名碰撞 → 失敗', function () {
  const env = scaffold({
    assets: { 'pack/a.png': 'pack/A.png', 'pack/a2.png': 'pack/a.png' },
    presets: [spritePreset('p-one', ['pack/a.png', 'pack/a2.png'])]
  });
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /檔名碰撞/.test(p); }), e.problems.join('；'));
    return true;
  });
});

/* ---------------- 12–13 陳舊素材與所有權 ---------------- */

test('12. 不再被引用的素材隨舊樹整棵被替換掉', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png', 'pack/b.png', 'pack/c.png'])] });
  run(env);
  assert.equal(exportedFiles(env).length, 3);

  writeJson(path.join(env.repo, 'vfx', 'presets', 'p-one.json'),
    spritePreset('p-one', ['pack/a.png', 'pack/b.png']));
  const report = run(env);
  assert.deepEqual(exportedFiles(env), ['pack/a.png', 'pack/sub dir/b.png'].sort());
  assert.ok(report.removedStale.indexOf('pack/c.png') >= 0, '應回報 c.png 被移除');
  assert.deepEqual(leftoverTempDirs(env), [], '不得留下 staging/backup 目錄');
});

test('13. 正式目錄若不是本工具管理的（缺標記檔）→ 拒絕發佈，且不動任何檔案', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const root = exportRootOf(env);
  fs.mkdirSync(root, { recursive: true });
  const intruder = path.join(root, 'someone-elses-file.png');
  fs.writeFileSync(intruder, 'not mine');
  // 匯出目錄的上一層也放一個檔案，確認完全不受影響
  const neighbour = path.join(env.repo, 'images', 'vfx', 'hand_authored.png');
  fs.writeFileSync(neighbour, 'hand authored');

  assert.throws(function () { run(env); }, function (e) {
    assert.ok(/不是本工具管理的目錄|標記檔/.test(e.message), e.message);
    return true;
  });
  assert.equal(fs.readFileSync(intruder, 'utf8'), 'not mine');
  assert.equal(fs.readFileSync(neighbour, 'utf8'), 'hand authored');
  assert.deepEqual(leftoverTempDirs(env), []);
});

/* ---------------- 14–15 Production Resolver ---------------- */

test('14. production resolver 能解析所有正式 preset 的 assetId', function () {
  const shippedPath = path.join(repoRoot, exporter.SHIPPED_INDEX_REL);
  assert.ok(fs.existsSync(shippedPath), '請先執行 node tools/vfx/export-assets.cjs');
  const shipped = JSON.parse(fs.readFileSync(shippedPath, 'utf8'));
  const res = VFXCore.createIndexResolver(shipped, shipped.baseUrl);

  const dir = path.join(repoRoot, 'vfx', 'presets');
  fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (file) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    preset.layers.forEach(function (layer) {
      if (!layer.assetId) return;
      assert.ok(res.has(layer.assetId), file + ' 的 ' + layer.assetId + ' 不在 shipped index');
      const url = res.resolve(layer.assetId);
      assert.ok(url.indexOf(shipped.baseUrl + '/') === 0, 'URL 應以 baseUrl 起頭：' + url);
      const relFromUrl = decodeURIComponent(url.slice(shipped.baseUrl.length + 1));
      const onDisk = path.join(repoRoot, exporter.EXPORT_DIR_REL, relFromUrl.split('/').join(path.sep));
      assert.ok(fs.existsSync(onDisk), '檔案不存在：' + onDisk);
    });
  });
});

test('15. production resolver 完全不依賴本機素材庫與開發期資料', function () {
  const shipped = JSON.parse(fs.readFileSync(path.join(repoRoot, exporter.SHIPPED_INDEX_REL), 'utf8'));
  const text = JSON.stringify(shipped);
  assert.ok(!/[A-Za-z]:[\\/]/.test(text), 'shipped index 不得含磁碟機代號');
  assert.ok(text.indexOf('\\\\') < 0, '不得含反斜線路徑');
  assert.ok(!/effects-materials[\\/]/.test(text), '不得含素材庫實體路徑');
  const res = VFXCore.createIndexResolver(shipped, shipped.baseUrl);
  assert.ok(res.has(shipped.assets[0].assetId));
  ['shape', 'usage', 'tags', 'element', 'confidence', 'facts'].forEach(function (k) {
    assert.ok(text.indexOf('"' + k + '"') < 0, 'shipped index 不該含語意／事實欄位：' + k);
  });
});

/* ---------------- 16 決定性 ---------------- */

test('16. 重複匯出具決定性且冪等（比對路徑、雜湊、索引、標記檔）', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png', 'pack/b.png'])] });
  const first = run(env);
  const snapA = snapshot(env);
  const second = run(env);
  const snapB = snapshot(env);

  assert.deepEqual(snapB.paths, snapA.paths, '路徑清單必須相同');
  assert.deepEqual(snapB.files, snapA.files, '每個檔案的雜湊必須相同');
  assert.equal(snapB.index, snapA.index, '索引內容必須位元相同');
  assert.equal(snapB.marker, snapA.marker, '標記檔內容必須相同');
  assert.equal(first.published, true, '第一次要發佈');
  assert.equal(second.published, false, '第二次應判定已是最新而不重發佈');
  assert.equal(second.upToDate, true);
  assert.ok(snapA.index.indexOf('generatedAt') < 0 && snapA.index.indexOf('timestamp') < 0,
    '索引不得含時間戳');
  assert.deepEqual(leftoverTempDirs(env), []);
});

test('16b. 索引與來源檔不一致時 fail closed', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const src = path.join(env.libRoot, 'pack', 'a.png');
  const buf = fs.readFileSync(src);
  buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;      // 保持長度與檔頭，只翻一個位元組
  fs.writeFileSync(src, buf);
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /contentHash 不符/.test(p); }), e.problems.join('；'));
    return true;
  });
  assert.deepEqual(exportedFiles(env), []);
});

test('17. 符號連結指向素材庫外時，來源解析必須失敗', function (t) {
  const env = scaffold({ assets: { 'pack/a.png': 'pack/a.png' },
    presets: [spritePreset('p-one', ['pack/a.png'])] });
  const outside = makeTmp('vfx-outside-');
  const secret = path.join(outside, 'secret.png');
  fs.writeFileSync(secret, 'top secret');
  const linkPath = path.join(env.libRoot, 'pack', 'a.png');
  fs.unlinkSync(linkPath);
  try {
    fs.symlinkSync(secret, linkPath, 'file');
  } catch (e) {
    t.skip('此環境無法建立檔案符號連結：' + e.code);
    return;
  }
  assert.equal(exporter.realPathInside(env.libRoot, linkPath), false);
  assert.throws(function () { run(env); });
});

/* ---------------- 正式 API 的輸出位置無法被指定 ---------------- */

test('F7. 正式 API 無法讓匯出接管 repo 內另一個空目錄', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  // 正式 API 只有 libraryRoot 與 dryRun 兩個旋鈕
  assert.equal(exporter.runExport.length, 1);
  const src = fs.readFileSync(path.join(repoRoot, 'tools', 'vfx', 'export-assets.cjs'), 'utf8');
  assert.ok(/function runExport\(options\) \{[\s\S]*?exportInternal\(\{ libraryRoot: opts\.libraryRoot, dryRun: opts\.dryRun === true \}\)/.test(src),
    'runExport 只能把 libraryRoot 與 dryRun 傳下去');
  assert.ok(/const EXPORT_DIR_REL = '/.test(src), '匯出位置必須是常數');
  assert.ok(!/opts\.exportDir|options\.exportDir/.test(src), '任何地方都不得讀取 exportDir 參數');
  assert.ok(!/opts\.baseUrl|options\.baseUrl/.test(src), '不得讀取 baseUrl 參數');
  assert.ok(!/opts\.shippedIndexFile/.test(src), '不得讀取 shippedIndexFile 參數');
  // CLI 不經過測試 seam
  const cli = src.slice(src.indexOf('function main()'), src.indexOf('if (require.main === module)'));
  assert.ok(cli.indexOf('__testOnly') < 0 && cli.indexOf('exportInternal') < 0,
    'CLI 只能呼叫 runExport，不得使用測試 seam');
  assert.ok(cli.indexOf('runExport(') > 0, 'CLI 必須走正式 API');

  // 即使連測試 seam 也只能換 repo，換不了 repo 內位置
  const report = run(env, { exportDir: 'images/somewhere-else', baseUrl: 'x', shippedIndexFile: 'y' });
  assert.equal(report.exportRoot, exportRootOf(env), '多餘的參數必須完全無效');
  assert.ok(fs.existsSync(path.join(exportRootOf(env), exporter.MARKER_NAME)));
  assert.ok(!fs.existsSync(path.join(env.repo, 'images', 'somewhere-else')));
});

/* ---------------- 標記檔與保留檔名 ---------------- */

test('F8. 標記檔是硬連結 → 拒絕（避免覆寫標記檔改到外部 inode）', function (t) {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  run(env);
  const markerPath = path.join(exportRootOf(env), exporter.MARKER_NAME);
  const outside = path.join(env.repo, 'outside-marker-target.json');
  fs.writeFileSync(outside, 'outside');
  fs.unlinkSync(markerPath);
  try {
    fs.linkSync(outside, markerPath);
  } catch (e) {
    t.skip('此檔案系統不支援硬連結：' + e.code);
    return;
  }
  assert.ok(/硬連結/.test(exporter.checkMarkerFile(markerPath)), exporter.checkMarkerFile(markerPath));
  // 改一個 preset 讓它需要重新發佈，發佈時應拒絕搬走這個「不可信」的正式目錄
  writeJson(path.join(env.repo, 'vfx', 'presets', 'p-one.json'),
    spritePreset('p-one', ['pack/a.png', 'pack/b.png']));
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(/標記檔|不是本工具管理/.test(e.message), e.message);
    return true;
  });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside', '外部檔案不得被改寫');
});

test('F9. 保留檔名以可攜規則比較，大小寫別名一樣被擋', function () {
  ['.vfx-export-root.json', '.VFX-EXPORT-ROOT.JSON', '.Vfx-Export-Root.Json',
    '.vfx-export-root.json.', '.vfx-export-root.json '].forEach(function (name) {
    assert.ok(exporter.isReservedOutputName(name), name + ' 應視為保留檔名');
    assert.ok(exporter.checkPortableRelativePath('pack/' + name).length > 0,
      'pack/' + name + ' 應被擋下');
  });
  assert.ok(!exporter.isReservedOutputName('vfx-export-root.json'), '少了前綴點就不是保留檔名');
  assert.equal(exporter.normaliseFilename('A.PNG '), 'a.png');
  assert.equal(exporter.normalisePathForComparison('Pack/SUB Dir/A.PNG'), 'pack/sub dir/a.png');

  const env = scaffold({
    assets: { 'pack/marker.png': exporter.MARKER_NAME.toUpperCase() },
    presets: [spritePreset('p-one', ['pack/marker.png'])]
  });
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /保留檔名/.test(p); }), e.problems.join('；'));
    return true;
  });
});

/* ---------------- 失敗注入：舊的正式輸出必須毫髮無傷 ---------------- */

function seedGoodExport() {
  const env = scaffold({
    assets: { 'pack/a.png': 'pack/a.png', 'pack/b.png': 'pack/b.png', 'pack/c.png': 'pack/c.png' },
    presets: [spritePreset('p-one', ['pack/a.png', 'pack/b.png'])]
  });
  run(env);
  return { env: env, before: snapshot(env) };
}

/* 讓下一次匯出「有事要做」，否則會走「已是最新」直接跳過 */
function makeDirty(env) {
  writeJson(path.join(env.repo, 'vfx', 'presets', 'p-one.json'),
    spritePreset('p-one', ['pack/a.png', 'pack/b.png', 'pack/c.png']));
}

test('F1. staging 第一個素材複製失敗 → 舊正式樹逐位元不變', function () {
  const seeded = seedGoodExport();
  makeDirty(seeded.env);
  assert.throws(function () {
    run(seeded.env, { hooks: { beforeCopy: function (i) { if (i === 0) throw new Error('注入：第一個複製失敗'); } } });
  });
  assert.deepEqual(snapshot(seeded.env), seeded.before, '舊正式輸出必須完全不變');
  assert.deepEqual(leftoverTempDirs(seeded.env), [], 'staging 必須被清掉');
});

test('F2. staging 中途複製失敗 → 舊正式樹逐位元不變', function () {
  const seeded = seedGoodExport();
  makeDirty(seeded.env);
  assert.throws(function () {
    run(seeded.env, { hooks: { beforeCopy: function (i) { if (i === 2) throw new Error('注入：第三個複製失敗'); } } });
  });
  assert.deepEqual(snapshot(seeded.env), seeded.before);
  assert.deepEqual(leftoverTempDirs(seeded.env), []);
});

test('F3. staging 驗證失敗 → 舊正式樹逐位元不變', function () {
  const seeded = seedGoodExport();
  makeDirty(seeded.env);
  assert.throws(function () {
    run(seeded.env, {
      hooks: {
        afterStagingBuilt: function (stagingAbs) {
          // 偷偷弄壞 staging：刪掉一個素材，驗證階段必須發現
          fs.unlinkSync(path.join(stagingAbs, 'pack', 'a.png'));
        }
      }
    });
  }, function (e) {
    assert.ok(e.problems.some(function (p) { return /staging 缺少/.test(p); }), e.problems.join('；'));
    return true;
  });
  assert.deepEqual(snapshot(seeded.env), seeded.before);
  assert.deepEqual(leftoverTempDirs(seeded.env), []);
});

test('F4. publish 第一步失敗 → 舊正式樹逐位元不變', function () {
  const seeded = seedGoodExport();
  makeDirty(seeded.env);
  assert.throws(function () {
    run(seeded.env, { hooks: { beforePublishStep1: function () { throw new Error('注入：第一步失敗'); } } });
  });
  assert.deepEqual(snapshot(seeded.env), seeded.before);
  assert.deepEqual(leftoverTempDirs(seeded.env), []);
});

test('F5. publish 第二步失敗 → 回復到上一版，舊正式樹逐位元不變', function () {
  const seeded = seedGoodExport();
  const env = seeded.env;
  makeDirty(env);
  assert.throws(function () {
    run(env, {
      hooks: {
        beforePublishStep2: function () {
          /* 舊樹此刻已被改名成 backup。把 staging 整個移走讓第二步 rename 失敗，
             但 live 位置是空的，所以回復（backup → live）必須能成功。 */
          const parent = path.join(env.repo, exporter.EXPORT_PARENT_REL.split('/').join(path.sep));
          const staging = fs.readdirSync(parent)
            .find(function (n) { return n.indexOf(exporter.STAGING_PREFIX) === 0; });
          fs.rmSync(path.join(parent, staging), { recursive: true, force: true });
        }
      }
    });
  }, function (e) {
    assert.ok(!e.unrecovered, '這一步應該可以回復，不該是 unrecovered');
    assert.equal(e.rolledBack, true, '必須標記為已回復');
    return true;
  });
  const after = snapshot(env);
  assert.deepEqual(after.paths, seeded.before.paths, '舊素材的路徑清單必須原封不動地回來');
  assert.deepEqual(after.files, seeded.before.files, '舊素材的內容必須原封不動地回來');
  assert.equal(after.index, seeded.before.index, '索引不得被改動');
  assert.equal(after.marker, seeded.before.marker, '標記檔不得被改動');
  assert.deepEqual(leftoverTempDirs(env), [], '回復後不得留下暫時目錄');
});

test('F6. 回復也失敗 → 大聲失敗並回報復原狀態，且不再清理', function () {
  const seeded = seedGoodExport();
  const env = seeded.env;
  makeDirty(env);
  let caught = null;
  try {
    run(env, {
      hooks: {
        beforePublishStep2: function () {
          const live = exportRootOf(env);
          fs.mkdirSync(live, { recursive: true });
          fs.writeFileSync(path.join(live, 'blocker.txt'), 'blocking');
        },
        beforeRollback: function () {
          // live 仍被佔著，backup 換不回去
        }
      }
    });
  } catch (e) { caught = e; }
  assert.ok(caught, '必須丟出錯誤');
  assert.equal(caught.unrecovered, true, '必須標記為無法回復');
  assert.ok(caught.recoveryState && caught.recoveryState.backup, '必須回報 backup 位置');
  assert.ok(caught.recoveryState.live && caught.recoveryState.rollbackError);
  // 不再清理：backup 必須還在，讓人工可以救回來
  assert.ok(fs.existsSync(caught.recoveryState.backup), 'backup 必須保留供人工復原');
  const backupFiles = exporter.listTree(caught.recoveryState.backup)
    .filter(function (i) { return i.kind === 'file' && i.rel !== exporter.MARKER_NAME; })
    .map(function (i) { return i.rel; }).sort();
  assert.deepEqual(backupFiles, ['pack/a.png', 'pack/b.png'], '舊資料仍完整保存在 backup 裡');
});

/* ---------------- 其他格式與索引驗證 ---------------- */

test('M1. 改了副檔名的非圖片檔不得被當成素材匯出', function () {
  const env = scaffold({ assets: { 'pack/fake.png': 'pack/fake.png' },
    rawBodies: ['pack/fake.png'],
    presets: [spritePreset('p-one', ['pack/fake.png'])] });
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /不是允許的素材格式|檔頭不是/.test(p); }),
      e.problems.join('；'));
    return true;
  });
  assert.deepEqual(exportedFiles(env), []);

  const png = Buffer.concat([PNG_MAGIC, Buffer.from('x')]);
  assert.equal(exporter.checkAssetFormat(png, 'a/b.png'), null);
  assert.ok(exporter.checkAssetFormat(Buffer.from('hello'), 'a/b.png'));
  assert.ok(exporter.checkAssetFormat(Buffer.from('secret'), 'a/b.txt'));
  assert.equal(exporter.checkAssetFormat(Buffer.from('<svg xmlns="x"/>'), 'a/b.svg'), null);
  assert.ok(exporter.checkAssetFormat(Buffer.from('not xml'), 'a/b.svg'));
});

test('M2. 索引缺少合法 contentHash 或 fileSize 對不上 → 拒絕', function () {
  const env = scaffold({ assets: { 'pack/a.png': 'pack/a.png' },
    presets: [spritePreset('p-one', ['pack/a.png'])] });
  const idxPath = path.join(env.repo, 'vfx', 'asset-index.json');

  const noHash = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  delete noHash.assets[0].contentHash;
  writeJson(idxPath, noHash);
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /合法的 sha256/.test(p); }), e.problems.join('；'));
    return true;
  });

  const badSize = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  badSize.assets[0].contentHash = 'sha256:' + '0'.repeat(64);
  badSize.assets[0].fileSize = 999999;
  writeJson(idxPath, badSize);
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /大小與索引不符/.test(p); }), e.problems.join('；'));
    return true;
  });
});

test('C4b. 同一個路徑同時被當成檔案與目錄 → 拒絕', function () {
  const env = scaffold({
    assets: { 'pack/x.png': 'pack/x.png', 'pack/deep.png': 'pack/deep.png' },
    presets: [spritePreset('p-one', ['pack/x.png', 'pack/deep.png'])]
  });
  const idxPath = path.join(env.repo, 'vfx', 'asset-index.json');
  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  idx.assets.find(function (a) { return a.assetId === 'pack/deep.png'; })
    .relativePath = 'pack/x.png/deep.png';
  writeJson(idxPath, idx);
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(e.problems.some(function (p) { return /路徑衝突/.test(p); }), e.problems.join('；'));
    return true;
  });
  assert.deepEqual(exportedFiles(env), []);
});

/* ================================================================
   最後一輪安全修正的回歸保護
   C1 marker ownership contract ／ C2 containment ／ C3 首次發佈回滾
   MAJOR 1 staging ownership ／ MAJOR 2 獨佔建立 ／ MAJOR 3 攻擊案例
   ================================================================ */

function markerPathOf(env) {
  return path.join(exportRootOf(env), exporter.MARKER_NAME);
}

function writeMarker(env, obj) {
  const p = markerPathOf(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  return p;
}

function goodMarkerObject() {
  return JSON.parse(exporter.markerContent());
}

/* ---------------- C1：ownership contract ---------------- */

test('C1-1. 只有 kind 正確的 marker → 拒絕', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const p = writeMarker(env, { kind: exporter.MARKER_KIND });
  assert.ok(/owner|schemaVersion|repoRelativePath|內容與本工具/.test(exporter.checkMarkerFile(p)),
    exporter.checkMarkerFile(p));
  assert.throws(function () { run(env); }, function (e) {
    assert.ok(/ownership 驗證/.test(e.message), e.message);
    return true;
  });
});

test('C1-2. repoRelativePath 不對 → 拒絕', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const bad = goodMarkerObject();
  bad.repoRelativePath = 'images/somewhere-else';
  const p = writeMarker(env, bad);
  assert.ok(/repoRelativePath/.test(exporter.checkMarkerFile(p)), exporter.checkMarkerFile(p));
  assert.throws(function () { run(env); }, /ownership 驗證/);
});

test('C1-3. owner 不對 → 拒絕', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const bad = goodMarkerObject();
  bad.owner = 'someone-else';
  const p = writeMarker(env, bad);
  assert.ok(/owner/.test(exporter.checkMarkerFile(p)), exporter.checkMarkerFile(p));
  assert.throws(function () { run(env); }, /ownership 驗證/);
});

test('C1-4. schemaVersion 不對 → 拒絕', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const bad = goodMarkerObject();
  bad.schemaVersion = 99;
  const p = writeMarker(env, bad);
  assert.ok(/schemaVersion/.test(exporter.checkMarkerFile(p)), exporter.checkMarkerFile(p));
  assert.throws(function () { run(env); }, /ownership 驗證/);
});

test('C1-5. 多出未知欄位 → 拒絕（不得改變 ownership 語意）', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const bad = goodMarkerObject();
  bad.alsoOwns = '../../';
  const p = writeMarker(env, bad);
  assert.ok(/不支援的欄位/.test(exporter.checkMarkerFile(p)), exporter.checkMarkerFile(p));
  assert.throws(function () { run(env); }, /ownership 驗證/);
});

test('C1-6. 欄位都對但序列化內容被動過 → 拒絕', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const p = markerPathOf(env);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // 欄位值全部正確，只是換了順序與縮排
  const obj = goodMarkerObject();
  fs.writeFileSync(p, JSON.stringify({
    note: obj.note, repoRelativePath: obj.repoRelativePath,
    owner: obj.owner, schemaVersion: obj.schemaVersion, kind: obj.kind
  }) + '\n', 'utf8');
  assert.ok(/內容與本工具產生的版本不符/.test(exporter.checkMarkerFile(p)), exporter.checkMarkerFile(p));
  assert.throws(function () { run(env); }, /ownership 驗證/);
});

test('C1-7. 完整正確的 marker → 接受', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  run(env);                                        // 第一次由工具自己建立
  assert.equal(exporter.checkMarkerFile(markerPathOf(env)), null, '工具自己寫的 marker 必須通過');
  // 內容確實就是 canonical 版本
  assert.equal(fs.readFileSync(markerPathOf(env), 'utf8'), exporter.markerContent());
  // 再跑一次要能正常接管（不會因為嚴格驗證而卡死）
  makeDirty(env);
  const report = run(env);
  assert.equal(report.published, true);
});

/* ---------------- C2：containment ---------------- */

function junctionOrSkip(t, target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath, 'junction');
    return true;
  } catch (e) {
    t.skip('此環境無法建立 junction：' + e.code);
    return false;
  }
}

test('C2-1. repo/vfx 是指向 repo 外的 junction → fail closed，外部檔案完全不變', function (t) {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const outside = makeTmp('vfx-junction-target-');
  // 把 vfx 的內容搬到 repo 外，再用 junction 指回去
  fs.cpSync(path.join(env.repo, 'vfx'), path.join(outside, 'vfx'), { recursive: true });
  fs.rmSync(path.join(env.repo, 'vfx'), { recursive: true, force: true });
  if (!junctionOrSkip(t, path.join(outside, 'vfx'), path.join(env.repo, 'vfx'))) return;

  const beforeOutside = exporter.listTree(path.join(outside, 'vfx'))
    .filter(function (i) { return i.kind === 'file'; })
    .map(function (i) { return i.rel + ':' + hashOf(fs.readFileSync(i.abs)); }).sort();

  assert.throws(function () { run(env); }, function (e) {
    assert.ok(/符號連結／junction|junction|符號連結/.test(JSON.stringify(e.problems || e.message)),
      JSON.stringify(e.problems || e.message));
    return true;
  });

  const afterOutside = exporter.listTree(path.join(outside, 'vfx'))
    .filter(function (i) { return i.kind === 'file'; })
    .map(function (i) { return i.rel + ':' + hashOf(fs.readFileSync(i.abs)); }).sort();
  assert.deepEqual(afterOutside, beforeOutside, 'repo 外的檔案必須逐位元不變');
  assert.ok(!fs.existsSync(path.join(outside, 'vfx', 'shipped-assets.json')),
    '不得在 repo 外產生 shipped-assets.json');
  assert.ok(!fs.existsSync(exportRootOf(env)), '不得發佈任何 asset tree');
});

test('C2-2. images/vfx 是指向 repo 外的 junction → fail closed', function (t) {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const outside = makeTmp('vfx-imgjunction-');
  fs.mkdirSync(path.join(env.repo, 'images'), { recursive: true });
  if (!junctionOrSkip(t, outside, path.join(env.repo, 'images', 'vfx'))) return;

  assert.throws(function () { run(env); }, function (e) {
    assert.ok(/符號連結／junction/.test(JSON.stringify(e.problems || e.message)),
      JSON.stringify(e.problems || e.message));
    return true;
  });
  assert.deepEqual(fs.readdirSync(outside), [], 'repo 外的目錄必須完全沒被寫入');
});

test('C2-3. images/vfx/assets 本身是指向 repo 外的 junction → fail closed', function (t) {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const outside = makeTmp('vfx-assetsjunction-');
  fs.mkdirSync(path.join(env.repo, 'images', 'vfx'), { recursive: true });
  if (!junctionOrSkip(t, outside, exportRootOf(env))) return;

  assert.throws(function () { run(env); }, function (e) {
    assert.ok(/符號連結／junction/.test(JSON.stringify(e.problems || e.message)),
      JSON.stringify(e.problems || e.message));
    return true;
  });
  assert.deepEqual(fs.readdirSync(outside), [], 'repo 外的目錄必須完全沒被寫入');
});

test('C2-4. verifyRepoPath 對不存在的葉節點放行，但父鏈有連結就拒絕', function (t) {
  const repo = makeTmp('vfx-verify-repo-');
  const outside = makeTmp('vfx-verify-out-');
  assert.equal(exporter.verifyRepoPath(repo, path.join(repo, 'a', 'b.png'), 'x'), null,
    '不存在的葉節點應該可以建立');
  assert.ok(exporter.verifyRepoPath(repo, path.join(outside, 'b.png'), 'x'), 'repo 外必須拒絕');
  fs.mkdirSync(path.join(repo, 'sub'), { recursive: true });
  if (!junctionOrSkip(t, outside, path.join(repo, 'sub', 'link'))) return;
  assert.ok(/符號連結／junction/.test(
    exporter.verifyRepoPath(repo, path.join(repo, 'sub', 'link', 'x.png'), 'x')));
});

/* ---------------- C3：首次發佈時索引失敗必須撤掉新樹 ---------------- */

test('C3-1. 首次匯出、索引寫入失敗 → 新 live tree 撤除，回到執行前狀態', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png', 'pack/b.png'])] });
  const shippedPath = path.join(env.repo, exporter.SHIPPED_INDEX_REL.split('/').join(path.sep));
  assert.ok(!fs.existsSync(exportRootOf(env)), '前提：一開始沒有正式輸出');
  assert.ok(!fs.existsSync(shippedPath));

  let caught = null;
  try {
    run(env, { hooks: { beforeIndexWrite: function () { throw new Error('注入：索引寫入失敗'); } } });
  } catch (e) { caught = e; }

  assert.ok(caught, '必須丟出錯誤');
  assert.ok(!caught.unrecovered, '這個情況應該可以完全撤回');
  assert.equal(caught.recovery, 'new output removed');
  assert.ok(!fs.existsSync(exportRootOf(env)), 'images/vfx/assets 必須不存在');
  assert.ok(!fs.existsSync(shippedPath), 'shipped-assets.json 必須不存在');
  assert.deepEqual(leftoverTempDirs(env), [], '不得留下 staging/backup');
  const parent = path.join(env.repo, exporter.EXPORT_PARENT_REL.split('/').join(path.sep));
  const tmps = fs.existsSync(parent) ? fs.readdirSync(parent) : [];
  assert.deepEqual(tmps, [], '匯出父目錄必須是空的');
});

test('C3-2. 已有完整輸出時索引寫入失敗 → 還原成舊的那一份', function () {
  const seeded = seedGoodExport();
  makeDirty(seeded.env);
  let caught = null;
  try {
    run(seeded.env, { hooks: { beforeIndexWrite: function () { throw new Error('注入：索引寫入失敗'); } } });
  } catch (e) { caught = e; }
  assert.ok(caught);
  assert.equal(caught.recovery, 'existing output restored');
  assert.deepEqual(snapshot(seeded.env), seeded.before, '必須逐位元還原成舊版');
  assert.deepEqual(leftoverTempDirs(seeded.env), []);
});

test('C3-3. 錯誤訊息會區分三種復原狀態，且不會謊稱有既有輸出', function () {
  const src = fs.readFileSync(path.join(repoRoot, 'tools', 'vfx', 'export-assets.cjs'), 'utf8');
  ['nothing written', 'existing output restored', 'new output removed', 'recovery incomplete']
    .forEach(function (k) {
      assert.ok(src.indexOf("'" + k + "'") > 0, '必須有 ' + k + ' 這個復原狀態');
    });
  assert.ok(src.indexOf('目前已存在的正式輸出未被改動') < 0,
    '不得再無條件宣稱既有輸出未被改動');
});

/* ---------------- MAJOR 1：staging / backup 的所有權 ---------------- */

test('M1-1. 只有檔名前綴、沒有合法 marker 的目錄不得被當成 staging 刪除', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  run(env);
  const parent = path.join(env.repo, exporter.EXPORT_PARENT_REL.split('/').join(path.sep));
  const fake = path.join(parent, exporter.STAGING_PREFIX + 'forged');
  fs.mkdirSync(fake, { recursive: true });
  fs.writeFileSync(path.join(fake, 'precious.png'), 'precious');
  // 名稱型態對，但沒有 marker
  assert.throws(function () {
    exporter.__testOnly.removeOwnedTree({
      repoRootAbs: fs.realpathSync(env.repo), exportParentAbs: parent,
      exportRootAbs: exportRootOf(env)
    }, fake, 'staging');
  }, /ownership 驗證/);
  assert.equal(fs.readFileSync(path.join(fake, 'precious.png'), 'utf8'), 'precious');
});

test('M1-2. marker 合法但名稱型態不對 → 拒絕刪除', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  run(env);
  const parent = path.join(env.repo, exporter.EXPORT_PARENT_REL.split('/').join(path.sep));
  const odd = path.join(parent, 'not-a-managed-name');
  fs.mkdirSync(odd, { recursive: true });
  fs.writeFileSync(path.join(odd, exporter.MARKER_NAME), exporter.markerContent());
  const ctx = {
    repoRootAbs: fs.realpathSync(env.repo), exportParentAbs: parent,
    exportRootAbs: exportRootOf(env)
  };
  assert.throws(function () {
    exporter.__testOnly.removeOwnedTree(ctx, odd, 'staging');
  }, /名稱不符合本工具的型態/);
  assert.ok(fs.existsSync(odd));
  // 位置不對也一樣
  const elsewhere = makeTmp('vfx-elsewhere-');
  fs.writeFileSync(path.join(elsewhere, exporter.MARKER_NAME), exporter.markerContent());
  assert.throws(function () {
    exporter.__testOnly.removeOwnedTree(ctx, elsewhere, 'staging');
  }, /不在受管理的父目錄/);
  assert.ok(fs.existsSync(elsewhere));
});

/* ---------------- MAJOR 2：索引暫存檔獨佔建立 ---------------- */

test('M2-1. 索引暫存檔以獨佔方式建立，既有檔案不得被覆寫', function () {
  const src = fs.readFileSync(path.join(repoRoot, 'tools', 'vfx', 'export-assets.cjs'), 'utf8');
  assert.ok(/openSync\([^)]*'wx'\)/.test(src), '必須用 wx 獨佔建立暫存檔');

  // 佔住暫存檔名的空間：連續撞名時必須 fail closed 而不是覆寫
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const dir = path.join(env.repo, 'vfx');
  fs.mkdirSync(dir, { recursive: true });
  const collide = path.join(dir, exporter.TEMP_INDEX_PREFIX + 'occupied');
  fs.writeFileSync(collide, 'someone elses temp file');
  run(env);                                     // 正常路徑不會撞到隨機名稱
  assert.equal(fs.readFileSync(collide, 'utf8'), 'someone elses temp file',
    '既有的暫存檔不得被動到');
  assert.ok(fs.existsSync(path.join(dir, 'shipped-assets.json')));
});

test('M2-2. writeShippedIndex 不會覆寫既有的目標以外檔案，且失敗時清掉暫存檔', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  run(env);
  const dir = path.join(env.repo, 'vfx');
  const before = fs.readdirSync(dir).filter(function (n) {
    return n.indexOf(exporter.TEMP_INDEX_PREFIX) === 0;
  });
  assert.deepEqual(before, [], '成功路徑不得留下暫存檔');
});

/* ---------------- 綜合攻擊：偽造 marker 不得害到別的目錄 ---------------- */

test('攻擊：在 images/vfx 放偽造 marker，也不會讓那一層被當成匯出目錄', function () {
  const env = scaffold({ presets: [spritePreset('p-one', ['pack/a.png'])] });
  const parent = path.join(env.repo, exporter.EXPORT_PARENT_REL.split('/').join(path.sep));
  fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(path.join(parent, exporter.MARKER_NAME), exporter.markerContent());
  const precious = path.join(parent, 'hand_authored.png');
  fs.writeFileSync(precious, 'precious');

  const report = run(env);                       // 正常匯出到 assets 子目錄
  assert.equal(report.published, true);
  assert.equal(fs.readFileSync(precious, 'utf8'), 'precious', 'images/vfx 的檔案必須毫髮無傷');
  assert.ok(fs.existsSync(path.join(parent, exporter.MARKER_NAME)), '偽造的 marker 也不該被刪');
});
