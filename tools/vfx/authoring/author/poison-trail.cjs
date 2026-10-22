'use strict';
// Original seamless liquid, authored in the collision plane; no reference pixels.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const assetId = 'codex-authored/poison-trail/flow.svg';
const FRAMES = 16, COLUMNS = 4, WIDTH = 512, HEIGHT = 128;
const GEOMETRY = { length: 100, radius: 100 / 9, duration: 16, growSec: 3 };
const n = v => +v.toFixed(3) || 0;
function liquidSVG() {
  const hash = i => { const v = Math.sin(i * 127.1 + 31.7) * 43758.5453; return v - Math.floor(v); };
  const pathOf = points => points.map((p, i) => (i ? 'L' : 'M') + p.map(n).join(' ')).join(' ') + 'Z';
  const cells = [];
  for (let f = 0; f < FRAMES; f++) {
    const phase = f / FRAMES * Math.PI * 2;
    const upper = [], lower = [];
    function flow(x) {
      const center = 64 + 13 * Math.sin(x / 61 + phase) + 5 * Math.sin(x / 23 - phase);
      const cap = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, 40 - Math.min(x - 7, 505 - x)) / 40, 2)));
      const radius = Math.min(55 - Math.abs(center - 64), (39 + 14 * Math.sin(x / 42 + phase * 2) + 8 * Math.sin(x / 17 - phase)) * cap);
      return {center, radius};
    }
    for (let i = 0; i <= 100; i++) {
      const x = 7 + i * 498 / 100, {center, radius} = flow(x);
      upper.push([x, center - radius * (1 + .13 * Math.sin(x * .44 + phase))]);
      lower.unshift([x, center + radius * (1 + .17 * Math.sin(x * .31 - phase + 2))]);
    }
    const outline = pathOf([...upper, ...lower]);
    const clouds = [], eddies = [], foam = [];
    // Overlapping irregular stains, rather than parallel strokes down the whole arm.
    const colors = ['#aacb1b', '#78a91a', '#c5df32', '#4b7914', '#253c08', '#c1eb49'];
    for (let j = 0; j < 68; j++) {
      const x = hash(j + 17) * 500 + 6, base = flow(x);
      const y = base.center + (hash(j + 419) - .5) * base.radius * 1.7;
      const rx = 10 + hash(j + 98) * 32, ry = 5 + hash(j + 229) * 18;
      const points = [];
      for (let k = 0; k < 18; k++) {
        const a = k / 18 * Math.PI * 2, ripple = .74 + hash(j * 37 + k) * .35 + .1 * Math.sin(phase + k + j);
        points.push([x + Math.cos(a) * rx * ripple, y + Math.sin(a) * ry * ripple]);
      }
      clouds.push(`<path d="${pathOf(points)}" fill="${colors[j % colors.length]}" opacity="${n(.2 + hash(j + 811) * .45)}"/>`);
    }
    for (let j = 0; j < 17; j++) {
      const x = hash(j + 51) * 450 + 20, {center,radius} = flow(x);
      const y = center + (hash(j + 121) - .5) * radius;
      const dx = 20 + hash(j + 32) * 46, bend = (hash(j + 441) - .5) * 34 + Math.sin(phase + j) * 6;
      eddies.push(`<path d="M${n(x)} ${n(y)}q${n(dx * .4)} ${n(bend)} ${n(dx)} ${n(bend * .2)}t${n(-dx * .3)} ${n(-bend * .7)}" fill="none" stroke="${j % 3 ? '#cae943' : '#314e0a'}" stroke-width="${n(2 + hash(j + 33) * 5)}" stroke-linecap="round" opacity=".3"/>`);
    }
    for (let j = 0; j < 58; j++) {
      const x = 14 + hash(j + 225) * 482, {center,radius} = flow(x);
      const y = center + (j % 2 ? -1 : 1) * radius * (.65 + hash(j + 41) * .4);
      foam.push(`<ellipse cx="${n(x)}" cy="${n(y + Math.sin(phase + j) * 2)}" rx="${n(.8 + hash(j + 19) * 2)}" ry="${n(.6 + hash(j + 16) * 1.5)}" fill="#c1eb49" opacity="${n(.2 + hash(j + 819) * .45)}"/>`);
    }
    cells.push(`<g transform="translate(${f % COLUMNS * WIDTH} ${Math.floor(f / COLUMNS) * HEIGHT})" clip-path="url(#cell)"><defs><clipPath id="c${f}"><path d="${outline}"/></clipPath></defs><path d="${outline}" fill="#75af15" opacity=".28" filter="url(#mist)"/><path d="${outline}" fill="url(#liquid)" opacity=".8" filter="url(#soft)"/><g clip-path="url(#c${f})"><g filter="url(#soft)">${clouds.join('')}${eddies.join('')}</g>${foam.join('')}</g></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH * COLUMNS}" height="${HEIGHT * FRAMES / COLUMNS}" viewBox="0 0 ${WIDTH * COLUMNS} ${HEIGHT * FRAMES / COLUMNS}"><defs><clipPath id="cell"><rect width="512" height="128"/></clipPath><filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="1.5"/></filter><filter id="mist" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4.5"/></filter><linearGradient id="liquid" x2="0" y2="1"><stop stop-color="#5e8115" stop-opacity=".3"/><stop offset=".3" stop-color="#8eaf22"/><stop offset=".65" stop-color="#527b0d"/><stop offset="1" stop-color="#385d0d" stop-opacity=".3"/></linearGradient></defs>${cells.join('')}</svg>\n`;
}
function make() {
  const { length, radius, duration, growSec } = GEOMETRY, layers = [];
  for (let arm = 0; arm < 4; arm++) {
    const a = arm * Math.PI / 2, end = length / 2, t = growSec / duration;
    layers.push({ id: 'flow-' + arm, type: 'sprite', assetId, zIndex: arm,
      position: { x: 0, y: 0 }, rotation: a, anchor: { x: .5, y: .5 },
      scale: { x: (length + 2 * radius) / WIDTH, y: 2 * radius / HEIGHT },
      offsetXOverLife: [[0, 0], [t, n(Math.cos(a) * end)], [1, n(Math.cos(a) * end)]],
      offsetYOverLife: [[0, 0], [t, n(Math.sin(a) * end)], [1, n(Math.sin(a) * end)]],
      scaleXOverLife: [[0, 2 * radius / (length + 2 * radius)], [t, 1], [1, 1]],
      alpha: .95, blendMode: 'normal', duration,
      projection: { x: 1, y: .5 },
      sheet: { columns: COLUMNS, rows: FRAMES / COLUMNS, count: FRAMES, mode: 'fps', fps: 14 + arm, loop: true }
    });
  }
  return { schemaVersion: 1, id: 'en-poison-cross', duration, loop: false,
    sizing: { authored: { radius: length }, shape: 'circle' }, layers };
}
function writeSource() {
  const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
  const folder = path.join(root, 'codex-authored/poison-trail'), svg = liquidSVG();
  fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(root, assetId), svg);
  fs.writeFileSync(path.join(folder, 'SOURCE.md'), '# 毒素加持：連續毒水\n\n2026-10-22 Codex 原創 SVG 16 格流動圖集。僅參考使用者所附網路截圖的狹長毒水、破碎邊緣、明暗流紋與細泡沫；未下載、描摹或使用參考圖像素。Mote Studio 可存取，Export 僅 PNG／Sprite sheet／GIF，不支援本次原生 SVG，改採專案向量作者。\n\n遊戲使用表定長度／球半徑作為水帶長度／半寬、speed 決定前緣速度，四臂從中心連續伸展；不再逐顆放球。編輯器預覽採既有表定預設。重製：node tools/vfx/authoring/author/poison-trail.cjs，再執行 node tools/vfx/export-assets.cjs。\n');
  const scanner = require('../../asset-scanner.cjs'), file = path.join(repo, 'vfx/asset-index.json');
  const index = JSON.parse(fs.readFileSync(file)), bytes = Buffer.from(svg);
  const entry = { assetId, package: scanner.derivePackage(assetId), relativePath: assetId, format: 'svg',
    fileSize: bytes.length, contentHash: 'sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'),
    facts: require('../../vfx-image-facts.cjs').svgFacts(bytes) };
  const at = index.assets.findIndex(a => a.assetId === assetId);
  if (at < 0) index.assets.push(entry); else index.assets[at] = entry;
  index.assets.sort((a, b) => a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0);
  index.assetCount = index.assets.length; fs.writeFileSync(file, scanner.serialise(index));
  return folder;
}
if (require.main === module) {
  const folder = writeSource(); require('../preset-kit.cjs').write(make());
  for (const kind of ['presets', 'layouts']) {
    fs.mkdirSync(path.join(folder, kind), { recursive: true });
    fs.copyFileSync(path.join(repo, 'vfx', kind, 'en-poison-cross.json'), path.join(folder, kind, 'en-poison-cross.json'));
  }
  console.log('en-poison-cross：原創連續毒水已保存，待正式匯出');
}
module.exports = { make, liquidSVG, assetId, GEOMETRY, FRAMES, COLUMNS, WIDTH, HEIGHT };
