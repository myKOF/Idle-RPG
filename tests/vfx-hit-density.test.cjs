'use strict';
/* ============================================================
   vfx-hit-density.test.cjs — 命中類特效的密度控制

   2026-09-30 使用者回報：寒冰箭「無限冰裂」每次命中回扣冷卻，敵人越多連鎖越快，
   實機每秒 172 個 burst-icearrow-crystal（單一爆點約 74 個節點），同屏 17,692 個節點，
   Core 一幀 51ms，FPS 7。成本正比於節點數。

   修法有兩件，這裡釘住行為：
     1. 同目標併發上限 K（預設 4，preset.playback.hitCap 可調）——只對「命中」欄。
     2. 自適應密度——畫面吃緊時 K 縮小、新播出的命中特效少發粒子；正常負載不介入。
   以及 Core 的 play(density) 參數：預設 1 與加入之前逐位元相同。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');

const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');

/* ---------------- 測試替身（與 vfx-runtime.test.cjs 同一套寫法） ---------------- */

function recordingBackend(log) {
  return {
    createNode(spec) { const n = { spec, transforms: [] }; log.nodes.push(n); return n; },
    updateNode(node, t) { if (t && t.visible !== false) node.transforms.push({ x: t.x, y: t.y, alpha: t.alpha }); },
    destroyNode() {}, destroy() {}
  };
}
const RESOLVER = { has: () => true, resolve: (id) => '/' + id };
const ENT = { 'mv-float-1': { x: 100, y: 50 }, 'mv-float-2': { x: 300, y: 50 }, 'pv-float': { x: 0, y: 0 } };

function unitPreset(id, duration, loop, extra) {
  return Object.assign({
    schemaVersion: 1, id, duration: duration || 1, loop: !!loop,
    layers: [{ id: 'a', type: 'sprite', assetId: id + '.png', zIndex: 0, scale: { x: 1, y: 1 } }]
  }, extra || {});
}
function burstPreset(id, count, duration) {
  return {
    schemaVersion: 1, id, duration: duration || 1, loop: false,
    layers: [{ id: 'p', type: 'particle', assetId: id + '.png', emission: { mode: 'burst', count }, lifetime: [1, 1], speed: [0, 0] }]
  };
}
function makeAdapter(presets, over) {
  const log = { nodes: [] };
  const adapter = VFXRuntime.create(Object.assign({
    core: VFXCore, resolver: RESOLVER,
    fxBackend: recordingBackend(log), zoneBackend: recordingBackend(log),
    ctx: {
      posOf: (id) => Object.assign({}, ENT[id] || { x: -999, y: -999 }),
      playerPos: () => ({ x: 0, y: 0 }),
      projectileTargetPoint: (id) => Object.assign({}, ENT[id] || { x: -999, y: -999 })
    }
  }, over || {}));
  adapter.registerPresets(presets);
  return { adapter, log };
}
const hitSpec = (id, targets) => ({ fxKind: 'impact', variant: 'test-hit', targets: targets || ['mv-float-1'], vfx: { hit: id } });
const nodesOf = (log, id) => log.nodes.filter((n) => n.spec.assetUrl.includes(id + '.png')).length;

/* ================= 密度調節器（純函式） ================= */

test('GOV-1 60 FPS 不介入：密度維持 1', () => {
  const g = VFXRuntime.createDensityGovernor();
  for (let i = 0; i < 600; i++) g.step(1 / 60);
  assert.strictEqual(g.quality(), 1);
});

test('GOV-2 13 FPS 持續吃緊：約 12 幀內降到下限，且不會低於下限', () => {
  const g = VFXRuntime.createDensityGovernor();
  const floor = VFXRuntime.DENSITY.min;
  let reached = -1;
  for (let i = 1; i <= 60; i++) {
    g.step(0.05);                                   // renderer 把 dt 夾在 50ms
    assert.ok(g.quality() >= floor - 1e-12, '不得低於下限');
    if (reached < 0 && g.quality() <= floor + 1e-12) reached = i;
  }
  assert.ok(reached > 0 && reached <= 14, '應在 14 幀內到底，實際 ' + reached);
});

