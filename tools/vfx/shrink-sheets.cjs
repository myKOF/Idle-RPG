'use strict';
/* ============================================================
   shrink-sheets.cjs — 把序列幀圖集降到合理的格子尺寸

   為什麼需要這一步：PNG 是壓縮格式，上了 GPU 就是未壓縮的 RGBA。
   一張 3102×2585 的圖集在硬碟上是 2.7 MB，在 VRAM 裡是 **32 MB**。
   22 個特效全部常駐是 362 MB——目前整套 VFX 素材才 85 MB。

   而每格 517px 的解析度也用不到：這些特效在遊戲裡最多播到 300px
   （範圍技能的直徑 120～800px，受擊只有 60～96px）。格子降到 256px
   之後 VRAM 掉到八分之一，畫面上看不出差別。

   ------------------------------------------------------------
   設計決定

   1. 產生**衍生素材**，不就地覆蓋原檔。
      原始高解析度留在素材庫裡（那是母帶），衍生檔另存成一個 package
      （`<來源>-<格子尺寸>`）。preset 引用衍生檔，匯出照抄，不必在匯出路徑
      裡塞轉檔邏輯——那會讓「repo 裡的檔案」與「素材庫裡的檔案」不再是同一張圖，
      日後對不上時極難查。

   2. **逐格重取樣**，不是整張一起縮。
      一開始寫成「整張圖乘上一個整數倍率」，結果 517、305 這種格尺寸幾乎只能
      被 1 整除，全部被判成「已經夠小」而原封不動。改成每一格獨立縮到目標尺寸：
      比例可以是任意值，而且格與格之間絕不互相取樣——整張一起縮時，落在格線上
      的目標像素會同時吃到兩格的內容，畫面上是每一格邊緣都帶著隔壁格的一條線。

   3. 縮放前先**預乘 alpha**。
      透明像素的 RGB 通常是黑的（甚至是垃圾值）。直接平均 RGB 會把黑色混進
      邊緣，結果是所有半透明邊緣都變暗一圈——那正是「縮圖之後特效邊緣有黑框」
      的成因。預乘之後再平均、最後還原，邊緣才乾淨。

   4. 用 box filter（區塊平均）而不是取樣。
      降解析時區塊平均就是正解：每個目標像素涵蓋 k×k 個來源像素，全部算進去。
      取樣（最近鄰／雙線性）會丟掉大部分來源像素，細節變成雜訊。

   用法：
     node tools/vfx/shrink-sheets.cjs                     全部縮到 256px 格
     node tools/vfx/shrink-sheets.cjs --cell 128          指定格子尺寸
     node tools/vfx/shrink-sheets.cjs --package <name>    只處理某個 package
     node tools/vfx/shrink-sheets.cjs --dry               只報告，不寫檔
   ============================================================ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const imageFacts = require('./vfx-image-facts.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

const { readPngChunks, parseIhdr, decodeToRgba } = imageFacts._internal;

/* ---------------- PNG 編碼（8-bit RGBA、非交錯） ----------------
   只寫我們自己要用的那一種格式。用 filter 0（None）：這些圖集是大面積透明
   ＋ 局部彩色，Paeth 之類的預測器省不了多少，卻要多跑一輪逐像素運算。 */

const CRC_TABLE = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(rgba, width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;            // bit depth
  ihdr[9] = 6;            // colour type: RGBA
  ihdr[10] = 0;           // deflate
  ihdr[11] = 0;           // filter method
  ihdr[12] = 0;           // non-interlaced
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter type: None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 重取樣 ----------------
   面積平均（area average）：目標像素涵蓋來源的一塊矩形區域，區域邊界通常落在
   來源像素中間，所以每個來源像素按「重疊面積」加權。比例是任意實數也成立。

   src 的取樣範圍限制在 [sx0, sx0+sw) × [sy0, sy0+sh) —— 也就是一格之內。
   絕不越界到隔壁格，這是逐格處理的重點。 */
function resampleCell(src, srcStride, sx0, sy0, sw, sh, dw, dh, dst, dstStride, dx0, dy0) {
  const rx = sw / dw, ry = sh / dh;
  for (let dy = 0; dy < dh; dy++) {
    const y0 = sy0 + dy * ry, y1 = y0 + ry;
    const iy0 = Math.floor(y0), iy1 = Math.min(sy0 + sh, Math.ceil(y1));
    for (let dx = 0; dx < dw; dx++) {
      const x0 = sx0 + dx * rx, x1 = x0 + rx;
      const ix0 = Math.floor(x0), ix1 = Math.min(sx0 + sw, Math.ceil(x1));
      let r = 0, g = 0, b = 0, aw = 0, wsum = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          const o = sy * srcStride + sx * 4;
          /* 預乘：透明像素的 RGB 不可信，直接平均會把黑色混進邊緣。 */
          const av = src[o + 3] * w;
          r += src[o] * av; g += src[o + 1] * av; b += src[o + 2] * av;
          aw += av; wsum += w;
        }
      }
      const d = (dy0 + dy) * dstStride + (dx0 + dx) * 4;
      if (aw <= 0) { dst[d] = dst[d + 1] = dst[d + 2] = dst[d + 3] = 0; continue; }
      /* 還原預乘：顏色除以 alpha 加權總和，alpha 除以權重總和。 */
      dst[d] = Math.min(255, Math.round(r / aw));
      dst[d + 1] = Math.min(255, Math.round(g / aw));
      dst[d + 2] = Math.min(255, Math.round(b / aw));
      dst[d + 3] = Math.min(255, Math.round(aw / wsum));
    }
  }
}

