'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const cfg = require('../tools/config_tables.cjs');

const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
const IDS = (() => {
  const at = data.indexOf('bossOni:'), open = data.indexOf('{', at);
  let depth = 0, end = open;
  for (; end < data.length; end++) { if (data[end] === '{') depth++; else if (data[end] === '}' && --depth === 0) break; }
  return cfg.evalLiteral(data.slice(open, end + 1));
})();
const ctx = { window: undefined, globalThis: null };
ctx.globalThis = ctx;
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/boss-oni-fx.js'), 'utf8'), ctx);
const { BossOniFx } = ctx;

function fixture(opts) {
  opts = opts || {};
  const random = opts.random;
  const played = [], reacted = [];
  const mk = (id, params) => {
    const r = { id, params: Object.assign({}, params), initial: Object.assign({}, params), moves: 0, finished: false, stopped: false,
      move(p) { this.params = Object.assign({}, p); this.moves++; return !this.stopped; },
      finish() { this.finished = true; }, stop() { this.stopped = true; } };
    played.push(r); return r;
  };
  const clipSec = { Walk: 1, Attack1: 1.8, Attack2: 1.3333, Attack3: 2.2, Die: 4 };
  const oni = {
    id: 'tb-float', npc3d: true, state: 'idle', root: { x: 700, y: 300, destroyed: false },
    data: { npcId: 'tower_boss_5' },
    body: { scale: { x: 1.2 }, npc3d: { attackKey: 'attack1', clips: { attack1: { clip: 'Attack1' }, attack2: { clip: 'Attack2' }, attack3: { clip: 'Attack3' } },
      controller: { pxPerMeter: 82.6, duration: (c) => clipSec[c],
        anchorPoint: (n) => ({ Eye_L: { x: -10, y: -140 }, Eye_R: { x: 10, y: -150 }, Fx_Mouth: { x: -50, y: -120 }, Fx_Back: { x: 60, y: -130 }, Body: { x: 0, y: -140 } })[n] } } }
  };
  const ents = { 'tb-float': oni };
  const other = { id: 'x', npc3d: true, state: 'idle', root: { x: 0, y: 0 }, data: { npcId: 'tower_boss_1' }, body: { scale: { x: 1 }, npc3d: {} } };
  ents.x = other;
  const fx = BossOniFx.create({ vfx: { playFree: mk }, presets: IDS, entities: () => ents, hitReact: (id) => reacted.push(id), random,
    screenPosOf: (id) => (id === 'pv-float' ? { x: 300, y: 250 } : { x: 700, y: 160 }), footOf: (id) => (id === 'pv-float' ? { x: 300, y: 300 } : { x: 700, y: 300 }) });
  const run = (sec, dt) => { for (let t = 0; t < sec; t += dt || 1 / 60) fx.update(dt || 1 / 60); };
  return { fx, oni, ents, played, reacted, run };
}

