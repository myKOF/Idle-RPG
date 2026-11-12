'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REPO_ROOT, resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');

const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw new Error('Use --apply or --check');

const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/forge-chests-20261112');
const game = path.join(REPO_ROOT, 'images/chests');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const names = ['bronze', 'fine', 'epic', 'legendary', 'mythic'];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function readSource(file) {
  const bytes = fs.readFileSync(path.join(library, file));
  const contents = file === 'PROMPTS.json' ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes;
  if (hash(contents) !== manifest[file]) throw new Error('Library hash mismatch: ' + file);
  return bytes;
}

readSource('PROMPTS.json');
for (const name of names) readSource('originals/' + name + '.png');
const exportsByName = names.map((name) => [name + '.webp', readSource('web/' + name + '.webp')]);

if (mode === '--apply') fs.mkdirSync(game, { recursive: true });
for (const [name, bytes] of exportsByName) {
  const output = path.join(game, name);
  if (mode === '--apply') fs.writeFileSync(output, bytes);
  if (hash(fs.readFileSync(output)) !== hash(bytes)) throw new Error('Game export differs: ' + name);
}
console.log('Verified five chest images and their sources');
