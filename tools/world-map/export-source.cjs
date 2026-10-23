'use strict';
// 沿既有素材庫Root解析，僅複製使用者核准地圖，不重新生成／調色／縮放。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw new Error('用法：node tools/world-map/export-source.cjs [--apply|--check]');
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/world-map');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const record = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'source.json'), 'utf8'));
if (hash(path.join(sourceRoot, 'location-cursor-original.png')) !== record.cursor.originalSha256) throw new Error('所在地游標母圖與紀錄不同');
for (const entry of [{ file: 'salvien.png', sha256: record.sha256 }, record.cursor]) {
  if (!['salvien.png', 'location-cursor.png'].includes(entry.file)) throw new Error('未知世界地圖素材');
  const source = path.join(sourceRoot, entry.file);
  const target = path.join(REPO_ROOT, 'images/world-map', entry.file);
  if (entry.sha256 !== hash(source)) throw new Error(entry.file + '來源與核准紀錄不同');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  if (!fs.existsSync(target) || hash(target) !== entry.sha256) throw new Error(entry.file + '素材庫與遊戲匯出不同');
}
console.log('薩爾維恩世界地圖／游標：素材庫與遊戲SHA256一致。');
