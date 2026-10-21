'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadEliteEnv, makeElite } = require('./helpers/elite-env.cjs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const ROOT = path.resolve(__dirname, '..');
const IDS = ['white', 'blue', 'purple', 'yellow'].map(c => 'en-missile-' + c);
const presets = IDS.map(id => JSON.parse(fs.readFileSync(path.join(ROOT, 'vfx/presets', id + '.json'))));

function scene(over) {
  const c = loadEliteEnv();
  c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  const m = makeElite(c, ['e_missile'], { x: 100, y: 0, hp: 1e12 });
  Object.keys(m._el.cd).forEach(k => { m._el.cd[k] = 1e9; });
  m._el.repoAt = Infinity;
  // 新配置依規範先存待套用差異；隔離驗收不回寫正式表或生成資料。
  const d = Object.assign({}, c.ELITE_AFFIXES.e_missile, { n: [4, 4], leg1: .275, hold: 1 }, over);
  const log = [];
  c.playCombatVfx = spec => log.push({ t: c.GT - 100, spec });
  let t = 0;
  function until(end, before) {
    while (t < end - 1e-8) {
      t = Math.min(end, +(t + .005).toFixed(6)); c.GT = 100 + t;
      if (before) before(t);
      c.eliteTick(.005);
    }
  }
  return { c, m, d, log, until };
}
const flights = log => log.filter(e => e.spec.fxKind === 'projectile');

test('MISSILE-SALVO 同批後退，剎停一秒後同拍鎖定／齊射，抵達才結算', () => {
  for (const count of [3, 4, 5]) {
    const { c, m, d, log, until } = scene({ n: [count, count] });
    c.eliteCastMissiles(m, d);
    until(.21);
    const back = flights(log);
    assert.equal(back.length, count);
    assert.equal(new Set(back.map(e => e.t)).size, 1);
    for (const e of back) {
      assert.equal(e.spec.travelMs[0], 275);
      assert.equal(e.spec.area.holdSec, 1);
      assert.equal(e.spec.area.brake, true);
      assert.ok(e.spec.area.x > 100);
      assert.equal(e.spec.lineWidth, d.bodyD);
      assert.ok(IDS.includes(e.spec.vfx.projectile));
    }
    assert.equal(new Set(back.map(e => e.spec.area.y)).size, count, '停駐位置分開');
    until(1.47);
    assert.equal(flights(log).length, count, '一秒待機完成前不齊射');
    assert.equal(c.FIELD.player.hp, 1e12, '後退與等待期間不傷害');
    c.bfPlayerPos().x = -50; c.bfPlayerPos().y = 30;
    until(1.49);
    const salvo = flights(log).slice(count);
    assert.equal(salvo.length, count);
    assert.equal(new Set(salvo.map(e => e.t)).size, 1);
    for (let i = 0; i < count; i++) {
      const s = salvo[i].spec, b = back[i].spec;
      assert.equal(s.area.sourceX, b.area.x); assert.equal(s.area.sourceY, b.area.y);
      assert.equal(s.area.x, -50); assert.equal(s.area.y, 30);
      assert.equal(s.area.startAngle, b.area.holdAngle);
      assert.equal(s.travelMs[0], 380);
    }
    until(1.85);
    assert.equal(c.FIELD.player.hp, 1e12);
    until(1.88);
    const impacts = log.filter(e => e.spec.vfx.attack === d.v.attack);
    assert.equal(impacts.length, count);
    assert.equal(new Set(impacts.map(e => e.t)).size, 1);
    assert.ok(c.FIELD.player.hp < 1e12);
    assert.equal(c.ELITE_RT.errors, 0);
  }
});

test('MISSILE-SALVO 齊射後不改落點；走位、施法者提前死亡與重置均正確處理', () => {
  const s = scene(); s.c.eliteCastMissiles(s.m, s.d); s.until(1.49);
  s.c.bfPlayerPos().x = -500; s.until(2);
  assert.equal(s.c.FIELD.player.hp, 1e12);
  assert.ok(flights(s.log).slice(4).every(e => e.spec.area.x === 0));
  for (const cancel of ['death', 'reset']) {
    const x = scene(); x.c.eliteCastMissiles(x.m, x.d); x.until(.8);
    if (cancel === 'death') x.m.hp = 0; else x.c.eliteReset();
    x.until(3); assert.equal(flights(x.log).length, 4, cancel);
    assert.equal(x.log.filter(e => e.spec.vfx.attack === x.d.v.attack).length, 0, '取消後不爆炸');
    assert.equal(x.c.floats.filter(f => /^-/.test(f.text)).length, 0, '取消後不造成受傷浮字');
  }
});

