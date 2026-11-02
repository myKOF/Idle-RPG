'use strict';
/* 狀態光環貼合本體（playback.fitBody）：罩子大小與中心取自圖像目前可見範圍，而不是體型倍率與腳底。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');

function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`); }
function run(playback, box) {
  const nodes = [], backend = { createNode(spec) { const n = { spec }; nodes.push(n); return n; },
    updateNode(n, t) { n.t = { ...t }; }, destroyNode(n) { n.t = null; } };
  const foot = { x: 100, y: 300 };
  const old = global.statusVfxPreset;
  global.statusVfxPreset = () => 'fit-test';
  const rt = Runtime.create({ core: Core, resolver: { resolve: id => id }, zoneBackend: backend, fxBackend: backend,
    ctx: { playerPos: () => foot, posOf: () => foot, footOf: () => foot, bodyScaleOf: () => 2, bodyBoxOf: () => box } });
  try {
    rt.registerPresets([{ schemaVersion: 1, id: 'fit-test', playback, sizing: { shape: 'custom', widthM: 6, heightM: 6, authored: { width: 60, height: 60 } },
      duration: 1, loop: true, layers: [{ id: 'dome', type: 'sprite', assetId: 'test.png' }] }]);
    rt.syncStatuses([{ key: 'e1', sids: ['eInvuln'] }]);
    rt.update(.1);
    const live = nodes.find(n => n.t && n.t.visible); return { node: { t: { ...live.t } }, foot };
  } finally { rt.destroy(); global.statusVfxPreset = old; }
}

test('FIT-1 fitBody：罩子寬高＝可見範圍×1.15，中心對到可見範圍中心（飛行單位罩在空中）', () => {
  const { node, foot } = run({ fitBody: true }, { w: 80, h: 100, cx: 10, cy: 150 });
  close(node.t.scaleX * 60, 80 * 1.15);      // 畫面寬＝scale × 名目寬
  close(node.t.scaleY * 60, 100 * 1.15);
  close(node.t.x - foot.x, 10);
  close(node.t.y - foot.y, -(150 - 100 * 1.15 / 2));
});

test('FIT-2 fitPadding 可調；量不到可見範圍（null）退回原本的體型倍率做法', () => {
  const { node } = run({ fitBody: true, fitPadding: 1.4 }, { w: 50, h: 50, cx: 0, cy: 25 });
  close(node.t.scaleX * 60, 70);
  const fb = run({ fitBody: true }, null);
  close(fb.node.t.x - fb.foot.x, 0); close(fb.node.t.y - fb.foot.y, 0);
  close(fb.node.t.scaleX * 60, 120);   // 名目 6 米 × 每米 10px，再乘體型倍率 2
});

test('FIT-3 未開 fitBody 的光環不受影響；en-gold-dome 已開啟', () => {
  const plain = run({}, { w: 80, h: 100, cx: 10, cy: 150 });
  close(plain.node.t.x - plain.foot.x, 0);
  const dome = JSON.parse(fs.readFileSync(path.join(__dirname, '../vfx/presets/en-gold-dome.json'), 'utf8'));
  assert.equal(dome.playback.fitBody, true);
  assert.equal(Core.validatePreset ? Core.validatePreset(dome).ok : true, true);
});
