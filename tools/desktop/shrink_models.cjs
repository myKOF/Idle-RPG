'use strict';
/* ============ 打包時縮小 3D 模型貼圖（以 Electron 執行） ============
   electron tools/desktop/shrink_models.cjs <暫存區根目錄> <快取資料夾> <報告 JSON>
   由 tools/desktop/build_desktop.cjs 在打包時呼叫；原始檔（專案裡的 2048 模型）不動，只改暫存區的那一份。

   ---- 為什麼 ----
   BOSS 畫在 512×512、主角畫在 1024×1024 的畫布上（js/npc3d.js、js/hero3d.js），角色在畫面上只有幾百像素高；
   模型卻帶著 2048×2048 的貼圖（BOSS 一隻 3 張，貼圖佔 .glb 的 75～90%）。縮到 1024 畫面上看不出差別，
   包體少約 230 MB，顯示記憶體也少四分之三（2048² 一張解壓後 16 MB）。

   ---- 規則 ----
   - images/models/ 下的 .glb：內嵌貼圖最長邊縮到 1024；不需要透明的改存 JPEG（法線貼圖 95、其餘 90），
     需要透明的（材質 alphaMode 是 MASK／BLEND 的底色貼圖）維持 PNG。重壓後沒有變小、也不需要縮的保留原檔。
   - images/models/ 下的外部貼圖（.png／.jpg，主角 role5～7 用）：只縮尺寸、格式不變（檔名被 .glb 與 materials.json 引用）。
   - 用 Electron 的 nativeImage：不加新套件；實測解碼不做色彩管理（法線貼圖的像素值原樣保留），縮圖品質與 Lanczos 相當。

   ---- 暫存區是原始碼的硬連結 ----
   一律寫到暫存檔再 unlink 原路徑、rename 過去；直接寫會改到專案裡的原檔。

   ---- 快取 ----
   以「原檔 SHA-1＋規則版本」為鍵存在 build/desktop/model-cache/，沒改過的模型第二次打包直接取用。 */

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var electron = require('electron');

var RULES_VERSION = 'v1-max1024-jpeg90-normal95';
var MAX_SIZE = 1024;
var JPEG_QUALITY = 90;
var NORMAL_QUALITY = 95;

/* ---------------- GLB 讀寫（純函式，tests/desktop-shrink-models.test.cjs 直接測） ---------------- */
function parseGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB');
  var jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('GLB 第一個區塊不是 JSON');
  var json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  var bin = null;
  var off = 20 + jsonLen;
  if (off + 8 <= buf.length && buf.readUInt32LE(off + 4) === 0x004e4942) {
    bin = buf.slice(off + 8, off + 8 + buf.readUInt32LE(off));
  }
  return { json: json, bin: bin };
}

function pad4(n) { return (n + 3) & ~3; }

/* 依 bufferView 順序重新排 BIN；replace：{ bufferView 編號: 新的 bytes }。回傳新的 GLB Buffer。 */
function writeGlb(json, bin, replace) {
  var views = json.bufferViews || [];
  var parts = [];
  var offset = 0;
  views.forEach(function (v, i) {
    if ((v.buffer || 0) !== 0) throw new Error('只支援單一 buffer 的 GLB');
    var data = replace && replace[i] ? replace[i] : bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    var aligned = pad4(offset);
    if (aligned > offset) parts.push(Buffer.alloc(aligned - offset));
    v.byteOffset = aligned;
    v.byteLength = data.length;
    parts.push(data);
    offset = aligned + data.length;
  });
  var binOut = Buffer.concat(parts);
  var binPadded = Buffer.concat([binOut, Buffer.alloc(pad4(binOut.length) - binOut.length)]);
  if (json.buffers && json.buffers[0]) json.buffers[0].byteLength = binOut.length;
  var jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad4(jsonBuf.length) - jsonBuf.length, 0x20)]);
  var header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + (views.length ? 8 + binPadded.length : 0), 8);
  var jsonHead = Buffer.alloc(8);
  jsonHead.writeUInt32LE(jsonBuf.length, 0);
  jsonHead.writeUInt32LE(0x4e4f534a, 4);
  var chunks = [header, jsonHead, jsonBuf];
  if (views.length) {
    var binHead = Buffer.alloc(8);
    binHead.writeUInt32LE(binPadded.length, 0);
    binHead.writeUInt32LE(0x004e4942, 4);
    chunks.push(binHead, binPadded);
  }
  return Buffer.concat(chunks);
}

