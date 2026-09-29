const test = require('node:test');
const assert = require('node:assert/strict');
const VFXCore = require('../js/vfx-core.js');
const VFXRuntime = require('../js/vfx-runtime.js');

/* ============================================================
   lightning-chain-end 遇到「延後受擊」時不可丟例外（2026-09-29）

   VFX Runtime 的 pending 陣列有兩種元素：
     { at, spec }                          延後播放的整份事件（playSpec 的 delayMs）
     { at, rt, presetId, targetId, … }     延後的目標受擊（playOnTargets，雷鏈抵達終點才播命中）
   雷鏈終止事件要清掉「屬於該鏈的延後事件」，結果 filter 只寫了 p.spec.area……，
   遇到第二種（沒有 spec）就 TypeError。

   例外從 BattleRenderer.onVfx 一路冒到 ui.js 的 rAF flush，
   整幀剩下的視覺事件（含傷害飄字）都被晾著。
   ============================================================ */

const points = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } };

function recordingBackend(log, tag) {
  return {
    createNode(spec) { const n = { spec, tag, transforms: [] }; log.push(n); return n; },
    updateNode(n, t) { n.transforms.push(Object.assign({}, t)); },
    destroyNode() {}
  };
}
function unitPreset(id, duration) {
  return { schemaVersion: 1, id, duration: duration || 1, loop: false,
    sizing: { shape: 'custom', authored: { width: 256, height: 128 }, widthM: 25.6, heightM: 12.8 },
    layers: [{ id: 'a', type: 'sprite', assetId: id + '.png', zIndex: 0, scale: { x: 1, y: 1 } }] };
}
function makeAdapter() {
  const log = [];
  const adapter = VFXRuntime.create({
    core: VFXCore,
    resolver: { has: () => true, resolve: (id) => id },
    fxBackend: recordingBackend(log, 'fx'),
    zoneBackend: recordingBackend(log, 'zone'),
    ctx: {
      posOf: (id) => Object.assign({}, points[id] || { x: 0, y: 0 }),
      chainPoint: (id) => points[id],
      playerPos: () => ({ x: 0, y: 0 }),
      projectileTargetPoint: (id) => Object.assign({}, points[id] || { x: 0, y: 0 })
    }
  });
  adapter.registerPresets([unitPreset('chain-bolt', 0.4), unitPreset('chain-hit', 0.4)]);
  return { adapter, log };
}
const chainSpec = (chainId, extra) => Object.assign({
  fxKind: 'chain', variant: 'lightning-chain', targets: ['a', 'b'], lineLength: 180, travelMs: [0, 1000],
  vfx: { projectile: 'chain-bolt', hit: 'chain-hit' }, area: { chainId }
}, extra || {});
const chainEnd = (chainId) => ({ fxKind: 'chain', variant: 'lightning-chain-end', targets: [], vfx: {}, area: { chainId } });

test('CHAIN-END-1 延後的目標受擊還在 pending 時，終止事件不丟例外，且不誤清別條鏈的受擊', () => {
  const { adapter } = makeAdapter();
  assert.equal(adapter.tryPlay(chainSpec('one')), true);
  assert.equal(adapter.stats().pending, 1, '雷鏈起飛時排了一筆「抵達終點才播」的命中（沒有 spec）');

  assert.doesNotThrow(() => adapter.tryPlay(chainEnd('one')));
  assert.equal(adapter.stats().pending, 1, '命中受擊沒有 chainId，終止事件不動它（由 chainTargets 存活檢查把關）');
});

test('CHAIN-END-2 終止事件仍會清掉屬於該鏈、延後播放的整份事件（spec 型），別條鏈的不動', () => {
  const { adapter } = makeAdapter();
  // delayMs > 0 的整份事件進 pending（{at, spec}），與上一筆的受擊（沒有 spec）混在同一個陣列
  assert.equal(adapter.tryPlay(chainSpec('one', { delayMs: 500 })), true);
  assert.equal(adapter.tryPlay(chainSpec('two', { delayMs: 500 })), true);
  assert.equal(adapter.tryPlay(chainSpec('one')), true);
  assert.equal(adapter.stats().pending, 3);

  assert.doesNotThrow(() => adapter.tryPlay(chainEnd('one')));
  assert.equal(adapter.stats().pending, 2, "只少了 chainId 'one' 的那筆延後事件；受擊與 'two' 都還在");
});
