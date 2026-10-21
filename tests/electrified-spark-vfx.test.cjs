'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const Core = require('../js/vfx-core.js');
const author = require('../tools/vfx/authoring/author/electrified-spark.cjs');
const preset = JSON.parse(fs.readFileSync(require.resolve('../vfx/presets/en-spark.json')));

test('ELECTRIFIED-CURRENT 兩條獨立隨機扭動電流，各自保留核准長度與線寬', () => {
  assert.equal(Core.validatePreset(preset).ok, true);
  assert.equal(Core.serialisePreset(author.make()), Core.serialisePreset(preset));
  assert.equal(Core.serialisePreset(require('../tools/vfx/authoring/author/enemy-skills.cjs').NEW['en-spark']()), Core.serialisePreset(preset));
  assert.equal(preset.duration, .5); assert.equal(preset.loop, true);
  assert.equal(preset.sizing.shape, 'projectile-circle'); assert.equal(preset.sizing.authored.radius, 22);
  const frames = Array.from({ length: 64 }, (_, i) => author.framePaths(i));
  assert.equal(new Set(frames.map(f => JSON.stringify(f.paths))).size, 64, '每格必須有不同電流路徑');
  for (const f of frames) {
    assert.equal(f.paths.length, 2, '只有兩條開放電流，沒有外環或分叉');
    const local = line => line.map(([x, y]) => [x - line[0][0], y - line[0][1]]);
    assert.notDeepEqual(local(f.paths[0]), local(f.paths[1]), '不能只是相同線條平移複製');
    for (const line of f.paths) {
      const ref = author.framePaths(0, 1).paths[0];
      const span = a => Math.hypot((a.at(-1)[0] - a[0][0]) * .22, (a.at(-1)[1] - a[0][1]) * .11);
      assert.ok(Math.abs(span(line) / span(ref) - 1.5) < 1e-12);
      assert.ok(line.length >= 3);
      for (const [x, y] of line) assert.ok(x > 8 && x < 248 && y > 8 && y < 248, '折線留在cell內，避免鄰格滲色');
    }
  }
  assert.deepEqual(author.framePaths(64), author.framePaths(0), '相位首尾連續');
  const delta = frame => frame.paths[1].slice(1, -1).map((p, i) => p.map((v, axis) => v - frame.paths[0][i + 1][axis]));
  assert.notDeepEqual(delta(frames[0]), delta(frames[8]), '兩條電流之間的相對形狀也必須變化');
  const svg = author.currentSVG();
  assert.equal((svg.match(/stroke-width="7.2"/g) || []).length, 128, '兩條電流的線寬保持加倍');
  assert.equal((svg.match(/stroke-width="2.8"/g) || []).length, 128, '兩條亮芯保持加倍');
  const index = JSON.parse(fs.readFileSync(require.resolve('../vfx/shipped-assets.json')));
  const entry = index.assets.find(a => a.assetId === author.assetId);
  assert.ok(entry, '正式出貨索引必須包含新電流');
  const bytes = fs.readFileSync(require.resolve('../images/vfx/assets/' + entry.relativePath));
  assert.equal(bytes.toString(), svg);
  assert.equal(entry.contentHash, 'sha256:' + require('node:crypto').createHash('sha256').update(bytes).digest('hex'));
  const layout = JSON.parse(fs.readFileSync(require.resolve('../vfx/layouts/en-spark.json')));
  assert.deepEqual(layout.groups[0].layerIds, preset.layers.map(l => l.id));
});

test('ELECTRIFIED-CURRENT 36顆連續五秒持續選動畫格、不旋轉星芒、不累積粒子且全數回收', () => {
  const nodes = [], seen = new Set(); let alive = 0;
  const rt = Core.createRuntime({ budget: { maxActiveEffects: 64 }, resolver: { resolve: id => id }, backend: {
    createNode() { const n = {}; nodes.push(n); alive++; return n; },
    updateNode(n, t) { n.t = { ...t }; if (t.visible !== false) seen.add(t.frame); },
    destroyNode() { alive--; }
  } });
  rt.registerPreset(preset);
  for (let i = 0; i < 36; i++) rt.play(preset.id, { position: { x: i * 20, y: 0 } });
  for (let i = 0; i < 300; i++) {
    rt.update(1 / 60);
    assert.equal(rt.stats().activeEffects, 36); assert.equal(rt.stats().activeParticles, 0);
    assert.equal(alive, 36); assert.ok(nodes.every(n => n.t.rotation === 0));
  }
  assert.equal(seen.size, 64); rt.stopAll(); rt.update(1);
  assert.equal(rt.stats().activeEffects, 0); rt.destroy(); assert.equal(alive, 0);
});

test('ELECTRIFIED-CURRENT 真實帶電飛行事件經正式Adapter維持路徑／本體尺寸／壽命並回收', () => {
  const Runtime = require('../js/vfx-runtime.js');
  const { loadEliteEnv, makeElite } = require('./helpers/elite-env.cjs');
  const c = loadEliteEnv(), m = makeElite(c, ['e_electrified'], { x: 150, y: 50, hp: 1e9 });
  c.eliteOnDamaged(m, 100, c.FIELD.player);
  const d = c.ELITE_AFFIXES.e_electrified;
  const events = c.vfx.filter(e => e.vfx && e.vfx.projectile === preset.id);
  assert.ok(events.length >= 2 && events.length <= 4);
  assert.equal(events.length, c.ELITE_RT.sparks.length);
  for (let i = 0; i < events.length; i++) {
    const e = events[i], spark = c.ELITE_RT.sparks[i];
    assert.equal(e.lineWidth, d.bodyD); assert.equal(e.travelMs[0], d.life * 1000);
    assert.ok(Math.abs(e.area.x - (spark.x + spark.vx * d.life)) < 1e-8);
    assert.ok(Math.abs(e.area.y - (spark.y + spark.vy * d.life)) < 1e-8);
  }
  const nodes = [], seen = new Set();
  const rt = Runtime.create({ core: Core, resolver: { has: () => true, resolve: id => '/' + id },
    fxBackend: {
      createNode(spec) { const n = { spec }; nodes.push(n); return n; },
      updateNode(n, t) { n.t = { ...t }; if (t.visible !== false) seen.add(t.frame); },
      destroyNode() {}, destroy() {}
    }, ctx: { posOf: () => null, footOf: () => null, playerPos: () => ({ x: 0, y: 0 }) }
  });
  rt.registerPresets([preset]);
  const event = Runtime.screenSpaceSpec(events[0], .5), a = event.area, sec = event.travelMs[0] / 1000;
  rt.tryPlay(event);
  for (let i = 1; i < 500; i++) {
    rt.update(sec / 500);
    assert.equal(nodes.length, 1, '單一圖集精靈，不會循環新增雪花或電流實例');
    const t = nodes[0].t, k = i / 500;
    assert.ok(Math.abs(t.x - (a.sourceX + (a.x - a.sourceX) * k)) < 1e-6);
    assert.ok(Math.abs(t.y - (a.sourceY + (a.y - a.sourceY) * k)) < 1e-6);
    assert.equal(rt.stats().fx.activeParticles, 0);
  }
  assert.equal(seen.size, 64, '圖層持續時間跨過Preset週期仍須播完64格');
  rt.update(sec / 500 + .02);
  assert.equal(rt.stats().projectiles, 0); assert.equal(rt.stats().fx.activeEffects, 0);
  assert.equal(rt.stats().fx.activeParticles, 0); assert.equal(rt.stats().missing, 0); rt.destroy();
});
