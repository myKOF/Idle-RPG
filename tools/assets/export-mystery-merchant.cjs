'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');

const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw Error('Use --apply or --check');
const sourceDir = path.join(resolveLibraryRoot().root, 'codex-authored/mystery-merchant-20261111');
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
for (const file of manifest.files) {
  if (path.basename(file.source) !== file.source) throw Error('Invalid merchant asset source path');
  if (sha(fs.readFileSync(path.join(sourceDir, file.source))) !== file.sha256) {
    throw Error('Merchant asset source hash mismatch: ' + file.source);
  }
}
for (const exportName of ['mystery-merchant.webp', 'mystery-merchant-shop.webp']) {
  const expected = manifest.files.find(file => file.source === exportName);
  if (!expected) throw Error('Missing merchant asset export: ' + exportName);
  const output = path.resolve(__dirname, '../../images/ui', exportName);
  if (mode === '--apply') fs.copyFileSync(path.join(sourceDir, exportName), output);
  if (sha(fs.readFileSync(output)) !== expected.sha256) {
    throw Error('Game asset differs from the library export: ' + exportName);
  }
}
console.log('Mystery merchant assets verified: ' + mode);
