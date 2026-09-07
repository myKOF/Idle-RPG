'use strict';
/* ============================================================
   contact-sheet.cjs — 把一批素材拼成一張可以直接看的總覽圖

   為什麼需要這支工具：素材是帶 alpha 的 PNG，看圖程式各自用不同底色去
   合成——白底看不到白色火花，黑底看不到黑煙。實測同一批圖集，
   Effect_TheVortex 合在黑底上一目了然，Effect_Impact 合在白底上整張全白。
   底色不能碰運氣，必須由我們自己決定。

   預設用**中灰棋盤格**：亮素材與暗素材同時可見，而棋盤格讓「這裡是透明」
   與「這裡是灰色的畫」不會被混為一談——純灰底分不出這兩者。

   另外會畫出索引編號。177 張圖排成 16 欄時，用數格子的方式指認第 93 張
   必然會數錯；標號讓「pdalpha_093 是那個六角星」變成可以驗證的陳述。

   用法：
     node tools/vfx/contact-sheet.cjs --package shape-alpha --out a.png
     node tools/vfx/contact-sheet.cjs --package shape-alpha --range 1-60 --thumb 128
     node tools/vfx/contact-sheet.cjs --frames spritemancer-vfx-256/30fps/Effect_Impact_1_247x256.png
   ============================================================ */

const fs = require('fs');
const path = require('path');
const raster = require('./vfx-raster.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

/* ---------------- 3x5 點陣數字 ----------------
   只需要 0-9 與幾個符號。每個字元是 5 個 bit-row，每 row 取低 3 bit。
   自己畫一套的成本遠低於引入字型檔或 canvas 相依。 */
const GLYPHS = {
  A: [0x7, 0x5, 0x7, 0x5, 0x5], B: [0x6, 0x5, 0x6, 0x5, 0x6], C: [0x3, 0x4, 0x4, 0x4, 0x3],
  D: [0x6, 0x5, 0x5, 0x5, 0x6], E: [0x7, 0x4, 0x7, 0x4, 0x7], F: [0x7, 0x4, 0x7, 0x4, 0x4],
  G: [0x3, 0x4, 0x5, 0x5, 0x3], H: [0x5, 0x5, 0x7, 0x5, 0x5], I: [0x7, 0x2, 0x2, 0x2, 0x7],
  J: [0x1, 0x1, 0x1, 0x5, 0x2], K: [0x5, 0x5, 0x6, 0x5, 0x5], L: [0x4, 0x4, 0x4, 0x4, 0x7],
  M: [0x5, 0x7, 0x7, 0x5, 0x5], N: [0x5, 0x7, 0x7, 0x7, 0x5], O: [0x2, 0x5, 0x5, 0x5, 0x2],
  P: [0x6, 0x5, 0x6, 0x4, 0x4], Q: [0x2, 0x5, 0x5, 0x6, 0x3], R: [0x6, 0x5, 0x6, 0x5, 0x5],
  S: [0x3, 0x4, 0x2, 0x1, 0x6], T: [0x7, 0x2, 0x2, 0x2, 0x2], U: [0x5, 0x5, 0x5, 0x5, 0x7],
  V: [0x5, 0x5, 0x5, 0x5, 0x2], W: [0x5, 0x5, 0x7, 0x7, 0x5], X: [0x5, 0x5, 0x2, 0x5, 0x5],
  Y: [0x5, 0x5, 0x2, 0x2, 0x2], Z: [0x7, 0x1, 0x2, 0x4, 0x7],
  '0': [0x7, 0x5, 0x5, 0x5, 0x7], '1': [0x2, 0x6, 0x2, 0x2, 0x7],
  '2': [0x7, 0x1, 0x7, 0x4, 0x7], '3': [0x7, 0x1, 0x7, 0x1, 0x7],
  '4': [0x5, 0x5, 0x7, 0x1, 0x1], '5': [0x7, 0x4, 0x7, 0x1, 0x7],
  '6': [0x7, 0x4, 0x7, 0x5, 0x7], '7': [0x7, 0x1, 0x1, 0x1, 0x1],
  '8': [0x7, 0x5, 0x7, 0x5, 0x7], '9': [0x7, 0x5, 0x7, 0x1, 0x7],
  '-': [0x0, 0x0, 0x7, 0x0, 0x0], '.': [0x0, 0x0, 0x0, 0x0, 0x2],
  '#': [0x5, 0x7, 0x5, 0x7, 0x5], ' ': [0, 0, 0, 0, 0]
};

/* scale 倍放大的點陣字。畫兩次（先黑後白、偏移一格）做描邊，
   否則號碼落在亮素材上會看不見。 */
function drawText(dst, stride, W, H, text, x0, y0, scale) {
  function put(px, py, r, g, b) {
    if (px < 0 || py < 0 || px >= W || py >= H) return;
    const o = py * stride + px * 4;
    dst[o] = r; dst[o + 1] = g; dst[o + 2] = b; dst[o + 3] = 255;
  }
  [[1, 0, 0, 0], [0, 255, 255, 255]].forEach(function (pass) {
    const off = pass[0];
    let cx = x0 + off;
    for (let i = 0; i < text.length; i++) {
      const g = GLYPHS[text[i].toUpperCase()] || GLYPHS[' '];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 3; c++) {
          if (!((g[r] >> (2 - c)) & 1)) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              put(cx + c * scale + sx, y0 + off + r * scale + sy, pass[1], pass[2], pass[3]);
            }
          }
        }
      }
      cx += 4 * scale;
    }
  });
}

