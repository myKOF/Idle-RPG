'use strict';
/* ============================================================
   preset-render.cjs — 在 Node 裡把 preset 畫成圖，不需要瀏覽器

   為什麼要做這個：這個專案有 150 份 preset，而唯一能看到它們長什麼樣的
   地方是瀏覽器裡的 VFX Editor——一次一份，而且要人在旁邊點。
   「把所有特效逐個看過」用那條路是走不完的。

   能做得成的原因是 vfx-core.js 本來就與繪圖後端無關：它只呼叫
   createNode / updateNode / destroyNode，把 transform 交出去。
   所以這裡實作的是**第三個後端**（另外兩個是 Pixi 與測試用的 Null），
   把 transform 畫進一塊 Uint8Array。Core 的模擬邏輯完全共用——
   這張圖裡的粒子位置、曲線取樣、序列幀選格，與遊戲裡跑的是同一份程式碼。

   ⚠️ 這不是像素等同 Pixi 的模擬器。差別在取樣方式（這裡是雙線性）、
      加法混色的飽和點、以及 Pixi 的 round pixels 設定。
      用途是**看構圖、顏色、大小、時序**——那些差異不影響這幾件事。
      要驗證「Pixi 上真的長這樣」仍然要開瀏覽器。

   用法：
     node tools/vfx/preset-render.cjs hit-fire                 單一 preset 的時間序列
     node tools/vfx/preset-render.cjs --all --out out/         全部，每份一張
     node tools/vfx/preset-render.cjs hit-fire --frames 8 --size 220
     node tools/vfx/preset-render.cjs --grep "ground-" --contact 全部縮圖拼成一張
   ============================================================ */

const fs = require('fs');
const path = require('path');
const raster = require('./vfx-raster.cjs');
const contact = require('./contact-sheet.cjs');
const libraryRoot = require('./vfx-library-root.cjs');

const VFXCore = require(path.join(libraryRoot.REPO_ROOT, 'js', 'vfx-core.js'));

/* ---------------- 貼圖 ----------------
   assetId → 解好的 RGBA。整個 process 只解一次；一張 2048² 的圖解出來是
   16 MB，150 份 preset 各自重解會是好幾 GB 的無謂配置。 */
const texCache = new Map();

function loadTexture(root, index, assetId) {
  if (texCache.has(assetId)) return texCache.get(assetId);
  const entry = index.byId[assetId];
  let tex = null;
  if (!entry) tex = null;
  else if (!/\.png$/i.test(entry)) tex = null;          // SVG 等：這裡畫不了，畫成洋紅方塊
  else {
    try { tex = raster.decodePng(fs.readFileSync(path.join(root, entry))); }
    catch (e) { tex = null; }
  }
  texCache.set(assetId, tex);
  return tex;
}

/* 圖集切格：回傳第 n 格的來源矩形。 */
function frameRect(tex, sheet, n) {
  if (!sheet) return { x: 0, y: 0, w: tex.width, h: tex.height };
  const fw = tex.width / sheet.columns, fh = tex.height / sheet.rows;
  const i = Math.max(0, Math.min((sheet.count || sheet.columns * sheet.rows) - 1, n | 0));
  return {
    x: (i % sheet.columns) * fw, y: ((i / sheet.columns) | 0) * fh, w: fw, h: fh
  };
}

/* ---------------- 合成 ----------------
   逆向映射：走過目的地的每個像素，反算它落在來源的哪裡，雙線性取樣。
   正向映射（走來源、算目的地）在放大時會留下沒被寫到的洞。 */
