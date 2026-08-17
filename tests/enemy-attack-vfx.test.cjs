const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('敵人出手 VFX 由攻擊結算事件驅動，不依賴死亡後快照', () => {
  const combat = read('js/combat.js');
  const renderer = read('js/battle-renderer.js');

  assert.match(combat, /fxKind: 'enemy-attack'/);
  assert.match(combat, /sourceId: enemyAttackSourceId\(mEnt, floatSel\)/);
  assert.match(renderer, /function renderEnemyAttackVfx\(spec\)/);
  assert.match(renderer, /if \(!isEnemyAttack\) spec\.delayMs = \(spec\.delayMs \|\| 0\) \+ POS_BUFFER_MS/);
  assert.doesNotMatch(renderer, /if \(alive && ent\.state === 'idle' && d\.atkCd > prevCd \+ 0\.15\) enemyAttackAnim\(ent\)/);
});

test('Canvas 與 DOM 都有敵人近戰／遠程攻擊事件路徑', () => {
  const renderer = read('js/battle-renderer.js');
  const vfx = read('js/vfx.js');

  assert.match(renderer, /if \(isEnemyAttack\) \{\s*renderEnemyAttackVfx\(spec\);\s*return;/);
  assert.match(renderer, /spec\.variant === 'enemy-projectile'/);
  assert.match(renderer, /spawnProjectile\(targetId, travel/);
  assert.match(vfx, /if \(kind === 'enemy-attack' && s\.cat === 'enemy'\)/);
  assert.match(vfx, /vfxProjectile\(s, layer, enemySource, enemyTarget/);
  assert.match(vfx, /vfxSlash\(s, layer, enemyTarget/);
});
