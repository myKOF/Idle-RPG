'use strict';
// Original vector cylinder; no copied or generated bitmap material.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const assetId = 'codex-authored/arcane-rod/cylinder.svg';

function cylinderSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="1024" viewBox="0 0 144 1024">
<defs>
 <linearGradient id="barrel" x1="0" y1="0" x2="1" y2="0">
  <stop stop-color="#40137c"/><stop offset=".12" stop-color="#a33de4"/>
  <stop offset=".29" stop-color="#eea3ff"/><stop offset=".40" stop-color="#fff7ff"/>
  <stop offset=".51" stop-color="#e4bcff"/><stop offset=".76" stop-color="#a75bea"/>
  <stop offset=".94" stop-color="#652aa9"/><stop offset="1" stop-color="#3d137c"/>
 </linearGradient>
 <linearGradient id="axial" x1="0" y1="0" x2="0" y2="1">
  <stop stop-color="#f6cbff" stop-opacity=".1"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".45"/>
  <stop offset="1" stop-color="#f6cbff" stop-opacity=".1"/>
 </linearGradient>
</defs>
<path d="M20 52 A52 52 0 0 1 124 52 V972 A52 52 0 0 1 20 972 Z" fill="url(#barrel)"/>
<path d="M49 58 V966" stroke="url(#axial)" stroke-width="5" stroke-linecap="round"/>
<path d="M90 58 V966" stroke="#c899ff" stroke-opacity=".32" stroke-width="2" stroke-linecap="round"/>
</svg>\n`;
}

function writeAssets() {
  const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
  const svg = cylinderSVG();
  const folder = path.join(root, 'codex-authored/arcane-rod');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(root, assetId), svg);
  const scanner = require('../../asset-scanner.cjs');
  const facts = require('../../vfx-image-facts.cjs').svgFacts(Buffer.from(svg));
  const file = path.join(repo, 'vfx/asset-index.json');
  const index = JSON.parse(fs.readFileSync(file));
  const entry = { assetId: scanner.makeAssetId(assetId), package: scanner.derivePackage(assetId),
    relativePath: assetId, format: 'svg', fileSize: Buffer.byteLength(svg),
    contentHash: 'sha256:' + crypto.createHash('sha256').update(svg).digest('hex'), facts };
  const at = index.assets.findIndex(a => a.assetId === assetId);
  if (at < 0) index.assets.push(entry); else index.assets[at] = entry;
  index.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  index.assetCount = index.assets.length;
  fs.writeFileSync(file, scanner.serialise(index));
  fs.writeFileSync(path.join(folder, 'SOURCE.md'), '# 祕法加持圓柱光棒\n\n2026-10-21，Codex依使用者要求，以SVG幾何與向量漸層原創繪製。橫向明暗、偏心亮線與圓弧封口形成柱體；依使用者回饋移除光環、端帽邊線與尖端外伸光斑，保持平滑連續外緣，沒有使用外部圖片／描圖／生成點陣。Mote Studio已確認可用，但僅匯出PNG／sprite sheet／GIF，不支援此原生SVG需求。\n\n重製：遊戲倉庫 node tools/vfx/authoring/author/arcane-rod.cjs。柱身只由既有表定 en-arcane-beams-1 使用，長度與寬度按同一份敵人表格比例製作；單側順時針轉速與壽命保持既有值。其餘光暈及光環使用既有Kenney CC0素材。\n');
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
  return { schemaVersion: 1, id: d.v.field, duration, loop: false,
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
    ] };
}

if (require.main === module) {
  writeAssets();
  const preset = make();
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
module.exports = { make, cylinderSVG };
