'use strict';
/* VFX Asset Scanner v1 — 事實層掃描與索引可移植性
   測試自己生成素材（含真正的 PNG 編碼），不依賴本機素材庫是否存在，
   因此在任何一台電腦、任何 CI 上都能跑。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const scanner = require('../tools/vfx/asset-scanner.cjs');
const imageFacts = require('../tools/vfx/vfx-image-facts.cjs');
const libraryRoot = require('../tools/vfx/vfx-library-root.cjs');

/* ---------------- 測試用的最小 PNG 編碼器 ---------------- */

const CRC_TABLE = (function () {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/* rgba: Uint8Array，長度 width*height*4 */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      // bitDepth
  ihdr[9] = 6;      // colorType RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    for (let x = 0; x < width * 4; x++) {
      raw[y * (width * 4 + 1) + 1 + x] = rgba[y * width * 4 + x];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* 左半不透明紅、右半全透明的 4×4 圖 */
function halfRedPng() {
  const w = 4, h = 4;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const opaque = x < 2;
      rgba[o] = opaque ? 255 : 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = opaque ? 255 : 0;
    }
  }
  return encodePng(w, h, rgba);
}

/* 全不透明純黑的 4×4 圖 */
function opaqueBlackPng() {
  const w = 4, h = 4;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = 255;
  return encodePng(w, h, rgba);
}

/* 通用編碼器：可指定 colorType／bitDepth／filter／PLTE／tRNS，
   用來覆蓋 RGBA 以外的解碼路徑。scanlines 為每列「未濾波」的原始位元組。 */
function buildPng(opts) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(opts.width, 0);
  ihdr.writeUInt32BE(opts.height, 4);
  ihdr[8] = opts.bitDepth;
  ihdr[9] = opts.colorType;
  ihdr[12] = opts.interlace || 0;
  const filterType = opts.filterType || 0;
  const bpp = Math.max(1, Math.ceil(opts.bitDepth * opts.channels / 8));
  const rows = [];
  let prev = Buffer.alloc(opts.scanlines[0].length);
  for (const row of opts.scanlines) {
    const filtered = Buffer.alloc(row.length);
    for (let x = 0; x < row.length; x++) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      let predictor = 0;
      if (filterType === 1) predictor = left;
      else if (filterType === 2) predictor = up;
      else if (filterType === 3) predictor = (left + up) >> 1;
      else if (filterType === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        predictor = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
      }
      filtered[x] = (row[x] - predictor) & 0xff;
    }
    rows.push(Buffer.concat([Buffer.from([filterType]), filtered]));
    prev = row;
  }
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)];
  if (opts.plte) parts.push(pngChunk('PLTE', opts.plte));
  if (opts.trns) parts.push(pngChunk('tRNS', opts.trns));
  parts.push(pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const SVG_WITH_VIEWBOX = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16"><path d="M0 0"/></svg>\n';
const SVG_NO_SIZE = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>\n';

/* ---------------- 測試素材庫 ---------------- */

function makeFixtureLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-scan-fixture-'));
  const write = function (rel, data) {
    const full = path.join(root, rel.split('/').join(path.sep));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
  };
  // .git 底下的東西一律不得進索引
  write('.git/objects/ab/deadbeef.png', halfRedPng());
  write('.git/config', 'x');
  write('packA/nested/.git/inner.png', halfRedPng());
  // 同名不同路徑
  write('packA/img/logo.png', halfRedPng());
  write('packA/other/logo.png', opaqueBlackPng());
  // 同目錄同名不同副檔名
  write('packA/img/logo.svg', SVG_WITH_VIEWBOX);
  // 需要 slug 化的目錄與檔名
  write('packB/Odd Name (X)/thing 01.png', opaqueBlackPng());
  // 不支援的格式
  write('packB/notes.txt', 'not an asset');
  // 位於 root 直下 → package 應為 _root
  write('loose.svg', SVG_NO_SIZE);
  return root;
}