function drawSprite(canvas, W, H, tex, src, t, blend) {
  const cw = src.w * t.scaleX, ch = src.h * t.scaleY;
  if (!isFinite(cw) || !isFinite(ch) || cw === 0 || ch === 0) return;
  const cos = Math.cos(t.rotation), sin = Math.sin(t.rotation);
  /* 錨點：t.anchorX 0.5 表示 t.x 是中心。左上角在物件座標中的位置。 */
  const ax = -t.anchorX * cw, ay = -t.anchorY * ch;

  /* 目的地包圍盒：四個角轉過去取極值。 */
  const corners = [[ax, ay], [ax + cw, ay], [ax, ay + ch], [ax + cw, ay + ch]];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  corners.forEach(function (c) {
    const wx = t.x + c[0] * cos - c[1] * sin, wy = t.y + c[0] * sin + c[1] * cos;
    x0 = Math.min(x0, wx); x1 = Math.max(x1, wx);
    y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
  });
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  if (x1 <= x0 || y1 <= y0) return;

  const tr = ((t.tint >> 16) & 255) / 255, tg = ((t.tint >> 8) & 255) / 255, tb = (t.tint & 255) / 255;
  const alpha = t.alpha;
  const sStride = tex.width * 4;

  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      /* 世界 → 物件（反轉旋轉），再 → 來源像素 */
      const dx = px + 0.5 - t.x, dy = py + 0.5 - t.y;
      const ox = dx * cos + dy * sin, oy = -dx * sin + dy * cos;
      const u = (ox - ax) / cw, v = (oy - ay) / ch;
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      const sxf = src.x + u * src.w - 0.5, syf = src.y + v * src.h - 0.5;
      const sx = Math.floor(sxf), sy = Math.floor(syf);
      const fx = sxf - sx, fy = syf - sy;
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < 2; j++) {
        const yy = Math.max(src.y, Math.min(src.y + src.h - 1, sy + j));
        const wy = j ? fy : 1 - fy;
        for (let i = 0; i < 2; i++) {
          const xx = Math.max(src.x, Math.min(src.x + src.w - 1, sx + i));
          const w = (i ? fx : 1 - fx) * wy;
          if (w <= 0) continue;
          const o = (yy | 0) * sStride + (xx | 0) * 4;
          const sa = tex.rgba[o + 3];
          /* 預乘後內插：透明像素的 RGB 不可信（見 vfx-raster 的同一段道理）。 */
          r += tex.rgba[o] * sa * w; g += tex.rgba[o + 1] * sa * w; b += tex.rgba[o + 2] * sa * w;
          a += sa * w;
        }
      }
      if (a <= 0) continue;
      /* 還原預乘 → 套 tint → 乘 alpha 得到「這個像素要加多少」 */
      const sr = r / a * tr, sg = g / a * tg, sb = b / a * tb;
      const k = (a / 255) * alpha;
      if (k <= 0) continue;
      const d = (py * W + px) * 4;
      if (blend === 'add') {
        canvas[d] = Math.min(255, canvas[d] + sr * k);
        canvas[d + 1] = Math.min(255, canvas[d + 1] + sg * k);
        canvas[d + 2] = Math.min(255, canvas[d + 2] + sb * k);
      } else if (blend === 'multiply') {
        canvas[d] = canvas[d] * (1 - k + k * sr / 255);
        canvas[d + 1] = canvas[d + 1] * (1 - k + k * sg / 255);
        canvas[d + 2] = canvas[d + 2] * (1 - k + k * sb / 255);
      } else if (blend === 'screen') {
        canvas[d] = 255 - (255 - canvas[d]) * (1 - k * sr / 255);
        canvas[d + 1] = 255 - (255 - canvas[d + 1]) * (1 - k * sg / 255);
        canvas[d + 2] = 255 - (255 - canvas[d + 2]) * (1 - k * sb / 255);
      } else {
        canvas[d] = canvas[d] * (1 - k) + sr * k;
        canvas[d + 1] = canvas[d + 1] * (1 - k) + sg * k;
        canvas[d + 2] = canvas[d + 2] * (1 - k) + sb * k;
      }
      canvas[d + 3] = 255;
    }
  }
}

/* ---------------- 後端 ----------------
   Core 每幀對每個節點呼叫一次 updateNode，transform 是共用物件，
   所以這裡必須立刻複製。收集完再依 zIndex 排序畫——Core 不保證
   呼叫順序等於 zIndex 順序（粒子層與 sprite 層是分開走的）。 */
function makeBackend(state) {
  return {
    createNode: function (spec) { return { spec: spec }; },
    updateNode: function (node, t) {
      if (!t.visible) return;
      state.draws.push({
        spec: node.spec, x: t.x, y: t.y, rotation: t.rotation,
        scaleX: t.scaleX, scaleY: t.scaleY, alpha: t.alpha, tint: t.tint,
        frame: t.frame, anchorX: t.anchorX, anchorY: t.anchorY, z: t.zIndex
      });
    },
    destroyNode: function () {}
  };
}

