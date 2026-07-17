const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('高塔傷害飄字會在沒有新傷害後清理，且進場會清除上一場殘留', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js', 'tower.js'), 'utf8');
  const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');

  assert.match(ui, /function clearFloatLayer\(elId\)/);
  assert.match(ui, /function clearTowerFloatLayers\(\)/);
  assert.match(ui, /existing\._damageFloatTotal \+= damageValue;[\s\S]*?scheduleFloatTextRemoval\(existing, FLOAT_TEXT_LIFETIME_MS\)/);
  assert.match(ui, /layer\.appendChild\(sp\);[\s\S]*?scheduleFloatTextRemoval\(sp, FLOAT_TEXT_LIFETIME_MS\);/);
  assert.match(tower, /if \(typeof clearTowerFloatLayers === 'function'\) clearTowerFloatLayers\(\);/);
  assert.match(combat, /if \(COMBAT_PAUSED && typeof clearTowerFloatLayers === 'function'[\s\S]*?clearTowerFloatLayers\(\);/);
});

test('停止戰鬥時高塔倒數固定，不再由逐幀動畫反覆重設', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

  assert.match(ui, /var paused = typeof isCombatPaused === 'function' && isCombatPaused\(\);[\s\S]*?if \(paused\) UI\.towerTimerAnchor = null;/);
  assert.match(ui, /if \(paused\) \{[\s\S]*?UI\.towerTimerRaf = 0;[\s\S]*?return;[\s\S]*?\}\n  UI\.towerTimerRaf = scheduleTowerTimerFrame\(\);/);
  assert.match(ui, /if \(paused\) \{[\s\S]*?stopTowerTimerAnimation\(\);[\s\S]*?renderTowerTimerFrame\(\);/);
  assert.match(ui, /if \(!UI\.towerTimerAnchor \|\| UI\.towerTimerAnchor\.elapsed !== TOWER\.elapsed\)/);
});