function hashTree(root) {
  const entries = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) {
      return a.name < b.name ? -1 : 1;
    })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else entries.push(path.relative(root, full).split(path.sep).join('/') + ':' +
        crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'));
    }
  })(root);
  return entries.join('\n');
}

function rmTree(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

/* ---------------- 測試 ---------------- */

test('.git 目錄完全排除（含巢狀 .git）', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    const leaked = scan.assets.filter(function (a) { return a.relativePath.indexOf('.git') >= 0; });
    assert.deepEqual(leaked, [], '索引不得含任何 .git 路徑');
    assert.equal(scan.assets.some(function (a) { return a.assetId.indexOf('deadbeef') >= 0; }), false);
  } finally { rmTree(root); }
});

test('PNG 被正確索引，事實欄位符合已知像素內容', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    const logo = scan.assets.find(function (a) { return a.assetId === 'packa/img/logo.png'; });
    assert.ok(logo, '應索引到 packA/img/logo.png');
    assert.equal(logo.format, 'png');
    assert.equal(logo.package, 'packA');
    assert.deepEqual(logo.facts.dimensions, { width: 4, height: 4 });
    assert.equal(logo.facts.colorModel, 'rgba');
    assert.equal(logo.facts.hasAlphaChannel, true);
    assert.equal(logo.facts.pixelsAnalyzed, true);
    // 左半不透明 → 可見比例剛好一半，內容外接矩形寬 2
    assert.equal(logo.facts.alpha.visibleRatio, 0.5);
    assert.deepEqual(logo.facts.contentBounds, { x: 0, y: 0, width: 2, height: 4 });
    assert.equal(logo.facts.trimmed, false);
    assert.equal(logo.facts.backgroundVariant, 'transparent');
    // 純紅 → 飽和度 1
    assert.equal(logo.facts.saturation.mean, 1);
    assert.ok(logo.contentHash.startsWith('sha256:'));
  } finally { rmTree(root); }
});

test('全不透明純黑圖判為 blackBackground', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    const black = scan.assets.find(function (a) { return a.assetId === 'packa/other/logo.png'; });
    assert.equal(black.facts.backgroundVariant, 'blackBackground');
    assert.equal(black.facts.alpha.mean, 1);
    assert.equal(black.facts.luminance.borderNearBlackRatio, 1);
  } finally { rmTree(root); }
});

test('SVG 被正確索引；有 viewBox 取得尺寸，沒有則為 null', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    const withBox = scan.assets.find(function (a) { return a.assetId === 'packa/img/logo.svg'; });
    assert.ok(withBox, '應索引到 SVG');
    assert.equal(withBox.format, 'svg');
    assert.deepEqual(withBox.facts.dimensions, { width: 32, height: 16 });
    assert.equal(withBox.facts.dimensionsSource, 'viewBox');
    assert.equal(withBox.facts.pixelsAnalyzed, false);

    const loose = scan.assets.find(function (a) { return a.assetId === 'loose.svg'; });
    assert.ok(loose, 'root 直下的檔案也要索引');
    assert.equal(loose.package, '_root');
    assert.equal(loose.facts.dimensions, null, '沒有尺寸屬性就是 null，不猜');
  } finally { rmTree(root); }
});

test('同名不同路徑、同名不同副檔名都不會衝突', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    const ids = scan.assets.map(function (a) { return a.assetId; });
    assert.ok(ids.includes('packa/img/logo.png'));
    assert.ok(ids.includes('packa/other/logo.png'));
    assert.ok(ids.includes('packa/img/logo.svg'));
    assert.deepEqual(scanner.assertNoDuplicateIds(scan.assets), [], '不應有重複 assetId');
    assert.equal(new Set(ids).size, ids.length);
  } finally { rmTree(root); }
});

