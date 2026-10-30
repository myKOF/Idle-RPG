'use strict';
// 直接匯出使用者授權原圖；不重繪、重採樣或修改其像素。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw new Error('Expected --apply or --check');
const sourceRoot = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'user-authorized/chaos-equipment-ui');
const record = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'source.json'), 'utf8'));
if (record.file !== 'chaos-reference.png') throw new Error('Unexpected equipment UI source');
const source = path.join(sourceRoot, record.file);
const target = path.join(REPO_ROOT, 'images/ui/equipment', record.file);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (hash(source) !== record.sha256) throw new Error('Equipment UI source differs from its record');
if (mode === '--apply') {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}
if (!fs.existsSync(target) || hash(target) !== record.sha256) throw new Error('Equipment UI export differs from its source');
console.log('Equipment UI: authorized source and game export SHA256 match.');
