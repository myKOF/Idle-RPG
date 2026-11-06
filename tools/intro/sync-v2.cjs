'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');
const mode = process.argv[2] || '--check';
if (!['--archive', '--apply', '--check'].includes(mode)) throw Error('使用 --archive／--apply／--check');
const relative = 'codex-authored/intro-dark-fantasy-v2-20261106';
const root = path.join(resolveLibraryRoot({}).root, relative);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function inside(base, file) { const p = path.resolve(base, file); if (!p.startsWith(path.resolve(base) + path.sep)) throw Error('路徑越界'); return p; }
const recipes = ['js/intro-motion.js', 'js/intro-data.js'];
if (mode === '--archive') {
  for (const file of recipes) fs.copyFileSync(path.join(REPO_ROOT, file), path.join(root, 'source', path.basename(file)));
  const assets = JSON.parse(fs.readFileSync(path.join(root, 'assets.json')));
  const sources = assets.map(a => a.original).concat(['reference/angel-fall.webp', 'reference/awakening.webp', 'reference/rise-and-quest.webp', 'assets.json'], recipes.map(f => 'source/' + path.basename(f)));
  const exports = assets.map(a => ({ source: a.source, target: a.target })).concat(['SOURCE.md', 'PROMPTS.json'].map(file => ({ source: file, target: 'images/intro-v2/' + file })));
  const manifest = { version: 2, sourceRoot: relative, assets, recipes, sources: sources.map(file => ({ file, sha256: hash(inside(root, file)) })), exports: exports.map(e => ({ ...e, sha256: hash(inside(root, e.source)) })) };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('第二版七張素材及2D關節／時間軸來源已封存');
  process.exit(0);
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
for (const s of manifest.sources.concat(manifest.exports.map(e => ({ file: e.source, sha256: e.sha256 })))) {
  if (hash(inside(root, s.file)) !== s.sha256) throw Error('來源SHA不同：' + s.file);
}
for (const file of recipes) if (hash(path.join(REPO_ROOT, file)) !== hash(path.join(root, 'source', path.basename(file)))) throw Error('動畫來源未封存：' + file);
for (const e of manifest.exports) {
  const target = inside(REPO_ROOT, e.target);
  if (mode === '--apply') { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(inside(root, e.source), target); }
  if (hash(target) !== e.sha256) throw Error('匯出SHA不同：' + e.target);
}
const targetManifest = path.join(REPO_ROOT, 'images/intro-v2/manifest.json');
if (mode === '--apply') fs.copyFileSync(path.join(root, 'manifest.json'), targetManifest);
if (hash(targetManifest) !== hash(path.join(root, 'manifest.json'))) throw Error('素材清單不同');
console.log('第二版七張素材／提示詞／2D動畫來源：雙庫SHA一致');