test('assetId 為 slug 化且與掃描順序無關；重跑完全一致', function () {
  const root = makeFixtureLibrary();
  try {
    const first = scanner.scanLibrary(root, { quiet: true });
    const second = scanner.scanLibrary(root, { quiet: true });
    assert.deepEqual(first.assets.map(function (a) { return a.assetId; }),
      second.assets.map(function (a) { return a.assetId; }));
    // 空白與括號被 slug 化
    assert.ok(first.assets.some(function (a) { return a.assetId === 'packb/odd-name-x/thing-01.png'; }),
      '目錄與檔名中的空白／括號應轉為 -');
    // 排序穩定
    const sorted = first.assets.map(function (a) { return a.assetId; }).slice().sort();
    assert.deepEqual(first.assets.map(function (a) { return a.assetId; }), sorted);
  } finally { rmTree(root); }
});

test('relativePath 全為可移植格式，且索引不含任何絕對路徑', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    for (const asset of scan.assets) {
      assert.equal(asset.relativePath.indexOf('\\'), -1, '不得有反斜線：' + asset.relativePath);
      assert.equal(asset.relativePath.startsWith('/'), false);
      assert.equal(/^[a-z]:/i.test(asset.relativePath), false);
    }
    const index = scanner.buildIndex('fixture', scan);
    assert.deepEqual(scanner.findNonPortableValues(index, '', root), [],
      '索引不得含磁碟機代號、反斜線或素材庫絕對路徑');
    assert.equal(scanner.serialise(index).indexOf(root.split(path.sep).join('/')), -1);
  } finally { rmTree(root); }
});

test('序列化輸出具決定性：兩次執行位元相同，且不含時間戳', function () {
  const root = makeFixtureLibrary();
  try {
    const a = scanner.serialise(scanner.buildIndex('fixture', scanner.scanLibrary(root, { quiet: true })));
    const b = scanner.serialise(scanner.buildIndex('fixture', scanner.scanLibrary(root, { quiet: true })));
    assert.equal(a, b, '相同素材庫必須產生位元相同的索引');
    assert.equal(/generatedAt|timestamp|\d{4}-\d{2}-\d{2}T/.test(a), false,
      '索引不得含掃描時間，否則每次重掃都會產生無意義 diff');
  } finally { rmTree(root); }
});

test('不支援的格式被略過而非誤索引', function () {
  const root = makeFixtureLibrary();
  try {
    const scan = scanner.scanLibrary(root, { quiet: true });
    assert.equal(scan.assets.some(function (a) { return a.relativePath.endsWith('.txt'); }), false);
    assert.equal(scan.skipped['.txt'], 1);
    assert.deepEqual(scan.failures, [], '合法素材不應有解析失敗');
  } finally { rmTree(root); }
});

test('掃描完全唯讀：素材庫內容與檔案清單皆未改變', function () {
  const root = makeFixtureLibrary();
  try {
    const before = hashTree(root);
    scanner.scanLibrary(root, { quiet: true });
    assert.equal(hashTree(root), before, 'Scanner 不得修改、搬移或新增任何素材');
  } finally { rmTree(root); }
});

test('Asset Library Root 不存在時給出清楚錯誤且不繼續', function () {
  const missing = path.join(os.tmpdir(), 'vfx-root-does-not-exist-' + process.pid);
  assert.throws(function () {
    libraryRoot.resolveLibraryRoot({ root: missing, libraryId: 'fixture' });
  }, function (err) {
    assert.equal(err.name, 'LibraryRootError');
    assert.ok(err.message.includes('不存在'), '錯誤訊息要說明是路徑不存在：' + err.message);
    assert.ok(err.hint && err.hint.includes('library.local.json'), '要附上設定方式');
    return true;
  });
});