function adapter(presetList = presets, context) {
  const nodes = [];
  const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => '/' + id },
    fxBackend: {
      createNode(spec) { const n = { spec, history: [] }; nodes.push(n); return n; },
      updateNode(node, t) { node.visible = !!t && t.visible !== false; if (node.visible) node.history.push({ ...t }); },
      destroyNode() {}, destroy() {}
    }, ctx: context || { posOf: () => null, footOf: () => null, chainPoint: () => null, playerPos: () => ({ x: 0, y: 0 }) }
  });
  rt.registerPresets(presetList);
  return { rt, nodes };
}
function curve(a, k) {
  const u = 1 - k;
  return { x: u*u*a.sourceX + 2*u*k*a.controlX + k*k*a.x,
    y: u*u*a.sourceY + 2*u*k*a.controlY + k*k*a.y };
}

test('MISSILE-SALVO 真實Preset平滑剎停／原地停留／轉向，尾跡自然消散不洩漏', () => {
  const x = scene(); x.c.eliteCastMissiles(x.m, x.d); x.until(.21);
  const ev = flights(x.log)[0].spec;
  x.until(1.49);
  const forward = flights(x.log)[4].spec;
  for (const preset of presets) {
    const { rt, nodes } = adapter();
    rt.tryPlay({ ...ev, vfx: { projectile: preset.id } });
    let core, maxParticles = 0;
    for (let i = 1; i <= 305; i++) {
      rt.update(1/240);
      core ||= nodes.find(n => n.spec.assetUrl.endsWith('circle_05.png'));
      assert.ok(core, '實際光芯可見');
      const expected = curve(ev.area, 1 - Math.pow(1 - Math.min(1, i / 240 / .275), 3));
      const p = core.history.at(-1);
      assert.ok(Math.abs(p.x - expected.x) < 1e-7, preset.id + ' x');
      assert.ok(Math.abs(p.y - expected.y) < 1e-7, preset.id + ' y');
      if (i > 67) {
        const prev = core.history.at(-2);
        assert.ok(Math.hypot(p.x-prev.x, p.y-prev.y) < 1e-7, '待機原地');
        const turn = Math.atan2(Math.sin(p.rotation-prev.rotation), Math.cos(p.rotation-prev.rotation));
        assert.ok(Math.abs(turn) < .5, '待機轉向連續');
      }
      maxParticles = Math.max(maxParticles, rt.stats().fx.activeParticles);
      if (i === 192) {
        const cones = nodes.filter(n => n.spec.assetUrl.endsWith('cone_composed_c.png'));
        assert.ok(cones.length >= 2 && cones.every(n => !n.visible), '停駐後光錐消退');
        assert.equal(rt.stats().fx.activeParticles, 0, '停駐後舊光點散完，不持續噴出硬尾');
      }
    }
    assert.equal(rt.stats().projectiles, 1, '停留尚未結束不提前消失');
    const p = core.history.at(-1);
    assert.ok(Math.abs(Math.atan2(Math.sin(p.rotation-ev.area.holdAngle), Math.cos(p.rotation-ev.area.holdAngle))) < .01);
    assert.ok(maxParticles > 0 && maxParticles <= 48, '尾跡有發射且受預算限制');
    rt.update(.01); assert.equal(rt.stats().projectiles, 0);
    assert.equal(rt.stats().fx.activeParticles, 0, '待機結束時沒有殘留長尾');
    rt.tryPlay({ ...forward, vfx: { projectile: preset.id } });
    for (let i = 0; i < 100; i++) rt.update(1/240);
    assert.equal(rt.stats().projectiles, 0);
    assert.ok(rt.stats().fx.activeParticles > 0, '衝刺抵達後，飛行留下的光點自然淡出');
    rt.update(1); assert.equal(rt.stats().fx.activeEffects, 0); assert.equal(rt.stats().fx.activeParticles, 0);
    assert.equal(rt.stats().missing, 0); rt.destroy();
  }
});

