const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context() {
  const c = { console, UI: { dirty: {} }, blog() {}, document: { getElementById() { return null; } } };
  c.window = c;
  vm.createContext(c);
  for (const f of ['util', 'strings_data', 'strings', 'data', 'status', 'formula', 'battlefield', 'combat']) {
    vm.runInContext(readExpanded(path.join(root, 'js', f + '.js')), c);
  }
  return c;
}
test('出生寬限、完整秒邊界與無上限累加', () => {
  const c = context(), m = { _spawnAt: 50, hp: 1 };
  for (const [now, pct] of [[50, 0], [60, 0], [60.99, 0], [61, 1], [62, 2], [160, 100], [1060, 1000], [1000060, 1000000]]) {
    c.tickEnemyFrenzy([m], now);
    assert.ok(Math.abs(c.enemyFrenzyPct(m, now) - pct) < 1e-8);
  }
  assert.equal(c.enemyFrenzyPct({}, 1000), 0);
  const worker = readExpanded(path.join(root, 'js/worker/sim.worker.js'));
  assert.match(worker, /if \(!combatPaused\) GT \+= dt/, '暫停不推進狂暴化使用的GT');
});
test('物理、魔法與元素攻擊共用狂暴化，與既有重擊乘算且不污染敵人', () => {
  const c = context();
  c.GT = 210;
  for (const magic of [false, true]) {
    const m = { _spawnAt: 0, hp: 1, atk: 100, level: 1, magic, elemAtk: { fire: 20 }, effects: {}, buffs: {} };
    c.tickEnemyFrenzy([m], c.GT);
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
  const ui = readExpanded(path.join(root, 'js/ui.js'));
  vm.runInContext(ui.slice(ui.indexOf('function renderEnemyFrenzy('), ui.indexOf('function renderBattle()')), c);
  const alive = { hp: 1, _spawnAt: 0 };
  const group = [alive, { hp: 1, _spawnAt: 100 }, { hp: 0, _spawnAt: -100 }];
  c.tickEnemyFrenzy(group, 110);
  assert.equal(c.enemyFrenzyAverage(group, 110), 50);
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
  const html = readExpanded(path.join(root, 'index.html'));
  assert.match(html, /id="battle-frenzy"[^>]*right:12px;top:44px/);
  assert.match(html, /id="battle-frenzy"[^>]*pointer-events:auto/);
  assert.match(html, /id="battle-frenzy"[^>]*data-tt-title="狂暴化"[^>]*data-tt-desc="敵人在場上存在時間越久會逐漸提升其強度"/);
  assert.match(ui, /renderEnemyFrenzy\(battleSnapshot, view\)/);
  assert.match(readExpanded(path.join(root, 'js/tower.js')), /TOWER\.boss = makeBoss\(floor\);\s*TOWER\.boss\._spawnAt = GT/);
});

test('交戰數量30不加速、31加倍，更多敵人維持加倍，死亡降回門檻不回扣', () => {
  const c = context();
  const m = { hp: 1, _spawnAt: 0, atk: 100, elemAtk: { fire: 20 }, effects: {}, buffs: {} };
  const young = Array.from({ length: 29 }, () => ({ hp: 1, _spawnAt: 10 }));
  const dead = { hp: 0, _spawnAt: 0 };
  c.tickEnemyFrenzy([m, ...young, dead], 11);
  assert.equal(c.enemyFrenzyPct(m, 11), 1);
  assert.equal(c.enemyFrenzyPct(young[0], 11), 0);
  young.push({ hp: 1, _spawnAt: 11 });
  c.tickEnemyFrenzy([m, ...young, dead], 11.9);
  assert.equal(c.enemyFrenzyPct(m, 11.9), 1, '未滿秒不因數量增加提前累積');
  c.tickEnemyFrenzy([m, ...young, dead], 12);
  assert.equal(c.enemyFrenzyPct(m, 12), 3, '寬限中的交戰敵人也計數');
  const extra = Array.from({ length: 70 }, () => ({ hp: 1, _spawnAt: 12 }));
  c.tickEnemyFrenzy([m, ...young, ...extra, dead], 13);
  assert.equal(c.enemyFrenzyPct(m, 13), 5, '超過門檻固定每秒+2%');
  young[29].hp = 0;
  c.tickEnemyFrenzy([m, ...young, dead], 14);
  assert.equal(c.enemyFrenzyPct(m, 14), 6);
  c.tickEnemyFrenzy([m], 15);
  assert.equal(c.enemyFrenzyPct(m, 15), 7);
  c.tickEnemyFrenzy([m], 15);
  assert.equal(c.enemyFrenzyPct(m, 15), 7, '重複Tick／暫停不重複增加');
  assert.equal(c.enemyFrenzyPct(dead, 15), 0);
  c.GT = 15;
  assert.equal(c.monsterAtkCfg(m).atk, 107, '傷害使用同一權威累積值');
  const snapshot = JSON.parse(JSON.stringify(m));
  assert.equal(c.enemyFrenzyAverage([snapshot], 1000), 7, 'UI讀權威累積值，不按現在數量重算歷史');
  const el = { style: {} };
  c.$id = () => el;
  c.setTextIfChanged = (e, text) => e.textContent = text;
  c.setStyleIfChanged = (e, k, value) => e.style[k] = value;
  const ui = readExpanded(path.join(root, 'js/ui.js'));
  vm.runInContext(ui.slice(ui.indexOf('function renderEnemyFrenzy('), ui.indexOf('function renderBattle()')), c);
  c.renderEnemyFrenzy({ gt: 1000, field: { monsters: [snapshot] } }, {});
  assert.equal(el.textContent, '狂暴化：7%');
});

test('門檻排除未交戰視野外敵人及進場倒數，已警戒後離開視野仍計數', () => {
  const c = context();
  const active = Array.from({ length: 30 }, () => ({ hp: 1, _spawnAt: 0, sightRange: 10, _alerted: true }));
  const idle = Array.from({ length: 40 }, (_, i) => ({
    hp: 1, _spawnAt: 0, sightRange: 10, _alerted: false,
    _encounterKey: i < 20 ? 'distant' : undefined, x: 10000, y: 10000
  }));
  const entering = { hp: 1, _spawnAt: 0, _enterCd: 1, _alerted: true };
  const group = [...active, ...idle, entering, null, { hp: 0, _alerted: true }];
  c.tickEnemyFrenzy(group, 11);
  assert.equal(active[0]._frenzyPct, 1);
  assert.equal(c.enemyFrenzyPct(idle[0], 11), 0);
  c.GT = 11;
  c.bfAlertEnemy(idle[0]);
  c.tickEnemyFrenzy(group, 12);
  assert.equal(active[0]._frenzyPct, 3, '已交戰的遠方敵人計數');
  assert.equal(c.enemyFrenzyPct(idle[0], 12), 0, '預置敵人從交戰起仍有寬限');
  idle[0].hp = 0;
  c.tickEnemyFrenzy(group, 13);
  assert.equal(active[0]._frenzyPct, 4);
  entering._enterCd = 0;
  c.tickEnemyFrenzy(group, 14);
  assert.equal(active[0]._frenzyPct, 6, '進場完成才推過門檻');
});

test('各敵人從自己的出生時間滿秒，野外與高塔Tick均接入累積', () => {
  const c = context(), a = { hp: 1, _spawnAt: 0 }, b = { hp: 1, _spawnAt: 0.5 };
  c.tickEnemyFrenzy([a, b], 11);
  assert.equal(c.enemyFrenzyPct(a, 11), 1);
  assert.equal(c.enemyFrenzyPct(b, 11), 0);
  c.tickEnemyFrenzy([a, b], 11.5);
  assert.equal(c.enemyFrenzyPct(a, 11.5), 1);
  assert.equal(c.enemyFrenzyPct(b, 11.5), 1);
  assert.match(readExpanded(path.join(root, 'js/combat.js')), /function fieldTick\(dt\)[\s\S]*?tickEnemyFrenzy\(fieldEnemyList\(\), GT\)/);
  assert.match(readExpanded(path.join(root, 'js/tower.js')), /tickEnemyFrenzy\(TOWER\.boss \? \[TOWER\.boss\] : \[\], GT\)/);
});

test('真實野外與高塔Tick在暫停演出行動時仍同步出生計時增傷', () => {
  const c = context();
  vm.runInContext(readExpanded(path.join(root, 'js/tower.js')), c);
  c.G = { tower: { active: false } };
  c.GT = 11;
  c.getStats = () => ({});
  c.tickSkillCds = () => {};
  c.sgTickEarthguardRevival = () => {};
  c.FIELD.player = { _sgRevival: { mode: 'earthguard' } };
  c.FIELD.monsters = [{ hp: 1, _spawnAt: 0 }, ...Array.from({ length: 30 }, () => ({ hp: 1, _spawnAt: 10 }))];
  c.fieldTick(0.1);
  assert.equal(c.FIELD.monsters[0]._frenzyPct, 2);
  assert.equal(c.enemyFrenzyPct(c.FIELD.monsters[1], c.GT), 0);
  c.G.tower.active = true;
  c.TOWER.boss = { hp: 1, _spawnAt: 0 };
  c.TOWER.player = c.FIELD.player;
  c.TOWER.introCd = 1;
  c.towerTick(0.1);
  assert.equal(c.TOWER.boss._frenzyPct, 1);
  assert.equal(c.TOWER.introCd, 0.9);
});
