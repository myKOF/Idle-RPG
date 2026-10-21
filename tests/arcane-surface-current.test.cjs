'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const Core = require('../js/vfx-core');
const author = require('../tools/vfx/authoring/author/arcane-rod.cjs');
const preset = require('../vfx/presets/en-arcane-beams-1.json');

test('ARCANE-CURRENT 表面電流逐格流動，完整貼合已編輯柱身的旋轉／非等比投影', () => {
  const nodes = [];
  const rt = Core.createRuntime({ resolver: { resolve: id => id }, backend: {
    createNode(spec) { const n = { spec }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode() {} } });
  rt.registerPreset(preset);
  rt.play(preset.id, { position: { x: 20, y: 40 }, scaleX: 2, scaleY: 1.7 });
  let previous = 0;
  const frames = new Set();
  for (const time of [.01, .12, .23, .34, .45, .56, .67]) {
    rt.update(time - previous); previous = time;
    const body = nodes.find(n => n.spec.assetUrl.endsWith('/cylinder.svg') && n.t?.zIndex === 2).t;
    const current = nodes.find(n => n.spec.assetUrl.endsWith('/surface-current.svg')).t;
    for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'sortY']) assert.equal(current[key], body[key], key);
    assert.equal(current.visible, body.visible);
    assert.ok(current.alpha > 0 && current.alpha < body.alpha, 'surface current must remain subtle');
    frames.add(current.frame);
  }
  assert.ok(frames.size >= 5, 'sheet must animate rather than remain a static overlay');
  rt.stopAll(); assert.equal(rt.stats().activeEffects, 0); rt.destroy();
});

test('ARCANE-CURRENT 增補工具不重設使用者的柱身與父層設定，重跑不重複圖層', () => {
  const base = JSON.parse(JSON.stringify(preset));
  base.layers = base.layers.filter(l => l.id !== 'surface-current');
  const result = author.enhance(base);
  assert.deepEqual(result.layers.filter(l => l.id !== 'surface-current'), base.layers);
  assert.deepEqual(author.enhance(result), result);
  assert.ok(Core.validatePreset(result).ok);
});

test('ARCANE-CURRENT 自製圖集與出貨雜湊一致，圖集保留透明柱身裁切及8格', () => {
  const index = require('../vfx/shipped-assets.json');
  for (const [name, source] of [['cylinder.svg', author.cylinderSVG()], ['surface-current.svg', author.currentSVG()], ['emitter-flare.svg', author.emitterSVG()]]) {
    const entry = index.assets.find(a => a.assetId === 'codex-authored/arcane-rod/' + name);
    assert.ok(entry);
    const bytes = fs.readFileSync(require.resolve('../images/vfx/assets/' + entry.relativePath));
    assert.equal(bytes.toString(), source);
    assert.equal('sha256:' + crypto.createHash('sha256').update(bytes).digest('hex'), entry.contentHash);
  }
  assert.equal((author.currentSVG().match(/clip-path="url\(#body\)"/g) || []).length, 8);
  assert.match(author.cylinderSVG(), /72 0 C96 17/);
});
