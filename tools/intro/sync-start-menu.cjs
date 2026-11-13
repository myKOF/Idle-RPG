'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { resolveLibraryRoot, REPO_ROOT } = require('../vfx/vfx-library-root.cjs');

const mode = process.argv[2] || '--check';
if (!['--archive', '--apply', '--check'].includes(mode)) throw new Error('使用 --archive、--apply 或 --check');

const sourceRoot = 'codex-authored/start-menu-wasteland-20261106';
const root = path.join(resolveLibraryRoot({ libraryId: 'effects-materials' }).root, sourceRoot);
const game = path.join(REPO_ROOT, 'images/start-menu');
const recipe = 'js/start-menu-background.js';
const sources = [
  'originals/battlefield.png', 'originals/cloth-atlas.png', 'PROMPTS.json',
  'originals/battlefield-atmosphere.png', 'originals/title-lockup-forged.png', 'ATMOSPHERE_PROMPTS.json',
  'originals/title-lockup-subtitle-edit.png', 'originals/title-lockup-subtitle.png',
  'originals/battlefield-open-arch.png', 'originals/open-arch-dark-edit.png',
  'originals/open-arch-light-edit.png', 'OPEN_ARCH_PROMPTS.json',
  'source/start-menu-background.js'
];
const exportsByName = {
  'battlefield.webp': 'web/battlefield.webp',
  'battlefield-atmosphere.webp': 'web/battlefield-atmosphere.webp',
  'cloth-atlas.webp': 'web/cloth-atlas.webp',
  'title-lockup-forged.webp': 'web/title-lockup-forged.webp',
  'gate-light-original.png': 'originals/gate-light-original.png',
  'gate-light-clear.png': 'web/gate-light-clear.png',
  'SOURCE.md': 'SOURCE.md',
  'TITLE_SOURCE.md': 'TITLE_SOURCE.md'
};

const hash = data => createHash('sha256').update(data).digest('hex');
const read = (dir, file) => fs.readFileSync(path.join(dir, file));
const hashSource = file => hash(read(root, file));
const gameRecipe = () => read(REPO_ROOT, recipe).toString('utf8').replace(/\r\n/g, '\n');
const manifestPath = path.join(root, 'manifest.json');

if (mode === '--archive') {
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.writeFileSync(path.join(root, 'source/start-menu-background.js'), gameRecipe());
  const manifest = {
    sourceRoot,
    sources: Object.fromEntries(sources.map(file => [file, hashSource(file)])),
    exports: Object.fromEntries(Object.values(exportsByName).map(file => [file, hashSource(file)]))
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const file of sources) {
  if (hashSource(file) !== manifest.sources[file]) throw new Error('素材來源 SHA 不符：' + file);
}
for (const file of Object.values(exportsByName)) {
  if (hashSource(file) !== manifest.exports[file]) throw new Error('素材匯出 SHA 不符：' + file);
}
if (hash(gameRecipe()) !== manifest.sources['source/start-menu-background.js']) {
  throw new Error('遊戲的背景程式尚未封存至素材庫');
}

if (mode === '--apply') fs.mkdirSync(game, { recursive: true });
if (mode !== '--archive') {
  for (const [target, source] of Object.entries({ ...exportsByName, 'manifest.json': 'manifest.json' })) {
    if (mode === '--apply') fs.copyFileSync(path.join(root, source), path.join(game, target));
    if (hash(read(game, target)) !== hashSource(source)) throw new Error('遊戲素材 SHA 不符：' + target);
  }
}
console.log('選單荒原底圖、透明旗布、標誌與背景程式來源 SHA 一致');
