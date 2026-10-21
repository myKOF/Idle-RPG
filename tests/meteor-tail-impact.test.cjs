'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const { createEngine } = require('../scripts/sim/engine');
const projectile = require('../vfx/presets/proj-meteor-inferno.json');
const impact = require('../vfx/presets/burst-meteor-inferno.json');

function visual(presets = [projectile, impact], over = {}) {
  const nodes = [];
  const backend = tag => ({ createNode(spec) { const n = { tag, spec }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode() {}, destroy() {} });
  const rt = Runtime.create({ core: Core, resolver: { resolve: id => id, has: () => true },
    fxBackend: backend('fx'), zoneBackend: backend('zone'), airBackend: backend('air'),
    ctx: { posOf: () => ({ x: 350, y: 400 }), playerPos: () => ({ x: 0, y: 0 }),
      skyEntryPoint: () => ({ x: 100, y: 0 }) }, ...over });
  rt.registerPresets(presets);
  return { rt, nodes };
}
const launch = { fxKind: 'rain', variant: 'meteor', targets: ['target'], travelMs: [1000], hit: false,
  area: { fixedLanding: true, x: 350, y: 400 }, vfx: { projectile: projectile.id } };

test('METEOR-AFTER 命中移除石頭、停止發射，空中煙火沿落下方向收束且不越過落點', () => {
  const s = visual();
  s.rt.tryPlay(launch);
  for (let i = 0; i < 61 && s.rt.stats().projectiles; i++) s.rt.update(1 / 60);
  assert.equal(s.rt.stats().projectiles, 0);
  const count = s.rt.stats().air.activeParticles;
  assert.ok(count > 10, 'impact must retain already emitted particles');
  assert.ok(!s.nodes.some(n => n.tag === 'air' && n.t?.visible && n.t.zIndex >= 6 && n.t.zIndex <= 10), 'rock and head sprites must disappear');
  const smoke = s.nodes.filter(n => n.tag === 'air' && n.t?.visible && n.spec.assetUrl.includes('smoke_04'));
  const before = smoke.map(n => ({ n, x: n.t.x, y: n.t.y, distance: Math.hypot(n.t.x - 350, n.t.y - 400) }));
  s.rt.update(.04);
  const alive = before.filter(v => v.n.t.visible && v.n.t.alpha > 0);
  assert.ok(alive.length > 0);
  for (const { n, y, distance } of alive) {
    assert.ok(n.t.y > y, 'smoke must continue downward');
    assert.ok(n.t.y <= 400, 'smoke must not pass through the ground');
    assert.ok(Math.hypot(n.t.x - 350, n.t.y - 400) < distance);
  }
  assert.ok(s.rt.stats().air.activeParticles <= count);
  s.rt.update(1.2);
  assert.equal(s.rt.stats().air.activeParticles, 0);
  assert.equal(s.rt.stats().air.activeEffects, 0);
  s.rt.destroy();
});

test('METEOR-AFTER 四秒坑痕在地板層，爆炸不被延長；重疊落點各自回收', () => {
  const s = visual();
  const hit = { fxKind: 'impact', variant: 'meteor-impact', targets: ['target'],
    area: { x: 350, y: 400, r: 150 }, vfx: { hit: impact.id }, preserveDeadTargets: true };
  s.rt.tryPlay(hit); s.rt.update(.2);
  const cracks = s.nodes.filter(n => n.spec.assetUrl.includes('crater-'));
  assert.equal(cracks.length, 1);
  assert.ok(cracks.every(n => n.tag === 'zone' && n.t.visible));
  assert.ok(cracks.every(n => Math.abs(n.t.scaleX * 512 - 300) < 1e-6), 'crater must follow the impact diameter');
  s.rt.update(1.3);
  assert.equal(s.rt.stats().fx.activeEffects, 0, 'blast must finish while crater remains');
  assert.equal(s.rt.stats().zone.activeEffects, 1);
  s.rt.tryPlay({ ...hit, area: { ...hit.area, x: 420 } });
  s.rt.update(2.49);
  assert.equal(s.rt.stats().zone.activeEffects, 2, 'first crater must remain just before four seconds');
  s.rt.update(.02);
  assert.equal(s.rt.stats().zone.activeEffects, 1, 'first crater expires at four seconds');
  s.rt.update(1.51);
  assert.equal(s.rt.stats().zone.activeEffects, 0);
  s.rt.destroy();
});

test('METEOR-AFTER 真模擬仍只在原命中時刻扣血，落地事件才生成坑痕', () => {
  const c = createEngine({ seed: 42 }).boot(null).ctx;
  c.G.player.level = 1000; c.G.player.loadout = ['sg:fireball'];
  c.G.player.skills2.levels.fireball = Array(7).fill(10);
  c.initFieldPlayer(); c.gmArenaSpawn(1, 'elite', 1000000);
  const p = c.FIELD.player, m = c.FIELD.monsters[0];
  m.pos = { x: 10, y: 0 }; m._enterCd = 0; p.mp = 1e9;
  const events = []; c.playCombatVfx = e => events.push(e);
  const hp = m.hp;
  c.castSkill2(p, [m], 'fireball', 'mv-float');
  const shots = events.filter(e => e.variant === 'meteor');
  assert.equal(shots.length, 3);
  const s = visual(); shots.forEach(e => s.rt.tryPlay(e));
  assert.equal(s.rt.stats().zone.activeEffects, 0, 'launch cannot show a crater');
  const at = c.SKILL2_RT.meteors[0].at;
  c.GT = at - .001; c.sgTickMeteors({}); assert.equal(m.hp, hp);
  c.GT = at; c.sgTickMeteors({}); assert.ok(m.hp < hp);
  const hit = events.find(e => e.variant === 'meteor-impact');
  assert.equal(hit.vfx.hit, impact.id);
  s.rt.tryPlay(hit); s.rt.update(.2);
  assert.ok(s.nodes.some(n => n.tag === 'zone' && n.t?.visible && n.spec.assetUrl.includes('crater-lava-soft')));
  s.rt.clear();
  assert.equal(s.rt.stats().air.activeParticles, 0);
  assert.equal(s.rt.stats().zone.activeEffects, 0);
  s.rt.destroy();
});

test('METEOR-AFTER 清場立即刪除尾跡，重用粒子不繼承上次收束狀態', () => {
  const s = visual(); s.rt.tryPlay(launch);
  for (let i = 0; i < 61; i++) s.rt.update(1 / 60);
  assert.ok(s.rt.stats().air.activeParticles > 0);
  s.rt.clearFields(); assert.equal(s.rt.stats().air.activeParticles, 0);
  s.rt.tryPlay({ ...launch, variant: 'ordinary-projectile' });
  s.rt.update(.1);
  assert.ok(s.nodes.some(n => n.tag === 'air' && n.t?.visible));
  s.rt.clear(); assert.equal(s.rt.stats().air.activeEffects, 0); s.rt.destroy();
});

test('METEOR-AFTER Core收束使用已畫出的座標，支援父層與世界粒子且不污染池重用', () => {
  for (const worldSpace of [false, true]) {
    const nodes = [];
    const core = Core.createRuntime({ resolver: { resolve: id => id }, backend: {
      createNode() { const n = {}; nodes.push(n); return n; }, updateNode(n, t) { n.t = { ...t }; }, destroyNode() {} } });
    core.registerPreset({ schemaVersion: 1, id: 'settle', duration: 2, layers: [
      { id: 'axis', type: 'empty', rotation: .2 },
      { id: 'smoke', type: 'particle', parent: 'axis', worldSpace, assetId: 'smoke',
        emission: { mode: 'rate', rate: 20 }, lifetime: 1, position: { x: -100, y: -20 },
        speed: 50, direction: 180, projection: { x: 1, y: .65 } }
    ] });
    const h = core.play('settle', { position: { x: 0, y: 0 } }); core.update(.2);
    const n = nodes[0], before = { ...n.t };
    core.setTransform(h, { position: { x: 150, y: 200 } });
    core.finish(h, { settleToOrigin: true }); core.update(0);
    assert.equal(n.t.x, before.x); assert.equal(n.t.y, before.y, 'impact must not teleport the tail');
    core.update(.1); assert.ok(n.t.x > before.x && n.t.y > before.y);
    core.update(1); assert.equal(core.stats().activeEffects, 0);
    core.play('settle'); core.update(.1);
    assert.ok(nodes.some(p => p.t?.visible && p.t.x < 0), 'reused particles must follow ordinary emitter motion');
    core.destroy();
  }
});
