'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const b = require('../tools/ult-dps-benchmark.cjs');

test('69 unique enabled ultimates have their five actual legendary effects and identical item affixes', () => {
  assert.equal(b.TARGETS.length, 69);
  assert.equal(new Set(b.TARGETS.map(t => t.ultId)).size, 69);
  const ctx = b.createSimContext();
  const standard = b.buildEquipment(ctx, b.TARGETS[0]);
  for (const t of b.TARGETS) {
    assert.equal(t.affixes.length, 5);
    const eq = b.buildEquipment(ctx, t);
    assert.equal(Object.keys(eq).length, 13);
    for (const slot of ctx.SLOT_LIST) {
      assert.deepEqual(eq[slot].affixes, standard[slot].affixes);
      assert.equal(eq[slot].level, 100);
      assert.equal(eq[slot].rarity, 5);
      assert.equal(eq[slot].upgrade, 40);
    }
  }
});

test('normalized stats reach real combat; all seven tiers and ultimates bypass level gates', () => {
  for (const t of b.TARGETS) {
    const s = b.prepareSimulation(t, 1);
    assert.equal(s.ctx.getStats(), s.pStats);
    assert.equal(s.ctx.sgUlt(t.gid, t.ultId).id, t.ultId);
    assert.equal(s.ctx.skills2Levels(t.gid).join(','), '10,10,10,10,10,10,10');
    assert.equal(s.pStats.atk, 50000);
    assert.equal(s.pStats.matk, 50000);
    assert.equal(s.pStats.critDmg, 5996);
    assert.equal(typeof s.pStats.elemDmgPct, 'object');
    assert.equal(s.ctx.FIELD.player.maxHp, undefined, 'player must not be misclassified as an enemy');
    assert.ok(s.ctx.gmHpLockActive(s.ctx.FIELD.player));
    assert.ok(s.ctx.gmMpLockActive(s.ctx.FIELD.player));
    assert.equal(s.legendaryMultiplier, t.isTwoHand ? s.ctx.TWO_HAND_EFFECT_VALUE_MULT : 1);
    for (const a of t.affixes) assert.equal(s.pStats.legendaryEffectMults[a.id], s.legendaryMultiplier);
  }
});

test('native HP/MP locks prevent lethal direct damage, DOT and skill self-cost interruptions', () => {
  const t = b.TARGETS.find(t => t.ultId === 'doomDance');
  const s = b.prepareSimulation(t, 1);
  const ctx = s.ctx;
  const p = ctx.FIELD.player;
  const initialHp = p.hp;
  const result = ctx.resolveHit(ctx.FIELD.monsters[0], p,
    { atk: 1e15, dmgType: 'phys', level: 300, hit: 100 }, { ...ctx.playerDefCfg(p), dodge: 0, absDodge: 0 });
  assert.equal(result.hpDamage, 0);
  assert.equal(p.hp, initialHp);
  assert.equal(ctx.applyEnemyHpDamage(p, 1e15), 0);
  assert.equal(p.hp, initialHp);
  p.dots = [{ name: 'lethal incoming DOT', until: 1, interval: 0.05, acc: 0, dps: 1e15 }];
  ctx.tickStatuses(p, 0.05);
  assert.equal(p.hp, initialHp);
  p.dots = [];
  // A locked MP pool must allow the 10,000 MP ultimate even with zero current MP.
  p.mp = 0;
  for (let step = 0; step < 800; step++) s.tick(step);
  assert.ok(s.casts['skill2:dualdance'] > 1);
  assert.ok(s.sampleCasts['skill2:dualdance'] > 0);
  assert.equal(s.resources.deaths, 0);
  assert.equal(s.resources.revivalTicks, 0);
  assert.equal(s.resources.minHp, initialHp);
});