/* 每張內嵌圖的用途：{ 圖片編號: { normal, needsAlpha } } */
function imageRoles(json) {
  var roles = {};
  var textures = json.textures || [];
  function mark(texInfo, fn) {
    if (!texInfo || texInfo.index == null || !textures[texInfo.index]) return;
    var src = textures[texInfo.index].source;
    if (src == null) return;
    roles[src] = roles[src] || { normal: false, other: false, needsAlpha: false };
    fn(roles[src]);
  }
  (json.materials || []).forEach(function (m) {
    var pbr = m.pbrMetallicRoughness || {};
    var alpha = m.alphaMode === 'MASK' || m.alphaMode === 'BLEND';
    mark(pbr.baseColorTexture, function (r) { r.other = true; if (alpha) r.needsAlpha = true; });
    mark(pbr.metallicRoughnessTexture, function (r) { r.other = true; });
    mark(m.normalTexture, function (r) { r.normal = true; });
    mark(m.occlusionTexture, function (r) { r.other = true; });
    mark(m.emissiveTexture, function (r) { r.other = true; });
    // 其他擴充材質的貼圖：用途不明，保守起見保留透明
    Object.keys(m.extensions || {}).forEach(function (ext) {
      var e = m.extensions[ext] || {};
      Object.keys(e).forEach(function (k) {
        if (e[k] && typeof e[k] === 'object' && e[k].index != null) mark(e[k], function (r) { r.other = true; r.needsAlpha = true; });
      });
    });
  });
  return roles;
}

/* 縮圖目標尺寸：最長邊不超過 max，等比 */
function targetSize(w, h, max) {
  var m = Math.max(w, h);
  if (m <= max) return { width: w, height: h, resized: false };
  var s = max / m;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)), resized: true };
}

/* ---------------- 影像處理（Electron nativeImage） ---------------- */
function encodeImage(bytes, opts) {
  var img = electron.nativeImage.createFromBuffer(bytes);
  if (img.isEmpty()) return null;
  var size = img.getSize();
  var t = targetSize(size.width, size.height, MAX_SIZE);
  var out = t.resized ? img.resize({ width: t.width, height: t.height, quality: 'best' }) : img;
  var data, mime;
  if (opts.format === 'png') { data = out.toPNG(); mime = 'image/png'; }
  else { data = out.toJPEG(opts.quality || JPEG_QUALITY); mime = 'image/jpeg'; }
  return { data: data, mime: mime, from: size, to: { width: t.width, height: t.height }, resized: t.resized };
}

function shrinkGlb(buf) {
  var g = parseGlb(buf);
  if (!g.bin) return { buf: buf, images: [] };
  var roles = imageRoles(g.json);
  var replace = {};
  var log = [];
  (g.json.images || []).forEach(function (im, i) {
    if (im.bufferView == null) return;   // 外部 uri：另外以外部貼圖處理
    var v = g.json.bufferViews[im.bufferView];
    var bytes = g.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
    var role = roles[i] || { normal: false, other: false, needsAlpha: true };   // 沒被材質用到：保守保留透明
    var png = role.needsAlpha;
    var r = encodeImage(bytes, { format: png ? 'png' : 'jpeg', quality: role.normal && !role.other ? NORMAL_QUALITY : JPEG_QUALITY });
    if (!r || (!r.resized && r.data.length >= bytes.length)) { log.push({ image: i, kept: true, bytes: bytes.length }); return; }
    if (r.data.length >= bytes.length) { log.push({ image: i, kept: true, bytes: bytes.length }); return; }
    replace[im.bufferView] = r.data;
    im.mimeType = r.mime;
    log.push({ image: i, from: r.from.width + 'x' + r.from.height, to: r.to.width + 'x' + r.to.height, mime: r.mime, before: bytes.length, after: r.data.length });
  });
  if (!Object.keys(replace).length) return { buf: buf, images: log };
  return { buf: writeGlb(g.json, g.bin, replace), images: log };
}

