'use strict';
// The asset library keeps the editable source and authorized originals.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../../..');
const library = path.join(resolveLibraryRoot().root, 'codex-authored/tower-boss1-3d-20261108-v2');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
function sha(bytes, file) {
  return crypto.createHash('sha256').update(/\.(py|cjs|md|json|txt)$/.test(file)
    ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes).digest('hex');
}
function child(root, relative) {
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw Error('Invalid asset path: ' + relative);
  return target;
}
for (const file of manifest.files) {
  const bytes = fs.readFileSync(child(library, file.source));
  if (sha(bytes, file.source) !== file.sha256) throw Error('Library source differs: ' + file.source);
  if (!file.project) continue;
  const target = child(project, file.project);
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  if (sha(fs.readFileSync(target), file.project) !== file.sha256) throw Error('Project export differs: ' + file.project);
}
console.log('Tower BOSS1 source/export verified: ' + manifest.files.length + ' files; ' + mode);
