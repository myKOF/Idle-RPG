'use strict';
// PBR maps are sidecars so the approved mesh, rig, UV and motion files remain
// byte-exact. The configured library owns maps and editable packed Blends.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../../..');
const library = path.join(resolveLibraryRoot().root, 'codex-authored/hero3d-pbr-20261104');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
const sha = (bytes, file = '') => crypto.createHash('sha256').update(
  /\.(py|cjs|js|html|md|json)$/.test(file) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes
).digest('hex');
const mode = process.argv[2] || '--check';
if (!['--apply', '--check', '--source-check'].includes(mode)) throw Error('Use --apply, --check or --source-check');
// Validate source dependencies before copying anything into the game.
for (const [role, model] of Object.entries(manifest.models)) {
  const game = path.join(project, 'images/models/hero3d', role + '.glb');
  if (sha(fs.readFileSync(game)) !== model.approvedModelSha256) throw Error('Approved model changed: rebuild PBR for ' + role);
  const original = path.join(resolveLibraryRoot().root, 'codex-authored', model.sourcePackage, 'source', role[0].toUpperCase() + role.slice(1) + '.glb');
  if (sha(fs.readFileSync(original)) !== model.sourceSha256) throw Error('Licensed source changed: ' + role);
}
for (const file of manifest.files) {
  const source = path.resolve(library, file.source);
  if (!source.startsWith(library + path.sep)) throw Error('Invalid library path');
  const bytes = fs.readFileSync(source);
  if (sha(bytes, source) !== file.sha256) throw Error('Library source hash mismatch: ' + file.source);
  if (!file.project) continue;
  const dest = path.resolve(project, file.project);
  if (!dest.startsWith(project + path.sep)) throw Error('Invalid project path');
  if (mode === '--apply') { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); }
  if (sha(fs.readFileSync(dest), dest) !== file.sha256) throw Error('Game export differs: ' + file.project);
}
console.log('Hero PBR source / game export verified: ' + manifest.files.length + ' files; ' + mode);