test('resource audit rejects a disabled lock and any death or revival immediately', () => {
  const s = b.prepareSimulation(b.TARGETS[0], 1);
  s.ctx.GM_TEST.hpLock = false;
  assert.throws(() => s.tick(0), /Native resource locks disabled/);
  const alive = b.prepareSimulation(b.TARGETS[0], 1);
  assert.throws(() => alive.ctx.onPlayerFieldDeath(), /player died with HP lock/);
  const reviving = b.prepareSimulation(b.TARGETS[0], 1);
  reviving.ctx.fieldTick = () => {};
  reviving.ctx.FIELD.reviveCd = 1;
  assert.throws(() => reviving.tick(0), /revival interrupted benchmark/);
});

test('sampling excludes warmup and end boundary, retaining overkill and source totals', () => {
  const c = b.createDamageCollector(30, 150);
  for (const [time, dmg] of [[29.95, 900], [30, 200], [149.95, 300], [150, 800]]) c.record(time, 'damage', dmg);
  assert.equal(c.total, 500);
  assert.equal(c.events, 2);
  assert.equal(c.sources.damage.damage, 500);
  assert.throws(() => c.record(30, 'broken', NaN));
});

test('native DOT overkill is recorded once; damage received by player is excluded', () => {
  const s = b.prepareSimulation(b.TARGETS[0], 1);
  const ctx = s.ctx;
  ctx.GT = 30;
  ctx.dotOffenseCfg = () => null;
  ctx.globalDamageMultiplierForEntity = () => 1;
  ctx.legendaryDotDamageMultiplier = () => 1;
  const e = ctx.FIELD.monsters[0];
  e.hp = 3;
  e.dots = [{ sid: 'test', name: 'DOT test', sourceName: 'DOT test', sourceKey: 'test', until: 31, interval: 0.5, acc: 0, dps: 10 }];
  ctx.tickStatuses(e, 0.5);
  assert.equal(e.hp, 0);
  assert.equal(s.damage.total, 5, 'record full 5 damage despite only 3 HP remaining');
  assert.equal(s.damage.events, 1);
  const p = ctx.FIELD.player;
  p.dots = [{ name: 'incoming', until: 31, interval: 0.5, acc: 0, dps: 10 }];
  ctx.tickStatuses(p, 0.5);
  assert.equal(s.damage.total, 5);
});

test('real simulation is reproducible and uses integer steps with an exact denominator', () => {
  const t = b.TARGETS[0];
  const a = b.runSimulation(t, 1, 5, 1);
  const c = b.runSimulation(t, 1, 5, 1);
  assert.deepEqual(a, c);
  assert.equal(a.steps, 100);
  assert.equal(a.sampleDuration, 4);
  assert.equal(a.avgDps, a.totalDamage / 4);
  assert.ok(a.casts['skill2:knife'] > 0);
});

test('controlled incoming hits deduct HP once and fully absorbed hits never invent damage', () => {
  const s = b.prepareSimulation(b.TARGETS[0], 3);
  const ctx = s.ctx;
  ctx.fieldTick = () => {};
  const p = ctx.FIELD.player;
  const m = ctx.FIELD.monsters[0];
  p.hp = 1000;
  m.atkCd = 0;
  const incoming = [];
  ctx.skills2OnPlayerDamaged = (enemy, player, hpDamage) => incoming.push(hpDamage);
  ctx.resolveHit = (attacker, defender) => {
    defender.hp -= 10;
    return { dmg: 10, hpDamage: 10 };
  };
  s.tick(0);
  assert.equal(p.hp, 990);
  assert.deepEqual(incoming, [10]);
  m.atkCd = 0;
  ctx.resolveHit = () => ({ dmg: 0, hpDamage: 0, absorbed: 0 });
  s.tick(1);
  assert.equal(p.hp, 990);
  assert.deepEqual(incoming, [10, 0]);
});

test('committed report covers every scenario and exactly matches the raw measurements', () => {
  const p = path.resolve(__dirname, '../docs/skill-tests/20261026-ult-dps-results.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  const report = require('../tools/ult-dps-report.cjs');
  report.validate(data);
  assert.equal(fs.readFileSync(path.resolve(__dirname, '../docs/ULT_EVOLUTION_ALL_69_SKILLS_DPS_REPORT_CODEX.md'), 'utf8'), report.render(data));
});
