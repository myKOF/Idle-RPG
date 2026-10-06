'use strict';
/* ============================================================
   vfx-load-shedding.test.cjs — 吃緊時的特效降級（第二輪，2026-10-06）

   第一輪（vfx-hit-density.test.cjs）只管命中類，而且重負載下早就壓在下限，FPS 仍只有 12。
   重負載穩態實測（32 隻敵人、6 個滿階技能，平均約 4,700 個特效節點）：
     飛行子彈 36%（冰箭每支約 88 個節點，幾乎都是拖尾粒子）、命中爆點 33%、持續場域 27%；
     Core.play 每秒約 640 次，命中類約 340 次——場域一秒好幾拍、每拍都想播一次。
   所以密度小於 1（吃緊才會）時另外降三件事，這裡釘住：
     1. 飛行子彈（含冰箭／風刃追蹤本體）拖尾變疏
     2. 同目標同種命中特效限頻（到吃緊程度 0.3 才開始，免得輕微吃緊就改變畫面）
     3. 全場命中特效同時上限
   以及：密度為 1 時三件事都完全不介入；不該降的（敵方彈體、非子彈的場域）不受影響。
   後面另有 Pixi 後端的「透明度 ≤ 1% 就不畫」（無損）。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');

const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');
const VFXPixiBackend = require('../js/vfx-pixi-backend.js');

function recordingBackend(log) {
  return {
    createNode(spec) { const n = { spec, transforms: [] }; log.nodes.push(n); return n; },
    updateNode(node, t) { if (t && t.visible !== false) node.transforms.push({ x: t.x, y: t.y, alpha: t.alpha }); },
    destroyNode() {}, destroy() {}
  };
}
const RESOLVER = { has: () => true, resolve: (id) => '/' + id };

/* 固定在某個密度的調節器（runtime 的 o.governor 測試縫）；可中途改值。 */
function fixedGovernor(q, floor) {
  const g = { q, f: floor === undefined ? 0.25 : floor };
  g.step = () => g.q; g.quality = () => g.q; g.floor = () => g.f; g.frameMs = () => 16;
  return g;
}
function makeAdapter(presets, gov) {
  const log = { nodes: [] };
  const adapter = VFXRuntime.create({
    core: VFXCore, resolver: RESOLVER, governor: gov,
    fxBackend: recordingBackend(log), zoneBackend: recordingBackend(log),
    ctx: {
      posOf: () => ({ x: 100, y: 50 }), playerPos: () => ({ x: 0, y: 0 }),
      projectileTargetPoint: () => ({ x: 100, y: 50 })
    }
  });
  adapter.registerPresets(presets);
  return { adapter, log };
}
const hitPreset = (id, duration) => ({
  schemaVersion: 1, id, duration: duration || 0.1, loop: false,
  layers: [{ id: 'a', type: 'sprite', assetId: id + '.png', zIndex: 0, scale: { x: 1, y: 1 } }]
});
const trailPreset = (id) => ({
  schemaVersion: 1, id, duration: 2, loop: false,
  layers: [{ id: 't', type: 'particle', assetId: id + '.png', emission: { mode: 'rate', rate: 200 }, lifetime: [5, 5], speed: [0, 0] }]
});
const hitSpec = (id, target) => ({ fxKind: 'impact', variant: 'test-hit', targets: [target || 'mv-float-1'], vfx: { hit: id } });
// 一般場域走 zone、其餘走 fx。測試沒給獨立的 air／billboard／enemyAir 後端，它們就是 fx 的別名，
// 一起加會把同一批粒子算好幾次——只加測試裡真正獨立的兩個。
const particles = (adapter) => {
  const s = adapter.stats();
  return s.fx.activeParticles + s.zone.activeParticles;
};

/* ================= 命中：限頻與全場上限 ================= */

test('SHED-1 密度 1：三件事都不介入——同一瞬間疊 10 個只受併發上限 4 管，沒有任何限頻', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a')], fixedGovernor(1));
  for (let i = 0; i < 10; i++) adapter.tryPlay(hitSpec('hit-a'));
  const s = adapter.stats();
  assert.strictEqual(s.played, 4);
  assert.strictEqual(s.capped, 6);
  assert.strictEqual(s.throttled, 0);
  assert.strictEqual(s.trailThinned, 0);
});

