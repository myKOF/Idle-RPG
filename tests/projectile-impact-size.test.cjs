const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('一般受擊維持原尺寸，只有飛刀與血刃斬彈射命中縮為三分之一', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');
  const css = read('css/style.css');

  assert.match(renderer, /var BOUNCE_HIT_RADIUS_SCALE = 1 \/ 3/);
  assert.match(renderer, /function spawnParticles\(x, y, count, theme, speed, radiusScale\)/);
  assert.match(renderer, /g\.scale\.set\(r \* particleScale \/ DOT_TEX_RADIUS\)/);
  assert.match(renderer, /function spawnImpact\(x, y, spec, strong, isBounceHit\)/);
  assert.match(renderer, /var impactScale = isBounceHit \? BOUNCE_HIT_RADIUS_SCALE : 1/);
  assert.match(renderer, /ring\.scale\.set\(\(1\.3 \+ maxR \* k\) \* impactScale \/ RING_TEX_RADIUS\)/);
  assert.match(renderer, /spawnParticles\(x, y, strong \? 12 : 6, theme, strong \? 0\.9 : 0\.55, impactScale\)/);
  assert.match(renderer, /spawnImpact\(pt\.x, pt\.y, spec, false, true\)/);
  assert.match(renderer, /var t = 0, dur = 0\.24, R = big \? 54 : 36;/);
  assert.doesNotMatch(renderer, /slashScale/);
  assert.doesNotMatch(renderer, /if \(strong && canJolt\) addShake\(4\)/);

  assert.match(vfx, /var VFX_BOUNCE_HIT_RADIUS_SCALE = 1 \/ 3/);
  assert.match(vfx, /function vfxImpact\(spec, layer, pt, targetId, delayMs, isBounceHit\)/);
  assert.match(vfx, /if \(isBounceHit\) d\.style\.setProperty\('--vfx-hit-scale', String\(VFX_BOUNCE_HIT_RADIUS_SCALE\)\)/);
  assert.doesNotMatch(vfx, /if \(!strong\) d\.style\.setProperty\('--vfx-hit-scale'/);
  assert.match(vfx, /pathStart \+ pathFlight, true\);/);

  assert.match(css, /\.vfx-impact \{[\s\S]*?transform: scale\(var\(--vfx-hit-scale, 1\)\)/);
  const slashBlock = css.match(/\.vfx-slash \{([\s\S]*?)\n\}/);
  assert.ok(slashBlock, 'vfx-slash CSS block should exist');
  assert.doesNotMatch(slashBlock[1], /--vfx-hit-scale/);
});
