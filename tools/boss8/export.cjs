'use strict';
// Runtime exports come from the formal gargoyle package; preview assets stay isolated.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../..');
const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root,
  'codex-authored/boss8-gargoyle-20261119');
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw Error('Use --check or --apply');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const sha = (bytes, file) => crypto.createHash('sha256').update(/\.(py|cjs|ps1|json|md)$/.test(file)
  ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes).digest('hex');
for (const entry of manifest.files) {
  const source = path.resolve(library, entry.source);
  if (!source.startsWith(library + path.sep)) throw Error('Invalid library source');
  const bytes = fs.readFileSync(source);
  if (sha(bytes, entry.source) !== entry.sha256) throw Error('Library source changed: ' + entry.source);
  if (!entry.project) continue;
  const target = path.resolve(project, entry.project);
  if (!['images/models/npc3d/boss8.glb', 'images/sprites/boss/boss8_gargoyle.png'].includes(entry.project)) throw Error('Unexpected runtime export');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  if (sha(fs.readFileSync(target), entry.project) !== entry.sha256) throw Error('Runtime export changed');
}
console.log('BOSS8 formal library/export verified:', manifest.files.length, mode);