/* 目標格子尺寸：等比縮到長邊等於 target，且不放大。 */
function targetCell(cellW, cellH, target) {
  const k = target / Math.max(cellW, cellH);
  if (k >= 1) return null;                      // 本來就比目標小，不動它
  return { w: Math.max(1, Math.round(cellW * k)), h: Math.max(1, Math.round(cellH * k)) };
}

/* 檔名把每格尺寸寫在後面：`Effect_X_1_517x517.png`。縮完要跟著改，
   否則 preset 端算格線時會用錯的格尺寸去除。 */
const NAME_RE = /^(.*)_(\d+)x(\d+)\.png$/i;

function run(opts) {
  const resolved = libraryRoot.resolveLibraryRoot({ root: opts.root });
  const root = resolved.root;
  const target = opts.cell;
  const srcPkg = opts.package;
  const srcDir = path.join(root, srcPkg);
  if (!fs.existsSync(srcDir)) throw new Error('找不到 package：' + srcDir);
  const outPkg = srcPkg + '-' + target;
  const outRoot = path.join(root, outPkg);

  const jobs = [];
  (function walk(rel) {
    const dir = path.join(srcDir, rel);
    fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) return walk(r);
      if (!/\.png$/i.test(e.name)) return;
      jobs.push(r);
    });
  })('');

  let savedVram = 0, newVram = 0, oldBytes = 0, newBytes = 0, skipped = 0;
  jobs.forEach(function (rel) {
    const srcPath = path.join(srcDir, rel);
    const m = NAME_RE.exec(path.basename(rel));
    if (!m) { console.warn('  略過（檔名沒有格尺寸）：' + rel); skipped++; return; }
    const cellW = +m[2], cellH = +m[3];
    const buf = fs.readFileSync(srcPath);
    const chunks = readPngChunks(buf);
    const header = parseIhdr(chunks.ihdr);
    oldBytes += buf.length;
    const oldV = header.width * header.height * 4;
    const cols = header.width / cellW, rows = header.height / cellH;
    if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
      console.warn('  略過（' + header.width + 'x' + header.height + ' 除不盡格 ' +
        cellW + 'x' + cellH + '）：' + rel);
      skipped++; newVram += oldV; newBytes += buf.length;
      writeOut(outRoot, rel, buf, opts.dry);
      return;
    }
    const tc = targetCell(cellW, cellH, target);
    if (!tc) {
      console.log('  ' + rel + ' 已經夠小（格 ' + cellW + 'x' + cellH + '），照抄');
      newVram += oldV; newBytes += buf.length;
      writeOut(outRoot, rel, buf, opts.dry);
      return;
    }
    const rgba = decodeToRgba(header, chunks);
    const dw = cols * tc.w, dh = rows * tc.h;
    const dst = new Uint8Array(dw * dh * 4);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        resampleCell(rgba, header.width * 4, c * cellW, r * cellH, cellW, cellH,
          tc.w, tc.h, dst, dw * 4, c * tc.w, r * tc.h);
      }
    }
    const outName = (path.dirname(rel) === '.' ? '' : path.dirname(rel) + '/') +
      m[1] + '_' + tc.w + 'x' + tc.h + '.png';
    const png = encodePng(dst, dw, dh);
    writeOut(outRoot, outName, png, opts.dry);
    const nv = dw * dh * 4;
    newVram += nv; savedVram += oldV - nv; newBytes += png.length;
    console.log('  ' + rel.padEnd(46) + ' 格 ' + cellW + 'x' + cellH + ' → ' + tc.w + 'x' + tc.h +
      '   VRAM ' + (oldV / 1048576).toFixed(1) + ' → ' + (nv / 1048576).toFixed(1) + ' MB');
  });

  console.log('');
  console.log('來源 package : ' + srcPkg + '（' + jobs.length + ' 張' + (skipped ? '，略過 ' + skipped : '') + '）');
  console.log('輸出 package : ' + outPkg + (opts.dry ? '（--dry，未寫檔）' : ''));
  console.log('硬碟         : ' + (oldBytes / 1048576).toFixed(1) + ' → ' + (newBytes / 1048576).toFixed(1) + ' MB');
  console.log('全部常駐VRAM : ' + ((newVram + savedVram) / 1048576).toFixed(0) + ' → ' + (newVram / 1048576).toFixed(0) + ' MB');
  console.log('');
  console.log('⚠️ 記得重跑 asset-scanner，衍生素材才會進索引。');
}

function writeOut(outRoot, rel, buf, dry) {
  if (dry) return;
  const p = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const arg = (name, def) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
  };
  try {
    run({
      root: arg('root', null),
      package: arg('package', 'spritemancer-vfx'),
      cell: Number(arg('cell', 256)),
      dry: argv.includes('--dry')
    });
  } catch (e) {
    console.error('失敗：' + e.message);
    process.exit(2);
  }
}

module.exports = { encodePng: encodePng, resampleCell: resampleCell, targetCell: targetCell, run: run };
