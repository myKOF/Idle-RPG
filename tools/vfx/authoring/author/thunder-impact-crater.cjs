'use strict';
/* 雷隕石落地坑痕（對應火隕石的 meteor-impact-crater.cjs）：
   火隕石是熔岩裂口；雷隕石是一個「凹下去的坑」——外緣隆起的石環、坑壁內斜、坑底焦黑，
   坑底與石環外的裂縫裡竄著藍白電流。程序化繪製、純向量運算，不用外部素材。
   輸出兩張 512×512 PNG：
     crater-thunder-body.png  本體（一般混色）：焦痕、石環、坑壁、坑底、暗裂縫
     crater-thunder-glow.png  電光（加法混色）：裂縫與坑底的藍白電流，只在這張上閃動
   兩張共用同一份幾何，疊起來才對得上。
   用法：node tools/vfx/authoring/author/thunder-impact-crater.cjs [--preview 輸出資料夾] */
const fs = require('node:fs');
const path = require('node:path');
const repo = path.resolve(__dirname, '../../../..');
const raster = require(path.join(repo, 'tools/vfx/vfx-raster.cjs'));

const N = 512;

/* ---- 可重現的雜訊 ---- */
function hash(i) { let x = (i * 374761393 + 668265263) | 0; x = (x ^ (x >>> 13)) * 1274126177; return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, seed) {
  const i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  return hash(i + seed * 101) * (1 - s) + hash(i + 1 + seed * 101) * s;   // 0..1
}
function vnoise2(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (a, b) => hash(a * 73856093 + b * 19349663 + seed * 83492791);
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}
function lnoise(x, seed) { const i = Math.floor(x), f = x - i; return hash(i + seed * 101) * (1 - f) + hash(i + 1 + seed * 101) * f; }   // 線性內插：折線感
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }

/* 坑緣半徑隨角度起伏：不是正圓。 */
function rimRadius(th) {   // 以 (cos,sin) 取雜訊，才不會在 ±π 接縫處斷開
  const cx = Math.cos(th), cy = Math.sin(th);
  return 0.60 + 0.085 * (vnoise2(cx * 1.7 + 5, cy * 1.7 + 5, 1) - 0.5) * 2 + 0.040 * (vnoise2(cx * 5 + 9, cy * 5 + 9, 2) - 0.5) * 2 + 0.018 * (vnoise2(cx * 13 + 3, cy * 13 + 3, 4) - 0.5) * 2;
}

/* 裂縫：從 rStart 走到 rEnd，沿途左右擺動。主裂縫從坑緣向外、坑底另有幾道短的從中心向外。 */
function buildCracks() {
  const cracks = [];
  const mains = 11;
  for (let i = 0; i < mains; i++) {
    const th0 = (i / mains) * TAU + (hash(i + 7) - 0.5) * 0.35;
    const len = 0.80 + hash(i + 31) * 0.19;
    cracks.push({ th0: th0, r0: 0.30, r1: len, w: 0.036 + hash(i + 11) * 0.012, seed: i + 3, wob: 0.05 });
    if (hash(i + 71) > 0.35) {   // 分岔
      const rs = 0.70 + hash(i + 5) * 0.1;
      cracks.push({ th0: th0 + (hash(i + 17) > 0.5 ? 0.22 : -0.22), r0: rs, r1: Math.min(0.99, rs + 0.16 + hash(i + 23) * 0.1),
        w: 0.020, seed: i + 40, wob: 0.045 });
    }
  }
  for (let i = 0; i < 6; i++) {   // 坑底的電脈
    cracks.push({ th0: (i / 6) * TAU + hash(i + 90) * 0.8, r0: 0.0, r1: 0.34 + hash(i + 60) * 0.10, w: 0.020, seed: i + 70, wob: 0.16, floor: true });
  }
  return cracks;
}
function crackTheta(c, r) {
  const ramp = c.floor ? 1 : Math.min(1, (r - c.r0) / 0.18 + 0.15);
  const j = (lnoise(r * 11 + c.seed * 13, c.seed) - 0.5) * 2 + 0.5 * (lnoise(r * 27 + c.seed * 7, c.seed + 5) - 0.5) * 2;   // 閃電式折線
  const t = c.th0 + j * c.wob * ramp * 1.5;
  return t;
}
/* 像素到這道裂縫的距離比（0＝中線、1＝邊緣）；不在範圍內回 2。 */
function crackCoverage(c, th, r) {
  if (r < c.r0 || r > c.r1) return 2;
  const along = (r - c.r0) / Math.max(0.001, c.r1 - c.r0);
  const taper = c.floor ? 1 - along * 0.55 : 1 - along * 0.8;
  const w = c.w * Math.max(0.25, taper) * (c.floor ? 1 : 1);
  const perp = Math.abs(angDiff(th, crackTheta(c, r))) * Math.max(r, 0.05);
  return perp / w;
}

