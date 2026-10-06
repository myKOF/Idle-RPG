'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const Core = require('../js/vfx-core.js');
const Runtime = require('../js/vfx-runtime.js');
const disc = require('../vfx/presets/orb-void-disc.json');
const source = fs.readFileSync(require.resolve('../js/battle-renderer.js'), 'utf8');

function harness({ legacy = false, absent = false } = {}) {
  let resolve, reject, now = 0;
  const boot = new Promise((yes, no) => { resolve = yes; reject = no; });
  const played = [], old = [], timers = [];
  const S = { ready: true, vfxLoading: false, pendingVfx: [], layers: {}, fx: [], entities: {} };
  const c = { S, MAX_PENDING_VFX: 256, POS_BUFFER_MS: 100, GROUND_Y_SCALE: .5,
    console: { info() {}, warn() {} }, Date: { now: () => now },
    legacyVfxByQuery: () => legacy, normalizeTowerVfxIds() {},
    endedWaterTornadoes: {}, documentHidden: () => false, fxGate: () => false,
    areaRect: () => ({}), shouldAnimatePlayer: () => false,
    spawnVoidDisc: e => old.push(e), laterFrame: fn => timers.push(fn),   // 延遲播放佇列（取代 setTimeout）
    killFx() {}, sweepOrphanFxNodes() {}, _followAuras: {}, _fireHuntRings: {},
    projectAirTransform() {}, projectBillboardTransform() {}, projectSceneTransform() {},
    screenPosOf: () => ({ x: 0, y: 0 }), chainTargetAlive: () => true,
    screenFootOf() {}, screenMuzzle: () => ({ x: 0, y: 0 }) };
  if (!absent) c.VFXRuntime = { boot: () => boot };
  vm.createContext(c);
  vm.runInContext(['deferVfxUntilReady', 'flushPendingVfx', 'bootVfxRuntime', 'onVfx',
    'clearAllFx', 'clearPlayerFields'].map(n => extractFunction(source, n)).join('\n'), c);
  const rt = { tryPlay: e => { played.push(e); return true; }, stats: () => ({ presets: 1 }), clear() {}, clearFields() {} };
  return { c, S, played, old, rt, resolve, reject,
    clock: value => { now = value; }, drain: () => { while (timers.length) timers.shift()(); } };
}
const orbit = (id = 'disc') => ({ cat: 'magic', fxKind: 'aura', variant: 'void-disc',
  dur: 6, _buffered: true, vfx: { projectile: 'orb-void-disc' },
  area: { id, orbs: 1, r: 60, orbR: 60, startAng: 0, spinRate: 2, grow: 10, x: 0, y: 0 } });

test('慢載入時不先畫legacy鋸齒；就緒後用正式九層圓盤，等待不延長壽命或重置相位', async () => {
  const h = harness(), pending = h.c.bootVfxRuntime();
  const nodes = [];
  const backend = { createNode: s => { const n = { s }; nodes.push(n); return n; },
    updateNode: (n, t) => { n.t = t; }, destroyNode() {}, destroy() {} };
  const rt = Runtime.create({ core: Core, resolver: { resolve: id => id, has: () => true },
    airBackend: backend, fxBackend: backend,
    ctx: { playerPos: () => ({ x: 0, y: 0 }), posOf: () => ({ x: 0, y: 0 }), targetAlive: () => true } });
  rt.registerPresets([disc]);
  const received = [];
  const tryPlay = rt.tryPlay.bind(rt);
  rt.tryPlay = e => { received.push(e); return tryPlay(e); };
  const input = orbit();
  h.c.onVfx(input);
  assert.equal(h.old.length, 0); assert.equal(nodes.length, 0);
  h.clock(1000); h.resolve(rt); await pending;
  assert.equal(h.S.vfxLoading, false); assert.equal(h.S.pendingVfx.length, 0);
  assert.equal(received.length, 1); assert.equal(received[0].dur, 5);
  assert.equal(received[0].area.r, 70); assert.equal(received[0].area.startAng, 2);
  assert.equal(input.dur, 6); assert.equal(input.area.r, 60);
  rt.update(.01);
  assert.equal(nodes.length, disc.layers.length);
  assert.ok(nodes.every(n => n.s.assetUrl)); assert.equal(h.old.length, 0);
  rt.update(5.01); assert.equal(rt.stats().air.activeEffects, 0); rt.destroy();
});

