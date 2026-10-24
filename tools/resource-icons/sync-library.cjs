'use strict';
// 素材庫為來源；只匯出已驗收的透明PNG，不在遊戲執行時去背。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const names = ['gold', 'scrap', 'essence', 'ancient_essence', 'gems', 'books'];
const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw new Error('用法：node tools/resource-icons/sync-library.cjs [--apply|--check]');
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/resource-icons');
const record = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'source.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (record.icons.length !== names.length || new Set(record.icons.map(icon => icon.name)).size !== names.length) {
  throw new Error('資源圖示清單不完整或重複');
}
// 先驗證全部來源，避免來源不完整時只覆寫一部分遊戲圖示。
for (const name of names) {
  const icon = record.icons.find(entry => entry.name === name);
  if (!icon) throw new Error('缺少資源圖示：' + name);
  for (const [folder, sha256] of [['before', icon.beforeSha256], ['transparent', icon.sha256]]) {
    if (hash(path.join(sourceRoot, folder, 'icon_' + name + '.png')) !== sha256) {
      throw new Error(name + '來源與紀錄不同：' + folder);
    }
  }
}
for (const name of names) {
  const icon = record.icons.find(entry => entry.name === name);
  const source = path.join(sourceRoot, 'transparent', 'icon_' + name + '.png');
  const target = path.join(REPO_ROOT, 'images', 'icon_' + name + '.png');
  if (mode === '--apply') fs.copyFileSync(source, target);
  if (hash(target) !== icon.sha256) throw new Error(name + '遊戲匯出與素材庫不同');
}
console.log('六張貨幣／材料圖示：原圖、透明來源與遊戲匯出SHA256核對通過。');
