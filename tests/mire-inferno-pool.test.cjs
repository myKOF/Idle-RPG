'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine');
const Core = require('../js/vfx-core');
const Runtime = require('../js/vfx-runtime');

function setup(lv = 1) {
  const c = createEngine({ seed: 42 }).boot(null).ctx;
  c.G.player.level = 1000;
  c.G.tower.highest = 100;
  c.G.player.loadout = ['sg:mire'];
  c.G.player.skills2.levels.mire = Array(7).fill(10);
  c.G.player.skills2.ult = { mire: { pick: c.sgUltIndexOfId('mire', 'abyssInferno'), lv } };
  c.initFieldPlayer();
  c.gmArenaSpawn(3, 'elite', 1000000);
  const p = c.FIELD.player;
  p.pos = { x: 0, y: 0 }; p.mp = 1e9;
  c.FIELD.monsters.forEach((e, i) => { e.pos = { x: 20 + i * 10, y: 0 }; e._enterCd = 0; });
  const events = [], hits = [], shimVfx = c.playCombatVfx;
  c.playCombatVfx = s => events.push(s);
  c.sgHitOne = (p, st, e, dmg, gid, sel, out, delay, bonus, elem) => {
    hits.push({ e, dmg, elem, at: c.GT }); return { miss: false };
  };
  assert.ok(c.castSkill2(p, c.FIELD.monsters, 'mire', 'mv-float'));
  const ctx = { pEnt: p, getEnemies: () => c.FIELD.monsters };
  c.GT = 1; c.sgTickGrounds(1, ctx);
  const balls = c.SKILL2_RT.grounds.filter(f => f.kind === 'mirefireball');
  assert.equal(balls.length, 3);
  // 發射後只留下待落地火球，隔離沼澤本體的下一輪發射與狀態。
  c.SKILL2_RT.grounds = balls;
  return { c, p, ctx, balls, events, hits, shimVfx };
}
function land(s) {
  s.c.GT = s.balls[0].nextAt;
  s.c.sgTickGrounds(.001, s.ctx);
  return s.c.SKILL2_RT.grounds.filter(f => f.kind === 'firepool');
}

test('深淵火池：落地才出生，空場及原目標死亡仍在固定落點留下獨立火池', () => {
  const s = setup();
  s.c.GT = s.balls[0].nextAt - .001;
  s.c.sgTickGrounds(.899, s.ctx);
  assert.equal(s.hits.length, 0);
  assert.equal(s.events.filter(e => e.variant === 'mire-inferno-pool').length, 0);
  const positions = s.balls.map(b => ({ ...b.pos }));
  s.c.FIELD.monsters.forEach(e => { e.hp = 0; e.pos.x = 9999; });
  const pools = land(s);
  assert.equal(pools.length, 3);
  pools.forEach((f, i) => {
    assert.equal(f.pos.x, positions[2 - i].x);
    assert.equal(f.radius, s.c.bfMeterPx(6));
    assert.equal(f.hits, 8); assert.equal(f.gap, .5);
    assert.equal(f.expiresAt - f.bornAt, 4);
  });
  assert.equal(new Set(pools.map(f => f.vfxId)).size, 3);
  const visuals = s.events.filter(e => e.variant === 'mire-inferno-pool' && e.area?.lifeSec === 4);
  assert.equal(visuals.length, 3, '出生立即顯示，不等首個傷害節拍');
  visuals.forEach(e => {
    assert.deepEqual(Object.keys(e.vfx), ['ground']);
    assert.equal(e.vfx.ground, 'ground-mire-lava');
    assert.equal(e.elem, 'fire'); assert.equal(e.hit, false);
    assert.equal(e.area.r, 60); assert.equal(e.area.w, 120); assert.equal(e.area.h, 120);
    assert.equal(e.dur, 4);
  });
});

