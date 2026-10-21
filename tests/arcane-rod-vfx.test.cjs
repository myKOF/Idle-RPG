'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const { loadEliteEnv, makeElite } = require('./helpers/elite-env.cjs');
const preset = JSON.parse(fs.readFileSync(require.resolve('../vfx/presets/en-arcane-beams-1.json')));

test('ARCANE-CYLINDER 圓柱端點、直徑及旋轉逐時對齊同一份傷害線段', () => {
  const d = loadEliteEnv().ELITE_AFFIXES.e_arcane;
  const nodes = [];
  const rt = Core.createRuntime({ resolver: { resolve: id => id }, backend: {
    createNode() { const n = {}; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode() {}
  } });
  rt.registerPreset(preset);
  const size = Runtime.resolveSizing(preset.sizing, { r: d.len });
  rt.play(preset.id, { position: { x: 20, y: 40 }, ...size });
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
  for (const t of [0, .5, 2, 4.5, 5.99]) {
    rt.update(t - (rt.previousTime || 0)); rt.previousTime = t;
    const body = nodes.find(n => n.t?.visible && n.t.zIndex === 2).t;
    const angle = d.rot * Math.PI / 180 * t;
    close(body.x, 20); close(body.y, 40);
    // Top centre of the authored SVG is the outer endpoint; bottom centre is the pivot.
    close(1024 * body.scaleY * Math.sin(body.rotation - body.skewX), d.len * Math.cos(angle));
    close(-1024 * body.scaleY * Math.cos(body.rotation - body.skewX), d.len * Math.sin(angle) * .5);
    close(104 * body.scaleX * Math.cos(body.rotation), -d.wid * Math.sin(angle));
    close(104 * body.scaleX * Math.sin(body.rotation), d.wid * Math.cos(angle) * .5);
  }
  rt.update(.02);
  assert.equal(rt.stats().activeEffects, 0);
  rt.destroy();
});

test('ARCANE-CYLINDER 向量素材與出貨索引一致；表定接線、壽命及作者入口一致', () => {
  const d = loadEliteEnv().ELITE_AFFIXES.e_arcane;
  assert.equal(preset.id, d.v.field);
  assert.equal(preset.duration, d.dur);
  assert.deepEqual(Array.from(d.arms), [1, 1]);
  assert.equal(Core.validatePreset(preset).ok, true);
  const author = require('../tools/vfx/authoring/author/arcane-rod.cjs');
  assert.equal(Core.serialisePreset(author.make()), Core.serialisePreset(preset));
  const id = 'codex-authored/arcane-rod/cylinder.svg';
  const index = JSON.parse(fs.readFileSync(require.resolve('../vfx/shipped-assets.json')));
  const entry = index.assets.find(a => a.assetId === id);
  assert.ok(entry);
  const svg = fs.readFileSync(require.resolve('../images/vfx/assets/' + entry.relativePath));
  assert.equal(svg.toString(), author.cylinderSVG());
  assert.equal(entry.contentHash, 'sha256:' + require('node:crypto').createHash('sha256').update(svg).digest('hex'));
});

test('ARCANE-CYLINDER 真引擎預警後的場域事件經遊戲Adapter持續旋轉，刷新不重播', () => {
  const c = loadEliteEnv();
  c.FIELD.player.hp = c.FIELD.player.maxHp = 1e12;
  const m = makeElite(c, ['e_arcane'], { hp: 1e9 });
  for (const k of Object.keys(m._el.cd)) m._el.cd[k] = 1e9;
  m._el.repoAt = Infinity;
  const nodes = [];
  const backend = { createNode() { const n = {}; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode() {} };
  const adapter = Runtime.create({ core: Core, resolver: { resolve: id => id },
    fxBackend: backend, zoneBackend: backend,
    ctx: { posOf: () => ({ x: 0, y: 0 }), playerPos: () => ({ x: 0, y: 0 }) } });
  adapter.registerPresets([preset]);
  c.eliteCastRotbeam(m, c.ELITE_AFFIXES.e_arcane);
  let read = 0, fields = 0;
  const directions = new Set();
  for (let i = 0; i < 85; i++) {
    c.GT += .1; c.eliteTick(.1);
    for (const event of c.vfx.slice(read)) if (event.vfx?.ground === preset.id) {
      assert.equal(event.area.r, c.ELITE_AFFIXES.e_arcane.len);
      assert.equal(adapter.tryPlay(event), true);
      fields++;
    }
    read = c.vfx.length;
    adapter.update(.1);
    for (const n of nodes) if (n.t?.visible && n.t.zIndex === 2) directions.add(Math.round(n.t.rotation * 10));
  }
  assert.ok(fields > 10);
  assert.ok(directions.size > 25, 'field refresh must retain continuous rotation');
  assert.equal(adapter.stats().played, 1, 'refreshes extend the existing field');
  assert.equal(adapter.stats().grounds, 0);
  adapter.destroy();
});
