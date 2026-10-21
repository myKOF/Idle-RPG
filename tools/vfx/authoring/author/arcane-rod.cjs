'use strict';
// Original vector cylinder; no copied or generated bitmap material.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const assetId = 'codex-authored/arcane-rod/cylinder.svg';
const currentId = 'codex-authored/arcane-rod/surface-current.svg';
const emitterId = 'codex-authored/arcane-rod/emitter-flare.svg';
const cylinderPath = 'M20 88 C20 51 48 17 72 0 C96 17 124 51 124 88 V972 A52 52 0 0 1 20 972 Z';

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
  <stop stop-color="#f6cbff" stop-opacity=".1"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".45"/>
  <stop offset="1" stop-color="#f6cbff" stop-opacity=".1"/>
 </linearGradient>
</defs>
<path d="${cylinderPath}" fill="url(#barrel)"/>
<path d="M72 90 V966" stroke="url(#axial)" stroke-width="5" stroke-linecap="round"/>
</svg>\n`;
}

function currentSVG() {
  const frames = [];
  for (let frame = 0; frame < 8; frame++) {
    const lines = [];
    for (let strand = 0; strand < 2; strand++) {
      const phase = frame * Math.PI / 4 + strand * Math.PI;
      let path = '';
      for (let y = 92; y <= 932; y += 14) {
        const x = 72 + 40 * Math.sin(y / 90 + phase) + 8 * Math.sin(y * .37 + phase * 2);
        path += (path ? ' L' : 'M') + x.toFixed(2) + ' ' + y;
      }
      lines.push(`<path d="${path}" fill="none" stroke="#9d35ff" stroke-width="10" opacity=".18"/>
<path d="${path}" fill="none" stroke="#9f42f0" stroke-width="3" opacity=".9"/>
<path d="${path}" fill="none" stroke="#f2c8ff" stroke-width="1" opacity=".9"/>`);
    }
    frames.push(`<g transform="translate(${frame * 144} 0)"><g clip-path="url(#body)">${lines.join('\n')}</g></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1152" height="1024" viewBox="0 0 1152 1024"><defs><clipPath id="body"><path d="${cylinderPath}"/></clipPath></defs>${frames.join('\n')}</svg>\n`;
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
  p.layers = p.layers.filter(l => l.id !== 'surface-current');
  const body = p.layers.find(l => l.id === 'cylinder-body');
  if (!body) throw Error('Missing cylinder-body');
  // 電流沿用實際柱身的所有幾何與時間軸，包含使用者的分層旋轉／投影設定。
  const surface = { ...JSON.parse(JSON.stringify(body)), id: 'surface-current', assetId: currentId,
    zIndex: (body.zIndex || 0) + 1, alpha: .55, blendMode: 'normal',
    sheet: { columns: 8, rows: 1, count: 8, mode: 'fps', fps: 12, loop: true } };
  p.layers.splice(p.layers.indexOf(body) + 1, 0, surface);
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
  for (const [id, svg] of [[assetId, cylinderSVG()], [currentId, currentSVG()], [emitterId, emitterSVG()]]) {
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
  fs.writeFileSync(path.join(folder, 'SOURCE.md'), '# 祕法加持圓柱光棒\n\n2026-10-21，Codex依使用者要求，以SVG幾何與向量漸層原創繪製。橫向明暗、偏心亮線與圓弧封口形成柱體；依使用者回饋移除光環、端帽邊線與尖端外伸光斑，保持平滑連續外緣，沒有使用外部圖片／描圖／生成點陣。Mote Studio已確認可用，但僅匯出PNG／sprite sheet／GIF，不支援此原生SVG需求。\n\n重製：遊戲倉庫 node tools/vfx/authoring/author/arcane-rod.cjs。柱身只由既有表定 en-arcane-beams-1 使用，長度與寬度按同一份敵人表格比例製作；單側順時針轉速與壽命保持既有值。其餘光暈及光環使用既有Kenney CC0素材。\n');
  fs.appendFileSync(path.join(folder, 'SOURCE.md'), '\n2026-10-21追加：使用者要求前端略尖、柱身有輕微紫色電流。前端以短弧收尖，保留原端點與最大直徑；surface-current.svg是8格原創紫色細電流圖集，12fps循環，每格兩道不規則螺旋細線並裁切在柱身內，沒有虛線外環。CLI只增補電流，保留使用者現有柱身與父層的尺寸／旋轉／投影／時間軸。電流完整沿用柱身幾何；不修改表格、傷害判定或程式Runtime。\n');
  fs.appendFileSync(path.join(folder, 'SOURCE.md'), '\n2026-10-21參考風格追加：僅觀察使用者紫白光束截圖的亮暗層次，不使用／描摹附件像素。光柱改為白熱細芯與柔紫暈，電流加強不規則折線；emitter-flare.svg以原創放射幾何、徑向漸層與載入時柔化製作起點閃光，取代圓球外觀。保留使用者實際幾何與時間軸，不改傷害。\n');
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
module.exports = { make, enhance, cylinderSVG, currentSVG, emitterSVG };
