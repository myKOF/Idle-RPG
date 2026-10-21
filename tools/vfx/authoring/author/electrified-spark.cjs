'use strict';
// Original vector current: two independently twisting strands.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const repo = path.resolve(__dirname, '../../../..');
const assetId = 'codex-authored/electrified-spark/current.svg';
const FRAMES = 64, COLUMNS = 16, CELL = 256;
// 圈選線段的兩端跨度；延長只沿線段方向，線寬另行加倍。
const SEGMENT = { dx: 56, dy: -98, lengthMultiplier: 1.5, widthMultiplier: 2 };
const polyD = pts => pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ');
function randomBend(strand, point, key) {
  let h = Math.imul(strand + 13, 374761393) ^ Math.imul(point + 7, 668265263) ^ Math.imul((key + 8) % 8 + 3, 2147483647);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296 * 2 - 1;
}
function framePaths(frame, lengthMultiplier = SEGMENT.lengthMultiplier) {
  const dx = SEGMENT.dx * lengthMultiplier, dy = SEGMENT.dy * lengthMultiplier;
  const length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
  const paths = [];
  for (let strand = 0; strand < 2; strand++) {
    const time = ((frame % FRAMES) + strand * 13) / FRAMES * 8;
    const key = Math.floor(time), fraction = time - key, smooth = fraction * fraction * (3 - 2 * fraction);
    const line = [], offset = strand ? 1 : -1;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, a = randomBend(strand, i, key), b = randomBend(strand, i, key + 1);
      // 兩條各取自己的亂數節點，平滑過渡；不共用同一條波形或鏡像。
      const bend = Math.sin(Math.PI * t) * (a + (b - a) * smooth) * 24.7;
      line.push([128 + dx * (t - .5) + nx * (offset + bend), 128 + dy * (t - .5) + ny * (offset + bend)]);
    }
    paths.push(line);
  }
  return { paths };
}
function currentSVG(options = {}) {
  const lengthMultiplier = options.lengthMultiplier ?? SEGMENT.lengthMultiplier;
  const widthMultiplier = options.widthMultiplier ?? SEGMENT.widthMultiplier;
  const cells = [];
  for (let frame = 0; frame < FRAMES; frame++) {
    const { paths } = framePaths(frame, lengthMultiplier);
    const lines = paths.map(pts => {
      const d = polyD(pts), k = widthMultiplier;
      return `<path d="${d}" stroke="#1634ff" stroke-width="${18 * k}" opacity=".24"/>
<path d="${d}" stroke="#2457ff" stroke-width="${8 * k}" opacity=".85"/>
<path d="${d}" stroke="#769eff" stroke-width="${3.6 * k}"/>
<path d="${d}" stroke="#dcf0ff" stroke-width="${1.4 * k}" opacity=".8"/>`;
    }).join('\n');
    cells.push(`<g transform="translate(${frame % COLUMNS * CELL} ${Math.floor(frame / COLUMNS) * CELL})" clip-path="url(#cell)">
<g fill="none" stroke-linejoin="round" stroke-linecap="round">${lines}</g></g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * CELL}" height="${FRAMES / COLUMNS * CELL}" viewBox="0 0 ${COLUMNS * CELL} ${FRAMES / COLUMNS * CELL}">
<defs><clipPath id="cell"><rect width="256" height="256"/></clipPath></defs>
${cells.join('\n')}</svg>\n`;
}
function make() {
  return { schemaVersion: 1, id: 'en-spark', duration: 2, loop: true,
    sizing: { authored: { radius: 22 }, shape: 'projectile-circle' },
    layers: [{ id: 'current', type: 'sprite', assetId, zIndex: 0,
      position: { x: 0, y: 0 }, rotation: .693156,
      scale: { x: .7115, y: .3785 }, alpha: 1, blendMode: 'add', duration: 2, loop: true,
      sheet: { columns: COLUMNS, rows: FRAMES / COLUMNS, count: FRAMES, mode: 'fps', fps: 32, loop: true } }] };
}
function writeSource() {
  const root = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
  const folder = path.join(root, 'codex-authored/electrified-spark'), svg = currentSVG();
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(root, assetId), svg);
  fs.writeFileSync(path.join(folder, 'SOURCE.md'), '# NPC帶電：跳動電流\n\n2026-10-21，Codex原創SVG。僅參考使用者提供藍色電團截圖的鋸齒輪廓、分岔與深藍光暈，不使用／描摹附件像素或第三方素材。Mote Studio可用，已檢查Export只有PNG／Sprite sheet／GIF，沒有本次原生SVG匯出，因此使用專案原生向量作者流程。\n\n2026-10-22依使用者圈選改為只有一段持續扭動的電流：以圈出的斜向線段為基準，沿線段延長50%，各層線寬加倍。移除外環、內網、分叉與面積光暈；其後依使用者要求改成兩條獨立種子的隨機扭動電流，兩條基準軸幾乎重疊、獨立隨機扭動幅度增加30%，64格32fps／2秒圖層循環；單一sprite不旋轉、不發射粒子。保留en-spark既有0.5秒loop與projectile-circle／authored.radius=22尺寸契約，沿用表定bodyD與飛行事件。\n\n重製：node tools/vfx/authoring/author/electrified-spark.cjs，再執行node tools/vfx/export-assets.cjs。Preset與layout存於同目錄的presets／layouts，遊戲與素材庫皆需提交。\n');
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
  const folder = writeSource(), kit = require('../preset-kit.cjs'); kit.write(make());
  for (const kind of ['presets', 'layouts']) {
    fs.mkdirSync(path.join(folder, kind), { recursive: true });
    fs.copyFileSync(path.join(repo, 'vfx', kind, 'en-spark.json'), path.join(folder, kind, 'en-spark.json'));
  }
  console.log('en-spark：原創電流圖集及作者資料已保存，待正式匯出');
}
module.exports = { make, currentSVG, framePaths, assetId, FRAMES, COLUMNS, CELL, SEGMENT };
