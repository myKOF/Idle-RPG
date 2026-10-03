'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine');
const Core = require('../js/vfx-core.js'), Runtime = require('../js/vfx-runtime.js');
const preset = require('../vfx/presets/proj-wind-crescent.json');
function setup(lv) {
  const engine = createEngine({ seed: 9 }).boot(null), c = engine.ctx;
  c.G.player.level = 1000; c.G.player.gold = 1e20;
  c.G.player.skills2 = { levels: { windblade: [10, lv, 0, 0, 0, 0, 0] }, ult: {} };
  c.G.player.loadout = ['sg:windblade']; c._statsCache = null;
  const p = { hp: 10000, mp: 10000, pos: { x: 0, y: 0 }, skillCds: {}, buffs: {}, dots: [], effects: {} };
  const enemy = (name, y) => ({ name, floatSel: name, hp: 1e9, maxHp: 1e9, pos: { x: 100, y },
    def: 0, mdef: 0, level: 1, effects: {}, buffs: {}, dots: [], resist: {}, ctrlRes: 0 });
  const primary = enemy('primary', 0), edge = enemy('edge', 0), outside = enemy('outside', 0);
  const body = c.bfEntityRadius(edge), factor = lv > 0 ? 1 + (30 + 3 * lv) / 100 : 1;
  edge.pos.y = 40 + body + 1;
  outside.pos.y = 40 * factor + body + .01;
  const enemies = [primary, edge, outside]; p._lockTarget = primary;
  c.FIELD.player = p; c.FIELD.enemies = enemies; c.Math.random = () => .5;
  c.shimDrainUrgentVisualEvents();
  return { engine, c, p, enemies, edge, outside, factor };
}
function launch(s) {
  s.p.skillCds['sg:windblade'] = 0;
  assert.ok(s.c.castSkill2(s.p, s.enemies, 'windblade', 'mv-float'));
  const spec = s.c.shimDrainUrgentVisualEvents().find(e => e.variant === 'wind-blade' && e.fxKind === 'projectile');
  assert.ok(spec); return spec;
}
function render(spec, groundScale) {
  const nodes = [], backend = { createNode(spec) { const n = { spec }; nodes.push(n); return n; },
    updateNode(n, transform) { n.transform = { ...transform }; }, destroyNode() {} };
  const rt = Runtime.create({ core: Core, resolver: { resolve: id => id }, groundScale,
    fxBackend: backend, airBackend: backend, zoneBackend: backend,
    ctx: { playerPos: () => ({ x: 0, y: 0 }), posOf: () => ({ x: 100, y: 0 }) } });
  rt.registerPresets([preset]); assert.equal(rt.tryPlay(spec), true); rt.update(.1);
  const transforms = nodes.filter(n => n.transform?.visible).map(n => n.transform);
  assert.ok(transforms.length > 0); rt.destroy(); return transforms;
}
test('巨型風刃：正式Worker未學／Lv.1／10保留本體長寬，實際邊界命中與特效比例一致', () => {
  const base = launch(setup(0));
  for (const lv of [0, 1, 10]) {
    const s = setup(lv), spec = launch(s);
    assert.ok(Math.abs(spec.bodyLength - 40 * s.factor) < 1e-9);
    assert.ok(Math.abs(spec.lineWidth - 80 * s.factor) < 1e-9);
    assert.equal(s.c.SKILL2_RT.projectiles[0].halfWidthPx, spec.lineWidth / 2);
    for (let i = 0; i < 20; i++) {
      s.c.GT += .05;
      s.c.tickSkill2(.05, { pEnt: s.p, getEnemies: () => s.enemies, floatSel: 'mv-float', onDeaths() {}, onDamage() {} });
    }
    assert.equal(s.edge.hp < 1e9, lv > 0, '學習後能命中原本範圍外的敵人');
    assert.equal(s.outside.hp, 1e9, '新邊界外仍不命中');
    for (const groundScale of [1, .65]) {
      const a = render(base, groundScale), b = render(spec, groundScale);
      assert.equal(a.length, b.length);
      for (let i = 0; i < a.length; i++) {
        assert.ok(Math.abs(b[i].scaleX / a[i].scaleX - s.factor) < 1e-8);
        assert.ok(Math.abs(b[i].scaleY / a[i].scaleY - s.factor) < 1e-8);
      }
    }
  }
});
test('巨型風刃：Worker升級指令後下一次施放立即使用新尺寸', () => {
  const s = setup(0); const before = launch(s);
  assert.deepEqual(JSON.parse(JSON.stringify(s.engine.cmd('skill2.learn', { group: 'windblade', tier: 1 }))), { ok: true, result: null });
  const after = launch(s);
  assert.ok(Math.abs(after.bodyLength / before.bodyLength - 1.33) < 1e-9);
  assert.ok(Math.abs(after.lineWidth / before.lineWidth - 1.33) < 1e-9);
});
test('bodyLength只透傳正有限數；缺省或不合法時保留舊事件形狀與Runtime退化', () => {
  const c = setup(0).c;
  for (const value of [undefined, null, 0, -1, Infinity, NaN, '80']) {
    c.playCombatVfx({ fxKind: 'projectile', bodyLength: value });
    assert.equal(Object.hasOwn(c.shimDrainUrgentVisualEvents()[0], 'bodyLength'), false);
  }
  const spec = launch(setup(0)); delete spec.bodyLength;
  assert.ok(render(spec, .65).length > 0);
});