function shrinkExternal(buf, ext) {
  var r = encodeImage(buf, { format: ext === '.png' ? 'png' : 'jpeg', quality: JPEG_QUALITY });
  if (!r || !r.resized || r.data.length >= buf.length) return { buf: buf, kept: true };
  return { buf: r.data, from: r.from, to: r.to };
}

/* ---------------- 主流程 ---------------- */
function listFiles(dir) {
  var out = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (e) {
      var p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(p);
    });
  })(dir);
  return out;
}

/* 硬連結安全的取代：寫暫存檔 → 刪掉原路徑（只斷開連結，不動原始檔）→ 改名 */
function replaceFile(dst, data) {
  var tmp = dst + '.shrink-tmp';
  fs.writeFileSync(tmp, data);
  fs.unlinkSync(dst);
  fs.renameSync(tmp, dst);
}

function run(stageRoot, cacheDir, reportFile) {
  var modelsDir = path.join(stageRoot, 'images', 'models');
  fs.mkdirSync(cacheDir, { recursive: true });
  var report = { rules: RULES_VERSION, files: [], beforeBytes: 0, afterBytes: 0, cacheHits: 0 };
  listFiles(modelsDir).forEach(function (file) {
    var ext = path.extname(file).toLowerCase();
    if (ext !== '.glb' && ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') return;
    var rel = path.relative(stageRoot, file).replace(/\\/g, '/');
    var src = fs.readFileSync(file);
    var key = crypto.createHash('sha1').update(RULES_VERSION).update(src).digest('hex');
    var cached = path.join(cacheDir, key + ext);
    var entry = { file: rel, before: src.length };
    var out;
    if (fs.existsSync(cached)) {
      out = fs.readFileSync(cached);
      report.cacheHits++;
    } else {
      var r = ext === '.glb' ? shrinkGlb(src) : shrinkExternal(src, ext === '.jpeg' ? '.jpg' : ext);
      out = r.buf;
      if (r.images) entry.images = r.images;
      fs.writeFileSync(cached, out);
    }
    entry.after = out.length;
    report.beforeBytes += src.length;
    report.afterBytes += out.length;
    if (out !== src && !out.equals(src)) replaceFile(file, out);
    report.files.push(entry);
  });
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  return report;
}

module.exports = { parseGlb: parseGlb, writeGlb: writeGlb, imageRoles: imageRoles, targetSize: targetSize, RULES_VERSION: RULES_VERSION };

/* 只在 Electron 主行程執行（Node 測試 require 本檔時不跑）。不用 require.main === module：
   Electron 載入入口腳本時它不成立，主流程不跑、又沒開視窗，程式就永遠掛著不結束。 */
if (process.type === 'browser' && electron && electron.app) {
  var args = process.argv.slice(-3);   // electron.exe <本檔> <暫存區> <快取> <報告>
  var app = electron.app;
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(path.resolve(args[1]), '.electron-userdata'));
  app.whenReady().then(function () {
    try {
      var r = run(path.resolve(args[0]), path.resolve(args[1]), path.resolve(args[2]));
      console.log('模型貼圖：' + r.files.length + ' 個檔，' + (r.beforeBytes / 1048576).toFixed(1) + ' → ' + (r.afterBytes / 1048576).toFixed(1) + ' MB（快取命中 ' + r.cacheHits + '）');
      app.exit(0);
    } catch (e) {
      console.error(e && e.stack || e);
      app.exit(1);
    }
  });
}
