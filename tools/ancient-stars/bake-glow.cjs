'use strict';
/* ============================================================
   bake-glow.cjs — 把太古星星的描邊／光暈烘進 PNG

   為什麼要烘：原本每顆星星的 ::after 在 CSS 上即時跑
   「SVG 色彩矩陣（淺藍）→ SVG feMorphology 描邊 → 三層 drop-shadow」。
   SVG 參照濾鏡（url(...)）在 Chrome 是 CPU 光柵化、且每次重繪都要重算；
   背包一頁幾十格 × 每格最多 7 顆星，滑鼠移過格子（hover 的 brightness
   過渡）、捲動、開詳情都會讓整片星星的濾鏡重跑，整個介面因此卡頓。
   效果本身是靜態的，沒有理由每次重繪都算一次，所以在這裡離線算好。

   比例：星星的 ::after 盒（字形盒外擴 2px）在徽章與詞條中都約 16.7 CSS px 寬，
   128px 原圖 contain 進去 → 1 CSS px ≈ 7.6 圖像素。濾鏡長度（描邊 1px、
   光暈 1／3／5px）都依此換算；drop-shadow 的模糊半徑換成高斯 σ＝半徑／2。
   畫布四周各加 64px 給光暈，成品 256px。以上沿用原尺寸烘焙基準，
   顯示端以 transform: scale(1.8) 抵銷留白後，將星星縮小為原尺寸90%。

   用法：node tools/ancient-stars/bake-glow.cjs --apply  重新烘焙
         node tools/ancient-stars/bake-glow.cjs --check  驗證成品與原圖一致
   ============================================================ */
const fs = require('node:fs');
const path = require('node:path');
const { decodePng, encodePng } = require('../vfx/vfx-raster.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const UI_DIR = path.join(REPO_ROOT, 'images/ui');
const PX = 7.6;          // 1 CSS px 對應的圖像素
const PAD = 64;          // 四周光暈留白（圖像素）
const SRC_SIZE = 128;

/* 與原 CSS 相同的參數；淺藍的 tone 是原本 --ancient-star-tone 的對角色彩矩陣。 */
const VARIANTS = [
  { src: 'ancient-star-gold.png', out: 'ancient-star-gold-glow.png' },
  { src: 'ancient-star-light-blue.png', out: 'ancient-star-light-blue-glow.png', tone: [0.498039, 0.862745, 0.960784] },
  { src: 'ancient-star-blue.png', out: 'ancient-star-blue-glow.png' }
];
const OUTLINE = { radius: 1, color: [0x6b, 0x3f, 0x16] };
const SHADOWS = [
  { blur: 1, color: [0xff, 0xf4, 0xae], alpha: 1 },
  { blur: 3, color: [0xff, 0xd8, 0x4a], alpha: 1 },
  { blur: 5, color: [0xff, 0xbb, 0x23], alpha: 0.9 }
];

/* 預乘 RGBA 浮點圖：{ size, r, g, b, a }，每個通道 0～1。 */
function loadPadded(file, tone) {
  const img = decodePng(fs.readFileSync(file));
  if (img.width !== SRC_SIZE || img.height !== SRC_SIZE) throw new Error('Expected 128px PNG: ' + file);
  const size = SRC_SIZE + PAD * 2;
  const n = size * size;
  const out = { size: size, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), a: new Float32Array(n) };
  const t = tone || [1, 1, 1];
  for (let y = 0; y < SRC_SIZE; y++) {
    for (let x = 0; x < SRC_SIZE; x++) {
      const s = (y * SRC_SIZE + x) * 4;
      const d = (y + PAD) * size + (x + PAD);
      const a = img.rgba[s + 3] / 255;
      out.r[d] = img.rgba[s] / 255 * t[0] * a;
      out.g[d] = img.rgba[s + 1] / 255 * t[1] * a;
      out.b[d] = img.rgba[s + 2] / 255 * t[2] * a;
      out.a[d] = a;
    }
  }
  return out;
}

/* feMorphology dilate：矩形核取最大值，分離成水平、垂直兩趟。 */
function dilate(alpha, size, radius) {
  const tmp = new Float32Array(alpha.length);
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let m = 0;
      for (let k = Math.max(0, x - radius); k <= Math.min(size - 1, x + radius); k++) m = Math.max(m, alpha[y * size + k]);
      tmp[y * size + x] = m;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let m = 0;
      for (let k = Math.max(0, y - radius); k <= Math.min(size - 1, y + radius); k++) m = Math.max(m, tmp[k * size + x]);
      out[y * size + x] = m;
    }
  }
  return out;
}

function gaussianBlur(alpha, size, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) { kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += kernel[i + radius]; }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  const tmp = new Float32Array(alpha.length);
  const out = new Float32Array(alpha.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let i = -radius; i <= radius; i++) { const k = x + i; if (k >= 0 && k < size) v += alpha[y * size + k] * kernel[i + radius]; }
      tmp[y * size + x] = v;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let i = -radius; i <= radius; i++) { const k = y + i; if (k >= 0 && k < size) v += tmp[k * size + x] * kernel[i + radius]; }
      out[y * size + x] = v;
    }
  }
  return out;
}

/* 把單色、alpha 為 layerA 的圖層墊在 img 下方（img source-over layer）。 */
function underlay(img, layerA, color) {
  const cr = color[0] / 255, cg = color[1] / 255, cb = color[2] / 255;
  for (let i = 0; i < img.a.length; i++) {
    const below = layerA[i] * (1 - img.a[i]);
    img.r[i] += cr * below;
    img.g[i] += cg * below;
    img.b[i] += cb * below;
    img.a[i] += below;
  }
}

function bake(variant) {
  const img = loadPadded(path.join(UI_DIR, variant.src), variant.tone);
  const size = img.size;
  // 描邊：SourceAlpha 膨脹後減去原 alpha，得到只在外圈的環。
  const expanded = dilate(img.a, size, Math.round(OUTLINE.radius * PX));
  const ring = new Float32Array(expanded.length);
  for (let i = 0; i < ring.length; i++) ring[i] = expanded[i] * (1 - img.a[i]);
  underlay(img, ring, OUTLINE.color);
  // 三層 drop-shadow 依序疊：每一層都以前一層的結果（含光暈）為輸入。
  for (const s of SHADOWS) {
    const blurred = gaussianBlur(img.a, size, s.blur / 2 * PX);
    for (let i = 0; i < blurred.length; i++) blurred[i] *= s.alpha;
    underlay(img, blurred, s.color);
  }
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < img.a.length; i++) {
    const a = Math.min(1, img.a[i]);
    const o = i * 4;
    if (a <= 0) continue;
    rgba[o] = Math.round(Math.min(1, img.r[i] / a) * 255);
    rgba[o + 1] = Math.round(Math.min(1, img.g[i] / a) * 255);
    rgba[o + 2] = Math.round(Math.min(1, img.b[i] / a) * 255);
    rgba[o + 3] = Math.round(a * 255);
  }
  return encodePng(rgba, size, size);
}

function main() {
  const mode = process.argv[2] || '--check';
  if (!['--check', '--apply'].includes(mode)) throw new Error('Expected --check or --apply');
  for (const variant of VARIANTS) {
    const png = bake(variant);
    const target = path.join(UI_DIR, variant.out);
    if (mode === '--apply') fs.writeFileSync(target, png);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(png)) throw new Error('Baked glow differs, run --apply: ' + variant.out);
  }
  console.log('Ancient stars: baked glow PNGs match their 128px sources.');
}

if (require.main === module) main();
module.exports = { bake: bake, VARIANTS: VARIANTS };