test('SHED-2 輕微吃緊（密度 0.9、吃緊程度 0.13 < 起點 0.3）：不限頻，畫面與密度 1 一樣', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a')], fixedGovernor(0.9));
  for (let i = 0; i < 10; i++) adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 4, 'K 仍是 round(4×0.9)＝4');
  assert.strictEqual(adapter.stats().throttled, 0);
});

test('SHED-3 密度在下限：同目標同種命中特效間隔 0.5 秒內不再播，過了就播', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a', 0.1)], fixedGovernor(0.25));
  adapter.tryPlay(hitSpec('hit-a'));
  adapter.update(0.3);                                   // 第一個已播完（0.1 秒），併發上限不擋
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 1, '距上次 0.3 秒 < 0.5，限頻擋下');
  assert.strictEqual(adapter.stats().throttled, 1);
  assert.strictEqual(adapter.stats().capped, 1, 'throttled 也算在 capped 裡（呼叫端一律算已處理）');
  adapter.update(0.25);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 2, '距上次 0.55 秒，放行');
});

test('SHED-4 間隔從吃緊程度 0.3 起線性加長：深度 0.5 時約 0.143 秒', () => {
  const gov = fixedGovernor(1 - 0.5 * 0.75);             // 吃緊程度 0.5
  const { adapter } = makeAdapter([hitPreset('hit-a', 0.05)], gov);
  adapter.tryPlay(hitSpec('hit-a'));
  adapter.update(0.1);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 1, '0.1 < 0.143');
  adapter.update(0.06);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 2, '0.16 > 0.143');
});

test('SHED-5 起點邊界：吃緊程度剛好 0.3 還不限頻', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a', 0.05)], fixedGovernor(1 - 0.3 * 0.75));
  adapter.tryPlay(hitSpec('hit-a'));
  adapter.update(0.06);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().throttled, 0);
  assert.strictEqual(adapter.stats().played, 2);
});

test('SHED-6 限頻是「每個目標×每種特效」各算各的，不互相擋', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a', 0.05), hitPreset('hit-b', 0.05)], fixedGovernor(0.25));
  adapter.tryPlay(hitSpec('hit-a', 'mv-float-1'));
  adapter.update(0.1);
  adapter.tryPlay(hitSpec('hit-a', 'mv-float-2'));        // 換目標
  adapter.tryPlay(hitSpec('hit-b', 'mv-float-1'));        // 換特效
  assert.strictEqual(adapter.stats().played, 3);
  assert.strictEqual(adapter.stats().throttled, 0);
});

test('SHED-7 全場命中特效同時上限＝160×密度（密度 0.25 → 40）；滿了不再疊，密度回 1 就放開', () => {
  const gov = fixedGovernor(0.25);
  const { adapter } = makeAdapter([hitPreset('hit-a', 5)], gov);
  for (let i = 1; i <= 60; i++) adapter.tryPlay(hitSpec('hit-a', 'mv-float-' + i));
  assert.strictEqual(adapter.stats().played, 40);
  assert.strictEqual(adapter.stats().throttled, 20);
  assert.strictEqual(adapter.stats().hitLive, 40);
  gov.q = 1;
  for (let i = 61; i <= 70; i++) adapter.tryPlay(hitSpec('hit-a', 'mv-float-' + i));
  assert.strictEqual(adapter.stats().played, 50, '密度 1：不限');
});

test('SHED-8 播完的命中特效退出全場計數；名額回來後可以再播', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a', 1)], fixedGovernor(0.25));
  for (let i = 1; i <= 40; i++) adapter.tryPlay(hitSpec('hit-a', 'mv-float-' + i));
  adapter.tryPlay(hitSpec('hit-a', 'mv-float-41'));
  assert.strictEqual(adapter.stats().hitLive, 40);
  assert.strictEqual(adapter.stats().throttled, 1, '第 41 個被全場上限擋下');
  adapter.update(1.1);
  assert.strictEqual(adapter.stats().hitLive, 0);
  adapter.tryPlay(hitSpec('hit-a', 'mv-float-41'));
  assert.strictEqual(adapter.stats().played, 41);
});

test('SHED-9 clear() 之後限頻與全場計數歸零', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a', 5)], fixedGovernor(0.25));
  adapter.tryPlay(hitSpec('hit-a'));
  adapter.clear();
  assert.strictEqual(adapter.stats().hitLive, 0);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().played, 2, '剛播過也不被限頻擋（場景已重置）');
});

