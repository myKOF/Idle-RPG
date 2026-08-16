const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('一般投射物與彈射目標命中回饋縮為原半徑的三分之一', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');
  const css = read('css/style.css');

  assert.match(renderer, /var PROJECTILE_HIT_RADIUS_SCALE = 1 \/ 3/);
  assert.doesNotMatch(renderer, /if \(strong && canJolt\) addShake\(4\)/);
  assert.match(renderer, /function isSpecialScreenShakeSpec\(spec\)/);
  assert.match(renderer, /\(1\.3 \+ maxR \* k\) \* impactScale \/ RING_TEX_RADIUS/);
  assert.match(renderer, /var t = 0, dur = 0\.24, R = \(big \? 54 : 36\) \* slashScale/);
  assert.match(renderer, /spec\.variant === 'knife-bounce'[\s\S]*?spawnImpact\(pt\.x, pt\.y, spec, false\)/);

  assert.match(vfx, /var VFX_PROJECTILE_HIT_RADIUS_SCALE = 1 \/ 3/);
  assert.match(vfx, /if \(!strong\) d\.style\.setProperty\('--vfx-hit-scale', String\(VFX_PROJECTILE_HIT_RADIUS_SCALE\)\)/);
  assert.match(vfx, /function vfxKnifeBounce\([\s\S]*?vfxProjectile\(next, layer, from, to, delayMs, travelMs\)/);
  assert.match(vfx, /spec\.variant === 'poison-spread'[\s\S]*?vfxImpact\(/);

  assert.match(css, /\.vfx-slash \{[\s\S]*?scale\(var\(--vfx-hit-scale, 1\)\)/);
  assert.match(css, /\.vfx-impact \{[\s\S]*?transform: scale\(var\(--vfx-hit-scale, 1\)\)/);
});
