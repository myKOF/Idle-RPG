'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEngine } = require('../scripts/sim/engine');

const root = path.resolve(__dirname, '..');
function battlefield() {
  const c = { Math: Object.create(Math) };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/battlefield.js'), 'utf8'), c);
  return c;
}
function enemy(m, extra) {
  return Object.assign({ hp: 100, pos: { x: m * 10, y: 0 } }, extra);
}

for (const radius of [40, 50, 60, 70, 80, 90, 100]) {
  test(`auto search: first populated circle is ${radius}m, including its boundary`, () => {
    const c = battlefield();
    const edge = enemy(radius), outside = enemy(radius + 0.001);
    c.Math.random = () => 0.999;
    assert.equal(c.bfPickPlayerTarget([outside, edge], outside), edge,
      'an outer locked target must not bypass a populated inner circle');
    assert.equal(c.bfPickPlayerTarget([outside, edge], null), edge);
  });
}

test('different distances in the same circle have equal random opportunities, rather than nearest priority', () => {
  const c = battlefield();
  const list = [enemy(2), enemy(10), enemy(25), enemy(39.9)];
  const counts = new Map(list.map(e => [e, 0]));
  for (let i = 0; i < 400; i++) {
    c.Math.random = () => (i + 0.5) / 400;
    const picked = c.bfPickPlayerTarget(list, null);
    counts.set(picked, counts.get(picked) + 1);
  }
  assert.deepEqual([...counts.values()], [100, 100, 100, 100]);
});

test('search uses current player position and circular center distance, without subtracting boss body radius', () => {
  const c = battlefield();
  c.bfPlayerPos().x = 2000;
  c.bfPlayerPos().y = -3000;
  const edge = enemy(0, { pos: { x: 2240, y: -2680 } }); // 24/32/40 triangle
  const outerBoss = enemy(0, { pos: { x: 2401, y: -3000 }, _bodyR: 300 });
  c.Math.random = () => 0.999;
  assert.equal(c.bfPickPlayerTarget([outerBoss, edge], outerBoss), edge);
  edge.pos.y += 0.01;
  assert.equal(c.bfPickPlayerTarget([edge], null), edge, 'expand to 50m for a diagonal beyond 40m');
  edge.pos = { x: 2800, y: -2200 };
  assert.equal(c.bfPickPlayerTarget([edge], null), null, 'a square corner lies outside the 100m circle');
});

test('dead, entering, missing or invalid positions and targets beyond 100m cannot be selected', () => {
  const c = battlefield();
  const valid = enemy(80);
  const invalid = [enemy(1, { hp: 0 }), enemy(2, { _enterCd: 1 }), { hp: 100 },
    enemy(3, { pos: { x: NaN, y: 0 } }), enemy(100.001, { _bodyR: 9999 })];
  assert.equal(c.bfPickPlayerTarget(invalid.concat(valid), invalid[0]), valid);
  assert.equal(c.bfPickPlayerTarget(invalid, valid), null);
});

test('lock stays stable within a circle but reselects for an inner circle, death, leaving or escape', () => {
  const c = battlefield(), a = enemy(41), b = enemy(49), inner = enemy(39);
  c.Math.random = () => 0;
  assert.equal(c.bfPickPlayerTarget([a, b], b), b);
  assert.equal(c.bfPickPlayerTarget([a, b, inner], b), inner);
  inner.hp = 0;
  assert.equal(c.bfPickPlayerTarget([a, b, inner], inner), a);
  assert.equal(c.bfPickPlayerTarget([b], a), b);
  b.pos.x = 1000.01;
  assert.equal(c.bfPickPlayerTarget([b], b), null);
});

test('movement locks the random target before reaching it, and ignores a stale far preferred target', () => {
  const c = battlefield(), near = enemy(10), other = enemy(39), far = enemy(95), p = {};
  c.Math.random = () => 0.999;
  assert.equal(c.bfTickPlayer([near, other, far], 0.01, far, p), true);
  assert.equal(p._lockTarget, other, 'farther of the two inner-circle enemies is a valid random choice');
  c.Math.random = () => { throw Error('a valid lock must not reroll every movement tick'); };
  for (let i = 0; i < 20; i++) c.bfTickPlayer([near, other, far], 0.01, p._lockTarget, p);
  assert.equal(p._lockTarget, other);
});

test('no automatic chase outside 100m; empty battlefield retains forward movement', () => {
  const c = battlefield(), far = enemy(100.001), p = { _lockTarget: far };
  c.BF_PLAYER_CHASING = true;
  assert.equal(c.bfTickPlayer([far], 0.1, far, p), false);
  assert.equal(p._lockTarget, null);
  assert.equal(c.BF_PLAYER_CHASING, false);
  assert.equal(c.bfPlayerPos().x, 0);
  assert.equal(c.bfTickPlayer([], 0.1, null, p), true);
  assert.ok(c.bfPlayerPos().x > 0);
});

function game() {
  const e = createEngine({ seed: 42 }).boot(null), c = e.ctx;
  c.G.player.loadout = [];
  c.gmArenaSpawn(3, 'elite', 1e6);
  c.bfResetPlayer();
  const list = c.FIELD.monsters;
  list.forEach((m, i) => {
    m.pos = { x: [50, 390, 1500][i], y: 0 };
    m._enterCd = 0;
    m._passive = true;
    m._alerted = false;
    m._bodyR = 20;
  });
  return { e, c, list, p: c.FIELD.player };
}

test('real fieldTick keeps pursuit and basic attack on the same random target, even with nearer enemies', () => {
  const { c, list, p } = game();
  const hits = [];
  c.Math.random = () => 0.999;
  p._lockTarget = list[2];
  p.atkCd = 0;
  c.doPlayerAttack = (player, target) => {
    hits.push(target);
    assert.equal(c.bfPlayerCanReach(target), true, 'attack only after physically reaching the target');
    return { dmg: 1, killed: false };
  };
  for (let i = 0; i < 100 && !hits.length; i++) { c.GT += 0.1; c.fieldTick(0.1); }
  assert.ok(hits.length);
  assert.equal(hits[0], list[1]);
  assert.equal(p._lockTarget, list[1]);
  assert.ok(c.bfPlayerPos().x > 300, 'walk past a nearer same-circle enemy toward the randomly selected one');
});

test('storm dance cannot override pursuit with a global random target or retain an outer-circle lock', () => {
  const { c, list, p } = game();
  c.G.player.level = 1000;
  c.G.player.skills2.levels.dualdance = Array(7).fill(1);
  c.SKILL2_RT.storm = { until: c.GT + 10, nextAt: c.GT + 5, gap: 0.35, tgt: list[2] };
  p._lockTarget = list[2];
  c.Math.random = () => 0.999;
  const ctx = { pEnt: p, getEnemies: () => list, floatSel: 'mv-float' };
  c.sgTickStorm(ctx, 0.1);
  assert.equal(p._lockTarget, list[1]);
  assert.equal(c.SKILL2_RT.storm.tgt, list[1]);
  list[1].pos.x = 800;
  c.sgTickStorm(ctx, 0.1);
  assert.equal(p._lockTarget, list[0]);
  list[0].hp = 0;
  list[1].pos.x = 1100;
  c.sgTickStorm(ctx, 0.1);
  assert.equal(p._lockTarget, null);
});
