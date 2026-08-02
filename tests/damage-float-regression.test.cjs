const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const combat = fs.readFileSync(path.join(root, 'js', 'combat.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function functionBody(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('敵人浮字識別碼在陣列重排後保持穩定', () => {
  const context = { FIELD_ENEMY_FLOAT_SEQ: 0 };
  vm.runInNewContext(functionBody(combat, 'markFieldEnemyFloatTargets'), context);

  const first = {};
  const second = {};
  context.markFieldEnemyFloatTargets([first, second]);
  const secondId = second.floatSel;
  context.markFieldEnemyFloatTargets([second]);

  assert.equal(first.floatSel, 'mv-float-0');
  assert.equal(secondId, 'mv-float-1');
  assert.equal(second.floatSel, secondId);
});

test('敵人卡片重建會依穩定浮字圖層識別碼保留舊節點', () => {
  assert.match(ui, /function enemyFloatLayerId\(enemy, index\)/);
  assert.match(ui, /function ensureRetainedEnemyFloatLayer\(party\)/);
  assert.match(ui, /function rebuildEnemyParty\(party, html\)/);
  assert.match(ui, /while \(oldLayer\.firstChild\) nextLayer\.appendChild\(oldLayer\.firstChild\)/);
  assert.match(ui, /retained\.appendChild\(oldLayer\)/);
  assert.match(ui, /party\.parentNode && typeof party\.parentNode\.appendChild === 'function' \? party\.parentNode : party/);
  assert.match(ui, /container\.querySelectorAll\('\.enemy-card \.float-layer, \.enemy-float-retained > \.float-layer'\)/);
  assert.match(ui, /enemy-float-retained > \.float-layer/);
  assert.match(ui, /enemyFloatLayerId\(enemy, index\) \+ ':'/);
  assert.match(ui, /id="' \+ enemyFloatLayerId\(enemy, ei\) \+ '"/);
  assert.match(ui, /rebuildEnemyParty\(party, partyHtml\)/);
});

test('敵人批次死亡重建時，保留層位於 mv-party 外部', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="mv-party"[\s\S]*?id="mv-float-retained"/);
  assert.match(ui, /host\.parentNode === party\) container\.appendChild\(host\)/);
});

test('浮字不再以固定 50 個節點刪除尚未播完的傷害', () => {
  assert.doesNotMatch(ui, /normalFloats\.length\s*>=\s*50/);
  assert.doesNotMatch(ui, /floatOpacity\s*<=\s*0\.05/);
  assert.match(ui, /Each float has its own removal timer/);
});

test('浮字定位量測時包含 translate(-50%)，並限制在戰鬥容器內', () => {
  assert.match(ui, /var oldTransform = sp\.style\.transform;/);
  assert.match(ui, /sp\.style\.transform = 'translate\(-50%, 0\)'/);
  assert.match(ui, /sp\.style\.transform = oldTransform;/);
  assert.match(ui, /layer\.closest\('#combat-area'\)/);
  assert.match(ui, /placedRect\.left < clipRect\.left/);
  assert.match(ui, /placedRect\.right > clipRect\.right/);
});

test('Worker 事件佇列滿載時不丟棄傷害浮字', () => {
  const shim = fs.readFileSync(path.join(root, 'js', 'worker', 'shim.js'), 'utf8');
  assert.match(shim, /var SHIM_EVENT_CAP = 400;/);
  assert.match(shim, /if \(kind !== 'float'\)/);
  assert.doesNotMatch(shim, /if \(_shimEvents\.length >= SHIM_EVENT_CAP\) \{[\s\S]*?_shimEvents\.shift\(\)/);
  assert.match(shim, /_shimEvents\[di\]\.kind !== 'float'/);
});

test('狀態切換不清空浮字，只重置 MISS 節流狀態', () => {
  const clearStart = ui.indexOf('function clearFloatLayer(');
  const clearEnd = ui.indexOf('function clearTowerFloatLayers(', clearStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  const clearBody = ui.slice(clearStart, clearEnd);
  assert.doesNotMatch(clearBody, /innerHTML\s*=\s*['"]['"]/);
  assert.doesNotMatch(clearBody, /removeChild\(/);
  assert.match(clearBody, /removeAttribute\('data-last-miss-at'\)/);
});

test('大量敵人浮字只關閉昂貴碰撞量測，不限制或刪除浮字節點', () => {
  assert.match(ui, /var ENEMY_FLOAT_LAYOUT_LOAD_LIMIT = 80;/);
  assert.match(ui, /totalEnemyFloats > ENEMY_FLOAT_LAYOUT_LOAD_LIMIT/);
  assert.match(ui, /仍建立每一個數字，只略過碰撞避讓/);
  assert.doesNotMatch(ui, /normalFloats\.length\s*>\s*50/);
});
