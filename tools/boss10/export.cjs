'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');

const project = path.resolve(__dirname, '../..');
const material = process.argv.includes('--material3') ? 3 : process.argv.includes('--variants') ? 2 : 1;
const suffix = material === 1 ? '' : '_lv' + material;
const variantPart = material === 1 ? '' : '-variant' + material;
const packageName = 'boss10-lava' + variantPart + '-20261124';
const library = path.join(resolveLibraryRoot().root, 'codex-authored', packageName);
const mode = process.argv[2] || '--check';
if (!['--check', '--apply'].includes(mode)) throw new Error('Use --check or --apply');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const exportsBySource = {
  ['exports/boss10'+suffix+'.glb']: 'images/models/npc3d/boss10'+suffix+'.glb',
  ['exports/boss10_lava'+suffix+'.png']: 'images/sprites/boss/boss10_lava'+suffix+'.png'
};
const sha = (bytes, file) => crypto.createHash('sha256').update(/\.(py|cjs|json|md)$/.test(file)
  ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes).digest('hex');
const assets = manifest.files.map(entry => {
  const source = path.resolve(library, entry.source);
  if (!source.startsWith(library + path.sep)) throw new Error('Invalid library path');
  const bytes = fs.readFileSync(source);
  if (sha(bytes, entry.source) !== entry.sha256) throw new Error('Library asset differs: ' + entry.source);
  return { ...entry, bytes };
});
for (const [source, target] of Object.entries(exportsBySource)) {
  const entry = assets.find(asset => asset.source === source);
  if (!entry) throw new Error('Missing runtime asset: ' + source);
  const file = path.join(project, target);
  if (mode === '--apply') fs.writeFileSync(file, entry.bytes);
  if (sha(fs.readFileSync(file), target) !== entry.sha256) throw new Error('Runtime asset differs: ' + target);
}
console.log('BOSS10 source and runtime exports verified:', assets.length, mode);
