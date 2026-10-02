'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');

function setup(lv = 1) {
  const file = path.join(__dirname, 'skill2-waterball-frostnova-legendary.test.cjs');
  const src = fs.readFileSync(file, 'utf8');
  const h = { require: createRequire(file), __dirname, console }; vm.createContext(h);
  vm.runInContext(src.slice(0, src.indexOf('test(')) + '\nthis.c=loadContext();', h);
  const c = h.c, p = h.playerEnt(); p.mp = 10000; c.FIELD.player = p;
  h.maxLevels(c, 'waterball'); h.equip(c, 'waterball'); h.setUlt(c, 'waterball', 'ragingTide', lv);
  c.chance = () => false;
  const es = [], hits = h.stubHits(c), specs = h.stubVfx(c), ctx = h.tickCtx(c, p, es);
  const fields = kind => c.SKILL2_RT.grounds.filter(f => f.gid === 'waterball' && f.kind === kind);
  const spawn = (n, extra = {}) => {
    for (let i = 0; i < n; i++) c.sgSpawnGround(p, c.BASE_STATS, 'waterball', {
      kind: 'tornado', from: { x: i * 10, y: 0 }, radius: 50, dmgVal: 1,
      hits: 100, gap: 5, floatSel: 'mv-float', vfxTier: 7, ...extra });
  };
  const tide = (dt = 0) => { c.GT = +(c.GT + dt).toFixed(8); c.sgTickRagingTide(ctx, dt); };
  const ground = dt => { c.GT = +(c.GT + dt).toFixed(8); c.sgTickGrounds(dt, ctx); };
  const merge = () => { spawn(12); tide(); tide(1.5); return fields('tidetornado')[0]; };
  return { h, c, p, es, hits, specs, ctx, fields, spawn, tide, ground, merge };
}
function close(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`); }

test('TIDE: authoritative configuration and descriptions retain base + per × level', () => {
  const { c } = setup(), u = c.sgUlt('waterball', 'ragingTide');
  assert.deepEqual({ ...u.def.fx }, { need: 12, durAdd: 5, durAddPer: .5, pct: 400,
    pctPer: 40, sec: 4, mergeDelay: 1.5, gap: .25, m: 30 });
  assert.deepEqual({ ...u.def.triggerVfx }, { ground: 'cast-water-tide-merge', field: 'field-water-tide-column' });
  assert.match(c.describeSkill2Ult('waterball', u.idx, 1), /5.5 秒.*12 道.*0.25 秒.*30 米.*440%.*4 秒/);
  assert.match(c.describeSkill2Ult('waterball', u.idx, 10), /10 秒.*800%/);
});

test('TIDE: ordinary and legendary tornado durations grow, but original cadence and frozen bonus remain', () => {
  for (const lv of [1, 10]) {
    const { c, p, h, es, ctx, fields } = setup(lv);
    const t = c.SKILLS2.waterball.tiers[6], levels = c.skills2Levels('waterball');
    c.sgSpawnWaterTornadoes(p, c.BASE_STATS, c.SKILLS2.waterball, levels, 'mv-float');
    const fs = fields('tornado'); assert.equal(fs.length, 4);
    const sec = t.fx.hits * t.fx.gap + 5 + .5 * lv;
    fs.forEach((f, i) => { close(f.expiresAt - f.startAt, sec + i * .35 * .15); close(f.gap, .35);
      assert.equal(f.hits, Math.floor(sec / .35 + 1e-9)); assert.equal(f.frozenMult, 2); });
    c.SKILL2_RT.grounds = [];
    const target = h.enemy(1e9, 100, 0); es.push(target);
    const spec = { hits: 6, gap: .35, radius: 50, dmgVal: 500, frozenMult: 2 };
    c.sgSpawnWaterTornadoAt(p, c.BASE_STATS, spec, target, 'mv-float');
    close(fields('tornado')[0].expiresAt - c.GT, sec);
    c.GT = sec - .01; c.sgTickGrounds(sec - .01, ctx); assert.equal(fields('tornado').length, 1);
    c.GT = sec; c.sgTickGrounds(.01, ctx); assert.equal(fields('tornado').length, 0);
    delete c.G.player.skills2.ult.waterball;
    assert.deepEqual({ ...c.sgWaterTornadoLife(6, .35) }, { hits: 6, lifeSec: 0 });
  }
});

test('TIDE: twelfth tornado remains visible for 1.5 seconds, then consumes all tornadoes at their centroid', () => {
  const { c, spawn, tide, fields, specs } = setup();
  spawn(11); tide(); assert.equal(c.SKILL2_RT.tideMergeAt, 0);
  spawn(1); tide(); close(c.SKILL2_RT.tideMergeAt, 1.5);
  assert.equal(specs.at(-1).variant, 'water-tide-merge');
  assert.deepEqual({ ...specs.at(-1).vfx }, { ground: 'cast-water-tide-merge' });
  assert.equal(specs.at(-1).area.follow, true); assert.equal(specs.at(-1).area.r, undefined);
  tide(1.49); assert.equal(fields('tornado').length, 12); assert.equal(fields('tidetornado').length, 0);
  spawn(2, { from: { x: 200, y: 10 }, startDelaySec: .1 });
  const other = { gid: 'firepillar', kind: 'pillar' }; c.SKILL2_RT.grounds.push(other);
  tide(.01); assert.equal(fields('tornado').length, 0); assert.equal(fields('tidetornado').length, 1);
  assert.ok(c.SKILL2_RT.grounds.includes(other));
  close(fields('tidetornado')[0].pos.x, 550 / 12); // 尚未出現的兩道也清除，但不進重心。
  assert.equal(specs.filter(s => s.variant === 'water-tornado-end').length, 15);
  const giant = specs.at(-1); assert.equal(giant.area.lifeSec, 4); assert.equal(giant.area.r, 300);
  assert.deepEqual({ ...giant.vfx }, { field: 'field-water-tide-column' });
});

test('TIDE: threshold can trigger again and replaces an existing giant rather than stacking giants', () => {
  const { merge, spawn, tide, fields, specs } = setup(); const first = merge();
  spawn(12); tide(); tide(1.5);
  assert.equal(fields('tidetornado').length, 1); assert.notEqual(fields('tidetornado')[0].vfxId, first.vfxId);
  assert.ok(specs.some(s => s.variant === 'water-tornado-end' && s.area.id === first.vfxId));
  assert.equal(fields('tornado').length, 0);
});

test('TIDE: giant has exactly sixteen quarter-second hits, 30m body-edge range and a fixed four-second life', () => {
  for (const lv of [1, 10]) {
    const { h, c, es, hits, merge, ground, fields } = setup(lv), giant = merge();
    assert.equal(giant.hits, 16); close(giant.expiresAt - c.GT, 4);
    close(giant.dmgVal, 500 * (400 + lv * 40) / 100);
    const centre = h.enemy(1e9, giant.pos.x, 0, 'centre');
    centre.buffs.sgFrozen = { until: 999, val: 0, stacks: 1 };
    const edge = h.enemy(1e9, giant.pos.x + 320, 0, 'edge');
    const outside = h.enemy(1e9, giant.pos.x + 320.001, 0, 'outside'); es.push(centre, edge, outside);
    ground(.249); assert.equal(hits.length, 0); ground(.001);
    assert.equal(hits.length, 2); assert.ok(hits.every(x => x.atk === giant.dmgVal && x.total === 0 && x.elem === 'ice'));
    for (let i = 1; i < 16; i++) ground(.25);
    assert.equal(hits.length, 32); assert.equal(hits.filter(x => x.ent === outside).length, 0);
    assert.equal(fields('tidetornado').length, 0); ground(1); assert.equal(hits.length, 32);
  }
});

test('TIDE: cancellation resets the merge overlay and stats failure never discards tornadoes', () => {
  const { c, spawn, tide, fields, specs } = setup(); spawn(12); tide();
  fields('tornado')[0].hitsLeft = 0; tide(.2); assert.equal(c.SKILL2_RT.tideMergeAt, 0);
  assert.equal(specs.at(-1).variant, 'water-tornado-end'); assert.match(specs.at(-1).area.id, /^sg-tide-merge-/);
  spawn(1); tide(); c.getStats = () => null; tide(1.5); assert.equal(fields('tornado').length, 13);
  c.G.player.loadout = []; tide(); assert.equal(c.SKILL2_RT.tideMergeAt, 0);
});

test('TIDE: death and earthguard knockdown pause merge and tornado damage clocks without catch-up', () => {
  for (const dead of [true, false]) {
    const { h, c, p, es, ctx, spawn, tide, fields, hits } = setup();
    spawn(12, { hits: 50, gap: .25, lifeSec: 20 }); es.push(h.enemy(1e9, 50, 0)); tide(); tide(.5);
    const next = fields('tornado')[0].nextAt, expires = fields('tornado')[0].expiresAt;
    if (dead) p.hp = 0; else c.SKILL2_RT.earthguardRevival = { endAt: 99 };
    h.advance(c, p, es, 2); assert.equal(hits.length, 0); close(c.SKILL2_RT.tideMergeAt, 3.5);
    close(fields('tornado')[0].nextAt, next + 2); close(fields('tornado')[0].expiresAt, expires + 2);
    p.hp = 1000; c.SKILL2_RT.earthguardRevival = null;
    tide(.99); assert.equal(fields('tidetornado').length, 0); tide(.01); assert.equal(fields('tidetornado').length, 1);
  }
});

test('TIDE: a positionless tower can merge and damage its live boss; not-yet-started fields do not count', () => {
  const { h, c, es, spawn, tide, ground, fields, hits } = setup(); const boss = h.enemy(1e9); es.push(boss);
  spawn(12, { from: null, tgt: boss, startDelaySec: .5 }); tide(); assert.equal(c.SKILL2_RT.tideMergeAt, 0);
  tide(.5); tide(1.5); const giant = fields('tidetornado')[0]; assert.equal(giant.pos, null);
  assert.equal(giant.tgt, boss); ground(.25); assert.equal(hits.length, 1); assert.equal(hits[0].atk, 2200);
});

function visuals() {
  const nodes = [], plays = [], backends = {};
  for (const k of ['fx', 'zone', 'billboard']) backends[k] = {
    createNode(spec) { const n = { spec, backend: k }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode(n) { n.t = null; }
  };
  let player = { x: 10, y: 20 };
  const core = { ...Core, createRuntime(opts) { const actual = Core.createRuntime(opts); return {
    ...actual, play(id, params) { plays.push({ id, params }); return actual.play(id, params); } }; } };
  const rt = Runtime.create({ core, resolver: { resolve: id => id }, fxBackend: backends.fx,
    zoneBackend: backends.zone, billboardBackend: backends.billboard,
    ctx: { playerPos: () => player, posOf: () => player } });
  rt.registerPresets(['field-water-tornado', 'field-water-tide-column', 'cast-water-tide-merge']
    .map(id => require('../vfx/presets/' + id + '.json')));
  return { rt, nodes, plays, move: () => { player = { x: 40, y: 50 }; } };
}

test('TIDE: Worker events preserve lifetime, separate merge/giant roles and empty stop roles', () => {
  const { merge, specs } = setup(); merge();
  const shim = {}; shim.self = shim; vm.createContext(shim);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/worker/shim.js'), 'utf8'), shim);
  for (const s of specs) shim.playCombatVfx(s);
  const events = JSON.parse(JSON.stringify(shim.shimDrainUrgentVisualEvents()));
  const giant = events.find(e => e.vfx?.field === 'field-water-tide-column');
  assert.equal(giant.area.lifeSec, 4); assert.equal(giant.area.r, 300);
  assert.ok(events.some(e => e.variant === 'water-tornado-end' && Object.keys(e.vfx).length === 0));
  const { rt, nodes } = visuals(); events.forEach(e => rt.tryPlay(e)); rt.update(.1);
  assert.equal(rt.stats().grounds, 1); assert.ok(nodes.some(n => n.backend === 'fx' && n.t?.visible));
  rt.update(3.89); assert.equal(rt.stats().grounds, 1); rt.update(.011); assert.equal(rt.stats().grounds, 0); rt.destroy();
});

test('TIDE: merge swirl follows player above the field, while giant scales to a 60m diameter and uses sparse particles', () => {
  const { specs, spawn, tide } = setup(); spawn(12); tide();
  const { rt, nodes, plays, move } = visuals(); rt.tryPlay(specs.at(-1)); rt.update(.3);
  const swirl = nodes.find(n => /ice-merge-vortex/.test(n.spec.assetUrl) && n.t?.visible);
  assert.ok(swirl); assert.equal(swirl.backend, 'billboard'); assert.ok(swirl.t.y < 20);
  const old = { x: swirl.t.x, y: swirl.t.y }; move(); rt.update(.1);
  close(swirl.t.x - old.x, 30); close(swirl.t.y - old.y, 30);
  tide(1.5); specs.filter(s => s.variant === 'water-tornado-end').forEach(s => rt.tryPlay(s));
  const giant = specs.at(-1); rt.tryPlay(giant); rt.update(.1);
  const ring = nodes.find(n => n.spec.assetUrl.endsWith('circle_01.png') && n.t?.visible);
  assert.ok(ring); close(512 * ring.t.scaleX, 600);
  const column = require('../vfx/presets/field-water-tide-column.json');
  assert.equal(column.layers.find(l => l.type === 'particle').maxParticles, 14);
  assert.ok(column.layers.filter(l => l.type !== 'particle').every(l => l.alpha <= .22));
  assert.equal(rt.stats().grounds, 1); rt.destroy();
});

test('TIDE: consumption cancels both active fields and pending Runtime jobs immediately', () => {
  const { rt } = visuals(); const normal = { variant: 'water-tornado', fxKind: 'aura',
    targets: [], dur: .35, vfx: { field: 'field-water-tornado' }, area: { id: 'small', x: 0, y: 0, r: 50 } };
  rt.tryPlay(normal); rt.tryPlay({ ...normal, delayMs: 100 });
  assert.equal(rt.stats().grounds, 1); assert.equal(rt.stats().pending, 1);
  rt.tryPlay({ variant: 'water-tornado-end', area: { id: 'small' }, vfx: {} });
  assert.equal(rt.stats().grounds, 0); assert.equal(rt.stats().pending, 0);
  rt.update(1); assert.equal(rt.stats().grounds, 0); rt.destroy();
});
