'use strict';
// 母圖與128px成品保留於素材庫；遊戲只接收已核對SHA的透明PNG。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw new Error('Expected --check or --apply');
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/ancient-stars-20261105');
const record = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'source.json'), 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const file of ['reference/star3.jpg', 'originals/gold.png', 'originals/blue.png', 'originals/light-blue.png', 'icons/ancient-star-gold.png', 'icons/ancient-star-blue.png', 'icons/ancient-star-light-blue.png']) {
  if (!record.sha256[file] || hash(path.join(sourceRoot, file)) !== record.sha256[file]) throw new Error('Source differs: ' + file);
}
for (const name of ['ancient-star-gold.png', 'ancient-star-light-blue.png', 'ancient-star-blue.png']) {
  const source = path.join(sourceRoot, 'icons', name);
  const target = path.join(REPO_ROOT, 'images/ui', name);
  const png = fs.readFileSync(source);
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 128 || png.readUInt32BE(20) !== 128 || png[25] !== 6) throw new Error('Expected 128px RGBA PNG: ' + name);
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
  if (!fs.existsSync(target) || hash(target) !== hash(source)) throw new Error('Game export differs: ' + name);
}
console.log('Ancient stars: 128px RGBA PNGs, source manifest and game SHA256 match.');
