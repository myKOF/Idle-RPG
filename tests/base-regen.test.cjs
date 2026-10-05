const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

const load = () => createEngine({ seed: 9 }).boot(null).ctx;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const row = (c, name) => c.STAT_GROUPS.flatMap(g => g.rows).find(r => r[0].includes(name));

test('新角色：生命基礎每秒5、法力基礎每秒1，智力加成另行累加', () => {
  const c = load(), st = c.computeStats();
  assert.equal(st.hpRegen, 0);
  assert.equal(c.playerHpRegenPerSec(st), 5);
  assert.equal(c.DERIVED_COEF.mpRegenBase, 1);
  near(st.mpRegen, 1.02);
  assert.equal(c.playerMpRegenPerSec({ mpRegen: 1 }), 1);
});

test('最大生命／法力大幅變動不改回復；裝備回復與智力加成仍累加', () => {
  const c = load(), bare = c.computeStats();
  c.G.equipment.helmet = { affixes: [{ key: 'hpFlat', val: 1000000 }, { key: 'mpFlat', val: 1000000 }], sockets: [], enchants: [] };
  const larger = c.computeStats();
  assert.ok(larger.hp > bare.hp * 1000);
  assert.ok(larger.mp > bare.mp * 1000);
  assert.equal(c.playerHpRegenPerSec(larger), 5);
  assert.equal(larger.mpRegen, bare.mpRegen);
  c.G.equipment.helmet.affixes.push({ key: 'hpRegen', val: 7 }, { key: 'mpRegen', val: 3 }, { key: 'int', val: 100 });
  const geared = c.computeStats();
  assert.equal(c.playerHpRegenPerSec(geared), 12);
  near(geared.mpRegen, 4.42);
});

test('正式Worker野外Tick：實際生命入帳與面板共用定值，回復仍夾資源上限', () => {
  const c = load();
  c.holdFieldSpawn(10);
  const p = c.FIELD.player, st = c.getStats();
  p.hp = 10; p.mp = 10;
  c.fieldTick(0.1);
  near(p.hp, 10.5); near(p.mp, 10.102);
  const panel = c.buildPanel('header').stats;
  assert.equal(panel.passivePanel.hpRegen, 5);
  near(panel.passivePanel.mpRegen, st.mpRegen);
  assert.equal(row(c, '生命恢復')[1](panel), c.statFmt(5, null, '/s'));
  p.hp = st.hp - 0.1; p.mp = st.mp - 0.01;
  c.fieldTick(0.1);
  assert.equal(p.hp, st.hp); assert.equal(p.mp, st.mp);
});

test('面板舊快照／預覽與技能倍率：最大生命不參與計算，顯示不再用百分比', () => {
  const c = load();
  c.G.player.level = 1000;
  c.G.player.skills2 = { levels: { earthguard: Array(7).fill(10) }, ult: {} };
  c.G.player.loadout = ['sg:earthguard'];
  const st = { ...c.computeStats(), hpRegen: 7, mpRegen: 3 };
  const snap = JSON.parse(JSON.stringify(c.playerPanelStats(st)));
  assert.equal(snap.passivePanel.hpRegen, 24);
  assert.equal(snap.passivePanel.mpRegen, 6);
  const preview = c.playerPanelStats({ ...st, hp: st.hp * 100 });
  assert.equal(preview.passivePanel.hpRegen, 24);
  delete c.G;
  assert.equal(row(c, '生命恢復')[1](snap), c.statFmt(24, null, '/s'));
  assert.equal(row(c, '生命恢復')[1](st), c.statFmt(12, null, '/s'));
  assert.match(row(c, '生命恢復')[2](), /基礎 5 點/);
  assert.doesNotMatch(row(c, '生命恢復')[2](), /%/);
  assert.equal(c.playerHpRegenBasePerSec(null), 0);
});

test('高塔仍只有額外生命回復，法力共用新的基礎值', () => {
  const c = load(), st = c.getStats();
  c.G.player.gold = 1e9;
  c.startTowerFight(1);
  c.TOWER.introCd = 0;
  const p = c.TOWER.player;
  p.hp = 10; p.mp = 10;
  p.effects = { stun: c.GT + 10 };
  c.TOWER.boss.effects = { stun: c.GT + 10 };
  c.towerTick(0.1);
  near(p.hp, 10); near(p.mp, 10 + st.mpRegen * 0.1);
});