test('SHED-10 吃緊程度依「調節器自己的下限」換算：下限 0.5、密度 0.5 就是最吃緊', () => {
  const { adapter } = makeAdapter([hitPreset('hit-a', 0.05)], fixedGovernor(0.5, 0.5));
  adapter.tryPlay(hitSpec('hit-a'));
  adapter.update(0.3);
  adapter.tryPlay(hitSpec('hit-a'));
  assert.strictEqual(adapter.stats().throttled, 1, '深度 1 → 間隔 0.5 秒，0.3 秒內被擋');
});

/* ================= 飛行子彈拖尾 ================= */

const flightSpec = (id) => ({ fxKind: 'projectile', targets: ['mv-float-1'], travelMs: [1500], vfx: { projectile: id } });
const iceArrowBody = (id, areaId) => ({ fxKind: 'aura', variant: 'ice-arrow-homing', dur: 3,
  area: { id: areaId || 'arrow-1', x: 0, y: 0, r: 15, speed: 0 }, vfx: { projectile: id } });

function trailParticles(gov, spec) {
  const { adapter } = makeAdapter([trailPreset('proj-trail'), hitPreset('hit-a')], gov);
  assert.strictEqual(adapter.tryPlay(spec), true);
  adapter.update(0.5);
  const count = particles(adapter);
  assert.ok(count > 0, '要真的有粒子，比較才有意義（兩邊都是 0 也會「相等」）');
  return { count, stats: adapter.stats() };
}

test('SHED-11 飛行子彈：密度 1 拖尾全發；密度在下限只發 40%（SHED.trailMin）', () => {
  const full = trailParticles(fixedGovernor(1), flightSpec('proj-trail'));
  const thin = trailParticles(fixedGovernor(0.25), flightSpec('proj-trail'));
  assert.ok(full.count >= 80, '200/秒 × 0.5 秒 ≈ 100，實際 ' + full.count);
  assert.ok(Math.abs(thin.count / full.count - 0.4) < 0.06, '比例約 0.4，實際 ' + (thin.count / full.count).toFixed(3));
  assert.strictEqual(full.stats.trailThinned, 0);
  assert.strictEqual(thin.stats.trailThinned, 1);
});

test('SHED-12 拖尾密度隨吃緊程度連續變化：深度 0.5 → 0.7', () => {
  const full = trailParticles(fixedGovernor(1), flightSpec('proj-trail')).count;
  const mid = trailParticles(fixedGovernor(1 - 0.5 * 0.75), flightSpec('proj-trail')).count;
  assert.ok(Math.abs(mid / full - 0.7) < 0.06, '實際 ' + (mid / full).toFixed(3));
});

test('SHED-13 冰箭追蹤本體（ground 路徑的 ice-arrow-homing）同樣降拖尾', () => {
  const full = trailParticles(fixedGovernor(1), iceArrowBody('proj-trail'));
  const thin = trailParticles(fixedGovernor(0.25), iceArrowBody('proj-trail'));
  assert.ok(Math.abs(thin.count / full.count - 0.4) < 0.06, '實際 ' + (thin.count / full.count).toFixed(3));
  assert.strictEqual(thin.stats.trailThinned, 1);
});

test('SHED-14 敵方出手的彈體不降（那是玩家要看清楚的威脅）', () => {
  const spec = { cat: 'enemy', fxKind: 'enemy-attack', variant: 'enemy-projectile', sourceId: 'mv-float-2',
    targets: ['pv-float'], travelMs: [1500], vfx: { projectile: 'proj-trail' } };
  const r = trailParticles(fixedGovernor(0.25), spec);
  assert.strictEqual(r.stats.trailThinned, 0);
  const full = trailParticles(fixedGovernor(1), spec).count;
  assert.strictEqual(r.count, full);
});

test('SHED-15 非子彈的場域不降：一般 ground 場域粒子照發', () => {
  const field = { fxKind: 'aura', variant: 'plain-field', dur: 3, area: { id: 'f1', x: 0, y: 0, r: 30 }, vfx: { ground: 'proj-trail' } };
  const full = trailParticles(fixedGovernor(1), field);
  const squeezed = trailParticles(fixedGovernor(0.25), field);
  assert.strictEqual(squeezed.count, full.count);
  assert.strictEqual(squeezed.stats.trailThinned, 0);
});