function render() {
  const body = new Uint8Array(N * N * 4), glow = new Uint8Array(N * N * 4);
  const cracks = buildCracks();
  const light = -Math.PI * 0.75;   // 光從左上來
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      const r = Math.hypot(u, v), th = Math.atan2(v, u);
      const o = (y * N + x) * 4;
      if (r >= 1) continue;
      const rim = rimRadius(th);
      const lit = Math.cos(th - light);                    // -1..1：朝光那一側為正
      const grain = vnoise2(u * 14, v * 14, 5) * 0.6 + vnoise2(u * 40, v * 40, 6) * 0.4;   // 石面顆粒
      let cr = 0, cg = 0, cb = 0, ca = 0;                  // 本體（非預乘）
      const over = (R, G, B, A) => {                       // 把新色蓋在目前的色上
        const na = A + ca * (1 - A);
        if (na <= 0) return;
        cr = (R * A + cr * ca * (1 - A)) / na; cg = (G * A + cg * ca * (1 - A)) / na; cb = (B * A + cb * ca * (1 - A)) / na; ca = na;
      };
      /* 1. 外圈焦痕：大範圍、很淡，邊緣羽化到 0 */
      const scorchEdge = 1 - smooth(0.62, 1.0, r);
      const patchy = 0.55 + 0.45 * vnoise2(u * 5 + 3, v * 5 + 3, 8);
      over(22, 26, 38, 0.62 * scorchEdge * patchy);
      /* 2. 隆起的石環：在坑緣外側，朝光那面亮、背光面暗 */
      const dRim = r - rim;
      const ringOut = smooth(-0.015, 0.012, dRim) * (1 - smooth(0.05, 0.13, dRim));
      if (ringOut > 0) {
        const k = 0.46 + 0.34 * lit + 0.55 * (grain - 0.5) - 0.18 * smooth(0.0, 0.10, dRim);
        over(mix(48, 118, k), mix(54, 128, k), mix(68, 150, k), 0.95 * ringOut * 1);
      }
      /* 3. 坑壁：從坑緣往內斜下去，背光側的牆面（遠端）受光、朝光側在陰影裡 */
      if (dRim < 0.02) {
        const depth = Math.min(1, Math.max(0, -dRim / rim + 0.16 * (vnoise2(u * 6 + 11, v * 6 + 11, 21) - 0.5) + 0.03 * (vnoise2(u * 19, v * 19, 22) - 0.5)));   // 0 坑緣 → 1 中心（加雜訊，坑壁不是正圓）
        const wallBand = Math.pow(1 - smooth(0.0, 0.62, depth), 1.2);                  // 牆面範圍
        const k = (0.40 - 0.40 * lit) * wallBand + 0.03 + 0.30 * (grain - 0.5) * wallBand;
        const wallA = smooth(0.02, -0.02, dRim);
        over(mix(10, 70, Math.max(0, k)), mix(13, 78, Math.max(0, k)), mix(22, 96, Math.max(0, k)), 0.97 * wallA);
        /* 4. 坑底：焦黑，越靠中心越黑，再透出一點藍 */
        const floorT = smooth(0.08, 0.66, depth);
        const rub = 0.5 + 0.9 * (vnoise2(u * 22, v * 22, 12) - 0.5);
        over(mix(12, 6, floorT) * rub + 2, mix(15, 8, floorT) * rub + 2, mix(26, 16, floorT) * rub + 4, 0.98 * floorT * wallA);
        const core = 1 - smooth(0.0, 0.28, depth);
        over(30, 70, 140, 0.22 * core * core * wallA);
      }
      /* 5. 暗裂縫（本體）與電光（glow） */
      let g = 0;
      for (let i = 0; i < cracks.length; i++) {
        const c = cracks[i];
        const cov = crackCoverage(c, th, r);
        if (cov >= 1.9) continue;
        const born = c.floor ? 1 : smooth(c.r0, c.r0 + 0.22, r);   // 從坑底慢慢長出來，不在某個半徑突然開始
        const dark = (1 - smooth(1.0, 1.9, cov)) * born;
        if (!c.floor) over(4, 6, 12, 0.92 * dark);
        else over(3, 5, 10, 0.85 * dark);
        const hot = 1 - smooth(0.12, 0.5, cov);
        const fade = c.floor ? 1 - smooth(0.2, 0.5, r) * 0.7 : (1 - smooth(c.r1 - 0.22, c.r1, r));
        g = Math.max(g, hot * fade * born);
      }
      const centreGlow = (1 - smooth(0.0, 0.17, r)) * 0.75;
      g = Math.min(1, Math.max(g, centreGlow * (0.6 + 0.4 * vnoise2(u * 18, v * 18, 9))));
      if (g > 0) {
        /* 本體裡也染一點藍，glow 疊加時才不會突兀 */
        over(70, 150, 255, 0.55 * g);
        const white = Math.pow(g, 3);
        glow[o] = Math.round(mix(60, 235, white)); glow[o + 1] = Math.round(mix(140, 248, white)); glow[o + 2] = 255;
        glow[o + 3] = Math.round(Math.min(1, g * 1.1) * 255);
      }
      /* 邊緣整體羽化，避免貼圖方框外緣露邊 */
      const edge = 1 - smooth(0.92, 1.0, r);
      body[o] = Math.round(cr); body[o + 1] = Math.round(cg); body[o + 2] = Math.round(cb); body[o + 3] = Math.round(Math.min(1, ca * edge) * 255);
      glow[o + 3] = Math.round(glow[o + 3] * edge);
    }
  }
  return { body, glow };
}

