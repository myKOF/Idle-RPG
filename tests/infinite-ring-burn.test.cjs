'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');

function setup(ult = 'infiniteRing', lv = 1) {
  const c = createEngine({ seed: 1019 }).boot(null).ctx;
  c.G.player.level = 1000; c.G.tower.highest = 100;
  c.G.player.skills2 = { levels: { firehunt: Array(7).fill(10) },
    ult: ult ? { firehunt: { pick: c.sgUltIndexOfId('firehunt', ult), lv } } : {} };
  c.G.player.loadout = ['sg:firehunt']; c.clearSkills2LevelsCache(); c.markStatsDirty();
  const stats = Object.assign({}, c.getStats(), { matk: 500 }); c.getStats = () => stats;
  c.Math.random = () => .5; c.chance = pct => pct >= 100;
  const p = c.FIELD.player; p.hp = stats.hp; p.mp = 1e9;
  c.gmArenaSpawn(1, 'small', 1e9);
  const e = c.FIELD.monsters[0]; e.pos = { x: 50, y: 0 };
  const events = []; c.playCombatVfx = spec => events.push(spec);
  const ctx = { pEnt: p, getEnemies: () => [e], floatSel: 'mv-float', onDamage() {}, onDeaths() {} };
  c.castSkill2(p, [e], 'firehunt', 'mv-float');
  const f = c.SKILL2_RT.orbits[0]; assert.ok(f);
  return { c, p, e, f, events, ctx };
}
function hit(s, orb = s.f.orbs[0], enemies = [s.e]) {
  s.c.sgOrbitStep(s.f, [], 0, s.ctx);
  for (const e of enemies) e.pos = s.c.sgOrbitPos(orb, s.c.bfPlayerPos());
  s.c.sgOrbitStep(s.f, enemies, 0, s.ctx);
}
function dot(s) { return s.c.sgFindDot(s.e, s.c.sgSlotSid('firehunt', 'infiniteRing', 'enemy', 0)); }
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`); }

test('無限星環：各等級成功命中後才附加6秒燃燒，每0.5秒200%魔攻，狀態與作用特效同源', () => {
  for (const lv of [1, 10]) {
    const s = setup('infiniteRing', lv), { c, e, events } = s;
    assert.equal(dot(s), null, '施放本身不燃燒');
    hit(s); const d = dot(s); assert.ok(d);
    close(d.dps * d.interval, 1000); close(d.interval, .5); close(d.until - c.GT, 6);
    const shown = c.statusEntries(e).find(x => x.sid === d.sid);
    close(shown.dps, 2000); close(shown.remain, 6); assert.equal(c.STATUS[d.sid].elem, 'fire');
    const before = e.hp;
    c.GT += .49; c.tickStatuses(e, .49); c.statusTickVfxFlush();
    assert.equal(e.hp, before); assert.equal(events.filter(x => x.variant === 'status-tick').length, 0);
    c.GT += .01; c.tickStatuses(e, .01); c.statusTickVfxFlush();
    close(before - e.hp, 1000);
    const vfx = events.filter(x => x.variant === 'status-tick');
    assert.equal(vfx.length, 1); assert.equal(vfx[0].elem, 'fire');
    assert.equal(vfx[0].vfx.hit, c.STATUS[d.sid].vfx.tick);
    c.GT = d.until; c.tickStatuses(e, 0);
    assert.equal(dot(s), null); assert.equal(c.statusEntries(e).some(x => x.sid === d.sid), false);
    const ended = e.hp; c.GT += 1; c.tickStatuses(e, 1); assert.equal(e.hp, ended);
  }
});

test('燃燒只屬於無限星環；未接觸與未命中不施加，多個敵人各自燃燒', () => {
  for (const ult of ['', 'solarRing', 'fireGodDescend']) {
    const s = setup(ult); hit(s); assert.equal(s.e.dots.length, 0, ult || '未選超神');
  }
  const s = setup(), { c, e, f } = s;
  e.pos = { x: 10000, y: 0 }; c.sgOrbitStep(f, [e], 0, s.ctx); assert.equal(dot(s), null);
  const resolve = c.resolveHit; c.resolveHit = () => ({ dmg: 0, miss: true });
  hit(s); assert.equal(dot(s), null);
  c.resolveHit = resolve;
  const other = Object.assign({}, e, { effects: {}, buffs: {}, dots: [] });
  hit(s, f.orbs[0], [e, other]);
  assert.ok(dot(s)); assert.ok(c.sgFindDot(other, 'sgBurn')); assert.equal(e.dots.length, 1);
  c.GT += 1; hit(s); close(dot(s).until - c.GT, 6); assert.equal(e.dots.length, 1, '重上刷新而非新增疊層');
});

test('無限星環延後放出的火狩與伴生都能燃燒，火狩結束不提早移除敵人燃燒', () => {
  const s = setup(), { c, f, e } = s;
  c.GT = f.spawnAt; c.sgOrbitStep(f, [], 0, s.ctx);
  const fresh = f.orbs.at(-1); assert.equal(fresh.canSpawn, false);
  hit(s, fresh); assert.ok(dot(s), '延後生成也沿用場域燃燒規格');
  e.dots = []; c.chance = () => true; hit(s, f.orbs[0]);
  const companion = f.orbs.find(o => o.companion); assert.ok(companion);
  e.dots = []; hit(s, companion); assert.ok(dot(s), '伴生成功命中也燃燒');
  const until = dot(s).until; c.SKILL2_RT.orbits = []; assert.equal(dot(s).until, until);
});

test('燃燒數值與狀態由表決定，能被火焰增幅識別；清空狀態欄不產生隱藏燃燒', () => {
  const s = setup(), { c, e, f, p } = s;
  const u = c.SKILLS2.firehunt.ult.find(x => x.id === 'infiniteRing');
  u.fx.dotPct = 80; u.fx.dotSec = 3; u.fx.dotGap = .25;
  c.STATUS.testHuntBurn = Object.assign({}, c.STATUS.sgBurn, { name: '測試燃燒' });
  u.status.enemy = [{ id: 'testHuntBurn' }]; c.sgStatusSlotsReset();
  c.resetSkill2RT(); p.skillCds = {}; p.mp = 1e9; e.pos = { x: 50, y: 0 };
  c.castSkill2(p, [e], 'firehunt', 'mv-float'); s.f = c.SKILL2_RT.orbits[0];
  hit(s); const d = dot(s); close(d.dps * d.interval, 400); close(d.interval, .25); close(d.until - c.GT, 3);
  assert.equal(d.sid, 'testHuntBurn');
  c.G.player.skills2.levels.fireball = [10, 10, 10, 10, 10, 10, 0]; c.clearSkills2LevelsCache();
  c.sgTickBurn(.25, s.ctx); assert.equal(p.buffs.sgFireAmp.stacks, 1);
  e.dots = []; u.status.enemy = []; c.sgStatusSlotsReset(); hit(s);
  assert.equal(e.dots.length, 0);
  assert.ok(f.spiral, '原螺旋保留');
});