test('等待時丟棄過期短效果；靜止斬保留剩餘時間、當下成長半徑，詳細軌道續相位', async () => {
  const h = harness(), pending = h.c.bootVfxRuntime();
  h.c.onVfx({ ...orbit('short'), dur: .2 });
  h.c.onVfx({ ...orbit('static'), variant: 'wind-blade-homing',
    area: { id: 'static', staticVacuum: true, r: 60, baseR: 60, growAge: .5, growTo: 2, growSec: 3, lifeSec: 2.5 } });
  h.c.onVfx({ ...orbit('members'), area: { ...orbit().area, id: 'members', members: [{}], orbitAge: 2 } });
  h.clock(1000); h.resolve(h.rt); await pending;
  assert.equal(h.played.length, 2);
  assert.equal(h.played[0].area.lifeSec, 1.5); assert.equal(h.played[0].area.growAge, 1.5);
  assert.equal(h.played[0].area.r, 90); assert.equal(h.played[1].area.orbitAge, 3);
});

test('同場域只保留最新更新，有界佇列且起始／終止順序不倒轉', async () => {
  const h = harness(), pending = h.c.bootVfxRuntime();
  for (let i = 0; i < 1000; i++) h.c.onVfx({ ...orbit('same'), dur: 5 + i });
  assert.equal(h.S.pendingVfx.length, 1); assert.equal(h.S.pendingVfx[0].spec.dur, 1004);
  for (let i = 0; i < 400; i++) h.c.onVfx(orbit('id-' + i));
  assert.equal(h.S.pendingVfx.length, 256);
  h.c.onVfx({ ...orbit('chain'), variant: 'lightning-chain', fxKind: 'chain' });
  h.c.onVfx({ variant: 'lightning-chain-end', area: { id: 'chain' } });
  h.resolve(h.rt); await pending;
  assert.deepEqual(h.played.slice(-2).map(e => e.variant), ['lightning-chain', 'lightning-chain-end']);
});

test('載入時換場清空全部；死亡清空場域，背景不新增待播', async () => {
  const h = harness(), pending = h.c.bootVfxRuntime();
  h.c.onVfx(orbit()); h.c.clearAllFx(); assert.equal(h.S.pendingVfx.length, 0);
  h.c.onVfx(orbit()); h.c.clearPlayerFields(); assert.equal(h.S.pendingVfx.length, 0);
  h.c.documentHidden = () => true; h.c.onVfx(orbit());
  h.resolve(h.rt); await pending; assert.equal(h.played.length, 0); assert.equal(h.old.length, 0);
});

test('位置緩衝先走完再排隊，載入就緒不重新等一輪；水龍捲終止訊號取消更新', async () => {
  const h = harness(), pending = h.c.bootVfxRuntime();
  const spec = orbit(); delete spec._buffered;
  h.c.onVfx(spec); assert.equal(h.S.pendingVfx.length, 0);
  h.clock(100); h.drain(); assert.equal(h.S.pendingVfx.length, 1);
  h.c.onVfx({ ...orbit('water'), variant: 'water-tornado' });
  h.c.onVfx({ variant: 'water-tornado-end', area: { id: 'water' } });
  h.clock(200); h.resolve(h.rt); await pending;
  assert.equal(h.played.length, 2);
  assert.equal(h.played[0].variant, 'void-disc'); assert.equal(h.played[0].dur, 5.9);
  assert.equal(h.played[1].variant, 'water-tornado-end');
});

test('載入真的失敗才使用相容畫法，null與reject都釋放佇列；明確legacy／缺Runtime不等待', async () => {
  for (const fail of ['null', 'reject']) {
    const h = harness(), pending = h.c.bootVfxRuntime(); h.c.onVfx(orbit());
    assert.equal(h.old.length, 0);
    if (fail === 'null') h.resolve(null); else h.reject(new Error('load failed'));
    await pending; assert.equal(h.old.length, 1); assert.equal(h.S.pendingVfx.length, 0);
    assert.equal(h.S.vfxLoading, false);
  }
  for (const options of [{ legacy: true }, { absent: true }]) {
    const h = harness(options); h.c.bootVfxRuntime(); h.c.onVfx(orbit());
    assert.equal(h.old.length, 1); assert.equal(h.S.vfxLoading, false);
  }
});
