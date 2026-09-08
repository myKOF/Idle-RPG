'use strict';
/* ============================================================
   vfx-raster.cjs — 點陣圖工具的共用底層（解碼／重取樣／編碼）

   由 shrink-sheets.cjs 抽出來的。動機很單純：sheet-facts 與 contact-sheet
   都要讀圖、縮圖、寫圖，而讓一支工具去 require 另一支工具的 CLI 模組
   （只為了拿它的編碼器）是一種會越滾越大的相依方向——A 需要 B 的某個函式，
   於是 B 從「一支工具」變成「一支工具外加一組別人在用的 API」，
   日後改 B 的 CLI 行為就會意外弄壞 A。

   解碼借用 vfx-image-facts 的 _internal：那裡已經有一份支援全部
   PNG 色彩型別／位元深度的實作，重寫第二份只會多一個會分歧的地方。
   編碼是新的——facts 只讀不寫，本來就沒有編碼器。
   ============================================================ */

const zlib = require('zlib');
const imageFacts = require('./vfx-image-facts.cjs');

const { readPngChunks, parseIhdr, decodeToRgba } = imageFacts._internal;

/* ---------------- 解碼 ----------------
   回傳 { width, height, rgba }，rgba 是 width*height*4 的 Uint8Array（非預乘）。
   讀不出像素時丟例外而不是回 null：呼叫端全都是「非有像素不可」的用途，
   靜靜回 null 只會把錯誤推遲到某個看不懂的地方才炸。 */
function decodePng(buffer) {
  const chunks = readPngChunks(buffer);
  const header = parseIhdr(chunks.ihdr);
  const rgba = decodeToRgba(header, chunks);
  if (!rgba) throw new Error('PNG 解碼失敗（可能是交錯或不支援的色彩型別）');
  return { width: header.width, height: header.height, rgba: rgba };
}

/* 只讀 IHDR 拿寬高，不解壓像素。呼叫端常常要先用尺寸決定「這張要不要處理」，
   為此把整張圖解出來再丟掉是非常昂貴的（2048² 就是 16 MB 一張）。 */
function pngSize(buffer) {
  const header = parseIhdr(readPngChunks(buffer).ihdr);
  return { width: header.width, height: header.height };
}

/* ---------------- PNG 編碼（8-bit RGBA、非交錯） ----------------
   只寫我們自己要用的那一種格式。用 filter 0（None）：這些圖是大面積透明
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

/* ---------------- 圖集格線 ----------------
   格線不從像素推：一張 3102x2585 的圖沒有辦法自己說出它是 6x5 還是 9x7。
   來源檔名把每格尺寸寫在後面（`Effect_X_1_517x517.png`），格數＝圖寬/格寬。
   縮圖工具改了格尺寸也必須跟著改檔名，否則這裡會算出錯的格線。 */
const CELL_IN_NAME = /^(.*)_(\d+)x(\d+)\.png$/i;

function cellFromName(basename) {
  const m = CELL_IN_NAME.exec(basename);
  return m ? { stem: m[1], w: +m[2], h: +m[3] } : null;
}

/* 由檔名格尺寸 ＋ 實際圖寬高推出格線。除不盡時回傳 null——
   除不盡代表檔名與內容不一致，硬取整只會讓每一格都偏移一點點。 */
function gridOf(basename, width, height) {
  const cell = cellFromName(basename);
  if (!cell) return null;
  const cols = width / cell.w, rows = height / cell.h;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  return { cols: cols, rows: rows, cellW: cell.w, cellH: cell.h, count: cols * rows };
}

module.exports = {
  decodePng: decodePng,
  pngSize: pngSize,
  encodePng: encodePng,
  resampleCell: resampleCell,
  targetCell: targetCell,
  cellFromName: cellFromName,
  gridOf: gridOf,
  CELL_IN_NAME: CELL_IN_NAME
};
