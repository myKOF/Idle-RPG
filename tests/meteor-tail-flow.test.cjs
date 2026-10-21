'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Core = require('../js/vfx-core.js');
const preset = JSON.parse(fs.readFileSync(require.resolve('../vfx/presets/proj-meteor-inferno.json'), 'utf8'));
const tailIds = ['comet-tail-envelope', 'golden-tail-stream', 'white-tail-thread'];

function runtime(p, rotation = 0) {
  const nodes = [];
  const rt = Core.createRuntime({ resolver: { resolve: id => id }, backend: {
    createNode() { const n = { alive: true }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; },
    destroyNode(n) { n.alive = false; }
  } });
  rt.registerPreset(p);
  const handle = rt.play(p.id, { seed: 42, rotation });
  return { rt, nodes, handle };
}

test('METEOR-TAIL 火舌持續向後流動、伸展及橫向擾動，旋轉後仍跟隨航向', () => {
  for (const id of tailIds) for (const angle of [0, Math.PI / 3, -Math.PI / 2]) {
    const layer = preset.layers.find(l => l.id === id);
    const p = { ...preset, layers: [layer] };
    const a = runtime(p, angle);
    const b = runtime({ ...p, layers: [layer.noise ? { ...layer, noise: { ...layer.noise, strength: 0 } } : layer] }, angle);
    try {
      for (let i = 0; i < 20 && !a.nodes.length; i++) {
        a.rt.update(1 / 240); b.rt.update(1 / 240);
      }
      const first = a.nodes[0];
      assert.ok(first?.t?.visible, id + ' must emit visible geometry');
      const before = { ...first.t };
      a.rt.update(.025); b.rt.update(.025);
      const t = first.t;
      const dx = t.x - before.x, dy = t.y - before.y;
      assert.ok(dx * Math.cos(angle) + dy * Math.sin(angle) < -2, id + ' must flow backward');
      assert.ok(t.scaleX > before.scaleX, id + ' must stretch while young');
      assert.ok(t.scaleX > t.scaleY * 2, id + ' must retain a narrow flame shape');
      const plain = b.nodes[0].t;
      const across = -(t.x - plain.x) * Math.sin(angle) + (t.y - plain.y) * Math.cos(angle);
      assert.ok(Math.abs(across) > .01, id + ' must have transverse air flow');
      for (let i = 0; i < 70; i++) a.rt.update(1 / 60);
      assert.ok(a.rt.stats().activeParticles > 0, id + ' must keep emitting across the loop');
      assert.ok(a.rt.stats().activeParticles <= layer.maxParticles);
    } finally { a.rt.destroy(); b.rt.destroy(); }
  }
});

test('METEOR-TAIL 三顆循環飛行的粒子量有界，命中停止後釋放所有活動節點', () => {
  assert.equal(Core.validatePreset(preset).ok, true);
  const a = runtime(preset);
  const handles = [a.handle, a.rt.play(preset.id, { seed: 43 }), a.rt.play(preset.id, { seed: 44 })];
  let peak = 0;
  for (let i = 0; i < 300; i++) {
    a.rt.update(1 / 60);
    peak = Math.max(peak, a.rt.stats().activeParticles);
  }
  assert.ok(peak > 150 && peak < 330, 'three complete meteors must stay within the intended particle budget: ' + peak);
  assert.equal(a.rt.stats().droppedParticles, 0);
  for (const handle of handles) a.rt.stop(handle);
  assert.equal(a.rt.stats().activeEffects, 0);
  assert.equal(a.rt.stats().activeParticles, 0);
  assert.ok(a.nodes.every(n => !n.t?.visible));
  a.rt.destroy();
});
