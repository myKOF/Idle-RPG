'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadEliteEnv, stepElite } = require('./helpers/elite-env.cjs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const readPreset = id => JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets', id + '.json')));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

function tower(id) {
  const c = loadEliteEnv();
  vm.runInContext('G.tower.active=true; TOWER.floor=46; TOWER.boss=makeBoss(46);' +
    'TOWER.player=newPlayerEntity(getStats()); TOWER.introCd=0; eliteReset();', c);
  const b = c.TOWER.boss;
  c.eliteEquip(b, [id], { tier: 'tower' });
  Object.keys(b._el.cd).forEach(k => { b._el.cd[k] = 1e9; });
  b.pos = { x: 160, y: 90 };
  b.hp = b.maxHp = c.TOWER.player.hp = 1e15;
  return { c, b };
}

test('BOSS不屈鬥魂：致命傷派送腳底白光與護罩，各按白光／無敵壽命，保命與擊退爆發保持', () => {
  const { c, b } = tower('ps_indomitable');
  b.hp = 0;
  assert.equal(c.eliteBossUndying(b), true);
  assert.equal(b.hp, b.maxHp * .03);
  const d = c.ELITE_AFFIXES.ps_indomitable;
  const u = c.SKILLS2.counter.ult.find(u => u.id === 'indomitable');
  const light = c.vfx.find(v => v.variant === 'indomitable-light');
  const guard = c.vfx.find(v => v.variant === 'indomitable-guard');
  assert.ok(light && guard);
  for (const [event, preset] of [[light, d.v.hit2], [guard, d.v.ground2]]) {
    assert.equal(event.fxKind, 'aura');
    assert.equal(event.cat, 'enemy');
    assert.equal(event.presetOnly, true);
    assert.deepEqual(Array.from(event.targets), [b.floatSel]);
    assert.equal(event.vfx.ground, preset);
    assert.equal(event.area, undefined, '純演出不能套擊退判定半徑');
  }
  near(light.dur, c.sgVal(u.fx, 'lightSec', c.bskLevel()));
  near(guard.dur, b._el.invulnUntil - c.GT);
  const burst = c.vfx.find(v => v.vfx.attack === d.v.attack2);
  assert.ok(burst);
  near(burst.area.x, b.pos.x); near(burst.area.y, b.pos.y);
  near(burst.area.r, c.bskRad(c.sgVal(u.fx, 'm', c.bskLevel())));
  assert.equal(c.ELITE_RT.vis.length, 0, '護罩不再登記成會反覆重播的範圍預警');
});

test('BOSS不屈鬥魂：正式事件經Runtime以腳底跟隨，身高／場景倍率不改尺寸，兩秒白光與護罩各自回收', () => {
  const { c, b } = tower('ps_indomitable');
  c.eliteBossUndying(b);
  const events = c.vfx.filter(v => /^indomitable-(light|guard)$/.test(v.variant));
  const presets = events.map(v => readPreset(v.vfx.ground));
  for (const groundScale of [.3, .65, 1]) for (const bodyHeight of [50, 240]) {
    const nodes = [], foot = { x: 440, y: 530 };
    const backend = { createNode(spec) { const n = { spec }; nodes.push(n); return n; },
      updateNode(n, t) { n.t = { ...t }; }, destroyNode(n) { n.destroyed = true; } };
    const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => id },
      fxBackend: backend, zoneBackend: backend, billboardBackend: backend,
      profile: { scale: .2, areaScale: .1, groundR: 0 }, groundScale,
      ctx: { playerPos: () => ({ x: 1, y: 2 }),
        posOf: id => id === b.floatSel ? { x: foot.x, y: foot.y - bodyHeight } : { x: 1, y: 2 },
        footOf: id => id === b.floatSel ? foot : { x: 1, y: 2 } } });
    rt.registerPresets(presets);
    events.forEach(v => assert.equal(rt.tryPlay(v), true)); rt.update(.5);
    const beam = nodes.find(n => n.spec.assetUrl.includes('streaks_composed_b'));
    const ring = nodes.find(n => n.spec.assetUrl.includes('ring_a'));
    assert.ok(beam && ring);
    const light = presets.find(p => p.id === events.find(v => v.variant === 'indomitable-light').vfx.ground);
    const guard = presets.find(p => p.id === events.find(v => v.variant === 'indomitable-guard').vfx.ground);
    near(beam.t.x, foot.x); near(beam.t.y, foot.y - 460);
    near(ring.t.y, foot.y - 58);
    near(beam.t.scaleX, light.layers.find(l => /streaks_composed_b/.test(l.assetId)).scale.x);
    near(ring.t.scaleX, guard.layers.find(l => /ring_a/.test(l.assetId)).scale.x);
    foot.x += 37; foot.y += 29; rt.update(.5);
    near(beam.t.x, foot.x); near(beam.t.y, foot.y - 460);
    near(ring.t.x, foot.x); near(ring.t.y, foot.y - 58);
    rt.update(1.01); assert.equal(beam.t.visible, false); assert.notEqual(ring.t.visible, false);
    const guardSec = events.find(v => v.variant === 'indomitable-guard').dur;
    rt.update(guardSec - 2.02); assert.notEqual(ring.t.visible, false);
    rt.update(.02); assert.equal(ring.t.visible, false); assert.equal(rt.stats().grounds, 0);
    rt.destroy();
  }
});

test('BOSS玩家技能與NPC專屬技能盤點：接地柱體不走身體受擊入口，並具有落點或目標', () => {
  const env = loadEliteEnv();
  const ids = Object.keys(env.ELITE_AFFIXES).filter(id => env.ELITE_AFFIXES[id].pool === 'player' || env.ELITE_AFFIXES[id].pool === 'exclusive');
  assert.equal(ids.filter(id => env.ELITE_AFFIXES[id].pool === 'player').length, 69);
  const columns = new Set(['pillar-indomitable-white', 'pillar-light', 'pillar-earth', 'pillar-rock-spike', 'bolt-sky-purple', 'bolt-curtain-lightning', 'bolt-thunderstrike-bluewhite']);
  const seen = new Set();
  for (const id of ids) {
    const { c, b } = tower(id), d = c.ELITE_AFFIXES[id];
    if (d.kind === 'active') c.eliteCast(b, d, id);
    else if (d.arch === 'pskUndying') c.eliteBossUndying(b);
    else if (d.arch === 'pskCounter') for (let i = 0; i < 10; i++) c.eliteOnDamaged(b, 100, null);
    else if (d.arch === 'pskReact') {
      const react = c.bskCtx(b, d); react.fx = { ...react.fx, chance: 100 };
      // 只固定觸發機率，不變更權威技能資料。
      const ctx = c.bskCtx; c.bskCtx = () => react;
      c.bskReactHit(b, d); c.bskCtx = ctx;
    }
    stepElite(c, 14);
    assert.equal(c.ELITE_RT.errors, 0, id);
    for (const event of c.vfx) {
      for (const [role, preset] of Object.entries(event.vfx || {})) {
        if (!columns.has(preset)) continue;
        seen.add(preset);
        assert.notEqual(role, 'hit', `${id}: ${preset}不能當身體受擊爆點`);
        assert.ok(event.area || event.targets && event.targets.length, `${id}: 柱體需要落點或目標`);
        if (!event.area) assert.ok(['indomitable-light', 'pillar', 'thunder-strike'].includes(event.variant), `${id}: ${event.variant}必須有腳底語意`);
      }
    }
  }
  for (const preset of columns) assert.ok(seen.has(preset), `已實際派送檢查${preset}`);
});