function write() {
  const crypto = require('node:crypto');
  const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
  const Core = require(path.join(repo, 'js/vfx-core.js'));
  const Layout = require(path.join(repo, 'tools/vfx/editor/layout-schema.js'));
  const scanner = require('../../asset-scanner.cjs');
  const facts = require('../../vfx-image-facts.cjs');
  const { body, glow } = render();
  const indexFile = path.join(repo, 'vfx/asset-index.json');
  const index = JSON.parse(fs.readFileSync(indexFile));
  const files = { 'codex-authored/thunder/crater-thunder-body.png': body, 'codex-authored/thunder/crater-thunder-glow.png': glow };
  for (const id of Object.keys(files)) {
    const png = Buffer.from(raster.encodePng(files[id], N, N));
    fs.mkdirSync(path.dirname(path.join(root, id)), { recursive: true });
    fs.writeFileSync(path.join(root, id), png);
    const record = { assetId: scanner.makeAssetId(id), package: scanner.derivePackage(id), relativePath: id, format: 'png',
      fileSize: png.length, contentHash: 'sha256:' + crypto.createHash('sha256').update(png).digest('hex'), facts: facts.pngFacts(png) };
    const at = index.assets.findIndex(a => a.assetId === id);
    if (at < 0) index.assets.push(record); else index.assets[at] = record;
  }
  index.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  index.assetCount = index.assets.length;
  fs.writeFileSync(indexFile, scanner.serialise(index));
  console.log('assets written', Object.keys(files).join(', '));
  /* 掛進雷隕石落地 Preset：impact-ground- 開頭的圖層會被 Runtime 拆到地板層、壽命獨立（同火隕石） */
  const file = path.join(repo, 'vfx/presets/hit-thunderfall-impact.json');
  const p = JSON.parse(fs.readFileSync(file));
  p.layers = p.layers.filter(l => !l.id.startsWith('impact-ground-'));
  if (p.duration !== 4) for (const l of p.layers) if (l.duration === undefined) l.duration = p.duration;
  p.duration = 4;
  p.layers.unshift(
    { id: 'impact-ground-crater', type: 'sprite', assetId: 'codex-authored/thunder/crater-thunder-body.png',
      zIndex: -2, duration: 4, scale: { x: .56, y: .56 }, projection: { x: 1, y: .5 },
      alpha: .92, blendMode: 'normal', alphaOverLife: [[0, 0], [.03, 1], [.78, .95], [1, 0]] },
    { id: 'impact-ground-glow', type: 'sprite', assetId: 'codex-authored/thunder/crater-thunder-glow.png',
      zIndex: -1, duration: 4, scale: { x: .56, y: .56 }, projection: { x: 1, y: .5 },
      alpha: .9, blendMode: 'add',
      alphaOverLife: [[0, 0], [.02, 1], [.08, .55], [.14, 1], [.22, .5], [.3, .95], [.4, .6], [.5, 1], [.6, .55], [.7, .85], [.85, .5], [1, 0]] }
  );
  const check = Core.validatePreset(p);
  if (!check.ok) throw Error(check.errors.join(String.fromCharCode(10)));
  fs.writeFileSync(file, Core.serialisePreset(p));
  const layoutFile = path.join(repo, 'vfx/layouts/hit-thunderfall-impact.json');
  const layout = JSON.parse(fs.readFileSync(layoutFile));
  const have = new Set(layout.groups.flatMap(g => g.layerIds));
  const add = p.layers.map(l => l.id).filter(id => !have.has(id));
  if (add.length) { layout.groups[0].layerIds = add.concat(layout.groups[0].layerIds); fs.writeFileSync(layoutFile, Layout.serialiseLayout(layout)); }
  console.log(p.id, 'layers', p.layers.length);
  return { Core, Layout };
}

