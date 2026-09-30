const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context() {
  const c = { console, UI: { dirty: {} }, blog() {}, document: { getElementById() { return null; } } };
  c.window = c;
  vm.createContext(c);
  for (const f of ['util', 'data', 'status', 'formula', 'battlefield', 'combat']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), c);
  }
  return c;
}
test('出生寬限、完整秒邊界與無上限累加', () => {
  const c = context(), m = { _spawnAt: 50, hp: 1 };
  for (const [now, pct] of [[50, 0], [60, 0], [60.99, 0], [61, 1], [62, 2], [160, 100], [1060, 1000], [1000060, 1000000]]) {
    assert.equal(c.enemyFrenzyPct(m, now), pct);
  }
  assert.equal(c.enemyFrenzyPct({}, 1000), 0);
  const worker = fs.readFileSync(path.join(root, 'js/worker/sim.worker.js'), 'utf8');
  assert.match(worker, /if \(!combatPaused\) GT \+= dt/, '暫停不推進狂暴化使用的GT');
});
test('物理、魔法與元素攻擊共用狂暴化，與既有重擊乘算且不污染敵人', () => {
  const c = context();
  c.GT = 210;
  for (const magic of [false, true]) {
    const m = { _spawnAt: 0, hp: 1, atk: 100, level: 1, magic, elemAtk: { fire: 20 }, effects: {}, buffs: {} };
    const cfg = c.monsterAtkCfg(m, 2);
    assert.equal(cfg.atk, 600);
    assert.equal(cfg.elemAtk.fire, 120);
    assert.equal(cfg.dmgType, magic ? 'magic' : 'phys');
    assert.equal(m.atk, 100);
    assert.equal(m.elemAtk.fire, 20);
  }
});
test('平均只算存活敵人，UI白到紅並保持無上限文字，高塔選當前BOSS', () => {
  const c = context();
  const el = { style: {} };
  c.$id = () => el;
  c.setTextIfChanged = (e, text) => e.textContent = text;
  c.setStyleIfChanged = (e, k, value) => e.style[k] = value;
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  vm.runInContext(ui.slice(ui.indexOf('function renderEnemyFrenzy('), ui.indexOf('function renderBattle()')), c);
  const alive = { hp: 1, _spawnAt: 0 };
  assert.equal(c.enemyFrenzyAverage([alive, { hp: 1, _spawnAt: 100 }, { hp: 0, _spawnAt: -100 }], 110), 50);
  for (const [now, text, color] of [[10, '0', 'rgb(255, 255, 255)'], [60, '50', 'rgb(255, 128, 128)'], [110, '100', 'rgb(255, 0, 0)'], [1010, '1000', 'rgb(255, 0, 0)']]) {
    c.renderEnemyFrenzy({ gt: now, field: { monsters: [alive] } }, {});
    assert.equal(el.textContent, '狂暴化：' + text + '%');
    assert.equal(el.style.color, color);
  }
  c.renderEnemyFrenzy({ gt: 110, field: { monsters: [alive] }, tower: { boss: { hp: 1, _spawnAt: 100 } } }, { towerActive: true });
  assert.equal(el.textContent, '狂暴化：0%');
  c.renderEnemyFrenzy({ gt: 110, field: { monsters: [{ hp: 0, _spawnAt: 0 }] } }, {});
  assert.equal(el.textContent, '狂暴化：0%');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="battle-frenzy"[^>]*right:12px;top:44px/);
  assert.match(ui, /renderEnemyFrenzy\(battleSnapshot, view\)/);
  assert.match(fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8'), /TOWER\.boss = makeBoss\(floor\);\s*TOWER\.boss\._spawnAt = GT/);
});
