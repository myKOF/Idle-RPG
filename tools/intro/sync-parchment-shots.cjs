'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { REPO_ROOT, resolveLibraryRoot } = require('../vfx/vfx-library-root.cjs');

const mode = process.argv[2] || '--check';
if (!['--archive', '--apply', '--check'].includes(mode)) {
  throw new Error('使用 --archive、--apply 或 --check');
}

const sourceRoot = 'codex-authored/intro-parchment-shots-20261111';
const library = resolveLibraryRoot({ libraryId: 'effects-materials' }).root;
const archive = path.join(library, sourceRoot);
const game = path.join(REPO_ROOT, 'images/intro-parchment');
const sources = [
  'PROMPTS.json',
  'index.html', 'preview.js', 'shot-timing.js', 'shot.js', 'shot-two.js', 'shot-three.js',
  'shot-air.js', 'shot-fire.js', 'shot-ash.js', 'shot-ground.js',
  'render-video.cjs', 'build-score.cjs',
  'assets/air-demon-atlas.png', 'assets/angel.png', 'assets/angels-fall-faces.png',
  'assets/archangel-fall-regalia.png', 'assets/archangel-hood-edit.png', 'assets/archangel-right-hand.png',
  'assets/cloud-abyss.png', 'assets/collapse-smoke.png', 'assets/colossus.png', 'assets/desert-surface.png',
  'assets/demons.png', 'assets/ember.png', 'assets/heaven-sky.png', 'assets/ledge.png', 'assets/mortal-map.png',
  'assets/siege.png', 'assets/temple-details.png', 'assets/temple-roofs.png',
  'assets/temple-spire.png', 'assets/temples.png', 'assets/valley-clean.png',
  'assets/valley.png', 'assets/wing.png', 'assets/score-shot-one.wav', 'assets/score.wav'
].map(file => 'source/' + file);
const exportsByName = {
  'shot-01-02.mp4': 'web/shot-01-02.mp4',
  'shot-01-03.mp4': 'web/shot-01-03.mp4',
  'SOURCE.md': 'SOURCE.md'
};
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const archiveHash = file => hash(path.join(archive, file));
const manifestFile = path.join(archive, 'manifest.json');
const manifest = {
  version: 1,
  sourceRoot,
  sources: Object.fromEntries(sources.map(file => [file, archiveHash(file)])),
  exports: Object.fromEntries(Object.entries(exportsByName).map(([target, source]) => [
    target, { source, sha256: archiveHash(source) }
  ]))
};

if (mode === '--archive') {
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log('羊皮紙序章前三鏡的分層來源及成片已建立 SHA-256 清單');
} else {
  const recorded = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (JSON.stringify(recorded) !== JSON.stringify(manifest)) {
    throw new Error('素材庫來源或匯出 SHA-256 不符，請檢查素材庫清單');
  }
  if (mode === '--apply') fs.mkdirSync(game, { recursive: true });
  for (const [target, source] of Object.entries({ ...exportsByName, 'manifest.json': 'manifest.json' })) {
    const destination = path.join(game, target);
    if (mode === '--apply') fs.copyFileSync(path.join(archive, source), destination);
    if (hash(destination) !== archiveHash(source)) throw new Error('遊戲匯出 SHA-256 不符：' + target);
  }
  console.log('羊皮紙序章前三鏡的分層來源與成片 SHA-256 一致');
}
