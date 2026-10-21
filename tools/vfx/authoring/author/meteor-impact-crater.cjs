'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
const Core = require(path.join(repo, 'js/vfx-core.js'));
const Layout = require(path.join(repo, 'tools/vfx/editor/layout-schema.js'));
const scanner = require('../../asset-scanner.cjs');
const facts = require('../../vfx-image-facts.cjs');

function craterSVG() {
  // 保留生成的手繪原稿；只以原生向量遮罩控制貼地融合，不重採樣原稿。
  const png = fs.readFileSync(path.join(root, 'codex-authored/meteor/crater-lava-source.png'));
  const measured = facts.pngFacts(png);
  if (!measured.hasAlphaChannel || measured.backgroundVariant !== 'transparent') throw Error('坑痕原稿需要透明PNG');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><radialGradient id="edge"><stop offset="0" stop-color="white"/><stop offset=".56" stop-color="white"/>
<stop offset=".7" stop-color="white" stop-opacity=".92"/><stop offset=".82" stop-color="white" stop-opacity=".52"/>
<stop offset=".94" stop-color="white" stop-opacity=".08"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient>
<mask id="terrain" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="url(#edge)"/></mask></defs>
<image width="512" height="512" href="data:image/png;base64,${png.toString('base64')}" mask="url(#terrain)"/></svg>\n`;
}

function write() {
  const indexFile = path.join(repo, 'vfx/asset-index.json');
  const index = JSON.parse(fs.readFileSync(indexFile));
  index.assets = index.assets.filter(a => !['codex-authored/meteor/crater-bed.svg', 'codex-authored/meteor/crater-embers.svg'].includes(a.assetId));
  for (const name of ['crater-lava-soft']) {
    const id = 'codex-authored/meteor/' + name + '.svg';
    const svg = craterSVG();
    fs.mkdirSync(path.dirname(path.join(root, id)), { recursive: true });
    fs.writeFileSync(path.join(root, id), svg);
    const record = { assetId: scanner.makeAssetId(id), package: scanner.derivePackage(id), relativePath: id,
      format: 'svg', fileSize: Buffer.byteLength(svg), contentHash: 'sha256:' + crypto.createHash('sha256').update(svg).digest('hex'),
      facts: facts.svgFacts(Buffer.from(svg)) };
    const at = index.assets.findIndex(a => a.assetId === id);
    if (at < 0) index.assets.push(record); else index.assets[at] = record;
  }
  index.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  index.assetCount = index.assets.length;
  fs.writeFileSync(indexFile, scanner.serialise(index));
  const file = path.join(repo, 'vfx/presets/burst-meteor-inferno.json');
  const p = JSON.parse(fs.readFileSync(file));
  p.layers = p.layers.filter(l => !l.id.startsWith('impact-ground-'));
  for (const l of p.layers) if (l.duration === undefined) l.duration = p.duration;
  p.duration = 4;
  p.layers.unshift(
    { id: 'impact-ground-crater', type: 'sprite', assetId: 'codex-authored/meteor/crater-lava-soft.svg',
      zIndex: -2, duration: 4, scale: { x: .234375, y: .234375 }, projection: { x: 1, y: .5 },
      alpha: 1, blendMode: 'normal', alphaOverLife: [[0, 0], [.04, 1], [.72, .9], [1, 0]] }
  );
  const check = Core.validatePreset(p);
  if (!check.ok) throw Error(check.errors.join('\n'));
  fs.writeFileSync(file, Core.serialisePreset(p));
  const layoutFile = path.join(repo, 'vfx/layouts/burst-meteor-inferno.json');
  const layout = JSON.parse(fs.readFileSync(layoutFile));
  layout.groups[0].layerIds = p.layers.map(l => l.id);
  fs.writeFileSync(layoutFile, Layout.serialiseLayout(layout));
  console.log(p.id);
}
if (require.main === module) write();
module.exports = { craterSVG };
