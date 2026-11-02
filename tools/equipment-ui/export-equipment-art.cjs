'use strict';
// 原稿與正式PNG保存於同一素材庫；只做透明留白與縮圖，不重畫生成素材。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const spec = require('./armor-accessories-20261102.json');
const ROOT = path.resolve(__dirname, '../..');

function catalog() {
  let id = 2244;
  const items = [];
  for (const set of spec.sets) {
    spec.slots.forEach((slot, i) => items.push({
      key: set.key + '_' + slot, slot, strId: id++, name: set.name + set.items[i][0],
      family: set.key, material: set.material,
      prompt: spec.style + set.items[i][1] + '. Family design: ' + set.theme
    }));
  }
  for (const [slot, list] of [['ring', spec.rings], ['amulet', spec.amulets]]) {
    for (const [key, name, description] of list) items.push({
      key: slot + '_' + key, slot, strId: id++, name,
      prompt: spec.style + description + '. Authentic finely worked medieval jewelry, rich realistic material detail, no oversized magical effects.'
    });
  }
  return items;
}

async function main() {
  const sharp = require('sharp');
  const library = path.join(resolveLibraryRoot().root, spec.libraryRelativePath);
  const items = catalog();
  const partial = process.argv.includes('--partial');
  const check = process.argv.includes('--check');
  const exportDir = path.join(library, 'export');
  const gameDir = path.join(ROOT, spec.gameRelativePath);
  if (!check) {
    fs.mkdirSync(exportDir, { recursive: true });
    fs.mkdirSync(gameDir, { recursive: true });
  }
  const hashes = [];
  for (const item of items) {
    const raw = path.join(library, 'raw', item.key + '.png');
    if (!fs.existsSync(raw) && partial) continue;
    const meta = await sharp(raw).metadata();
    if (!meta.hasAlpha) throw new Error('原稿缺少透明通道：' + item.key);
    const png = await sharp(raw).trim({ background: '#00000000', threshold: 0 })
      .resize(spec.iconSize - 80, spec.iconSize - 80, { fit: 'contain', background: '#00000000', withoutEnlargement: true })
      .extend({ top: 40, bottom: 40, left: 40, right: 40, background: '#00000000' })
      .png({ compressionLevel: 9, palette: false }).toBuffer();
    const file = 'icon_' + item.key + '.png';
    for (const dir of [exportDir, gameDir]) {
      const output = path.join(dir, file);
      if (check) {
        if (!fs.existsSync(output) || !fs.readFileSync(output).equals(png)) throw new Error('匯出不同步：' + output);
      } else fs.writeFileSync(output, png);
    }
    hashes.push({ key: item.key, file, sha256: crypto.createHash('sha256').update(png).digest('hex'),
      rawSha256: crypto.createHash('sha256').update(fs.readFileSync(raw)).digest('hex') });
  }
  const legacyDir = path.join(library, 'legacy');
  let legacyCount = 0;
  for (const file of fs.readdirSync(legacyDir).filter(f => f.endsWith('.png'))) {
    const input = fs.readFileSync(path.join(legacyDir, file));
    const output = path.join(gameDir, file);
    if (check) {
      if (!fs.existsSync(output) || !fs.readFileSync(output).equals(input)) throw new Error('舊圖搬移不同步：' + file);
    } else fs.writeFileSync(output, input);
    legacyCount++;
  }
  if (!check && !partial) fs.writeFileSync(path.join(library, 'hashes.json'), JSON.stringify(hashes, null, 2) + '\n');
  console.log((check ? '核對' : '匯出') + '裝備圖示：' + hashes.length + '/' + items.length);
  console.log('舊裝備原圖：' + legacyCount);
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { catalog, spec };
