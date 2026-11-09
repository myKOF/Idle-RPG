'use strict';
// Export the approved Role6 dependency and newly authored Role7 from one
// manifest. This only copies verified assets; runtime selection is separate.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../../..');
const root = resolveLibraryRoot().root;
const library = path.join(root, 'codex-authored/hero3d-role7-20261109');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw Error('Use --apply or --check');
const hash = (bytes, file) => crypto.createHash('sha256').update(
  /\.(py|cjs|md|json|html|txt)$/.test(file) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes
).digest('hex');
function inside(base, relative) {
  const file = path.resolve(base, relative);
  if (!file.startsWith(base + path.sep)) throw Error('Invalid manifest path: ' + relative);
  return file;
}
function verify(base, file) {
  const bytes = fs.readFileSync(inside(base, file.source));
  if (hash(bytes, file.source) !== file.sha256) throw Error('Source hash mismatch: ' + file.source);
  if (!file.project) return;
  const dest = inside(project, file.project);
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
  if (hash(fs.readFileSync(dest), file.project) !== file.sha256) throw Error('Export differs: ' + file.project);
}
for (const file of manifest.files) verify(library, file);
for (const file of manifest.dependencies) verify(root, file);
for (const [file, expected] of Object.entries(manifest.preservedModels)) {
  if (hash(fs.readFileSync(inside(project, file)), file) !== expected) throw Error('Preserved model changed: ' + file);
}
console.log('Role6 / Role7 sources and exports verified: ' + (manifest.files.length + manifest.dependencies.length) + '; ' + mode);
