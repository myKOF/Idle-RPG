const test = require('node:test');
const assert = require('node:assert/strict');
const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');

/* ============================================================
   VFX Runtime 的斜俯視換算（js/vfx-runtime.js 的 screenSpaceSpec／groundScale，2026-09-22）

   Preset 是照斜視畫面畫的（地面光圈本身已壓扁約 0.4、往上是高度），所以戰場改成斜俯視之後，
   Preset 不再整份壓扁，而是由 Runtime 把事件的世界座標換成畫面座標、照原樣畫。
   會讓它「安靜地畫錯」的：
     ① 事件的點沒換——範圍技、飛行物落點在畫面上差了一半的縱向距離。
     ② 方向與沿方向的長度沒換——斜著射出去的東西角度偏、飛過頭。
     ③ 換兩次——延後播放的事件到期再進來又換一次，縱向變成 × k²。
     ④ 編輯器／沒給 groundScale 的地方被動到。
   ============================================================ */

const K = 0.5;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, msg + '：' + a + ' ≠ ' + b);

test('SCREEN-1 沒給 groundScale（或 1）：事件原封不動（編輯器、既有測試不受影響）', () => {
  const spec = { angle: 1, lineLength: 100, area: { x: 1, y: 200, a: 1 } };
  assert.equal(VFXRuntime.screenSpaceSpec(spec, undefined), spec);
  assert.equal(VFXRuntime.screenSpaceSpec(spec, 1), spec);
});

test('SCREEN-2 點 × k、方向換成畫面角度、沿方向的長度換成投影長度；半徑與厚度不變；不改原物件；不換兩次', () => {
  const th = Math.PI / 3;
  const spec = {
    angle: th, lineLength: 100,
    area: { x: 7, y: 200, sourceX: 1, sourceY: 40, destX: 2, destY: -60, controlX: 3, controlY: 10,
      r: 50, h: 30, orbR: 12, a: th, w: 80, moveA: Math.PI / 2, speed: 90 }
  };
  const frozen = JSON.stringify(spec);
  const out = VFXRuntime.screenSpaceSpec(spec, K);
  assert.equal(JSON.stringify(spec), frozen, '不可改動傳進來的事件（舊畫法還要用原本的世界座標）');
  const a = out.area;
  /* 點 */
  assert.deepEqual([a.x, a.sourceX, a.destX, a.controlX], [7, 1, 2, 3], 'x 不變');
  assert.deepEqual([a.y, a.sourceY, a.destY, a.controlY], [100, 20, -30, 5], 'y × k');
  /* 方向：畫面上的 (cos, k·sin) */
  near(out.angle, Math.atan2(K * Math.sin(th), Math.cos(th)), 'spec.angle');
  near(a.a, Math.atan2(K * Math.sin(th), Math.cos(th)), 'area.a');
  near(a.moveA, Math.atan2(K, 0), 'area.moveA（正下方仍是正下方）');
  /* 沿方向的長度：√(cos² + k²·sin²) */
  const f = Math.sqrt(Math.cos(th) ** 2 + K * K * Math.sin(th) ** 2);
  near(out.lineLength, 100 * f, 'lineLength 沿 angle');
  near(a.w, 80 * f, 'w 沿 a');
  near(a.speed, 90 * K, 'speed 沿 moveA（正下方縮 k 倍）');
  /* 半徑與厚度：Preset 的地面圖本身已經畫扁，再乘就壓兩次 */
  assert.deepEqual([a.r, a.h, a.orbR], [50, 30, 12]);
  /* 換過的不再換 */
  assert.equal(VFXRuntime.screenSpaceSpec(out, K), out);
});

function recordingBackend(log, tag) {
  return {
    createNode(spec) { const n = { spec, tag, transforms: [] }; log.push(n); return n; },
    updateNode(n, t) { n.transforms.push(Object.assign({}, t)); },
    destroyNode() {}
  };
}
function unitPreset(id) {
  return { schemaVersion: 1, id, duration: 2, loop: false,
    layers: [{ id: 'a', type: 'sprite', assetId: id + '.png', zIndex: 0, scale: { x: 1, y: 1 } }] };
}
function makeAdapter(groundScale) {
  const log = [];
  const adapter = VFXRuntime.create({
    core: VFXCore,
    resolver: { has: () => true, resolve: (id) => id },
    fxBackend: recordingBackend(log, 'fx'),
    zoneBackend: recordingBackend(log, 'zone'),
    groundScale,
    ctx: { posOf: () => ({ x: 0, y: 0 }), playerPos: () => ({ x: 0, y: 0 }), projectileTargetPoint: () => ({ x: 0, y: 0 }) }
  });
  adapter.registerPresets([unitPreset('screen-ground')]);
  return { adapter, log };
}
const groundEvent = (extra) => Object.assign({ fxKind: 'aura', dur: 2,
  area: { id: 'screen-test', x: 100, y: 200, r: 40 }, vfx: { ground: 'screen-ground' } }, extra || {});

test('SCREEN-3 給了 groundScale：範圍技畫在投影後的位置；沒給就是世界座標', () => {
  for (const [k, wantY] of [[K, 100], [undefined, 200]]) {
    const { adapter, log } = makeAdapter(k);
    assert.equal(adapter.tryPlay(groundEvent()), true);
    adapter.update(0.01);
    const t = log[0].transforms.at(-1);
    assert.equal(t.x, 100);
    near(t.y, wantY, 'groundScale ' + k);
  }
});

test('SCREEN-4 延後播放的事件到期再進來只換一次（不是 × k²）', () => {
  const { adapter, log } = makeAdapter(K);
  assert.equal(adapter.tryPlay(groundEvent({ delayMs: 100 })), true);
  adapter.update(0.05);
  assert.equal(log.length, 0, '還沒到時間');
  adapter.update(0.1);
  adapter.update(0.01);
  assert.ok(log.length > 0, '到期要播');
  near(log[0].transforms.at(-1).y, 100, '延後的事件');
});