test('未設定的 libraryId 會失敗，不會靜默回退到別的路徑', function () {
  assert.throws(function () {
    libraryRoot.resolveLibraryRoot({ libraryId: 'no-such-library-' + process.pid });
  }, function (err) {
    assert.equal(err.name, 'LibraryRootError');
    assert.ok(err.hint.includes('環境變數'), '要提示可用的設定方式');
    return true;
  });
});

test('交錯 PNG 不解碼，只給標頭事實且標記 pixelsAnalyzed=false', function () {
  // 用合法 CRC 重新編碼，而不是竄改既有檔案的 byte——竄改會連 CRC 檢查一起測到，混淆意圖
  const png = buildPng({
    width: 2, height: 2, bitDepth: 8, colorType: 6, channels: 4, interlace: 1,
    scanlines: [Buffer.alloc(8, 255), Buffer.alloc(8, 255)]
  });
  const facts = imageFacts.pngFacts(png);
  assert.equal(facts.pixelsAnalyzed, false, '交錯 PNG 不應產生像素統計');
  assert.deepEqual(facts.dimensions, { width: 2, height: 2 }, '標頭事實仍要回報');
  assert.equal(facts.alpha, undefined, '不得產生假的統計值');
});

test('palette + tRNS 的 alpha 正確解出', function () {
  // 兩色調色盤：索引 0 = 不透明紅、索引 1 = 全透明綠
  const png = buildPng({
    width: 2, height: 1, bitDepth: 8, colorType: 3, channels: 1,
    plte: Buffer.from([255, 0, 0, 0, 255, 0]),
    trns: Buffer.from([255, 0]),
    scanlines: [Buffer.from([0, 1])]
  });
  const facts = imageFacts.pngFacts(png);
  assert.equal(facts.hasAlphaChannel, true);
  assert.equal(facts.alpha.visibleRatio, 0.5, '一半像素透明');
  assert.deepEqual(facts.contentBounds, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(facts.saturation.mean, 1, '可見像素是純紅');
});

test('grayscale 與 RGB 的 tRNS 色鍵透明會被處理', function () {
  const gray = imageFacts.pngFacts(buildPng({
    width: 2, height: 1, bitDepth: 8, colorType: 0, channels: 1,
    trns: Buffer.from([0x00, 0x40]),           // 色鍵 = 灰階值 0x40
    scanlines: [Buffer.from([0x40, 0xff])]
  }));
  assert.equal(gray.hasAlphaChannel, true, 'colorType 0 的 tRNS 也算有 alpha');
  assert.equal(gray.alpha.visibleRatio, 0.5, '符合色鍵的像素應為透明');

  const rgb = imageFacts.pngFacts(buildPng({
    width: 2, height: 1, bitDepth: 8, colorType: 2, channels: 3,
    trns: Buffer.from([0, 0x10, 0, 0x20, 0, 0x30]),   // 色鍵 = (0x10,0x20,0x30)
    scanlines: [Buffer.from([0x10, 0x20, 0x30, 0xff, 0xff, 0xff])]
  }));
  assert.equal(rgb.hasAlphaChannel, true);
  assert.equal(rgb.alpha.visibleRatio, 0.5);
});

test('16-bit 樣本完整換算，低於 1/256 的 alpha 不會被當成全透明', function () {
  // alpha = 200/65535 ≈ 0.003；只取高位元組會變成 0（＝誤判為完全透明）
  const row = Buffer.alloc(8);
  row.writeUInt16BE(65535, 0); row.writeUInt16BE(0, 2); row.writeUInt16BE(0, 4);
  row.writeUInt16BE(200, 6);
  const facts = imageFacts.pngFacts(buildPng({
    width: 1, height: 1, bitDepth: 16, colorType: 6, channels: 4, scanlines: [row]
  }));
  assert.equal(facts.alpha.visibleRatio, 1, '非零 alpha 必須算可見');
  assert.ok(facts.alpha.mean > 0, 'alpha 平均值不得為 0');
});

test('filter 1～4 都能正確反濾波', function () {
  const width = 4, height = 3;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x++) {
      row[x * 4] = (x * 37 + y * 11) & 0xff;
      row[x * 4 + 1] = (x * 5 + y * 61) & 0xff;
      row[x * 4 + 2] = (x * 97 + y * 3) & 0xff;
      row[x * 4 + 3] = 255;
    }
    rows.push(row);
  }
  const reference = imageFacts.pngFacts(buildPng({
    width: width, height: height, bitDepth: 8, colorType: 6, channels: 4,
    filterType: 0, scanlines: rows
  }));
  for (const filterType of [1, 2, 3, 4]) {
    const facts = imageFacts.pngFacts(buildPng({
      width: width, height: height, bitDepth: 8, colorType: 6, channels: 4,
      filterType: filterType, scanlines: rows
    }));
    assert.deepEqual(facts.luminance, reference.luminance, 'filter ' + filterType + ' 反濾波結果應一致');
    assert.deepEqual(facts.saturation, reference.saturation, 'filter ' + filterType);
  }
});