/* ---------------- 一份 preset 的一串時間取樣 ---------------- */

function renderPreset(opts) {
  const preset = opts.preset;
  const state = { draws: [] };
  const rt = VFXCore.createRuntime({
    backend: makeBackend(state),
    resolver: {
      has: function () { return true; },
      /* Core 只把 resolve 的結果當作 spec.assetUrl 傳給後端，
         這裡直接回 assetId，貼圖查詢在畫的時候才做。 */
      resolve: function (id) { return id; }
    },
    budget: { maxActiveEffects: 64, maxParticles: 20000, perEffectParticleLimit: 2000 }
  });
  rt.registerPreset(preset);
  const W = opts.size, H = opts.size;
  /* 場域類的原點在腳底／地面，畫面上要往下擺才看得到全部；
     其餘置中。ground/aura/mark 這幾類的 y 原點是地面線。 */
  const cy = opts.groundLike ? Math.round(H * 0.66) : Math.round(H * 0.5);
  const handle = rt.play(preset.id, { seed: opts.seed || 12345 });
  if (handle === null) throw new Error('play 失敗（預算或未註冊）');
  /* 位置不是 play 的參數——Core 把「播哪一份」與「擺在哪裡」分開，
     因為特效常常要跟著移動中的目標走（投射物）。 */
  rt.setTransform(handle, { position: { x: W / 2, y: cy }, scale: opts.scale || 1 });

  const dur = preset.duration;
  const total = opts.duration || (preset.loop ? dur : dur * 1.05);
  const step = 1 / 120;                    // 固定小步長，粒子軌跡才穩定
  const wantAt = [];
  for (let i = 0; i < opts.frames; i++) {
    /* 取樣點避開 t=0（那時什麼都還沒發射）與正尾端。 */
    wantAt.push(total * (i + 0.6) / opts.frames);
  }

  const shots = [];
  let t = 0, next = 0;
  while (next < wantAt.length) {
    rt.update(step);
    t += step;
    while (next < wantAt.length && t >= wantAt[next]) {
      const canvas = new Uint8Array(W * H * 4);
      fillBg(canvas, W, H, opts.bg);
      state.draws.length = 0;
      rt.update(0);                        // dt=0：只重新輸出 transform，不推進時間
      state.draws.sort(function (a, b) { return (a.z || 0) - (b.z || 0); });
      state.draws.forEach(function (d) {
        const tex = loadTexture(opts.root, opts.index, d.spec.assetUrl);
        if (!tex) return;
        drawSprite(canvas, W, H, tex, frameRect(tex, d.spec.sheet, d.frame || 0), d, d.spec.blendMode);
      });
      shots.push({ rgba: canvas, w: W, h: H, label: (wantAt[next] / total * 100).toFixed(0) });
      next++;
    }
    if (t > total * 3) break;              // 保險：不讓任何 preset 讓工具跑不完
  }
  rt.destroy();
  return shots;
}

const BG = {
  battle: function (x, y, H) {
    /* 近似戰鬥畫面的底：上半偏暗藍、下半偏土色，中間有地平線。
       不用純黑——加法混色的特效在純黑上全部都好看，那會看不出「太亮」。 */
    const k = y / H;
    return k < 0.6
      ? [30 + 10 * k, 34 + 12 * k, 48 + 14 * k]
      : [54 + 18 * (k - 0.6), 46 + 14 * (k - 0.6), 38 + 10 * (k - 0.6)];
  },
  dark: function () { return [18, 18, 22]; },
  grey: function () { return [110, 110, 112]; }
};

function fillBg(canvas, W, H, kind) {
  const fn = BG[kind] || BG.battle;
  for (let y = 0; y < H; y++) {
    const c = fn(0, y, H);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      canvas[o] = c[0]; canvas[o + 1] = c[1]; canvas[o + 2] = c[2]; canvas[o + 3] = 255;
    }
  }
}

/* ---------------- CLI ---------------- */

const GROUND_LIKE = /^(ground-|aura-|mark-|orb-|lightning-orb|fire-tornado|black-hole|pillar-)/;

