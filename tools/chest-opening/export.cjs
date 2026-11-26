'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const { REPO_ROOT, resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');
const library = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, 'codex-authored/chest-opening-20261126-v3');
const game = path.join(REPO_ROOT, 'images/chests/opening');
const names = ['bronze', 'fine', 'epic', 'legendary', 'mythic'];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const mode = process.argv[2] || '--check';
if (!['--prepare', '--apply', '--check'].includes(mode)) throw Error('Use --prepare, --apply or --check');
if (mode === '--prepare') {
  const result = cp.spawnSync('python', [path.join(__dirname, 'pack.py'), library], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw Error('Atlas packing failed');
  fs.mkdirSync(path.join(library, 'tools'), { recursive: true });
  for (const file of ['build.py', 'pack.py', 'export.cjs']) fs.copyFileSync(path.join(__dirname, file), path.join(library, 'tools', file));
  fs.copyFileSync(path.join(game, 'SOURCE.md'), path.join(library, 'README.md'));
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(path.join(library, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (!/\.blend\d+$/.test(rel) && rel !== 'manifest.json') files.push(rel);
    }
  }
  walk('');
  const manifest = { version: 1, frameSize: 320, columns: 5, frames: 25, files: Object.fromEntries(files.sort().map(f => [f, hash(path.join(library, f))])) };
  fs.writeFileSync(path.join(library, 'manifest.json'), JSON.stringify(manifest, null, 2)+'\n');
}
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json')));
for (const [file, expected] of Object.entries(manifest.files)) {
  if (hash(path.join(library, file)) !== expected) throw Error('Library mismatch: '+file);
}
fs.mkdirSync(game, { recursive: true });
for (const name of names) {
  const source = path.join(library, 'web', name+'.webp');
  const target = path.join(game, name+'.webp');
  if (mode !== '--check') fs.copyFileSync(source, target);
  if (hash(source) !== hash(target)) throw Error('Game export mismatch: '+name);
}
const gameManifest = { version: 1, frameSize: 320, columns: 5, frames: 25,
  files: Object.fromEntries(names.map(name => [name+'.webp', manifest.files['web/'+name+'.webp']])) };
if (mode !== '--check') fs.writeFileSync(path.join(game, 'manifest.json'), JSON.stringify(gameManifest, null, 2)+'\n');
else if (JSON.stringify(JSON.parse(fs.readFileSync(path.join(game, 'manifest.json')))) !== JSON.stringify(gameManifest)) throw Error('Game manifest mismatch');
console.log('Verified '+Object.keys(manifest.files).length+' source hashes and five game sheets');