test('損毀的 PNG 會拋錯，不會產生看似正常的事實', function () {
  const good = halfRedPng();

  const badCrc = Buffer.from(good);
  badCrc[badCrc.length - 5] ^= 0xff;              // 破壞 IEND 前一個 chunk 的內容
  assert.throws(function () { imageFacts.pngFacts(badCrc); }, /CRC|截斷|不足/);

  const truncated = good.subarray(0, good.length - 12);
  assert.throws(function () { imageFacts.pngFacts(truncated); }, /截斷|IEND/);

  const noSignature = Buffer.from(good);
  noSignature[1] = 0;
  assert.throws(function () { imageFacts.pngFacts(noSignature); }, /簽章/);
});

test('非法的 colorType／bitDepth 組合會被拒絕', function () {
  const png = buildPng({
    width: 1, height: 1, bitDepth: 4, colorType: 6, channels: 4,
    scanlines: [Buffer.from([0, 0])]
  });
  assert.throws(function () { imageFacts.pngFacts(png); }, /bitDepth/);
});

test('libraryId 格式受限，確保環境變數名稱一對一', function () {
  assert.equal(libraryRoot.envVarNameFor('effects-materials'), 'VFX_ASSET_ROOT_EFFECTS_MATERIALS');
  // a-b 與 a_b 若都合法就會映射到同一個環境變數名稱 → 只允許連字號
  assert.throws(function () { libraryRoot.envVarNameFor('a_b'); }, /不合法/);
  assert.throws(function () { libraryRoot.envVarNameFor('my.own vfx'); }, /不合法/);
  assert.throws(function () { libraryRoot.envVarNameFor('-lead'); }, /不合法/);
  assert.throws(function () { libraryRoot.resolveLibraryRoot({ libraryId: 'Bad_Id' }); }, /不合法/);
});

test('assetId 碰撞會被偵測並列出兩個來源', function () {
  // 'a b.png' 與 'a-b.png' slug 化後都是 'a-b.png'
  const assets = [
    { assetId: scanner.makeAssetId('pack/a b.png'), relativePath: 'pack/a b.png' },
    { assetId: scanner.makeAssetId('pack/a-b.png'), relativePath: 'pack/a-b.png' }
  ];
  assert.equal(assets[0].assetId, assets[1].assetId, 'slug 化後確實會撞在一起');
  const clashes = scanner.assertNoDuplicateIds(assets);
  assert.equal(clashes.length, 1, '必須偵測到碰撞');
  assert.ok(clashes[0].includes('a b.png') && clashes[0].includes('a-b.png'),
    '錯誤訊息要列出兩個來源路徑');
});

