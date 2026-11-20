'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEliteEnv, makeElite } = require('./helpers/elite-env.cjs');

function setup(floor) {
  const c = loadEliteEnv();
  c.Math.random = () => .5;
  const stats = { ...c.getStats(), hp: 1e20, mp: 1e10 };
  c.getStats = () => stats;
  c.G.player.gold = 1e30; c.G.tower.highest = 150;
  c.startTowerFight(floor);
  const boss = c.TOWER.boss;
  boss.hp = boss.maxHp = c.TOWER.player.hp = c.TOWER.player.maxHp = 1e20;
  c.doPlayerAttack = () => ({ dmg: 0, killed: false });
  c.doMonsterAttack = () => ({ dmg: 0 });
  c.pickAndCastSkill = () => null; c.tickSkillSchedulers = () => {};
  const events = [];
  c.emitEnemyAct = (act, b) => events.push({ act, gap: c.bfEntityDistance(b), range: c.bfEnemyAttackRange(b) });
  Object.keys(boss._el.cd).forEach(id => { boss._el.cd[id] = 0; });
  return { c, boss, events, step() { c.GT += .1; c.towerTick(.1); } };
}

for (const floor of [3, 4]) {
  test('floor ' + floor + ': ready opening skills cannot stop the boss outside attack range', () => {
    const s = setup(floor), { c, boss, events } = s;
    c.TOWER.introCd = 0;
    const start = { player: c.TOWER.playerPos.x, boss: boss.pos.x };
    s.step();
    assert.ok(boss.pos.x < start.boss, 'boss actively runs toward the player on the first step');
    assert.ok(c.TOWER.playerPos.x > start.player, 'player also approaches');
    assert.equal(events.length, 0, 'no distant cast may hold the boss in place');
    assert.equal(c.towerBossActionLocked(boss), false);
    assert.ok(Object.keys(boss._el.cd).some(id => boss._el.cd[id] < 0), 'cooldowns still advance while approaching');
    for (let i = 0; i < 80 && !events.length; i++) s.step();
    assert.ok(events.length > 0, 'normal actions start after closing the distance');
    assert.ok(events[0].gap <= events[0].range, 'the first action is within the configured attack range');
  });
}

test('the opening cast gate does not change wild NPC behavior', () => {
  const c = loadEliteEnv();
  const wild = makeElite(c, ['e_missile'], { x: 800 });
  wild._alerted = true; wild._el.cd.e_missile = 0;
  c.eliteTick(.1);
  assert.ok(wild._el.busyUntil > c.GT, 'wild NPC may still cast at its original distance');
});

test('tower combatants detect each other up to 200 meters without changing wild search or attack range', () => {
  const { c, boss } = setup(3);
  const nativeAttackRange = boss.atkRange;
  c.TOWER.playerPos.x = 0; c.TOWER.playerPos.y = 0;
  assert.equal(boss.sightRange, c.bfMeterPx(200));
  for (const meters of [150, 200, 201]) {
    boss.pos = { x: c.bfMeterPx(meters), y: 0 }; boss._alerted = false;
    assert.equal(c.bfPickPlayerTarget([boss], null), meters <= 200 ? boss : null);
    assert.equal(c.bfEnemyAlerted(boss), meters <= 200);
    assert.equal(c.bfInAttackRange(boss), false, 'detection does not grant a distant attack');
  }
  assert.equal(boss.atkRange, nativeAttackRange);
  c.G.tower.active = false; boss.pos.x = c.bfMeterPx(150);
  assert.equal(c.bfPickPlayerTarget([boss], null), null, 'wild player search remains capped at 100 meters');
});