test('GOV-3 恢復是慢的：60 FPS 之後不會立刻回到 1，最終回到 1', () => {
  const g = VFXRuntime.createDensityGovernor();
  for (let i = 0; i < 30; i++) g.step(0.05);
  assert.ok(g.quality() <= VFXRuntime.DENSITY.min + 1e-12);
  for (let i = 0; i < 60; i++) g.step(1 / 60);
  assert.ok(g.quality() < 1, '一秒內不該放回');
  for (let i = 0; i < 600; i++) g.step(1 / 60);
  assert.strictEqual(g.quality(), 1);
});

test('GOV-4 45～54 FPS 是死區：不降也不升', () => {
  const g = VFXRuntime.createDensityGovernor();
  for (let i = 0; i < 300; i++) g.step(0.02);       // 50 FPS
  assert.strictEqual(g.quality(), 1, '從 1 出發不會被拉下來');
  const g2 = VFXRuntime.createDensityGovernor();
  for (let i = 0; i < 30; i++) g2.step(0.05);
  for (let i = 0; i < 60; i++) g2.step(0.02);       // 先讓平滑值落進死區
  const held = g2.quality();
  for (let i = 0; i < 300; i++) g2.step(0.02);
  assert.strictEqual(g2.quality(), held, '死區內密度不動');
});

test('GOV-5 單一巨大 dt（分頁回前景）與暫停（dt = 0）不會觸發', () => {
  const g = VFXRuntime.createDensityGovernor();
  g.step(0.5);
  assert.strictEqual(g.quality(), 1);
  for (let i = 0; i < 100; i++) g.step(0);
  assert.strictEqual(g.quality(), 1);
});

/* ================= 同目標併發上限 ================= */

test('CAP-1 同一目標同一份命中特效最多同時 4 個；超過的算「已處理」，不退回舊畫法', () => {
  const { adapter, log } = makeAdapter([unitPreset('hit-a')]);
  for (let i = 0; i < 10; i++) assert.strictEqual(adapter.tryPlay(hitSpec('hit-a')), true, '第 ' + i + ' 次');
  adapter.update(0.001);
  assert.strictEqual(adapter.stats().played, 4);
  assert.strictEqual(adapter.stats().capped, 6);
  assert.strictEqual(adapter.stats().skipped, 0, '略過不能被記成「這份特效播不出來」（那個計數是在追缺件）');
  assert.strictEqual(nodesOf(log, 'hit-a'), 4);
});

test('CAP-2 不同目標、不同 preset 各算各的', () => {
  const { adapter } = makeAdapter([unitPreset('hit-a'), unitPreset('hit-b')]);
  for (let i = 0; i < 6; i++) {
    adapter.tryPlay(hitSpec('hit-a', ['mv-float-1']));
    adapter.tryPlay(hitSpec('hit-a', ['mv-float-2']));
    adapter.tryPlay(hitSpec('hit-b', ['mv-float-1']));
  }
  assert.strictEqual(adapter.stats().played, 12);   // 3 組 × 4
  assert.strictEqual(adapter.stats().capped, 6);    // 3 組 × 2
});

test('CAP-3 一則事件帶多個目標：每個目標各自判斷', () => {
  const { adapter } = makeAdapter([unitPreset('hit-a')]);
  for (let i = 0; i < 5; i++) adapter.tryPlay(hitSpec('hit-a', ['mv-float-1', 'mv-float-2']));
  assert.strictEqual(adapter.stats().played, 8);
});

test('CAP-4 特效播完就空出名額（依 preset 長度，不是依次數）', () => {
  const { adapter } = makeAdapter([unitPreset('hit-a', 1)]);
  for (let i = 0; i < 6; i++) adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 4);
  adapter.update(0.9);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 4, '0.9 秒時第一批還沒播完');
  adapter.update(0.2);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 5, '過了 1 秒名額釋出');
});

test('CAP-5 preset 的 playback.hitCap 可以覆寫 K', () => {
  const two = unitPreset('hit-two', 1, false, { playback: { hitCap: 2 } });
  const many = unitPreset('hit-many', 1, false, { playback: { hitCap: 9 } });
  const { adapter } = makeAdapter([two, many]);
  for (let i = 0; i < 12; i++) { adapter.tryPlay(hitSpec('hit-two')); adapter.tryPlay(hitSpec('hit-many')); }
  assert.strictEqual(adapter.stats().played, 2 + 9);
});