const BACKGROUNDS = {
  checker: function (x, y) { return (((x >> 3) + (y >> 3)) & 1) ? 128 : 100; },
  grey: function () { return 118; },
  black: function () { return 0; },
  white: function () { return 255; }
};

function fillBackground(dst, stride, W, H, kind) {
  const fn = BACKGROUNDS[kind];
  if (!fn) throw new Error('不認得的底色：' + kind);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = fn(x, y), o = y * stride + x * 4;
      dst[o] = dst[o + 1] = dst[o + 2] = v; dst[o + 3] = 255;
    }
  }
}

/* 把一塊已縮好的 RGBA 用 source-over 疊到畫布上。 */
function composite(dst, stride, dx0, dy0, src, sw, sh) {
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (y * sw + x) * 4, a = src[s + 3];
      if (!a) continue;
      const d = (dy0 + y) * stride + (dx0 + x) * 4;
      if (a === 255) {
        dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2];
      } else {
        const k = a / 255, ik = 1 - k;
        dst[d] = src[s] * k + dst[d] * ik;
        dst[d + 1] = src[s + 1] * k + dst[d + 1] * ik;
        dst[d + 2] = src[s + 2] * k + dst[d + 2] * ik;
      }
    }
  }
}

/* 縮到 thumb 見方（等比，置中留白）。回傳 { rgba, w, h }。 */
function thumbnail(img, sx, sy, sw, sh, thumb) {
  const k = Math.min(thumb / sw, thumb / sh);
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const out = new Uint8Array(w * h * 4);
  raster.resampleCell(img.rgba, img.width * 4, sx, sy, sw, sh, w, h, out, w * 4, 0, 0);
  return { rgba: out, w: w, h: h };
}

/* ---------------- 兩種來源 ---------------- */

/* 一批獨立檔案 */
function collectFiles(root, pkg, filter) {
  const base = path.join(root, pkg);
  const out = [];
  (function walk(rel) {
    fs.readdirSync(path.join(base, rel), { withFileTypes: true }).forEach(function (e) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(r);
      else if (/\.(png)$/i.test(e.name)) out.push(r);
    });
  })('');
  out.sort();
  return filter ? out.filter(function (r) { return new RegExp(filter, 'i').test(r); }) : out;
}

function tilesFromFiles(base, rels, thumb) {
  return rels.map(function (rel, i) {
    const img = raster.decodePng(fs.readFileSync(path.join(base, rel)));
    const t = thumbnail(img, 0, 0, img.width, img.height, thumb);
    /* 標號取檔名結尾的數字；沒有就用序號。指認素材時要說得出 assetId。 */
    const m = /(\d+)(?:_\d+x\d+)?\.png$/i.exec(rel);
    t.label = m ? String(+m[1]) : String(i + 1);
    return t;
  });
}