function loadIndex(root) {
  const ix = JSON.parse(fs.readFileSync(path.join(libraryRoot.REPO_ROOT, 'vfx/asset-index.json'), 'utf8'));
  const byId = {};
  ix.assets.forEach(function (a) { byId[a.assetId] = a.relativePath; });
  return { byId: byId };
}

function presetIds(grep) {
  const dir = path.join(libraryRoot.REPO_ROOT, 'vfx/presets');
  let ids = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); })
    .map(function (f) { return f.replace(/\.json$/, ''); });
  if (grep) ids = ids.filter(function (id) { return new RegExp(grep).test(id); });
  return ids.sort();
}

function run(opts) {
  const root = libraryRoot.resolveLibraryRoot({ root: opts.root }).root;
  const index = loadIndex(root);
  const ids = opts.ids.length ? opts.ids : presetIds(opts.grep);
  if (!ids.length) throw new Error('沒有符合的 preset');
  fs.mkdirSync(opts.out, { recursive: true });

  const contactTiles = [];
  ids.forEach(function (id) {
    const preset = JSON.parse(fs.readFileSync(
      path.join(libraryRoot.REPO_ROOT, 'vfx/presets', id + '.json'), 'utf8'));
    let shots;
    try {
      shots = renderPreset({
        preset: preset, root: root, index: index, size: opts.size,
        frames: opts.contact ? 1 : opts.frames, bg: opts.bg,
        groundLike: GROUND_LIKE.test(id), seed: opts.seed, scale: opts.scale
      });
    } catch (e) {
      console.error('  ✗ ' + id + '：' + e.message);
      return;
    }
    if (opts.contact) {
      const t = contact._internal.thumbnail(
        { rgba: shots[0].rgba, width: opts.size, height: opts.size },
        0, 0, opts.size, opts.size, opts.thumb);
      t.label = id.replace(/^(ground|burst|slash|proj|cast|bolt|hit|st|aura|mark|orb|curse|pillar|beam)-/, '');
      contactTiles.push(t);
    } else {
      const tiles = shots.map(function (s) {
        return { rgba: s.rgba, w: s.w, h: s.h, label: s.label };
      });
      const sheet = contact.layout(tiles, {
        thumb: opts.size, cols: opts.frames, bg: 'grey', label: true
      });
      const file = path.join(opts.out, id + '.png');
      fs.writeFileSync(file, raster.encodePng(sheet.rgba, sheet.width, sheet.height));
      console.log('  ' + id.padEnd(28) + ' → ' + file);
    }
  });

  if (opts.contact) {
    const sheet = contact.layout(contactTiles, {
      thumb: opts.thumb, cols: opts.cols || 0, bg: 'grey', label: true
    });
    const file = path.join(opts.out, (opts.name || 'contact') + '.png');
    fs.writeFileSync(file, raster.encodePng(sheet.rgba, sheet.width, sheet.height));
    console.log(contactTiles.length + ' 份 preset → ' + file +
      '（' + sheet.width + 'x' + sheet.height + '）');
  }
}

function parseArgs(argv) {
  const opts = {
    ids: [], grep: '', frames: 6, size: 200, thumb: 132, cols: 0,
    bg: 'battle', scale: 1, out: 'C:/Users/user/AppData/Local/Temp/vfx-render',
    contact: false, name: '', seed: 12345, root: undefined
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--grep') opts.grep = argv[++i];
    else if (a === '--frames') opts.frames = +argv[++i];
    else if (a === '--size') opts.size = +argv[++i];
    else if (a === '--thumb') opts.thumb = +argv[++i];
    else if (a === '--cols') opts.cols = +argv[++i];
    else if (a === '--bg') opts.bg = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--name') opts.name = argv[++i];
    else if (a === '--seed') opts.seed = +argv[++i];
    else if (a === '--scale') opts.scale = +argv[++i];
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--contact') opts.contact = true;
    else if (a === '--all') opts.grep = '';
    else if (a.startsWith('--')) throw new Error('不認得的參數：' + a);
    else opts.ids.push(a);
  }
  return opts;
}

if (require.main === module) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (e) {
    console.error('[ERROR] ' + e.message);
    console.error(e.stack);
    process.exit(2);
  }
}

module.exports = { renderPreset: renderPreset, drawSprite: drawSprite, run: run };
