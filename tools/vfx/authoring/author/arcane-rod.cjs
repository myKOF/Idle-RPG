'use strict';
// Original vector cylinder; no copied or generated bitmap material.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const assetId = 'codex-authored/arcane-rod/cylinder.svg';
const currentId = 'codex-authored/arcane-rod/surface-current.svg';
const emitterId = 'codex-authored/arcane-rod/emitter-flare.svg';
const arcsId = 'codex-authored/arcane-rod/outer-arcs.svg';
// 前端拉長成錐形：從最大直徑（y=430）起兩側向中心收成一點，尖端仍在 (72,0)，樞軸與最大直徑不變。
const cylinderPath = 'M72 0 C80 110 124 250 124 430 V972 A52 52 0 0 1 20 972 V430 C20 250 64 110 72 0 Z';
const TIP = { p0: [72, 0], p1: [80, 110], p2: [124, 250], p3: [124, 430] };

/* 柱身在高度 y 的半寬：錐形段取貝茲曲線的實際值，其下為滿寬 52。電流與弧線都以此為準，才會貼著錐形走。 */
function halfWidth(y) {
  if (y >= TIP.p3[1]) return 52;
  if (y <= 0) return 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2, u = 1 - t;
    const yy = 3 * u * u * t * TIP.p1[1] + 3 * u * t * t * TIP.p2[1] + t * t * t * TIP.p3[1];
    if (yy < y) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2, u = 1 - t;
  return u * u * u * TIP.p0[0] + 3 * u * u * t * TIP.p1[0] + 3 * u * t * t * TIP.p2[0] + t * t * t * TIP.p3[0] - 72;
}
/* 固定種子的亂數：圖集重跑得到逐位元相同的結果（測試以雜湊核對）。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function cylinderSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="1024" viewBox="0 0 144 1024">
<defs>
 <linearGradient id="barrel" x1="0" y1="0" x2="1" y2="0">
  <stop stop-color="#7622ff" stop-opacity="0"/><stop offset=".2" stop-color="#973aff" stop-opacity=".3"/>
  <stop offset=".36" stop-color="#cb7cff" stop-opacity=".8"/><stop offset=".44" stop-color="#f1c6ff"/>
  <stop offset=".47" stop-color="#ffffff"/><stop offset=".53" stop-color="#ffffff"/>
  <stop offset=".56" stop-color="#f1c6ff"/><stop offset=".64" stop-color="#cb7cff" stop-opacity=".8"/>
  <stop offset=".8" stop-color="#973aff" stop-opacity=".3"/><stop offset="1" stop-color="#7622ff" stop-opacity="0"/>
 </linearGradient>
 <linearGradient id="axial" x1="0" y1="0" x2="0" y2="1">
  <stop stop-color="#ffffff" stop-opacity=".95"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".7"/>
  <stop offset="1" stop-color="#f6cbff" stop-opacity=".12"/>
 </linearGradient>
</defs>
<path d="${cylinderPath}" fill="url(#barrel)"/>
<path d="M72 0 C75 130 80 460 80 640 L64 640 C64 460 69 130 72 0 Z" fill="url(#axial)"/>
</svg>\n`;
}

/* 表面電流：沿柱身盤繞的細電流，擺幅跟著半寬走（尖端收窄、柱身最寬），再加每格不同的折線抖動，看起來是劈啪竄動而非平滑的波。 */
function currentSVG() {
  const frames = [];
  for (let frame = 0; frame < 8; frame++) {
    const rand = rng(1000 + frame);
    const lines = [];
    for (let strand = 0; strand < 3; strand++) {
      const phase = frame * Math.PI / 4 * (strand % 2 ? -1 : 1) + strand * Math.PI * 2 / 3;
      let path = '';
      for (let y = 8; y <= 940; y += 12) {
        const hw = halfWidth(y);
        const x = 72 + hw * .82 * Math.sin(y / 70 + phase) + hw * .22 * (rand() - .5) * 2;
        path += (path ? ' L' : 'M') + x.toFixed(2) + ' ' + y;
      }
      lines.push(`<path d="${path}" fill="none" stroke="#9d35ff" stroke-width="10" opacity=".2"/>
<path d="${path}" fill="none" stroke="#c070ff" stroke-width="3.5" opacity=".95"/>
<path d="${path}" fill="none" stroke="#fbe9ff" stroke-width="1.2" opacity=".95"/>`);
    }
    frames.push(`<g transform="translate(${frame * 144} 0)"><g clip-path="url(#body)">${lines.join('\n')}</g></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1152" height="1024" viewBox="0 0 1152 1024"><defs><clipPath id="body"><path d="${cylinderPath}"/></clipPath></defs>${frames.join('\n')}</svg>\n`;
}

/* 外圍纏繞電流：不裁切在柱身內，從柱面竄出、繞到外側再折回柱面的鋸齒電弧（像電流把棒子纏起來），
   另有短分叉與只竄出不折回的游離電弧。8 格、每格 400 寬，柱身軸心在 x=200；與柱身共用同一組幾何，只是畫布更寬。 */
const ARC_W = 400, ARC_CX = 200;
function arcPath(rand, side, y0, y1, reach) {
  const pts = [];
  const n = 7 + Math.floor(rand() * 3);
  for (let i = 0; i <= n; i++) {
    const t = i / n, y = y0 + (y1 - y0) * t;
    const hw = halfWidth(y);
    const bulge = Math.sin(Math.PI * t);                         // 兩端貼柱面、中段最遠
    const jag = (i === 0 || i === n) ? 0 : (rand() - .5) * 2 * 14;
    pts.push([ARC_CX + side * (hw + 3 + reach * bulge) + jag, y]);
  }
  return pts;
}
const polyD = (pts) => pts.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
const strokeSet = (d, k) => `<path d="${d}" fill="none" stroke="#a23bff" stroke-width="${(9 * k).toFixed(1)}" opacity=".22" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="#d58cff" stroke-width="${(3.4 * k).toFixed(1)}" opacity=".95" stroke-linejoin="round"/>
<path d="${d}" fill="none" stroke="#ffffff" stroke-width="${(1.3 * k).toFixed(1)}" opacity=".95" stroke-linejoin="round"/>`;
function arcsSVG() {
  const frames = [];
  for (let frame = 0; frame < 8; frame++) {
    const rand = rng(5000 + frame * 17);
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const side = rand() < .5 ? -1 : 1;
      const y0 = 120 + rand() * 780, len = 70 + rand() * 150, reach = 22 + rand() * 62;
      const pts = arcPath(rand, side, y0, Math.min(1000, y0 + len), reach);
      parts.push(strokeSet(polyD(pts), 1));
      if (rand() < .55) {                                           // 從電弧中段分出一小叉
        const m = pts[Math.floor(pts.length / 2)];
        const fork = [m, [m[0] + side * (16 + rand() * 26), m[1] - 10 - rand() * 22], [m[0] + side * (30 + rand() * 40), m[1] - 4 + rand() * 30]];
        parts.push(strokeSet(polyD(fork), .6));
      }
    }
    for (let i = 0; i < 3; i++) {                                    // 游離電弧：竄出去不回來
      const side = rand() < .5 ? -1 : 1, y = 160 + rand() * 760, hw = halfWidth(y);
      const pts = [[ARC_CX + side * hw, y]];
      let x = pts[0][0], yy = y;
      for (let k = 0; k < 5; k++) { x += side * (10 + rand() * 18); yy += (rand() - .5) * 34; pts.push([x, yy]); }
      parts.push(strokeSet(polyD(pts), .75));
    }
    frames.push(`<g transform="translate(${frame * ARC_W} 0)">${parts.join('\n')}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ARC_W * 8}" height="1024" viewBox="0 0 ${ARC_W * 8} 1024">${frames.join('\n')}</svg>\n`;
}

function emitterSVG() {
  const rays = [];
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * Math.PI * 2 + .08 * Math.sin(i * 5.2);
    const length = 125 + 90 * (.5 + .5 * Math.sin(i * 3.7));
    const x = 256 + Math.cos(a) * length, y = 256 + Math.sin(a) * length;
    const w = 9 + 9 * (.5 + .5 * Math.cos(i * 4.1));
    const dx = -Math.sin(a) * w, dy = Math.cos(a) * w;
    rays.push(`<path d="M${256 + dx} ${256 + dy} L${x} ${y} L${256 - dx} ${256 - dy} Z" fill="url(#light)"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><radialGradient id="light" gradientUnits="userSpaceOnUse" cx="256" cy="256" r="240"><stop stop-color="#fff"/><stop offset=".13" stop-color="#fff"/><stop offset=".3" stop-color="#f0adff" stop-opacity=".95"/><stop offset=".62" stop-color="#9c37ff" stop-opacity=".38"/><stop offset="1" stop-color="#571bc9" stop-opacity="0"/></radialGradient>
<filter id="mist" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
<filter id="rays" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="3"/></filter></defs>
<g filter="url(#mist)" opacity=".55"><ellipse cx="245" cy="251" rx="125" ry="93" fill="#721ce2"/><ellipse cx="270" cy="255" rx="65" ry="105" fill="#d073ff"/></g>
<g filter="url(#rays)">${rays.join('\n')}</g><circle cx="256" cy="256" r="240" fill="url(#light)"/><circle cx="256" cy="256" r="32" fill="#fff"/></svg>\n`;
}

function enhance(base) {
  const p = JSON.parse(JSON.stringify(base));
  // 已存在的電流／電弧圖層是使用者在編輯器調過的（位置、寬度…），沿用不重設；只有不存在時才依柱身新建。
  const keep = id => p.layers.find(l => l.id === id);
  const keptSurface = keep('surface-current'), keptArcs = keep('outer-arcs');
  p.layers = p.layers.filter(l => l.id !== 'surface-current' && l.id !== 'outer-arcs');
  const body = p.layers.find(l => l.id === 'cylinder-body');
  if (!body) throw Error('Missing cylinder-body');
  // 電流沿用實際柱身的所有幾何與時間軸，包含使用者的分層旋轉／投影設定。
  const surface = keptSurface || { ...JSON.parse(JSON.stringify(body)), id: 'surface-current', assetId: currentId,
    zIndex: (body.zIndex || 0) + 1, alpha: .55, blendMode: 'normal',
    sheet: { columns: 8, rows: 1, count: 8, mode: 'fps', fps: 12, loop: true } };
  p.layers.splice(p.layers.indexOf(body) + 1, 0, surface);
  // 外圍纏繞電流：同樣沿用柱身幾何（每像素縮放相同，畫布較寬所以電弧能伸到柱外），加亮疊在最上層。
  const arcs = keptArcs || { ...JSON.parse(JSON.stringify(body)), id: 'outer-arcs', assetId: arcsId,
    zIndex: (body.zIndex || 0) + 2, alpha: 1, blendMode: 'add',
    sheet: { columns: 8, rows: 1, count: 8, mode: 'fps', fps: 14, loop: true } };
  p.layers.splice(p.layers.indexOf(surface) + 1, 0, arcs);
  const hub = p.layers.find(l => l.id === 'hub');
  if (hub) { hub.assetId = emitterId; hub.tint = '#ffffff'; }
  const halo = p.layers.find(l => l.id === 'halo');
  if (halo) halo.alpha = .08;
  return p;
}

function writeAssets() {
  const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
  const folder = path.join(root, 'codex-authored/arcane-rod');
  fs.mkdirSync(folder, { recursive: true });
  const scanner = require('../../asset-scanner.cjs');
  const file = path.join(repo, 'vfx/asset-index.json');
  const index = JSON.parse(fs.readFileSync(file));
  for (const [id, svg] of [[assetId, cylinderSVG()], [currentId, currentSVG()], [emitterId, emitterSVG()], [arcsId, arcsSVG()]]) {
    fs.writeFileSync(path.join(root, id), svg);
    const facts = require('../../vfx-image-facts.cjs').svgFacts(Buffer.from(svg));
    const entry = { assetId: scanner.makeAssetId(id), package: scanner.derivePackage(id),
      relativePath: id, format: 'svg', fileSize: Buffer.byteLength(svg),
      contentHash: 'sha256:' + crypto.createHash('sha256').update(svg).digest('hex'), facts };
    const at = index.assets.findIndex(a => a.assetId === id);
    if (at < 0) index.assets.push(entry); else index.assets[at] = entry;
  }
  index.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  index.assetCount = index.assets.length;
  fs.writeFileSync(file, scanner.serialise(index));
  // 正式遊戲只讀 images/vfx/assets 與 vfx/shipped-assets.json：同步放一份並更新雜湊（素材庫是本機的、不進版控）。
  const shippedFile = path.join(repo, 'vfx/shipped-assets.json');
  const shipped = JSON.parse(fs.readFileSync(shippedFile));
  for (const [id] of [[assetId], [currentId], [emitterId], [arcsId]]) {
    const bytes = fs.readFileSync(path.join(root, id));
    fs.mkdirSync(path.dirname(path.join(repo, 'images/vfx/assets', id)), { recursive: true });
    fs.writeFileSync(path.join(repo, 'images/vfx/assets', id), bytes);
    const entry = { assetId: id, relativePath: id, package: scanner.derivePackage(id),
      contentHash: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'), fileSize: bytes.length };
    const at = shipped.assets.findIndex(a => a.assetId === id);
    if (at < 0) shipped.assets.push(entry); else shipped.assets[at] = entry;
  }
  shipped.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  if (typeof shipped.assetCount === 'number') shipped.assetCount = shipped.assets.length;
  fs.writeFileSync(shippedFile, JSON.stringify(shipped, null, 2) + '\n');
  fs.writeFileSync(path.join(folder, 'SOURCE.md'), '# 祕法加持圓柱光棒\n\n2026-10-21，Codex依使用者要求，以SVG幾何與向量漸層原創繪製。橫向明暗、偏心亮線與圓弧封口形成柱體；依使用者回饋移除光環、端帽邊線與尖端外伸光斑，保持平滑連續外緣，沒有使用外部圖片／描圖／生成點陣。Mote Studio已確認可用，但僅匯出PNG／sprite sheet／GIF，不支援此原生SVG需求。\n\n重製：遊戲倉庫 node tools/vfx/authoring/author/arcane-rod.cjs。柱身只由既有表定 en-arcane-beams-1 使用，長度與寬度按同一份敵人表格比例製作；單側順時針轉速與壽命保持既有值。其餘光暈及光環使用既有Kenney CC0素材。\n');
  fs.appendFileSync(path.join(folder, 'SOURCE.md'), '\n2026-10-21追加：使用者要求前端略尖、柱身有輕微紫色電流。前端以短弧收尖，保留原端點與最大直徑；surface-current.svg是8格原創紫色細電流圖集，12fps循環，每格兩道不規則螺旋細線並裁切在柱身內，沒有虛線外環。CLI只增補電流，保留使用者現有柱身與父層的尺寸／旋轉／投影／時間軸。電流完整沿用柱身幾何；不修改表格、傷害判定或程式Runtime。\n');
  fs.appendFileSync(path.join(folder, 'SOURCE.md'), '\n2026-10-21參考風格追加：僅觀察使用者紫白光束截圖的亮暗層次，不使用／描摹附件像素。光柱改為白熱細芯與柔紫暈，電流加強不規則折線；emitter-flare.svg以原創放射幾何、徑向漸層與載入時柔化製作起點閃光，取代圓球外觀。保留使用者實際幾何與時間軸，不改傷害。\n');
  fs.appendFileSync(path.join(folder, 'SOURCE.md'), '\n2026-10-21再追加（使用者要求更尖、外圍電流更強，參考紫白電光束圖，僅觀察形狀與明暗不描摹）：柱身前端改為長錐形（y=430 起兩側收成一點，尖端與最大直徑不變）；白熱細芯改為隨錐形收窄；surface-current.svg 改為3道盤繞電流、擺幅隨半寬、每格折線抖動；新增 outer-arcs.svg（8格×400寬原創鋸齒電弧，從柱面竄出再折回、帶分叉與游離電弧，不裁切於柱身內），以加亮疊在最上層。halfWidth()／rng() 固定種子，重跑結果逐位元相同。\n');
  return root;
}

function make() {
  const source = fs.readFileSync(path.join(repo, 'js/skills2.js'), 'utf8');
  const literal = /var ENEMY_SKILLS2 = (\{[\s\S]*?\n\});/.exec(source);
  if (!literal) throw Error('Missing generated ENEMY_SKILLS2 data');
  const data = require('node:vm').runInNewContext('(' + literal[1] + ')').e_arcane;
  const d = { ...data.fx, v: data.vfx };
  const diameter = d.wid / d.len * 100;
  const duration = d.dur;
  const rad = d.rot * Math.PI / 180;
  const common = { parent: 'rod-axis', duration, loop: true };
  return enhance({ schemaVersion: 1, id: d.v.field, duration, loop: false,
    sizing: { shape: 'circle', authored: { radius: 100 } }, layers: [
      { id: 'halo', type: 'sprite', assetId: 'light-masks-1.0/default/circle_b.png',
        zIndex: 0, scale: { x: .07, y: .07 }, alpha: .25, tint: '#c850ff', blendMode: 'add',
        duration, projection: { x: 1, y: .5 } },
      { id: 'rod-axis', type: 'empty', duration, rotation: Math.PI / 2, rotationSpeed: rad,
        outerScale: { x: 1, y: .5 } },
      { ...common, id: 'barrel-aura', type: 'sprite', assetId, zIndex: 1,
        anchor: { x: .5, y: 1 }, scale: { x: diameter / 104 * 1.55, y: 100 / 1024 },
        alpha: .24, tint: '#b866ff', blendMode: 'add' },
      { ...common, id: 'cylinder-body', type: 'sprite', assetId, zIndex: 2,
        anchor: { x: .5, y: 1 }, scale: { x: diameter / 104, y: 100 / 1024 },
        alpha: .98, blendMode: 'normal' },
      { id: 'hub', type: 'sprite', assetId: 'particle-pack/png-black-background/light_03.png',
        zIndex: 9, scale: { x: .047, y: .047 }, alpha: .75, tint: '#f8d8ff', blendMode: 'add', duration }
    ] });
}

if (require.main === module) {
  writeAssets();
  const preset = enhance(JSON.parse(fs.readFileSync(path.join(repo, 'vfx/presets/en-arcane-beams-1.json'))));
  const Core = require(path.join(repo, 'js/vfx-core.js'));
  const Layout = require(path.join(repo, 'tools/vfx/editor/layout-schema.js'));
  const check = Core.validatePreset(preset);
  if (!check.ok) throw Error(check.errors.join('\n'));
  fs.writeFileSync(path.join(repo, 'vfx/presets', preset.id + '.json'), Core.serialisePreset(preset));
  fs.writeFileSync(path.join(repo, 'vfx/layouts', preset.id + '.json'), Layout.serialiseLayout({
    schemaVersion: 1, presetId: preset.id,
    groups: [{ id: preset.id, name: preset.id, layerIds: preset.layers.map(l => l.id) }], order: ['group:' + preset.id] }));
  console.log(preset.id);
}
module.exports = { make, enhance, cylinderSVG, currentSVG, emitterSVG, arcsSVG, halfWidth };
