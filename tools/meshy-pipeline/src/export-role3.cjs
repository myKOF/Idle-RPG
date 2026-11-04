'use strict';
// The editable Blender source and licensed attachment live in the configured
// asset library. This is the single copy/check entry point for its game export.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot } = require('../../vfx/vfx-library-root.cjs');
const project = path.resolve(__dirname, '../../..');
const library = path.join(resolveLibraryRoot().root, 'codex-authored/hero3d-role3-20261104');
const manifest = JSON.parse(fs.readFileSync(path.join(library, 'manifest.json'), 'utf8'));
// Git may check text out with CRLF on Windows. Binary assets stay byte-exact;
// text manifests hash their LF representation on both sides of the export.
const sha = (bytes, file = '') => crypto.createHash('sha256').update(
  /\.(py|cjs|md|json)$/.test(file) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes
).digest('hex');
const mode = process.argv[2] || '--check';
if (!['--apply', '--check', '--source-check'].includes(mode)) throw Error('Use --apply, --check or --source-check');
for (const file of manifest.files) {
  const source = path.resolve(library, file.source);
  if (!source.startsWith(library + path.sep)) throw Error('Invalid library path');
  const bytes = fs.readFileSync(source);
  if (sha(bytes, file.source) !== file.sha256) throw Error('Library source hash mismatch: ' + file.source);
  if (!file.project) continue;
  const dest = path.resolve(project, file.project);
  if (!dest.startsWith(project + path.sep)) throw Error('Invalid project path');
  if (mode === '--apply') {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
  }
  if (sha(fs.readFileSync(dest), file.project) !== file.sha256) throw Error('Game export differs: ' + file.project);
}
if (sha(fs.readFileSync(path.join(project, 'images/models/hero3d/sunbrand-knight.glb'))) !== manifest.knightSha256) {
  throw Error('Original knight changed; rebuild and validate the new appearance against its rig');
}
if (sha(fs.readFileSync(path.join(project, 'images/models/hero3d/role1.glb'))) !== manifest.approvedRoleSha256) throw Error('Approved Role motions/grip changed; rebuild Role3');
console.log('Role3 source / game export verified: ' + manifest.files.length + ' files; ' + mode);
