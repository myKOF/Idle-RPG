'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { createEngine } = require('../scripts/sim/engine');
const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
const preset = require('../vfx/presets/ground-homing-wind-crescent.json');
const helperFile = path.join(__dirname, 'skill2-windblade-vacuum-legendary.test.cjs');
const h = { require: createRequire(helperFile), __dirname, console };
vm.createContext(h);
vm.runInContext(fs.readFileSync(helperFile, 'utf8').split("test('")[0], h);
function setup(lv, legendary = [], ult = 'stormMyriad', worker = false) {
  const c = worker ? createEngine({ seed: 9 }).boot(null).ctx : h.loadContext();
  if (worker) { c.G.player.level = 1000; c.G.player.skills2 = { levels: {}, ult: {} }; c._statsCache = null; }
  h.maxLevels(c, 'windblade'); h.equip(c, 'windblade');
  if (lv > 0) h.setUlt(c, 'windblade', ult, lv);
  if (!worker) h.setLegendary(c, legendary);
  const p = h.playerEnt(), m = h.enemy(1e15, 20, 0, 'target');
  p.pos = { x: 0, y: 0 }; p.mp = 10000; p.hp = 10000; p._lockTarget = m;
  c.FIELD = { player: p, enemies: [m], dpsWindow: [] }; c.Math.random = () => .5;
  if (worker) c.shimDrainUrgentVisualEvents(); else { h.stubVfx(c); h.stubHits(c); }
  return { c, p, m };
}
function launch(s) { assert.ok(s.c.castSkill2(s.p, [s.m], 'windblade', 'mv-float')); }
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);

for (const lv of [1, 10]) test(`暴風萬刃 Lv.${lv}：大小風刃各增一道、七秒追擊，傷害獨立乘算`, () => {
  const s = setup(lv); launch(s);
  const fields = s.c.SKILL2_RT.grounds;
  const large = fields.filter(f => f.vfxUlt === 'stormMyriad'), small = fields.filter(f => !f.vfxUlt);
  assert.equal(large.length, 12); assert.equal(small.length, 12);
  assert.equal(s.c.SKILL2_RT.projectiles.length, 0);
  // 固定魔攻500；原風系池為1170%，再乘超神(50+5×等級)%獨立加成。
  const bodyDamage = 500 * 11.7 * (1 + (50 + 5 * lv) / 100);
  for (const f of fields) near(f.hits * f.gap, 7);
  for (const f of large) { near(f.dmgVal, bodyDamage); near(f.pulseDmg, bodyDamage * .5); assert.equal(f.chaseM, 60); }
  for (const f of small) { near(f.dmgVal, bodyDamage * .6); assert.equal(f.pulseGap, 0); assert.equal(f.chaseM, 30); }
  for (const delay of [0, .2, .4]) assert.equal(fields.filter(f => f.startAt === delay).length, 8);
});

test('暴風萬刃：大小風刃統一使用超神七秒，未選超神時保留追跡風刃時間', () => {
  for (const lv of [0, 1]) {
    const s = setup(lv), fx = s.c.SKILLS2.windblade.tiers[4].fx;
    fx.sec = 2; fx.secPer = 0;
    launch(s);
    for (const f of s.c.SKILL2_RT.grounds) near(f.hits * f.gap, lv ? 7 : 2);
    assert.equal(s.c.SKILL2_RT.grounds.length, lv ? 24 : 8);
    assert.equal(s.c.SKILL2_RT.projectiles.length, lv ? 0 : 8);
  }
});

test('暴風萬刃：斷空刃連射與風之痕鏡射相容，仍為獨立傷害乘區', () => {
  const s = setup(10, ['windbladeVoidCut', 'windbladeTrace']); launch(s);
  const fields = s.c.SKILL2_RT.grounds;
  assert.equal(fields.filter(f => f.vfxUlt === 'stormMyriad').length, 16);
  assert.equal(fields.filter(f => !f.vfxUlt).length, 32);
  for (const f of fields) {
    near(f.hits * f.gap, 7);
    near(f.dmgVal, 500 * (11.7 + .3) * 2 * (f.vfxUlt ? 1 : .6 * 1.3));
  }
});

test('其他超神：嵐之山仍融合成四道直線風刃，天穹崩裂仍被動只射一小刃', () => {
  const mountain = setup(10, [], 'stormMountain'); launch(mountain);
  assert.equal(mountain.c.SKILL2_RT.projectiles.length, 4);
  assert.equal(mountain.c.SKILL2_RT.grounds.length, 0);
  const sky = setup(10, [], 'skyCollapse'); sky.c.Math.random = () => 0;
  sky.c.skills2OnPlayerDamaged(sky.m, sky.p, 1, false, {}, 'mv-float');
  assert.equal(sky.c.SKILL2_RT.projectiles.length, 0);
  assert.equal(sky.c.SKILL2_RT.grounds.length, 1);
  near(sky.c.SKILL2_RT.grounds[0].hits * sky.c.SKILL2_RT.grounds[0].gap, 7);
});

test('正式Worker→Runtime：每道風刃從自己的發射時間追擊七秒，重送位置不新增本體且到期回收', () => {
  const s = setup(1, [], 'stormMyriad', true); launch(s);
  const fields = s.c.SKILL2_RT.grounds;
  assert.equal(fields.length, 24);
  const ids = new Set(fields.map(f => f.vfxId)), seen = new Set();
  // 正式Preset含持續發射的粒子；只計風刃本體素材，不將新粒子誤判成重複本體。
  const backend = { creates: 0, createNode(spec) {
    if (spec.assetUrl.includes('moon-original-01.png')) this.creates++;
    return {};
  }, updateNode() {}, destroyNode() {} };
  const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => id },
    fxBackend: backend, airBackend: backend, zoneBackend: backend,
    ctx: { playerPos: () => s.p.pos, posOf: () => s.m.pos } });
  rt.registerPresets([preset]);
  function advance(seconds) {
    for (let t = 0; t < seconds - 1e-9; t += .05) {
      h.advance(s.c, s.p, [s.m], .05);
      for (const e of s.c.shimDrainUrgentVisualEvents().filter(e => e.variant === 'wind-blade-homing')) {
        assert.ok(ids.has(e.area.id)); seen.add(e.area.id);
        assert.equal(e.vfx.ground, preset.id); assert.equal(rt.tryPlay(e), true);
      }
      rt.update(.05);
    }
  }
  advance(.6);
  assert.equal(seen.size, 24); assert.equal(rt.stats().grounds, 24);
  const created = backend.creates;
  advance(6.3);
  assert.equal(backend.creates, created, '追擊位置更新沿用原本體');
  assert.equal(s.c.SKILL2_RT.grounds.length, 24);
  assert.ok(s.m.hp < 1e15, '正式Worker追擊確實命中敵人');
  advance(.15); assert.equal(s.c.SKILL2_RT.grounds.length, 16);
  advance(.2); assert.equal(s.c.SKILL2_RT.grounds.length, 8);
  advance(.2); assert.equal(s.c.SKILL2_RT.grounds.length, 0);
  rt.update(1); assert.equal(rt.stats().grounds, 0); rt.destroy();
});