test('CLI：素材解析失敗時 exit 2 且不寫出索引', function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-scan-bad-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-scan-out-'));
  const outPath = path.join(outDir, 'asset-index.json');
  try {
    fs.writeFileSync(path.join(root, 'ok.png'), halfRedPng());
    const broken = halfRedPng();
    broken[broken.length - 5] ^= 0xff;                       // CRC 壞掉
    fs.writeFileSync(path.join(root, 'broken.png'), broken);

    const run = require('node:child_process').spawnSync(process.execPath, [
      path.join(__dirname, '..', 'tools', 'vfx', 'asset-scanner.cjs'),
      '--root', root, '--library', 'fixture-lib', '--out', outPath, '--quiet'
    ], { encoding: 'utf8' });

    assert.equal(run.status, 2, '解析失敗必須是硬錯誤，不能靜默略過素材');
    assert.equal(fs.existsSync(outPath), false, '失敗時不得寫出不完整的索引');
    assert.ok(/broken\.png/.test(run.stderr), '錯誤訊息要指出是哪個檔案：' + run.stderr);
  } finally { rmTree(root); rmTree(outDir); }
});

test('CLI：正常素材庫可寫出索引且 --check 通過', function () {
  const root = makeFixtureLibrary();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-scan-out-'));
  const outPath = path.join(outDir, 'asset-index.json');
  const cli = path.join(__dirname, '..', 'tools', 'vfx', 'asset-scanner.cjs');
  const spawn = require('node:child_process').spawnSync;
  try {
    const write = spawn(process.execPath,
      [cli, '--root', root, '--library', 'fixture-lib', '--out', outPath, '--quiet'],
      { encoding: 'utf8' });
    assert.equal(write.status, 0, write.stderr);
    assert.ok(fs.existsSync(outPath));

    const check = spawn(process.execPath,
      [cli, '--root', root, '--library', 'fixture-lib', '--out', outPath, '--check', '--quiet'],
      { encoding: 'utf8' });
    assert.equal(check.status, 0, '同樣的素材庫必須通過 --check：' + check.stderr);

    // 素材有變動時 --check 必須失敗，否則它就沒有守門的意義
    fs.writeFileSync(path.join(root, 'packA', 'img', 'extra.png'), opaqueBlackPng());
    const changed = spawn(process.execPath,
      [cli, '--root', root, '--library', 'fixture-lib', '--out', outPath, '--check', '--quiet'],
      { encoding: 'utf8' });
    assert.equal(changed.status, 1, '素材變動後 --check 應回報不同');
  } finally { rmTree(root); rmTree(outDir); }
});

test('16-bit alpha 的邊界值：raw 1 與 128 仍算可見', function () {
  for (const rawAlpha of [1, 128, 129, 65535]) {
    const row = Buffer.alloc(8);
    row.writeUInt16BE(65535, 0); row.writeUInt16BE(65535, 2); row.writeUInt16BE(65535, 4);
    row.writeUInt16BE(rawAlpha, 6);
    const facts = imageFacts.pngFacts(buildPng({
      width: 1, height: 1, bitDepth: 16, colorType: 6, channels: 4, scanlines: [row]
    }));
    assert.equal(facts.alpha.visibleRatio, 1, 'raw alpha=' + rawAlpha + ' 必須算可見');
    assert.deepEqual(facts.contentBounds, { x: 0, y: 0, width: 1, height: 1 },
      'raw alpha=' + rawAlpha + ' 的內容範圍不得被算成空');
  }
  // 真正的 0 才是透明
  const zero = Buffer.alloc(8);
  const facts = imageFacts.pngFacts(buildPng({
    width: 1, height: 1, bitDepth: 16, colorType: 6, channels: 4, scanlines: [zero]
  }));
  assert.equal(facts.alpha.visibleRatio, 0);
});