test('深淵火池：各等級均固定200%魔攻，每半秒共八拍，圓形邊界與進出即時重查', () => {
  for (const lv of [1, 10]) {
    const s = setup(lv), pools = land(s), f = pools[0];
    s.c.SKILL2_RT.grounds = [f]; s.hits.length = 0;
    const e = s.c.FIELD.monsters[0];
    e.pos = { x: f.pos.x + 60, y: f.pos.y };
    const base = s.c.sgGroupBaseStat(s.c.SKILLS2.mire, f.st);
    assert.equal(f.dmgVal, base * 2);
    s.c.GT = f.bornAt + .499; s.c.sgTickGrounds(.499, s.ctx);
    assert.equal(s.hits.length, 0);
    s.c.FIELD.monsters.splice(1);
    for (let i = 1; i <= 8; i++) {
      // 方形角落不屬圓形；下一拍回到六米邊界應重新命中。
      e.pos = i === 3 ? { x: f.pos.x + 59, y: f.pos.y + 59 }
        : { x: f.pos.x + 60, y: f.pos.y };
      s.c.GT = f.bornAt + i * .5; s.c.sgTickGrounds(.5, s.ctx);
    }
    assert.equal(s.hits.length, 7);
    assert.deepEqual(s.hits.map(h => +(h.at - f.bornAt).toFixed(2)), [.5, 1, 2, 2.5, 3, 3.5, 4]);
    s.hits.forEach(h => { assert.equal(h.dmg, base * 2); assert.equal(h.elem, 'fire'); });
    assert.equal(s.c.SKILL2_RT.grounds.length, 0);
    s.c.GT += .5; s.c.sgTickGrounds(.5, s.ctx); assert.equal(s.hits.length, 7);
  }
});

test('深淵火池：重疊火池分別結算，實際傷害走完整火焰命中管線', () => {
  const s = setup(), pools = land(s), e = s.c.FIELD.monsters[0];
  s.c.FIELD.monsters.splice(1);
  e.pos = { ...pools[0].pos };
  pools.forEach(f => { f.pos = { ...e.pos }; });
  s.hits.length = 0; s.c.GT += .5; s.c.sgTickGrounds(.5, s.ctx);
  assert.equal(s.hits.length, 3);
  // 移除 spy，直接比較同一火焰命中規格與火池單拍的真實扣血。
  const c = createEngine({ seed: 99 }).boot(null).ctx;
  c.initFieldPlayer(); c.gmArenaSpawn(2, 'elite', 1000000);
  const p = c.FIELD.player, st = c.getStats(), [a, b] = c.FIELD.monsters;
  a.hp = b.hp = 1e9; a.maxHp = b.maxHp = 1e9;
  a._enterCd = b._enterCd = 0; a.pos = { x: 0, y: 0 }; b.pos = { x: 9999, y: 0 };
  a.def = b.def = 0; a.mdef = b.mdef = 0;
  a.attr = b.attr = 'earth';
  c.chance = pct => pct > 0;
  c.Math.random = () => .5;
  const amount = c.sgGroupBaseStat(c.SKILLS2.mire, st) * 2;
  const out = { dmg: 0, killed: false, crit: false };
  c.sgHitOne(p, st, a, amount, 'mire', 'mv-float', out, 0, 0, 'fire');
  const expected = 1e9 - a.hp;
  assert.ok(expected > 0);
  b.pos = { x: 0, y: 0 };
  c.sgSpawnFirePool(p, st, 'mire', { dmgVal: amount, gap: .5, sec: 4, lifeSec: 4, radiusPx: 60, vfxUlt: 'abyssInferno' }, 'mv-float', null, { x: 0, y: 0 });
  c.GT = .5; c.sgTickGrounds(.5, { getEnemies: () => [b] });
  assert.equal(1e9 - b.hp, expected);
});

