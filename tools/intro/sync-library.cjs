'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw new Error('使用 --apply 或 --check');
const root = path.join(resolveLibraryRoot({}).root, 'codex-authored/intro-dark-fantasy-20261105');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inside(base, relative) {
  const file = path.resolve(base, relative);
  if (!file.startsWith(path.resolve(base) + path.sep)) throw new Error('素材路徑越界');
  return file;
}
for (const entry of manifest.sources.concat(manifest.exports.map(e => ({ file: e.source, sha256: e.sha256 })))) {
  if (hash(inside(root, entry.file)) !== entry.sha256) throw new Error('素材來源不符：' + entry.file);
}
if (hash(path.join(REPO_ROOT, 'tools/intro/build-score.cjs')) !== hash(path.join(root, 'source/build-score.cjs'))) {
  throw new Error('聲景產生器與素材庫不同');
}
for (const entry of manifest.exports) {
  const target = inside(REPO_ROOT, entry.target);
  if (mode === '--apply') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(inside(root, entry.source), target); }
  if (hash(target) !== entry.sha256) throw new Error('遊戲匯出不符：' + entry.target);
}
const shipped = path.join(REPO_ROOT, 'images/intro/manifest.json');
if (mode === '--apply') fs.copyFileSync(path.join(root, 'manifest.json'), shipped);
if (hash(shipped) !== hash(path.join(root, 'manifest.json'))) throw new Error('素材清單不同');
console.log('序章五張繪景／雙軌聲景／來源與提示詞：雙庫SHA256一致');