if (require.main === module) {
  const pv = process.argv.indexOf('--preview');
  if (pv > 0) {   // 只出預覽圖（疊在深色底上看），不動素材庫
    const out = process.argv[pv + 1];
    fs.mkdirSync(out, { recursive: true });
    const { body, glow } = render();
    const comp = new Uint8Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {   // 深灰綠底 → 本體 → 加法電光
      let r = 70, g = 66, b = 58;
      const ba = body[i * 4 + 3] / 255;
      r = r * (1 - ba) + body[i * 4] * ba; g = g * (1 - ba) + body[i * 4 + 1] * ba; b = b * (1 - ba) + body[i * 4 + 2] * ba;
      const ga = glow[i * 4 + 3] / 255 * 0.9;
      r = Math.min(255, r + glow[i * 4] * ga); g = Math.min(255, g + glow[i * 4 + 1] * ga); b = Math.min(255, b + glow[i * 4 + 2] * ga);
      comp[i * 4] = r; comp[i * 4 + 1] = g; comp[i * 4 + 2] = b; comp[i * 4 + 3] = 255;
    }
    fs.writeFileSync(path.join(out, 'thunder-crater-topdown.png'), Buffer.from(raster.encodePng(comp, N, N)));
    console.log('preview ->', path.join(out, 'thunder-crater-topdown.png'));
  } else write();
}
module.exports = { render };