function tilesFromFrames(base, rel, thumb) {
  const img = raster.decodePng(fs.readFileSync(path.join(base, rel)));
  const grid = raster.gridOf(path.basename(rel), img.width, img.height);
  if (!grid) throw new Error('這張圖的檔名沒有格尺寸，或除不盡：' + rel);
  const tiles = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = thumbnail(img, c * grid.cellW, r * grid.cellH, grid.cellW, grid.cellH, thumb);
      t.label = String(r * grid.cols + c);
      tiles.push(t);
    }
  }
  return tiles;
}

/* ---------------- 排版 ---------------- */

function layout(tiles, opts) {
  const thumb = opts.thumb, pad = 4;
  const cols = opts.cols || Math.ceil(Math.sqrt(tiles.length * 1.4));
  const rows = Math.ceil(tiles.length / cols);
  const cellW = thumb + pad, cellH = thumb + pad + (opts.label ? 9 : 0);
  const W = cols * cellW + pad, H = rows * cellH + pad;
  const stride = W * 4;
  const dst = new Uint8Array(W * H * 4);
  fillBackground(dst, stride, W, H, opts.bg);
  tiles.forEach(function (t, i) {
    const cx = pad + (i % cols) * cellW, cy = pad + ((i / cols) | 0) * cellH;
    composite(dst, stride, cx + ((thumb - t.w) >> 1), cy + ((thumb - t.h) >> 1), t.rgba, t.w, t.h);
    if (opts.label) drawText(dst, stride, W, H, t.label, cx + 1, cy + thumb + 1, 1);
  });
  return { rgba: dst, width: W, height: H, cols: cols, rows: rows };
}

function run(opts) {
  const root = libraryRoot.resolveLibraryRoot({ root: opts.root }).root;
  let tiles, sourceLabel;
  if (opts.frames) {
    const pkg = opts.frames.split('/')[0];
    const rel = opts.frames.slice(pkg.length + 1);
    tiles = tilesFromFrames(path.join(root, pkg), rel, opts.thumb);
    sourceLabel = opts.frames;
  } else {
    let rels = collectFiles(root, opts.package, opts.filter);
    if (opts.range) {
      const m = /^(\d+)-(\d+)$/.exec(opts.range);
      if (!m) throw new Error('--range 格式是 起-迄（1-60）');
      rels = rels.slice(+m[1] - 1, +m[2]);
    }
    if (!rels.length) throw new Error('沒有符合的素材');
    tiles = tilesFromFiles(path.join(root, opts.package), rels, opts.thumb);
    sourceLabel = opts.package + (opts.filter ? ' ~' + opts.filter : '') +
      (opts.range ? ' [' + opts.range + ']' : '');
  }
  const sheet = layout(tiles, opts);
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, raster.encodePng(sheet.rgba, sheet.width, sheet.height));
  console.log(sourceLabel + '：' + tiles.length + ' 格，' +
    sheet.cols + 'x' + sheet.rows + '，' + sheet.width + 'x' + sheet.height +
    ' → ' + opts.out);
  return sheet;
}

function parseArgs(argv) {
  const opts = {
    package: undefined, frames: undefined, filter: undefined, range: undefined,
    thumb: 96, cols: 0, bg: 'checker', label: true, out: undefined, root: undefined
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package') opts.package = argv[++i];
    else if (a === '--frames') opts.frames = argv[++i];
    else if (a === '--filter') opts.filter = argv[++i];
    else if (a === '--range') opts.range = argv[++i];
    else if (a === '--thumb') opts.thumb = +argv[++i];
    else if (a === '--cols') opts.cols = +argv[++i];
    else if (a === '--bg') opts.bg = argv[++i];
    else if (a === '--no-label') opts.label = false;
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--root') opts.root = argv[++i];
    else throw new Error('不認得的參數：' + a);
  }
  if (!opts.package && !opts.frames) throw new Error('要指定 --package 或 --frames');
  if (!opts.out) throw new Error('要指定 --out');
  return opts;
}

if (require.main === module) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    process.exit(2);
  }
}

module.exports = { run: run, layout: layout, drawText: drawText, _internal: { thumbnail: thumbnail } };
