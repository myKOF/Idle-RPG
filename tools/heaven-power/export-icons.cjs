'use strict';
// 只裁切／縮小核定原創圖集，不重畫；素材庫Root沿共用本機設定解析。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/heaven-power/icons');
const targetRoot = path.join(REPO_ROOT, 'images/ui/heaven-power/icons');

async function main() {
  if (!['--make-icons', '--apply', '--check'].includes(mode)) throw new Error('用法：export-icons.cjs [--make-icons|--apply|--check]');
  const layout = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'layout.json'), 'utf8'));
  const ids = layout.icons.map(icon => icon.id);
  if (ids.length !== 84 || new Set(ids).size !== ids.length || ids.some(id => !/^t(?:[1-9]|10)_[a-z0-9]+$/.test(id))) throw new Error('威能ID清單不完整或不合法');
  for (const source of layout.originals) {
    if (!/^originals\/turn-(?:0[1-9]|10)\.png$/.test(source.file) || hash(path.join(sourceRoot, source.file)) !== source.sha256) throw new Error('核定母圖已變更：' + source.file);
  }
  if (mode === '--make-icons') {
    const sharp = require('sharp');
    const records = [];
    fs.mkdirSync(path.join(sourceRoot, 'exports'), { recursive: true });
    for (const icon of layout.icons) {
      if (!layout.originals.some(source => source.file === icon.original)) throw new Error('缺少母圖：' + icon.id);
      const output = path.join(sourceRoot, 'exports', icon.id + '.png');
      await sharp(path.join(sourceRoot, icon.original)).extract(icon.crop)
        .resize(layout.size, layout.size, { fit: 'contain', background: '#0a1119' }).png().toFile(output);
      records.push({ id: icon.id, sha256: hash(output) });
    }
    fs.writeFileSync(path.join(sourceRoot, 'exports.json'), JSON.stringify({ layoutSha256: hash(path.join(sourceRoot, 'layout.json')), size: layout.size, icons: records }, null, 2) + '\n');
    console.log('84枚原創威能已由母圖裁切縮小至素材庫。');
    return;
  }
  const records = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'exports.json'), 'utf8'));
  if (records.layoutSha256 !== hash(path.join(sourceRoot, 'layout.json'))) throw new Error('裁切配置已變更，請先--make-icons');
  if (records.size !== layout.size || records.icons.length !== ids.length) throw new Error('匯出清單與裁切配置不同');
  if (mode === '--apply') fs.mkdirSync(targetRoot, { recursive: true });
  for (const id of ids) {
    const source = path.join(sourceRoot, 'exports', id + '.png');
    const target = path.join(targetRoot, id + '.png');
    const record = records.icons.find(icon => icon.id === id);
    if (!record || hash(source) !== record.sha256) throw new Error('素材庫輸出不同：' + id);
    if (mode === '--apply') fs.copyFileSync(source, target);
    if (hash(target) !== record.sha256) throw new Error('遊戲輸出不同：' + id);
  }
  console.log('84枚威能母圖／素材庫輸出／遊戲輸出SHA256核對通過。');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
