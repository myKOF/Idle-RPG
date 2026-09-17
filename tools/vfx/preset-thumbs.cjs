'use strict';
/* ============================================================
   preset-thumbs.cjs — VFX Editor「瀏覽特效」的縮圖

   下拉清單適合「已經知道名字」；要「找一份長得像的來改」，得看得到樣子。
   縮圖沿用 preset-render.cjs 的離線出圖（Core 的模擬邏輯與遊戲同一份），
   不必開瀏覽器，也不用另外維護一批截圖檔。

   ---- 取景 ----
   特效大小差很多：爆點十幾 px，岩甲術的石頭繞一整圈。用固定倍率畫的話，
   小的看不見、大的被切掉。所以先量再畫：
     1. 粗量：小倍率（看得到 ±640 單位），在幾個時間點裡挑內容最多的那一格，
        量出內容的外框
     2. 精量：外框很小的話，粗量裡它只佔幾個像素，誤差放大之後會明顯偏一邊——
        以粗量的中心為準，用 1:1 再量一次
     3. 正式：把外框放大到佔縮圖的 FILL 比例，並把中心移到畫面正中
   每一次都用同一個亂數種子與同樣的時間點，量到的與畫出來的是同一個瞬間。

   ---- 快取 ----
   鍵＝取景規則版本 ＋ preset 內容 ＋ 它用到的素材的 contentHash。
   preset 存檔或素材換了，鍵就變，自然重畫；沒變就直接回舊圖。
   記憶體一份（這個行程內），系統暫存資料夾一份（伺服器重開不必全部重畫）。
   不放進 repo：縮圖是衍生物，放進去只會變成要人維護的第二份資料。

   ---- 素材來源 ----
   本機素材庫優先；沒有的（另一台電腦沒有外部素材庫）改用隨 Git 出貨的
   images/vfx/assets。兩邊都沒有的圖層就不畫，縮圖仍然會產生。
   ============================================================ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const render = require('./preset-render.cjs');
const raster = require('./vfx-raster.cjs');

const THUMB_SIZE = 160;
/* 粗量：256 px × 0.2 倍＝看得到 ±640 單位。只看 ±320 的話，擺得遠的圖層會被量成
   「貼著邊的一半」，取景就跟著偏掉（THUMB-3 抓到的）。 */
const PROBE_SIZE = 256;
const PROBE_SCALE = 0.2;
/* 精量：外框小於 FINE_BELOW 單位時，以粗量中心為準再用 1:1 量一次 */
const FINE_SIZE = 128;
const FINE_SCALE = 1;
const FINE_BELOW = 100;
const FRAMES = 5;
/* 內容外框佔縮圖邊長的比例，留一點邊才看得出輪廓 */
const FILL = 0.82;
/* 外框至少當成 8 單位：只有一個亮點的特效不該被放大成一整片 */
const MIN_EXTENT = 8;
const MIN_SCALE = 0.04;
const MAX_SCALE = 4;
/* 取景或快取鍵的規則改了就加一：舊的暫存檔會因為鍵不同而自然不再被用到。 */
/* 3：離線出圖開始畫斜切（父子層級、outerScale 非等比）。舊的暫存圖在那些情況下形狀是錯的。 */
const RENDER_VERSION = 3;
/* preset-render 的 'dark' 底色；與它相差超過門檻的像素算「有內容」。 */
const BG_RGB = [18, 18, 22];
const CONTENT_THRESHOLD = 30;

const memory = new Map();
let assetIndex = null;                     // { stamp, byId, hashById }

function defaultCacheDir() {
  return path.join(os.tmpdir(), 'idle-rpg-vfx-thumbs');
}

/* 素材索引：assetId → 實際要讀的檔案。那份索引有兩千多筆，每張縮圖都重讀一次
   太浪費，所以看檔案大小與修改時間決定要不要重建（重建的代價只是多讀一次）。 */
function loadAssetIndex(repoRoot, assetRoots) {
  const file = path.join(repoRoot, 'vfx', 'asset-index.json');
  const st = fs.statSync(file);
  const stamp = [file, st.size, st.mtimeMs, JSON.stringify(assetRoots || {})].join('|');
  if (assetIndex && assetIndex.stamp === stamp) return assetIndex;

  const ix = JSON.parse(fs.readFileSync(file, 'utf8'));
  const libraryRoot = (assetRoots || {})[ix.libraryId] || null;
  const shippedRoot = path.join(repoRoot, 'images', 'vfx', 'assets');
  const byId = {};
  const hashById = {};
  (ix.assets || []).forEach(function (a) {
    hashById[a.assetId] = a.contentHash || '';
    const local = libraryRoot ? path.join(libraryRoot, a.relativePath) : null;
    /* 給絕對路徑：preset-render 以 path.join(root, entry) 讀檔，root 傳空字串就是原樣使用。 */
    byId[a.assetId] = local && fs.existsSync(local)
      ? local : path.join(shippedRoot, a.relativePath);
  });
  assetIndex = { stamp: stamp, byId: byId, hashById: hashById };
  return assetIndex;
}

/* 這份 preset 用到的素材與它們的 contentHash，排序後接成一串，當快取鍵的一部分。
   走過整份 JSON 的字串而不是只看 layer.assetId：子結構（例如水龍捲的部件）也可能指到素材。 */