test('colorType 4（gray+alpha）與 4-bit packed palette 都能解碼', function () {
  const grayAlpha = imageFacts.pngFacts(buildPng({
    width: 2, height: 1, bitDepth: 8, colorType: 4, channels: 2,
    scanlines: [Buffer.from([0xff, 0xff, 0x80, 0x00])]     // 白不透明 / 灰全透明
  }));
  assert.equal(grayAlpha.colorModel, 'grayAlpha');
  assert.equal(grayAlpha.alpha.visibleRatio, 0.5);
  assert.equal(grayAlpha.saturation.mean, 0, '灰階飽和度為 0');

  // 4-bit palette：一個 byte 裝兩個索引（0x01 → 索引 0、索引 1）
  const packed = imageFacts.pngFacts(buildPng({
    width: 2, height: 1, bitDepth: 4, colorType: 3, channels: 1,
    plte: Buffer.from([255, 255, 255, 0, 0, 0]),
    scanlines: [Buffer.from([0x01])]
  }));
  assert.deepEqual(packed.dimensions, { width: 2, height: 1 });
  assert.equal(packed.luminance.mean, 0.5, '一白一黑 → 平均亮度 0.5');
});

test('palette 索引越界與非法 PLTE 長度都會失敗，不會靜默變成黑色', function () {
  const outOfRange = buildPng({
    width: 1, height: 1, bitDepth: 8, colorType: 3, channels: 1,
    plte: Buffer.from([255, 0, 0]),                 // 只有 1 個色彩
    scanlines: [Buffer.from([5])]                   // 卻用索引 5
  });
  assert.throws(function () { imageFacts.pngFacts(outOfRange); }, /索引越界/);

  const badPlte = buildPng({
    width: 1, height: 1, bitDepth: 8, colorType: 3, channels: 1,
    plte: Buffer.from([255, 0]),                    // 長度不是 3 的倍數
    scanlines: [Buffer.from([0])]
  });
  assert.throws(function () { imageFacts.pngFacts(badPlte); }, /PLTE 長度/);
});

test('像素數上限對交錯 PNG 同樣生效', function () {
  // 只造標頭宣告的超大尺寸；上限檢查發生在解碼之前，不需要真的產生那麼多像素
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(9000, 0);
  ihdr.writeUInt32BE(9000, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[12] = 1;           // interlace = 1
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.alloc(16))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
  assert.throws(function () { imageFacts.pngFacts(png); }, /像素數超過上限/,
    '交錯 PNG 也必須受像素上限約束');
});

test('非 SVG 內容會拋錯；SVG 尺寸單位換算成像素', function () {
  assert.throws(function () { imageFacts.svgFacts(Buffer.from('just text, not svg')); },
    /不是 SVG/, '副檔名是 .svg 但內容不是，必須失敗而非被當成有效素材');

  const inches = imageFacts.svgFacts(Buffer.from('<svg width="1in" height="0.5in"></svg>'));
  assert.deepEqual(inches.dimensions, { width: 96, height: 48 }, '1in = 96px');
  assert.equal(inches.dimensionsSource, 'attributes');

  const percent = imageFacts.svgFacts(Buffer.from('<svg width="100%" height="50%"></svg>'));
  assert.equal(percent.dimensions, null, '百分比無從換算 → null，不猜');
});

test('--root 與 --library 都指定時不依賴本機設定檔', function () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-root-only-'));
  try {
    const resolved = libraryRoot.resolveLibraryRoot({ root: root, libraryId: 'fixture-lib' });
    assert.equal(resolved.libraryId, 'fixture-lib');
    assert.equal(resolved.source, '--root 參數');
  } finally { rmTree(root); }
});

test('edgeContinuity 是量測值，不是可平鋪判定', function () {
  const facts = imageFacts.pngFacts(opaqueBlackPng());
  // 純色圖對邊完全吻合 → 1，但這不代表它是有用的 tiling 紋理
  assert.equal(facts.edgeContinuity.u, 1);
  assert.equal(facts.edgeContinuity.v, 1);
  assert.equal(facts.seamless, undefined, 'v1 不得輸出 seamless 判定');
  assert.equal(facts.tileable, undefined);
});
