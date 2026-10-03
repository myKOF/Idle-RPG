'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
const helperFile = path.join(__dirname, 'skill2-windblade-vacuum-legendary.test.cjs');
const h = { require: createRequire(helperFile), __dirname, console };
vm.createContext(h);
vm.runInContext(fs.readFileSync(helperFile, 'utf8').split("test('")[0], h);
function setup(lv, legendary = []) {
  const c = h.loadContext(), p = h.playerEnt(); p.pos = { x: 0, y: 0 };
  h.maxLevels(c, 'windblade'); h.equip(c, 'windblade'); h.setUlt(c, 'windblade', 'skyCollapse', lv);
  h.setLegendary(c, legendary);
  const m = h.enemy(1e9, 20, 0, 'attacker');
  c.FIELD = { player: p, enemies: [m], dpsWindow: [] };
  const events = h.stubVfx(c), hits = h.stubHits(c);
  return { c, p, m, events, hits };
}
for (const lv of [1, 10]) test(`天穹崩裂 Lv.${lv}：20%邊界、一次一小刃、傷害／壽命及特效角色一致`, () => {
  const { c, p, m, events, hits } = setup(lv);
  c.Math.random = () => .2;
  c.skills2OnPlayerDamaged(m, p, 1, false, { miss: false }, 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 0);
  c.Math.random = () => .199999;
  const lock = { name: '原目標' }; p._lockTarget = lock; const mp = p.mp;
  c.skills2OnPlayerDamaged(m, p, 1, false, { miss: false }, 'mv-float');
  assert.equal(c.SKILL2_RT.projectiles.length, 0);
  assert.equal(c.SKILL2_RT.grounds.length, 1);
  const f = c.SKILL2_RT.grounds[0];
  // 固定fixture魔攻500、普通階傷害累加1170%，小刃60%，超神獨立乘區。
  assert.equal(f.dmgVal, 500 * 11.7 * .6 * (1 + (50 + 5 * lv) / 100));
  assert.equal(f.hits * f.gap, 7);
  assert.equal(f.chaseM, 30); assert.ok(Math.abs(f.radius - 48) < 1e-9);
  assert.equal(f.pulseGap, 0, '小型風刃不產生大型風刃沿途脈衝');
  assert.equal(p.mp, mp); assert.equal(p._lockTarget, lock);
  assert.equal(p.skillCds['sg:windblade'] || 0, 0);
  h.advance(c, p, [m], .15);
  const body = events.find(e => e.variant === 'wind-blade-homing');
  assert.ok(body); assert.equal(body.vfx.ground, 'ground-homing-wind-crescent');
  assert.ok(hits.length > 0, '追擊場域確實命中敵人');
  assert.equal(hits[0].elem, 'wind');
  assert.ok(events.every(e => e.fxKind !== 'projectile'), '命中不能重新發射風刃');
  const backend = { creates: 0, createNode() { this.creates++; return {}; }, updateNode() {}, destroyNode() {} };
  const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => id },
    fxBackend: backend, airBackend: backend, zoneBackend: backend,
    ctx: { playerPos: () => p.pos, posOf: () => m.pos } });
  rt.registerPresets([{ schemaVersion: 1, id: 'ground-homing-wind-crescent', duration: 7, loop: true,
    layers: [{ id: 'blade', type: 'sprite', assetId: 'marker' }] }]);
  assert.equal(rt.tryPlay(body), true); rt.update(.05); const created = backend.creates;
  assert.equal(rt.tryPlay(body), true); rt.update(.05);
  assert.equal(backend.creates, created, '同一場域重送位置不新增本體');
  rt.destroy();
});

test('正式Worker：一次受擊只派送一個追擊場域，方向／尺寸／速度與判定一致，壽命到期回收', () => {
  const { createEngine } = require('../scripts/sim/engine');
  const c = createEngine({ seed: 9 }).boot(null).ctx;
  c.G.player.level = 1000;
  c.G.player.skills2 = { levels: { windblade: Array(7).fill(10) }, ult: { windblade: { pick: 2, lv: 10 } } };
  c.G.player.loadout = ['sg:windblade'];
  c._statsCache = null;
  const p = h.playerEnt(), m = h.enemy(1e9, 0, 20, 'attacker');
  p.pos = { x: 0, y: 0 };
  c.FIELD.player = p; c.FIELD.enemies = [m];
  c.Math.random = () => 0;
  c.shimDrainUrgentVisualEvents();
  c.skills2OnPlayerDamaged(m, p, 1, false, {}, 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 1);
  assert.equal(c.SKILL2_RT.projectiles.length, 0);
  const f = c.SKILL2_RT.grounds[0];
  assert.equal(f.dest, null, '由追擊步驟選敵，不先飛向搜敵圈邊緣');
  assert.equal(f.moveAngle, Math.PI / 2, '初始航向指向攻擊者');
  h.advance(c, p, [m], .1);
  const events = c.shimDrainUrgentVisualEvents();
  const bodies = events.filter(e => e.variant === 'wind-blade-homing');
  assert.ok(bodies.length > 0);
  assert.equal(new Set(bodies.map(e => e.area.id)).size, 1);
  for (const body of bodies) {
    assert.equal(body.vfx.ground, 'ground-homing-wind-crescent');
    assert.equal(body.area.r, f.radius); assert.equal(body.area.speed, f.speed);
    assert.ok(Number.isFinite(body.area.moveA));
  }
  const last = bodies.at(-1);
  assert.equal(last.area.x, f.pos.x); assert.equal(last.area.y, f.pos.y);
  assert.ok(events.every(e => e.fxKind !== 'projectile'));
  h.advance(c, p, [m], 7);
  assert.equal(c.SKILL2_RT.grounds.length, 0);
});
test('天穹崩裂：傳奇連射／鏡射保持一道，仍保留小刃傷害加成', () => {
  const { c, p, m } = setup(10, ['windbladeVoidCut', 'windbladeTrace']); c.Math.random = () => 0;
  c.skills2OnPlayerDamaged(m, p, 1, false, {}, 'mv-float');
  assert.equal(c.SKILL2_RT.grounds.length, 1); assert.equal(c.SKILL2_RT.projectiles.length, 0);
  assert.equal(c.SKILL2_RT.grounds[0].dmgVal, 500 * (11.7 + .3) * .6 * 2 * 1.3);
});
test('天穹崩裂：卸下／玩家死亡／攻擊者死亡／閃避／無敵／致死受擊都不生成', () => {
  for (const kind of ['unequip', 'deadPlayer', 'deadEnemy', 'miss', 'invuln', 'killed']) {
    const { c, p, m } = setup(10); c.Math.random = () => 0;
    if (kind === 'unequip') c.G.player.loadout = [];
    if (kind === 'deadPlayer') p.hp = 0;
    if (kind === 'deadEnemy') m.hp = 0;
    c.skills2OnPlayerDamaged(m, p, 0, false, { [kind]: true }, 'mv-float');
    assert.equal(c.SKILL2_RT.grounds.length, 0, kind);
  }
});
