'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REPO_ROOT, resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');

const mode = process.argv[2] || '--check';
if (!['--apply', '--check'].includes(mode)) throw new Error('Use --apply or --check');

const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root,
  'codex-authored/quest-guide-dagger-20261118');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const filename = 'quest-guide-dagger.png';
const output = path.join(REPO_ROOT, 'images/ui', filename);

function readVerified(relativePath) {
  const bytes = fs.readFileSync(path.join(library, relativePath));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== manifest.files[relativePath]) throw new Error('Library hash mismatch: ' + relativePath);
  return bytes;
}

readVerified('originals/' + filename);
const exported = readVerified('exports/' + filename);
if (mode === '--apply') fs.writeFileSync(output, exported);
if (!fs.readFileSync(output).equals(exported)) throw new Error('Game export differs: ' + filename);
console.log('Verified quest guide dagger and ImageGen original');
