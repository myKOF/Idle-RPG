const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const skills = read('js/skills.js');
const vfx = read('js/vfx.js');
const renderer = read('js/battle-renderer.js');
const shim = read('js/worker/shim.js');

test('三個指定技能使用專用 VFX 與命中規格', () => {
  assert.match(skills, /chainLightning:[\s\S]*?hits:\s*3/);
  assert.match(skills, /fireball:\s*\{\s*variant:\s*'fireball'/);
  assert.match(skills, /arcaneBarrage:\s*\{\s*variant:\s*'arcane-barrage'/);
  assert.match(skills, /meteor:\s*\{\s*fxKind:\s*'rain',\s*variant:\s*'meteor'/);

  assert.match(vfx, /function vfxBarrageProjectile\(/);
  assert.match(vfx, /function vfxMeteorProjectile\(/);
  assert.match(vfx, /VFX_METEOR_SPEED_MULTIPLIER = 0\.70/);
  assert.match(vfx, /var fall = Math\.round\(rawFall \/ meteorSpeed\)/);
  assert.match(vfx, /var diagonalRise = diagonalRun \* Math\.tan\(Math\.PI \/ 3\)/);
  assert.match(vfx, /var smallOffsets = \[-0\.22, -0\.04, 0\.16, 0\.32\]/);
  assert.match(vfx, /vfxBuildFlareFlame\(d, false, 0\.65\)/);
  assert.match(vfx, /var VFX_METEOR_SIZE_SCALE = 1\.30/);
  assert.match(vfx, /vfxBuildFlareFlame\(d, !!small, VFX_METEOR_SIZE_SCALE\)/);
  assert.match(vfx, /vfxBuildFlareFlame\(d, false, 0\.65\)/);
  assert.match(vfx, /vfx-impact-fire-explosion/);
  assert.match(vfx, /vfx-burst-fireball/);
  assert.match(vfx, /VFX_FLARE_LIFESPAN_MS = 2400/);
  assert.match(vfx, /VFX_FLARE_SPEED = 100/);
  assert.match(vfx, /VFX_FLARE_ADVANCE_MS = 2000/);
  assert.match(vfx, /VFX_FLARE_START_SCALE = 0\.70/);
  assert.match(vfx, /Math\.cos\(life \* Math\.PI \* 0\.5\)/);
  assert.match(vfx, /function vfxMeteorShockwave\(/);
  assert.match(vfx, /flash\.style\.borderRadius = '50%'/);
  assert.match(read('css/style.css'), /\.vfx-area-flash[\s\S]*?transform-origin: 50% 50%/);
  assert.match(read('css/style.css'), /@keyframes vfxAreaFlash[\s\S]*?transform: scale\(1\)/);
  assert.match(vfx, /function vfxRectAround\(pt, area\)/);
  assert.match(vfx, /vfxRectAround\(fallbackPt, s\.variant === 'meteor' \? spec\.area : null\)/);

  assert.match(renderer, /function spawnBarrageMissile\(/);
  assert.match(renderer, /function spawnMeteorProjectile\(/);
  assert.match(renderer, /spec\.variant === 'fireball' \? 0/);
  assert.match(renderer, /var smallTheme = \{ c1: '#ef4b16', c2: '#ffd166', glow: '#ff7a1a' \}/);
  assert.match(renderer, /function loadFireFlare\(\)/);
  assert.match(renderer, /new PIXI\.Rectangle\(392, 2, 128, 128\)/);
  assert.match(renderer, /function flameProjectile\(theme, small, sizeScale\)/);
  assert.match(renderer, /core = flameProjectile\(theme, false, 0\.65\)/);
  assert.match(renderer, /var METEOR_SIZE_SCALE = 1\.30/);
  assert.match(renderer, /var flame = flameProjectile\(theme, scale && scale < 1, METEOR_SIZE_SCALE\)/);
  assert.match(renderer, /p\._age >= 2\.4/);
  assert.match(renderer, /var distance = 100 \* p\._age/);
  assert.match(renderer, /function flameColorIntAt\(/);
  assert.match(renderer, /g\.ellipse\(0, 0, 10 \+ radius/);
  assert.match(renderer, /var dur = Math\.min\(1\.15, Math\.max\(0\.7, meteorTravel \/ 1000 \/ 0\.70\)\)/);
  assert.match(renderer, /if \(spec\.variant === 'arcane-barrage'/);
  assert.match(renderer, /for \(var lane = 0; lane < 3; lane\+\+\)[\s\S]*spawnBarrageMissile\(id, spec, -1, lane[\s\S]*spawnBarrageMissile\(id, spec, 1, lane/);
  assert.match(renderer, /function spawnContinuousChainLightning\(/);
  assert.match(renderer, /function spawnNodeRing\(/);
  assert.match(renderer, /function rectRadius\(rect\)/);
  assert.match(renderer, /var shockTheme = \{ c1: '#9f1d12', c2: '#f05a13', glow: '#d62f12' \}/);
  assert.match(renderer, /spawnFireShockwave\(cx, cy, rectRadius\(rect\), shockTheme\)/);
  assert.match(renderer, /spec\.variant === 'fire-explosion'/);
  assert.match(renderer, /spawnFireShockwave\(cx, cy/);
  assert.match(read('css/style.css'), /\.vfx-meteor-small \.vfx-proj-core/);
  assert.match(read('css/style.css'), /-webkit-mask-image: url\('\.\.\/images\/flares\.png'\)/);
  assert.match(read('css/style.css'), /\.vfx-meteor-shockwave[\s\S]*?@keyframes vfxShockwaveRing/);
  assert.match(read('css/style.css'), /@keyframes vfxShockwaveParticle/);
  assert.match(read('css/style.css'), /\.vfx-burst-fireball[\s\S]*?@keyframes vfxFireballExplosion/);
  assert.match(vfx, /function vfxBuildFlareFlame\(parent, small, sizeScale\)/);
  assert.equal(fs.existsSync(path.join(root, 'images', 'flares.png')), true);
  assert.equal(fs.existsSync(path.join(root, 'images', 'flares.json')), true);
  assert.match(renderer, /var outerWidth = isPurple \? \(22 - 13 \* q\) : \(isMega \? \(18 - 12 \* q\) : \(13 - 10\.5 \* q\)\);/);
  assert.match(shim, /area: spec\.area \|\| null/);

  // 連鎖閃電與電紋刻印（紫雷/雷印）斷言
  assert.match(skills, /stormSigil:\s*\{\s*fxKind:\s*'rain',\s*variant:\s*'purple-thunder'\s*\}/);
  assert.match(vfx, /function vfxPurpleThunder\(/);
  assert.match(vfx, /function vfxLightningGroundImpact\(/);
  assert.match(vfx, /variant === 'purple-thunder' \|\| s\.variant === 'storm-sigil'/);
  assert.match(renderer, /function spawnPurpleThunder\(/);
  assert.match(read('css/style.css'), /\.vfx-bolt-mega/);
  assert.match(read('css/style.css'), /\.vfx-bolt-purple/);
  assert.match(read('css/style.css'), /\.vfx-storm-sigil-ring/);
  assert.match(read('css/style.css'), /\.vfx-lightning-ground-ring/);
});