test('CAP-6 只管命中欄：攻擊欄、循環 preset 不受限', () => {
  const { adapter } = makeAdapter([unitPreset('atk-a'), unitPreset('hit-loop', 1, true)]);
  for (let i = 0; i < 10; i++) adapter.tryPlay({ fxKind: 'slash', targets: ['mv-float-1'], vfx: { attack: 'atk-a' } });
  assert.strictEqual(adapter.stats().played, 10, '攻擊欄 10 個全播');
  const before = adapter.stats().played;
  for (let i = 0; i < 10; i++) adapter.tryPlay(hitSpec('hit-loop'));
  assert.strictEqual(adapter.stats().played - before, 10, '循環 preset 沒有播完時刻，不納入');
  assert.strictEqual(adapter.stats().capped, 0);
});

test('CAP-7 飛行物抵達後的命中（延後路徑）同樣受限，且是在真的播放那一刻才數', () => {
  const { adapter, log } = makeAdapter([unitPreset('proj-a', 0.5), unitPreset('hit-a', 1)]);
  const spec = { fxKind: 'projectile', targets: ['mv-float-1'], travelMs: [200], vfx: { projectile: 'proj-a', hit: 'hit-a' } };
  for (let i = 0; i < 10; i++) assert.strictEqual(adapter.tryPlay(spec), true);
  adapter.update(0.05);
  assert.strictEqual(nodesOf(log, 'hit-a'), 0, '飛行中命中還沒播');
  adapter.update(0.2);
  assert.strictEqual(nodesOf(log, 'hit-a'), 4, '抵達後只留 4 個');
  assert.strictEqual(adapter.stats().capped, 6);
});

test('CAP-8 clear() 之後名額歸零', () => {
  const { adapter } = makeAdapter([unitPreset('hit-a')]);
  for (let i = 0; i < 4; i++) adapter.tryPlay(hitSpec('hit-a'));
  adapter.clear();
  for (let i = 0; i < 4; i++) adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 8);
});

/* ================= 自適應密度 ================= */

// 一開始就吃緊的調節器：一幀降到底，方便驗證下游行為。
const SQUEEZED = { slowDt: 0.0001, downPerFrame: 1 };

test('ADAPT-1 正常負載：stats 顯示密度 1、K 不縮、沒有任何略過或少發', () => {
  const { adapter } = makeAdapter([burstPreset('hit-burst', 20)]);
  for (let i = 0; i < 120; i++) adapter.update(1 / 60);
  const s = adapter.stats();
  assert.strictEqual(s.quality, 1);
  assert.strictEqual(s.hitCap, 4);
  adapter.tryPlay(hitSpec('hit-burst'));
  adapter.update(0.001);
  assert.strictEqual(adapter.stats().fx.activeParticles, 20);
  assert.strictEqual(adapter.stats().thinned, 0);
});

test('ADAPT-2 吃緊時：K 依密度縮小（4 → 1），新命中特效少發粒子', () => {
  const { adapter } = makeAdapter([burstPreset('hit-burst', 20)], { densityGovernor: SQUEEZED });
  adapter.update(1 / 60);
  const s = adapter.stats();
  assert.strictEqual(s.quality, VFXRuntime.DENSITY.min);
  assert.strictEqual(s.hitCap, 1);
  adapter.tryPlay(hitSpec('hit-burst'));
  adapter.update(0.001);
  assert.strictEqual(adapter.stats().fx.activeParticles, 5, '20 顆 × 0.25');
  assert.strictEqual(adapter.stats().thinned, 1);
  adapter.tryPlay(hitSpec('hit-burst'));
  assert.strictEqual(adapter.stats().capped, 1, 'K 縮到 1，第二個略過');
});

test('ADAPT-3 只縮命中類：吃緊時攻擊欄的粒子數不變', () => {
  const { adapter } = makeAdapter([burstPreset('atk-burst', 20)], { densityGovernor: SQUEEZED });
  adapter.update(1 / 60);
  adapter.tryPlay({ fxKind: 'slash', targets: ['mv-float-1'], vfx: { attack: 'atk-burst' } });
  adapter.update(0.001);
  assert.strictEqual(adapter.stats().fx.activeParticles, 20);
});