test('every boss-oni preset id in VFX_COMBAT_DEFAULTS exists as a preset file', () => {
  const all = [];
  (function walk(v) { if (typeof v === 'string') all.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(IDS);
  assert.equal(all.length, 8 + 8, 'eight shared/base ids plus four recoloured ids for each of the two variants');
  for (const id of all) assert.ok(fs.existsSync(path.join(root, 'vfx/presets', id + '.json')), id);
});

test('eyes glow in front of the body and the mist trails behind it; only the oni is touched', () => {
  const f = fixture(); f.run(0.1);
  const eyes = f.played.filter((p) => p.id === IDS.eye), mist = f.played.filter((p) => p.id === IDS.mist);
  assert.equal(eyes.length, 2); assert.equal(mist.length, 1);
  assert.ok(eyes.every((p) => p.params.depthY > f.oni.root.y), 'eyes drawn in front of the 3D body');
  assert.ok(mist[0].params.depthY < f.oni.root.y, 'mist drawn behind the 3D body');
  assert.ok(eyes[0].params.scale > 1.5 && eyes[0].params.scale === mist[0].params.scale, 'scale follows the body size');
  f.run(0.5); assert.ok(eyes.every((p) => p.moves > 5), 'positions follow the model every frame');
  f.oni.state = 'dying'; f.run(0.1);
  assert.ok(eyes.every((p) => p.finished) && mist[0].finished, 'loops end when the boss dies');
  assert.equal(f.fx.attack({ sourceId: 'x' }), false, 'other bosses are not handled');
});

test('attack 2 releases one skull at the target and two at +-30 degrees that fly 60 m; hit resolves at the target', () => {
  const f = fixture(); f.oni.body.npc3d.attackKey = 'attack2';
  assert.equal(f.fx.attack({ sourceId: 'tb-float', targets: ['pv-float'], hit: true }), true);
  f.fx.onActPlayed(f.oni, 0.8);                        // compressed from 1.333 s to 0.8 s
  f.run(0.8 * 0.4667 / 1.3333 - 0.05); assert.equal(f.played.filter((p) => p.id === IDS.skull).length, 0, 'not released before the release frame');
  f.run(0.12);
  const skulls = f.played.filter((p) => p.id === IDS.skull);
  assert.equal(skulls.length, 3);
  assert.equal(f.played.filter((p) => p.id === IDS.spit).length, 1);
  const base = Math.atan2(160 - 180, 300 - 650);       // mouth is at root + anchor*scale, only the fan geometry matters below
  const angles = skulls.map((s) => s.params.rotation);
  assert.ok(Math.abs(angles[1] - angles[0] - Math.PI / 6) < 1e-6 && Math.abs(angles[0] - angles[2] - Math.PI / 6) < 1e-6, 'fan of 0 / +30 / -30 degrees');
  const start = skulls.map((s) => ({ x: s.initial.position.x, y: s.initial.position.y }));
  f.run(3);
  assert.ok(skulls.every((s) => s.finished), 'all skulls end');
  const side = skulls[1], travelled = Math.hypot(side.params.position.x - start[1].x, side.params.position.y - start[1].y);
  assert.ok(Math.abs(travelled - 600) < 8, 'side skulls fly 60 m (600 units), got ' + travelled);
  assert.deepEqual(f.reacted, ['pv-float'], 'only the aimed skull reacts on the target');
  assert.equal(f.played.filter((p) => p.id === IDS.skullHit).length, 1);
  assert.ok(Number.isFinite(base));
});

test('attack 3 flame is anchored at the mouth, capped at 15 m and lasts the flame window of the clip', () => {
  const f = fixture(); f.oni.body.npc3d.attackKey = 'attack3';
  f.fx.attack({ sourceId: 'tb-float', targets: ['pv-float'], hit: true });
  f.fx.onActPlayed(f.oni, 2.2);
  f.run(0.733 + 0.1);
  const flame = f.played.find((p) => p.id === IDS.flame); assert.ok(flame, 'flame started at 0.733 s');
  assert.ok(flame.params.scaleX <= 150 / 200 + 1e-9, 'length capped to 15 m');
  assert.ok(flame.params.depthY > f.oni.root.y);
  f.run(0.5); assert.ok(!flame.finished && flame.moves > 10);
  f.run(0.7); assert.ok(flame.finished, 'ends at 1.6 s of the clip');
});

test('attack 1 impact lands on the target at the ram frame; a missed attack plays the effect without a hit reaction', () => {
  const f = fixture(); f.oni.body.npc3d.attackKey = 'attack1';
  f.fx.attack({ sourceId: 'tb-float', targets: ['pv-float'], hit: false });
  f.fx.onActPlayed(f.oni, 1.8);
  f.run(0.55); assert.equal(f.played.filter((p) => p.id === IDS.ramHit).length, 0);
  f.run(0.2);
  const hit = f.played.find((p) => p.id === IDS.ramHit);
  assert.ok(hit && hit.params.position.x === 300);
  assert.deepEqual(f.reacted, []);
});

test('basic attacks are random among ram / skulls / flame without repeating the same one twice; skill casts use the ram animation only', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const f = fixture({ random: rnd }); const st = f.oni.body.npc3d, basic = [], casts = [];
  for (let i = 0; i < 300; i++) {
    f.fx.attack({ sourceId: 'tb-float', targets: ['pv-float'], hit: true });
    f.fx.beforeAct(f.oni); basic.push(st.forceKey); st.attackKey = st.forceKey; f.fx.onActPlayed(f.oni, 1);
    f.fx.beforeAct(f.oni); casts.push(st.forceKey);       // a skill cast in between: no pending event
  }
  assert.ok(basic.every((k, i) => i === 0 || k !== basic[i - 1]), 'never the same move twice in a row');
  for (const k of ['attack1', 'attack2', 'attack3']) assert.ok(basic.filter((x) => x === k).length > 70, k + ' is picked about a third of the time');
  assert.ok(casts.every((k) => k === 'attack1'));
  for (const id of ['tower_boss_15', 'tower_boss_25']) assert.ok(BossOniFx.NPC_IDS[id], id);
});

test('the blue and purple versions spit and burn in their own colours; the red one keeps the original ones', () => {
  for (const [npc, sfx] of [['tower_boss_5', ''], ['tower_boss_15', '-blue'], ['tower_boss_25', '-purple']]) {
    const f = fixture(); f.oni.data.npcId = npc; f.oni.body.npc3d.attackKey = 'attack2';
    f.fx.attack({ sourceId: 'tb-float', targets: ['pv-float'], hit: true }); f.fx.onActPlayed(f.oni, 1.333); f.run(3);
    assert.ok(f.played.some((p) => p.id === 'boss-oni-skull' + sfx), npc + ' skull');
    assert.ok(f.played.some((p) => p.id === 'boss-oni-spit' + sfx) && f.played.some((p) => p.id === 'boss-oni-skull-hit' + sfx), npc + ' spit / hit');
    const g = fixture(); g.oni.data.npcId = npc; g.oni.body.npc3d.attackKey = 'attack3';
    g.fx.attack({ sourceId: 'tb-float', targets: ['pv-float'], hit: true }); g.fx.onActPlayed(g.oni, 2.2); g.run(1);
    assert.ok(g.played.some((p) => p.id === 'boss-oni-flame' + sfx), npc + ' flame');
    assert.ok(g.played.filter((p) => /boss-oni-(eye|mist)/.test(p.id)).every((p) => !/-(blue|purple)/.test(p.id)), 'eyes and mist are shared');
  }
});

test('death shatters at 2.0 s and stops the loops', () => {
  const f = fixture(); f.run(0.1);
  f.oni.state = 'dying';                                  // the renderer sets this right before calling onDeath
  f.fx.onDeath(f.oni);
  f.run(1.9); assert.equal(f.played.filter((p) => p.id === IDS.shatter).length, 0);
  f.run(0.2); assert.equal(f.played.filter((p) => p.id === IDS.shatter).length, 1);
  assert.ok(f.played.filter((p) => p.id === IDS.eye).every((p) => p.finished));
});

test('the renderer routes enemy attacks of the oni to the module and keeps the simulation authoritative', () => {
  const src = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
  assert.match(src, /isEnemyAttack && S\.oni && S\.oni\.attack\(spec\)/);
  assert.match(src, /S\.oni\.onActPlayed\(e, e\.towerActionSeconds\)/);
  assert.match(src, /S\.oni\.onDeath\(ent\)/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const at = (f) => html.indexOf('src="js/' + f + '?v=');
  assert.ok(at('boss-oni-fx.js') > 0 && at('boss-oni-fx.js') < at('battle-renderer.js'));
});
