#!/usr/bin/env node
'use strict';
/* 寶石圖產生指令。
 *   node tools/gems/gem-build.cjs --types ruby,sapphire --levels 1-10 --out <資料夾> [--size 256]
 *   node tools/gems/gem-build.cjs --types ruby,sapphire --sheet <檔.png> [--cell 128] [--bg 18140f]
 *   node tools/gems/gem-build.cjs --check          只檢查種類表與 js/data.js 的 GEM_TYPES 是否對得上
 * 沒給 --types 就是全部種類。輸出檔名 gem-<key>-<階>.png。
 */
const fs = require('fs');
const path = require('path');
const core = require('./gem-core.cjs');
const defs = require('./gem-defs.cjs');
const { encodePng } = require('../vfx/vfx-raster.cjs');
const contact = require('../vfx/contact-sheet.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
function arg(name, dflt) { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; }
function has(name) { return args.indexOf(name) >= 0; }

function gameKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');
  const a = src.indexOf('var GEM_TYPES = {');
  const b = src.indexOf('\n};', a);
  const block = src.slice(a, b);
  const keys = [];
  block.replace(/^ {2}(\w+): \{ name: '([^']*)'/gm, function (_, k, n) { keys.push({ key: k, name: n }); return ''; });
  return keys;
}

function parseLevels(s) {
  if (!s) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const out = [];
  s.split(',').forEach(function (p) {
    const m = /^(\d+)-(\d+)$/.exec(p);
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.push(i); else out.push(+p);
  });
  return out;
}
function hexRgb(h) { const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }

const all = gameKeys();
if (has('--check')) {
  const miss = all.filter(function (g) { return !defs[g.key]; }).map(function (g) { return g.key; });
  const extra = Object.keys(defs).filter(function (k) { return !all.some(function (g) { return g.key === k; }); });
  console.log('GEM_TYPES ' + all.length + ' 種；外觀表 ' + Object.keys(defs).length + ' 種');
  console.log('缺外觀：' + (miss.join(', ') || '無'));
  console.log('多出：' + (extra.join(', ') || '無'));
  process.exit(miss.length || extra.length ? 1 : 0);
}

const types = arg('--types') ? arg('--types').split(',') : all.map(function (g) { return g.key; });
const levels = parseLevels(arg('--levels'));
const size = +arg('--size', 256);
const out = arg('--out');
const sheet = arg('--sheet');

function seedOf(key) { let h = 7; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0; return Math.abs(h) % 9973 + 1; }

const t0 = Date.now();
const cache = {};
function render(key, lv) {
  if (!defs[key]) throw new Error('沒有外觀定義：' + key);
  const k = key + ':' + lv;
  if (!cache[k]) cache[k] = core.renderGem(defs[key], lv, seedOf(key));
  return cache[k];
}

if (out) {
  fs.mkdirSync(out, { recursive: true });
  types.forEach(function (key) {
    levels.forEach(function (lv) {
      let px = render(key, lv), w = core.OUT;
      if (size !== core.OUT) { px = core.resizeRGBA(px, core.OUT, core.OUT, size, size); w = size; }
      const name = 'gem-' + key + '-' + String(lv).padStart(2, '0') + '.png';
      fs.writeFileSync(path.join(out, name), encodePng(px, w, w));
    });
  });
  console.log('寫出 ' + types.length * levels.length + ' 張到 ' + out + '（' + (Date.now() - t0) + ' ms）');
}

if (sheet) {
  const cell = +arg('--cell', 128), pad = 6;
  const bg = hexRgb(arg('--bg', '16120f'));
  const items = [];
  types.forEach(function (key) { levels.forEach(function (lv) { items.push({ key: key, lv: lv }); }); });
  const cols = +arg('--cols', levels.length), rows = Math.ceil(items.length / cols);
  const W = cols * (cell + pad) + pad, H = rows * (cell + pad) + pad;
  const img = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { img[i * 4] = bg[0]; img[i * 4 + 1] = bg[1]; img[i * 4 + 2] = bg[2]; img[i * 4 + 3] = 255; }
  items.forEach(function (it, n) {
    const px = core.resizeRGBA(render(it.key, it.lv), core.OUT, core.OUT, cell, cell);
    const x0 = pad + (n % cols) * (cell + pad), y0 = pad + Math.floor(n / cols) * (cell + pad);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const s = (y * cell + x) * 4, d = ((y0 + y) * W + x0 + x) * 4, a = px[s + 3] / 255;
      img[d] = px[s] * a + img[d] * (1 - a); img[d + 1] = px[s + 1] * a + img[d + 1] * (1 - a); img[d + 2] = px[s + 2] * a + img[d + 2] * (1 - a);
    }
    if (has('--label')) contact.drawText(img, W * 4, W, H, it.key + (levels.length > 1 ? ' ' + it.lv : ''), x0 + 2, y0 + cell - 7, 1);
  });
  fs.mkdirSync(path.dirname(path.resolve(sheet)), { recursive: true });
  fs.writeFileSync(sheet, encodePng(img, W, H));
  console.log('總覽圖 ' + sheet + '（' + W + '×' + H + '，' + (Date.now() - t0) + ' ms）');
}