test('SHED-16 命中類原有的密度行為不變（第一輪）：爆點仍依密度少發粒子', () => {
  const burst = { schemaVersion: 1, id: 'hit-burst', duration: 1, loop: false,
    layers: [{ id: 'p', type: 'particle', assetId: 'hit-burst.png', emission: { mode: 'burst', count: 20 }, lifetime: [1, 1], speed: [0, 0] }] };
  const { adapter } = makeAdapter([burst], fixedGovernor(0.25));
  adapter.tryPlay(hitSpec('hit-burst'));
  adapter.update(0.001);
  assert.strictEqual(particles(adapter), 5);
  assert.strictEqual(adapter.stats().thinned, 1);
});

/* ================= Pixi 後端：透明度 ≤ 1% 不畫（無損） ================= */

function makePixi() {
  class Rectangle { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }); } }
  class Texture {
    constructor(o) { o = o || {}; this.source = o.source || { id: 'src' }; this.frame = o.frame || new Rectangle(0, 0, 64, 64); }
    destroy() {}
  }
  Texture.EMPTY = new Texture({ frame: new Rectangle(0, 0, 1, 1) });
  class Sprite {
    constructor(tex) { this.texture = tex; this.children = []; this.destroyed = false; this.visible = true; this.alpha = 1; this.x = 0; this.y = 0; }
    destroy() { this.destroyed = true; }
  }
  class TilingSprite extends Sprite { constructor(o) { super(o.texture); this.tilePosition = { set() {} }; } }
  const Assets = { load: (url) => Promise.resolve(new Texture({ source: { id: url } })), unload: () => Promise.resolve() };
  return { Rectangle, Texture, Sprite, TilingSprite, Assets };
}
function makeContainer() {
  return { children: [], addChild(n) { this.children.push(n); }, removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); }, removeChildren() { this.children.length = 0; } };
}
function cullHarness() {
  const calls = { project: 0 };
  const backend = VFXPixiBackend.createBackend({
    PIXI: makePixi(), container: makeContainer(),
    projectTransform: (t) => { calls.project++; return Object.assign({}, t, { x: t.x + 1000 }); }
  });
  const node = backend.createNode({ kind: 'sprite', assetUrl: '/a.png', blendMode: 'add' });
  return { backend, node, calls };
}

test('CULL-1 alpha ≤ 0.01：節點關掉、不投影、不寫位置', () => {
  const { backend, node, calls } = cullHarness();
  backend.updateNode(node, { x: 5, y: 6, alpha: 0.01 });
  assert.strictEqual(node.visible, false);
  assert.strictEqual(calls.project, 0, '連投影都省掉');
  assert.strictEqual(node.x, 0);
  backend.updateNode(node, { x: 5, y: 6, alpha: 0 });
  assert.strictEqual(node.visible, false);
});

test('CULL-2 alpha 剛過門檻（0.011）：照常投影、顯示、寫入', () => {
  const { backend, node, calls } = cullHarness();
  backend.updateNode(node, { x: 5, y: 6, alpha: 0.011 });
  assert.strictEqual(node.visible, true);
  assert.strictEqual(calls.project, 1);
  assert.strictEqual(node.x, 1005);
  assert.strictEqual(node.alpha, 0.011);
});

test('CULL-3 淡出到看不見又淡回來：節點會回來，狀態沒有殘留', () => {
  const { backend, node } = cullHarness();
  backend.updateNode(node, { x: 1, y: 1, alpha: 0.5 });
  backend.updateNode(node, { x: 2, y: 2, alpha: 0.005 });
  assert.strictEqual(node.visible, false);
  assert.strictEqual(node.x, 1001, '看不見的那一幀不更新位置');
  backend.updateNode(node, { x: 3, y: 3, alpha: 0.4 });
  assert.strictEqual(node.visible, true);
  assert.strictEqual(node.x, 1003);
  assert.strictEqual(node.alpha, 0.4);
});

test('CULL-4 沒給 alpha 的更新（只動位置）不會被當成看不見', () => {
  const { backend, node } = cullHarness();
  backend.updateNode(node, { x: 7, y: 8 });
  assert.strictEqual(node.visible, true);
  assert.strictEqual(node.x, 1007);
});

test('CULL-5 t.visible === false 的原路徑不變', () => {
  const { backend, node } = cullHarness();
  backend.updateNode(node, { x: 1, y: 1, alpha: 1 });
  backend.updateNode(node, { visible: false, alpha: 1 });
  assert.strictEqual(node.visible, false);
});
