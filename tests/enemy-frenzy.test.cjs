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
  for (const [now, pct] of [[50, 0], [60, 0], [60.99, 0], [61, 1.01], [62, 2.02], [160, 101], [1060, 1010], [1000060, 1010000]]) {
    c.tickEnemyFrenzy([m], now);
    assert.ok(Math.abs(c.enemyFrenzyPct(m, now) - pct) < 1e-8);
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
    c.tickEnemyFrenzy([m], c.GT);
    const cfg = c.monsterAtkCfg(m, 2);
    assert.equal(cfg.atk, 604);
    assert.equal(cfg.elemAtk.fire, 120.8);
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
  const group = [alive, { hp: 1, _spawnAt: 100 }, { hp: 0, _spawnAt: -100 }];
  c.tickEnemyFrenzy(group, 110);
  assert.equal(c.enemyFrenzyAverage(group, 110), 51);
  for (const [now, text, color] of [[10, '0', 'rgb(255, 255, 255)'], [60, '50', 'rgb(255, 128, 128)'], [110, '100', 'rgb(255, 0, 0)'], [1010, '1000', 'rgb(255, 0, 0)']]) {
    const snapshotEnemy = { hp: 1, _spawnAt: 0, _frenzyPct: Number(text) };
    c.renderEnemyFrenzy({ gt: now, field: { monsters: [snapshotEnemy] } }, {});
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

test('數量按當秒累加，死亡不計、寬限與進場仍計，減少敵人不回扣', () => {
  const c = context();
  const m = { hp: 1, _spawnAt: 0 };
  const young = Array.from({ length: 99 }, () => ({ hp: 1, _spawnAt: 10, _enterCd: 1 }));
  const dead = { hp: 0, _spawnAt: 0 };
  c.tickEnemyFrenzy([m, ...young, dead], 11);
  assert.equal(c.enemyFrenzyPct(m, 11), 2);
  assert.equal(c.enemyFrenzyPct(young[0], 11), 0);
  c.tickEnemyFrenzy([m, ...young, dead], 11.9);
  assert.equal(c.enemyFrenzyPct(m, 11.9), 2);
  young.slice(49).forEach(e => { e.hp = 0; });
  c.tickEnemyFrenzy([m, ...young, dead], 12);
  assert.equal(c.enemyFrenzyPct(m, 12), 3.5);
  c.tickEnemyFrenzy([m], 13);
  assert.equal(c.enemyFrenzyPct(m, 13), 4.51);
  c.tickEnemyFrenzy([m], 13);
  assert.equal(c.enemyFrenzyPct(m, 13), 4.51, '重複Tick／暫停不重複增加');
  assert.equal(c.enemyFrenzyPct(dead, 13), 0);
  const snapshot = JSON.parse(JSON.stringify(m));
  assert.equal(c.enemyFrenzyAverage([snapshot], 1000), 4.51, 'UI讀權威累積值，不按現在數量重算歷史');
});

test('各敵人從自己的出生時間滿秒，野外與高塔Tick均接入累積', () => {
  const c = context(), a = { hp: 1, _spawnAt: 0 }, b = { hp: 1, _spawnAt: 0.5 };
  c.tickEnemyFrenzy([a, b], 11);
  assert.equal(c.enemyFrenzyPct(a, 11), 1.02);
  assert.equal(c.enemyFrenzyPct(b, 11), 0);
  c.tickEnemyFrenzy([a, b], 11.5);
  assert.equal(c.enemyFrenzyPct(a, 11.5), 1.02);
  assert.equal(c.enemyFrenzyPct(b, 11.5), 1.02);
  assert.match(fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8'), /function fieldTick\(dt\)[\s\S]*?tickEnemyFrenzy\(fieldEnemyList\(\), GT\)/);
  assert.match(fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8'), /tickEnemyFrenzy\(TOWER\.boss \? \[TOWER\.boss\] : \[\], GT\)/);
});

test('真實野外與高塔Tick在暫停演出行動時仍同步出生計時增傷', () => {
  const c = context();
  vm.runInContext(fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8'), c);
  c.G = { tower: { active: false } };
  c.GT = 11;
  c.getStats = () => ({});
  c.tickSkillCds = () => {};
  c.sgTickEarthguardRevival = () => {};
  c.FIELD.player = { _sgRevival: { mode: 'earthguard' } };
  c.FIELD.monsters = [{ hp: 1, _spawnAt: 0 }, { hp: 1, _spawnAt: 10 }];
  c.fieldTick(0.1);
  assert.equal(c.FIELD.monsters[0]._frenzyPct, 1.02);
  assert.equal(c.enemyFrenzyPct(c.FIELD.monsters[1], c.GT), 0);
  c.G.tower.active = true;
  c.TOWER.boss = { hp: 1, _spawnAt: 0 };
  c.TOWER.player = c.FIELD.player;
  c.TOWER.introCd = 1;
  c.towerTick(0.1);
  assert.equal(c.TOWER.boss._frenzyPct, 1.01);
  assert.equal(c.TOWER.introCd, 0.9);
});