function usedAssetsKey(preset, hashById) {
  const found = {};
  (function walk(v) {
    if (typeof v === 'string') {
      if (Object.prototype.hasOwnProperty.call(hashById, v)) found[v] = hashById[v];
      return;
    }
    if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { walk(v[k]); });
  })(preset);
  return Object.keys(found).sort()
    .map(function (id) { return id + '=' + found[id]; }).join(';');
}

/* 有內容的像素數，與它們的外框（畫布像素座標，含端點） */
function contentOf(shot) {
  const W = shot.w, H = shot.h, px = shot.rgba;
  let count = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const d = Math.abs(px[o] - BG_RGB[0]) + Math.abs(px[o + 1] - BG_RGB[1]) +
        Math.abs(px[o + 2] - BG_RGB[2]);
      if (d <= CONTENT_THRESHOLD) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return { count: count, x0: x0, y0: y0, x1: x1, y1: y1 };
}

/* 畫布上量到的外框 → 特效自己的座標（單位）。size／scale／offset 是量的那一次用的參數：
   畫布上的 x ＝ size/2 ＋ offset.x ＋ 本地 x × scale，反過來解。 */
function localBox(content, size, scale, offset) {
  const half = size / 2;
  const ox = offset ? offset.x : 0, oy = offset ? offset.y : 0;
  return {
    x0: (content.x0 - half - ox) / scale, x1: (content.x1 + 1 - half - ox) / scale,
    y0: (content.y0 - half - oy) / scale, y1: (content.y1 + 1 - half - oy) / scale
  };
}

function extentOf(box) {
  return Math.max(box.x1 - box.x0, box.y1 - box.y0);
}

/* 外框（單位）→ 正式那一次的倍率與位移：放大到佔 FILL，中心移到畫面正中。 */
function fitBox(box) {
  const extent = Math.max(extentOf(box), MIN_EXTENT);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, THUMB_SIZE * FILL / extent));
  return {
    scale: scale,
    offset: { x: -((box.x0 + box.x1) / 2) * scale, y: -((box.y0 + box.y1) / 2) * scale }
  };
}

/* opts：repoRoot、assetRoots（libraryId → 素材庫根目錄）、presetText 或 presetId、
   cacheDir（選填，預設系統暫存資料夾）。回傳 PNG 的 Buffer。 */
function renderThumbnail(opts) {
  const repoRoot = opts.repoRoot;
  const presetText = opts.presetText !== undefined
    ? String(opts.presetText)
    : fs.readFileSync(path.join(repoRoot, 'vfx', 'presets', opts.presetId + '.json'), 'utf8');
  const preset = JSON.parse(presetText);
  const index = loadAssetIndex(repoRoot, opts.assetRoots);
  const key = crypto.createHash('sha1')
    .update('v' + RENDER_VERSION + '|' + THUMB_SIZE + '|')
    .update(presetText)
    .update('|' + usedAssetsKey(preset, index.hashById))
    .digest('hex');
  if (memory.has(key)) return memory.get(key);

  const cacheDir = opts.cacheDir || defaultCacheDir();
  const cacheFile = path.join(cacheDir, key + '.png');
  try {
    const cached = fs.readFileSync(cacheFile);
    memory.set(key, cached);
    return cached;
  } catch (e) { /* 沒有暫存：往下畫 */ }

  const base = {
    preset: preset, root: '', index: { byId: index.byId }, frames: FRAMES,
    bg: 'dark', groundLike: false, seed: 12345
  };
  const probe = render.renderPreset(Object.assign({}, base, { size: PROBE_SIZE, scale: PROBE_SCALE }));
  const contents = probe.map(contentOf);
  let best = 0;
  contents.forEach(function (c, i) { if (c.count > contents[best].count) best = i; });

  let fit = { scale: 1, offset: { x: 0, y: 0 } };        // 完全沒有內容：1 倍置中
  if (contents[best] && contents[best].count) {
    let box = localBox(contents[best], PROBE_SIZE, PROBE_SCALE, null);
    if (extentOf(box) < FINE_BELOW) {
      const fineOffset = {
        x: -((box.x0 + box.x1) / 2) * FINE_SCALE, y: -((box.y0 + box.y1) / 2) * FINE_SCALE
      };
      const fine = render.renderPreset(Object.assign({}, base, {
        size: FINE_SIZE, scale: FINE_SCALE, offset: fineOffset
      }));
      const shotFine = fine[Math.min(best, fine.length - 1)];
      const c = shotFine ? contentOf(shotFine) : null;
      if (c && c.count) box = localBox(c, FINE_SIZE, FINE_SCALE, fineOffset);
    }
    fit = fitBox(box);
  }

  const shots = render.renderPreset(Object.assign({}, base, {
    size: THUMB_SIZE, scale: fit.scale, offset: fit.offset
  }));
  const shot = shots[Math.min(best, shots.length - 1)];
  const png = raster.encodePng(shot.rgba, THUMB_SIZE, THUMB_SIZE);
  memory.set(key, png);
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, png);
  } catch (e) { /* 暫存寫不進去只是下次要重畫，不影響這一次的回應 */ }
  return png;
}

module.exports = {
  THUMB_SIZE: THUMB_SIZE,
  renderThumbnail: renderThumbnail,
  _internal: {
    contentOf: contentOf, localBox: localBox, fitBox: fitBox, usedAssetsKey: usedAssetsKey,
    PROBE_SIZE: PROBE_SIZE, PROBE_SCALE: PROBE_SCALE
  }
};