/* ================= Core：play(density) ================= */

function coreParticles(presetLayer, density, steps) {
  const log = { nodes: [] };
  const rt = VFXCore.createRuntime({ backend: recordingBackend(log), resolver: RESOLVER });
  rt.registerPreset({ schemaVersion: 1, id: 'p', duration: 2, layers: [presetLayer] });
  const params = { seed: 7 };
  if (density !== undefined) params.density = density;
  const h = rt.play('p', params);
  rt.setTransform(h, { position: { x: 0, y: 0 }, scale: 1 });
  for (let i = 0; i < (steps || 1); i++) rt.update(1 / 60);
  return { rt, log, count: rt.stats().activeParticles };
}
const burstLayer = (count) => ({ id: 'p', type: 'particle', assetId: 'x.png', emission: { mode: 'burst', count }, lifetime: [5, 5], speed: [0, 0] });
const rateLayer = (rate) => ({ id: 'p', type: 'particle', assetId: 'x.png', emission: { mode: 'rate', rate }, lifetime: [5, 5], speed: [0, 0] });

test('CORE-1 density 縮放爆發顆數，至少留 1 顆；1 或不給＝原樣', () => {
  assert.strictEqual(coreParticles(burstLayer(20), undefined).count, 20);
  assert.strictEqual(coreParticles(burstLayer(20), 1).count, 20);
  assert.strictEqual(coreParticles(burstLayer(20), 0.5).count, 10);
  assert.strictEqual(coreParticles(burstLayer(20), 0.25).count, 5);
  assert.strictEqual(coreParticles(burstLayer(3), 0.1).count, 1, '3 × 0.1 四捨五入是 0，但至少留 1 顆');
});

test('CORE-2 density 縮放持續發射的速率', () => {
  const full = coreParticles(rateLayer(120), undefined, 60).count;
  const half = coreParticles(rateLayer(120), 0.5, 60).count;
  assert.ok(Math.abs(full - 120) <= 2, '滿速約 120 顆，實際 ' + full);
  assert.ok(Math.abs(half - 60) <= 2, '半速約 60 顆，實際 ' + half);
});

test('CORE-3 density = 1 與不給參數逐位元相同（粒子位置一致）', () => {
  const a = coreParticles({ id: 'p', type: 'particle', assetId: 'x.png', emission: { mode: 'rate', rate: 90 }, lifetime: [1, 2], speed: [10, 50], spread: 360 }, undefined, 30);
  const b = coreParticles({ id: 'p', type: 'particle', assetId: 'x.png', emission: { mode: 'rate', rate: 90 }, lifetime: [1, 2], speed: [10, 50], spread: 360 }, 1, 30);
  assert.strictEqual(a.count, b.count);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a.log.nodes.map((n) => n.transforms))),
    JSON.parse(JSON.stringify(b.log.nodes.map((n) => n.transforms))));
});

test('CORE-4 不合法的 density 直接丟錯（不靜默換成 1）', () => {
  for (const bad of [0, -0.5, 1.5, NaN, Infinity, '0.5']) {
    assert.throws(() => coreParticles(burstLayer(4), bad), /density/, String(bad));
  }
});

test('CORE-5 playback.hitCap 是登記過的旋鈕：預設 4，範圍 1～64，越界的 preset 被拒絕', () => {
  assert.strictEqual(VFXCore.PLAYBACK_FIELDS.hitCap.default, 4);
  assert.strictEqual(VFXCore.playbackValue(undefined, 'hitCap'), 4);
  assert.strictEqual(VFXCore.playbackValue({ playback: { hitCap: 7 } }, 'hitCap'), 7);
  const ok = (v) => VFXCore.validatePreset(unitPreset('v', 1, false, { playback: { hitCap: v } })).ok;
  assert.strictEqual(ok(1), true);
  assert.strictEqual(ok(64), true);
  assert.strictEqual(ok(0), false);
  assert.strictEqual(ok(65), false);
});
