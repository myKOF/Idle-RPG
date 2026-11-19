'use strict';
// Preserve the editable Blender source in the library; export only runtime assets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../..');
const library = path.join(resolveLibraryRoot().root, 'codex-authored/boss7-rock-20261119');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
function sha(data, file) {
  return crypto.createHash('sha256').update(/\.(py|md|json)$/.test(file)
    ? data.toString('utf8').replace(/\r\n/g, '\n') : data).digest('hex');
}
for (const entry of manifest.files) {
  const source = path.resolve(library, entry.source);
  if (!source.startsWith(library + path.sep)) throw new Error('Invalid source path');
  const bytes = fs.readFileSync(source);
  if (sha(bytes, entry.source) !== entry.sha256) throw new Error('Library asset differs: ' + entry.source);
  if (!entry.project) continue;
  const target = path.resolve(project, entry.project);
  if (!target.startsWith(project + path.sep)) throw new Error('Invalid project path');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  if (sha(fs.readFileSync(target), entry.project) !== entry.sha256) throw new Error('Export differs: ' + entry.project);
}
console.log('BOSS7 source/export verified: ' + manifest.files.length + ' files; ' + mode);
