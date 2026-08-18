const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Canvas 投射物預判移動目標，接近目標時可提前命中', () => {
  const renderer = read('js/battle-renderer.js');

  assert.match(renderer, /function projectileTargetVelocity\(targetId\)[\s\S]*?samples\.length < 2/);
  assert.match(renderer, /function projectileTargetPoint\(targetId, horizonSec\)[\s\S]*?velocity\.x \* horizon/);
  assert.match(renderer, /function projectileNearTarget\(x, y, targetId\)[\s\S]*?radius \* radius/);

  const projectile = renderer.slice(
    renderer.indexOf('function spawnProjectile('),
    renderer.indexOf('function spawnBarrageMissile(')
  );
  assert.match(projectile, /var to = path \? targetNow : projectileTargetPoint\(targetId, Math\.max\(0, dur - t\)\);/);
  assert.match(projectile, /if \(k >= 1 \|\| \(!path && projectileNearTarget\(node\.x, node\.y, targetId\)\)\)/);
  assert.doesNotMatch(projectile, /var to = posOf\(targetId\);/);

  const barrage = renderer.slice(
    renderer.indexOf('function spawnBarrageMissile('),
    renderer.indexOf('function spawnTrailDot(')
  );
  assert.match(barrage, /var targetAim = projectileTargetPoint\(targetId, Math\.max\(0, dur - t\)\);/);
  assert.match(barrage, /if \(k >= 1 \|\| projectileNearTarget\(x, y, targetId\)\)/);
});