test('深淵火池：完整八拍、攻擊快照不變，參數與空白觸發地板均讀配置', () => {
  const s = setup(), f = land(s)[0], e = s.c.FIELD.monsters[0];
  s.c.SKILL2_RT.grounds = [f]; s.c.FIELD.monsters.splice(1);
  e.pos = { ...f.pos }; s.hits.length = 0;
  for (let i = 1; i <= 8; i++) {
    s.c.GT = f.bornAt + i * .5; s.c.sgTickGrounds(.5, s.ctx);
  }
  assert.equal(s.hits.length, 8);
  assert.equal(s.events.filter(e => e.variant === 'mire-inferno-pool' && e.area?.id === f.vfxId).at(-1).area.lifeSec, .5,
    '到期的最後傷害拍不再播放／續命地板');
  assert.equal(s.hits.reduce((sum, h) => sum + h.dmg, 0), f.dmgVal * 8);
  const opt = s.c.SKILLS2.mire.ult.find(u => u.id === 'abyssInferno');
  Object.assign(opt.fx, { poolM: 4, poolPct: 125, poolGap: .25, poolSec: 2 });
  opt.triggerVfx.ground = '';
  const spec = s.c.sgMireInfernoSpec(Array(7).fill(10), 800);
  assert.equal(spec.pool.radiusPx, 40); assert.equal(spec.pool.dmgVal, 1000);
  assert.equal(spec.pool.gap, .25); assert.equal(spec.pool.lifeSec, 2);
  s.events.length = 0;
  s.c.sgSpawnFirePool(s.p, f.st, 'mire', spec.pool, 'mv-float', null, { x: 0, y: 0 });
  assert.equal(s.events[0].vfx.ground, undefined, '觸發地板留白不繼承沼澤本體');
  assert.equal(f.dmgVal, s.hits[0].dmg, '已出生火池的攻擊快照不受後續規格變動影響');
});

test('深淵火池：說明讀取配置，無熔岩沼不生成火球／火池', () => {
  const s = setup();
  for (const lv of [1, 10]) {
    const desc = s.c.describeSkill2Ult('mire', s.c.sgUltIndexOfId('mire', 'abyssInferno'), lv);
    assert.match(desc, /半徑 6 米的火池，每 0.5 秒造成 200% 火焰傷害，持續 4 秒/);
    assert.doesNotMatch(desc, /\{\w+\}/);
  }
  assert.equal(s.c.sgMireInfernoSpec([10, 10, 10, 10, 10, 10, 0], 100), null);
});

test('深淵火池：實際Runtime按六米圓形縮放、續命不重播爆炸，四秒精確回收', () => {
  const s = setup(), f = land(s)[0];
  const visual = s.events.find(e => e.area?.id === f.vfxId);
  s.c.shimDrainUrgentVisualEvents();
  s.shimVfx(visual);
  const wire = JSON.parse(JSON.stringify(s.c.shimDrainUrgentVisualEvents())).find(e => e.variant === 'mire-inferno-pool');
  assert.equal(wire.dur, 4); assert.equal(wire.area.lifeSec, 4); assert.equal(wire.area.r, 60);
  const preset = JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets/ground-mire-lava.json')));
  const transforms = [];
  const backend = { createNode: spec => ({ spec }), updateNode: (node, t) => transforms.push({ ...t }), destroyNode() {} };
  const adapter = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => id }, fxBackend: backend, zoneBackend: backend,
    ctx: { playerPos: () => ({ x: 0, y: 0 }), posOf: () => ({ x: 0, y: 0 }) } });
  adapter.registerPresets([preset]);
  assert.equal(adapter.tryPlay(wire), true);
  adapter.update(.01);
  assert.ok(adapter.stats().zone.activeEffects > 0);
  assert.ok(transforms.some(t => Math.abs(t.scaleX) > 0));
  assert.ok(Math.abs(transforms[0].scaleX - preset.layers[0].scale.x * .6) < 1e-8,
    '作者半徑100像素縮至權威六米／60像素，不使用Preset原本三米半徑');
  // 最後一個非到期節拍只剩半秒，禁止Runtime一般場域的多拍緩衝續命。
  adapter.update(3.49);
  s.c.GT = f.bornAt + 3.5;
  const last = s.c.sgGroundVfxSpec(f);
  assert.equal(last.area.lifeSec, .5);
  assert.deepEqual(Object.keys(last.vfxRoles), ['ground']);
  s.events.length = 0; s.c.sgEmitVfx('mire', [], 'mv-float', last);
  assert.equal(adapter.tryPlay(s.events[0]), true);
  adapter.update(.499); assert.ok(adapter.stats().zone.activeEffects > 0);
  adapter.update(.002); assert.equal(adapter.stats().zone.activeEffects, 0);
  adapter.clear();
  assert.equal(adapter.tryPlay({ ...wire, area: null, targets: ['mv-float-1'] }), true);
  adapter.update(3.999); assert.ok(adapter.stats().zone.activeEffects > 0);
  adapter.update(.002); assert.equal(adapter.stats().zone.activeEffects, 0, '無座標的高塔版面仍精確回收');
});
