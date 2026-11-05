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
// 新增神性之石沿用同一匯出入口；保留既有六張來源紀錄與原圖不動。
const stoneRoot = path.join(sourceRoot, '..', 'divine-stone-icon-20261105');
const stone = JSON.parse(fs.readFileSync(path.join(stoneRoot, 'source.json'), 'utf8'));
for (const entry of [stone.reference, stone.approved, stone.icon]) {
  if (hash(path.join(stoneRoot, entry.file)) !== entry.sha256) throw new Error('神性之石來源SHA256不同：' + entry.file);
}
for (const name of names) {
  const icon = record.icons.find(entry => entry.name === name);
  const source = path.join(sourceRoot, 'transparent', 'icon_' + name + '.png');
  const target = path.join(REPO_ROOT, 'images', 'icon_' + name + '.png');
  if (mode === '--apply') fs.copyFileSync(source, target);
  if (hash(target) !== icon.sha256) throw new Error(name + '遊戲匯出與素材庫不同');
}
const stoneSource = path.join(stoneRoot, stone.icon.file);
const stoneTarget = path.join(REPO_ROOT, 'images/icon_divine_stone.png');
if (mode === '--apply') fs.copyFileSync(stoneSource, stoneTarget);
if (hash(stoneTarget) !== stone.icon.sha256) throw new Error('神性之石遊戲匯出與素材庫不同');
console.log('七張貨幣／材料圖示：原圖、透明來源與遊戲匯出SHA256核對通過。');
