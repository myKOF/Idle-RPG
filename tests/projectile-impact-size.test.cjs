const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/* 命中爆點的環：
   1. 建立當下就要有起始尺寸。特效主迴圈反向走訪 S.fx，而投射物命中的爆點是在
      別的特效 update() 裡生出來的，那一幀必定不會被 update；少了起始 scale，
      第一幀就會把整張 128px 環形貼圖原尺寸畫出來（飛刀彈射時滿畫面大圈）。
   2. 彈射命中與一般命中同尺寸：不得再有 bounce 專用的縮放分流。 */
test('命中爆點的環在建立時就設好起始尺寸，且彈射與一般命中同尺寸', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');
  const css = read('css/style.css');

  assert.match(renderer, /function spawnImpact\(x, y, spec, strong, targetGuard\)/);
  assert.match(renderer, /ring\.anchor\.set\(0\.5\);[\s\S]*?ring\.scale\.set\(1\.3 \/ RING_TEX_RADIUS\);/);
  assert.match(renderer, /ring\.scale\.set\(\(1\.3 \+ maxR \* k\) \/ RING_TEX_RADIUS\)/);
  assert.match(renderer, /spawnParticles\(x, y, fireExplosion \? 22 : \(strong \? 12 : 6\), theme,[\s\S]*fireExplosion \? 1\.45 : 1(?:, targetGuard)?\)/);
  assert.match(renderer, /spawnImpact\(pt\.x, pt\.y, spec, false\);\s*\n\s*hitReact\(toId, spec\.elem, false\);/);
  assert.doesNotMatch(renderer, /BOUNCE_HIT_RADIUS_SCALE|isBounceHit|impactScale/);

  assert.match(renderer, /function spawnParticles\(x, y, count, theme, speed, radiusScale, targetGuard\)/);
  assert.match(renderer, /g\.scale\.set\(r \* particleScale \/ DOT_TEX_RADIUS\)/);
  assert.match(renderer, /var t = 0, dur = 0\.24, R = big \? 54 : 36;/);
  assert.doesNotMatch(renderer, /slashScale/);
  assert.doesNotMatch(renderer, /if \(strong && canJolt\) addShake\(4\)/);

  assert.match(vfx, /function vfxImpact\(spec, layer, pt, targetId, delayMs, targetGuard\)/);
  assert.doesNotMatch(vfx, /VFX_BOUNCE_HIT_RADIUS_SCALE|isBounceHit/);
  assert.doesNotMatch(vfx, /--vfx-hit-scale/);
  assert.match(vfx, /pathStart \+ pathFlight\);/);

  const impactBlock = css.match(/\.vfx-impact \{([\s\S]*?)\n\}/);
  assert.ok(impactBlock, 'vfx-impact CSS block should exist');
  assert.doesNotMatch(impactBlock[1], /--vfx-hit-scale/);
  const slashBlock = css.match(/\.vfx-slash \{([\s\S]*?)\n\}/);
  assert.ok(slashBlock, 'vfx-slash CSS block should exist');
  assert.doesNotMatch(slashBlock[1], /--vfx-hit-scale/);
});
