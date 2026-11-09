'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../../..');
const library = path.join(resolveLibraryRoot().root, 'codex-authored/character-portraits-20261109');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const sha = (bytes, file) => crypto.createHash('sha256').update(
  /\.(md|json|cjs)$/.test(file) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes
).digest('hex');
const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw Error('Use --apply or --check');
for (const file of manifest.files) {
  const source = path.resolve(library, file.source);
  if (!source.startsWith(library + path.sep)) throw Error('Invalid library path');
  const bytes = fs.readFileSync(source);
  if (sha(bytes, file.source) !== file.sha256) throw Error('Library hash mismatch: ' + file.source);
  if (!file.project) continue;
  const dest = path.resolve(project, file.project);
  if (!dest.startsWith(project + path.sep)) throw Error('Invalid project path');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
  if (sha(fs.readFileSync(dest), file.project) !== file.sha256) throw Error('Game export differs: ' + file.project);
}
console.log('Character portraits verified: ' + manifest.files.length + ' files; ' + mode);