test('MISSILE-SALVO 舊事件保持原曲線與壽命，角度投影不修改原事件', () => {
  // 高塔／無實體座標時可能有備援座標；明確路徑不能因此被吸回備援點。
  const { rt, nodes } = adapter(presets, { posOf: () => ({ x: -999, y: -999 }),
    footOf: () => ({ x: -999, y: -999 }), playerPos: () => ({ x: 0, y: 0 }) });
  const area = { sourceX: 100, sourceY: 0, x: 132, y: 25.6, controlX: 116, controlY: 0, knifeFlight: true };
  rt.tryPlay({ fxKind: 'projectile', variant: 'elite-flight', travelMs: [550], area, vfx: { projectile: IDS[0] } });
  rt.update(.275);
  const p = nodes.find(n => n.spec.assetUrl.endsWith('circle_05.png')).history.at(-1);
  assert.equal(p.x, 116); assert.ok(Math.abs(p.y - 6.4) < 1e-8);
  rt.update(.28); assert.equal(rt.stats().projectiles, 0); rt.destroy();
  const spec = { area: { holdAngle: .8, startAngle: -1.4 } };
  const projected = Runtime.screenSpaceSpec(spec, .62);
  for (const key of ['holdAngle', 'startAngle']) assert.equal(projected.area[key], Math.atan2(.62*Math.sin(spec.area[key]), Math.cos(spec.area[key])));
  assert.equal(spec.area.holdAngle, .8);
});

test('MISSILE-SALVO 四色Preset可重製，柔光錐取代硬尾且無新增素材來源', () => {
  const author = require('../tools/vfx/authoring/author/enemy-skills.cjs');
  for (const p of presets) {
    const original = author.NEW[p.id](); original.schemaVersion = 1;
    assert.equal(Core.serialisePreset(p), Core.serialisePreset(original));
    assert.equal(p.loop, true);
    const glow = p.layers.find(l => l.id === 'glow');
    assert.ok(glow.scale.x <= .0859*.41); assert.ok(glow.alpha <= .45);
    assert.equal(p.layers.some(l => l.id === 'tail-core'), false, '移除原固定光棒');
    const cone = p.layers.find(l => l.id === 'tail-cone');
    assert.ok(cone.assetId.endsWith('cone_composed_c.png'));
    assert.equal(cone.anchor.y, 1, '錐尖接在彈頭端');
    assert.ok(Math.abs(cone.rotation + Math.PI/2) < 1e-6, '光錐朝向彈頭後方');
    assert.ok(cone.duration <= .4);
    assert.equal(cone.alphaOverLife.at(-1)[1], 0, '光錐逐漸消退');
    const trail = p.layers.find(l => l.id === 'trail');
    assert.ok(trail.lifetime[1] <= .35); assert.ok(trail.startScale[1] < .02);
    assert.ok(trail.speed[1] <= 1, '光點留在路徑，避免自行拉成噴射直棒');
    const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'vfx/layouts', p.id + '.json')));
    assert.deepEqual(layout.groups[0].layerIds, p.layers.map(l => l.id));
  }
});

test('MISSILE-SALVO Worker實際派送保留剎停、等待、轉向及完整飛行幾何', () => {
  const s = scene(); s.c.eliteCastMissiles(s.m, s.d); s.until(.21);
  const spec = flights(s.log)[0].spec;
  const c = { self: {} }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/worker/shim.js'), 'utf8'), c);
  c.playCombatVfx(spec);
  const events = JSON.parse(JSON.stringify(c.shimDrainUrgentVisualEvents()));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].area, JSON.parse(JSON.stringify(spec.area)));
  assert.deepEqual(events[0].travelMs, [275]);
  assert.equal(events[0].lineWidth, spec.lineWidth);
  const { rt } = adapter();
  assert.equal(rt.tryPlay(events[0]), true);
  rt.update(.8); assert.equal(rt.stats().projectiles, 1);
  rt.update(.6); assert.equal(rt.stats().projectiles, 0); rt.destroy();
});
