'use strict';
// Preserve the editable candidate in the configured asset library. No live game
// sprite or asset index is modified; this is a candidate authoring package.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const repo = path.resolve(__dirname, '../..');
const root = resolveLibraryRoot({ libraryId: 'effects-materials' }).root;
const destination = path.join(root, 'codex-authored/knight3d');
const files = [
  'assets/characters/knight3d/knight_batch1.blend',
  'assets/characters/knight3d/knight_batch1.glb',
  'assets/characters/knight3d/manifest.json',
  'assets/characters/knight3d/README.md',
  'tools/knight3d/build_knight.py',
  'tools/knight3d/silver_knight_geometry.py',
  'tools/knight3d/silver_knight_motion.py',
  'tools/knight3d/render_batch.py',
  'tools/knight3d/package_previews.py',
  'tools/knight3d/validate_asset.py',
  'tools/knight3d/sync-library.cjs',
];
const apply = process.argv.includes('--apply');
if (process.argv.some(a => a.startsWith('--') && !['--apply', '--check'].includes(a))) {
  throw new Error('Use --apply to preserve package, or --check to verify.');
}
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const records = [];
let mismatch = false;
for (const relative of files) {
  const source = path.join(repo, relative);
  const target = path.join(destination, relative);
  const data = fs.readFileSync(source);
  if (apply) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
  const matches = fs.existsSync(target) && hash(fs.readFileSync(target)) === hash(data);
  if (!matches) mismatch = true;
  records.push({ path: relative, bytes: data.length, sha256: hash(data), matches });
}
console.log(JSON.stringify({ package: 'codex-authored/knight3d', mode: apply ? 'apply' : 'check', files: records }, null, 2));
process.exitCode = mismatch ? 1 : 0;
