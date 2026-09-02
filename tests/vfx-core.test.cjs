'use strict';
/* VFX Core v1 — Preset 驗證、assetId 解析、生命週期、粒子預算、決定性亂數
   Core 不依賴 PixiJS 與 DOM，因此可以直接在 Node 測；
   繪圖後端用 Core 內建的 NullBackend 取代。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const VFXCore = require('../js/vfx-core.js');

const root = path.resolve(__dirname, '..');

const FAKE_INDEX = {
  libraryId: 'test-lib',
  assets: [
    { assetId: 'pack/smoke.png', relativePath: 'pack/PNG (Transparent)/smoke.png' },
    { assetId: 'pack/star.png', relativePath: 'pack/star.png' },
    { assetId: 'pack/ring.png', relativePath: 'pack/ring.png' }
  ]
};

function resolver() {
  return VFXCore.createIndexResolver(FAKE_INDEX, '/asset-library/test-lib');
}

function basePreset(extra) {
  return Object.assign({
    schemaVersion: 1,
    id: 'unit-preset',
    duration: 1,
    layers: [
      { id: 'a', type: 'sprite', assetId: 'pack/ring.png' }
    ]
  }, extra || {});
}

function runtime(opts) {
  const backend = VFXCore.createNullBackend();
  const rt = VFXCore.createRuntime(Object.assign({
    backend: backend, resolver: resolver()
  }, opts || {}));
  return { rt: rt, backend: backend };
}

/* ---------------- 1. Preset validation ---------------- */

test('合法 preset 通過驗證', function () {
  const r = VFXCore.validatePreset(basePreset());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('未知 schemaVersion 被擋', function () {
  const r = VFXCore.validatePreset(basePreset({ schemaVersion: 99 }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(function (e) { return /schemaVersion/.test(e); }), r.errors.join('；'));
});

test('未知 layer type 被擋，且不 silent fallback', function () {
  const preset = basePreset();
  preset.layers[0].type = 'hologram';
  const r = VFXCore.validatePreset(preset);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(function (e) { return /type 非法值/.test(e); }));
});

test('重複 layer id 被擋', function () {
  const preset = basePreset();
  preset.layers.push({ id: 'a', type: 'sprite', assetId: 'pack/star.png' });
  const r = VFXCore.validatePreset(preset);
  assert.ok(r.errors.some(function (e) { return /圖層 id 重複/.test(e); }), r.errors.join('；'));
});

test('NaN / Infinity / 負 duration 被擋', function () {
  assert.equal(VFXCore.validatePreset(basePreset({ duration: 0 })).ok, false);
  assert.equal(VFXCore.validatePreset(basePreset({ duration: -1 })).ok, false);
  assert.equal(VFXCore.validatePreset(basePreset({ duration: NaN })).ok, false);
  assert.equal(VFXCore.validatePreset(basePreset({ duration: Infinity })).ok, false);

  const p = basePreset();
  p.layers[0].rotation = NaN;
  assert.ok(VFXCore.validatePreset(p).errors.some(function (e) { return /rotation/.test(e); }));

  const q = basePreset();
  q.layers[0].delay = -0.5;
  assert.ok(VFXCore.validatePreset(q).errors.some(function (e) { return /delay 不得為負/.test(e); }));
});

test('非法 blendMode 與非法顏色被擋', function () {
  const p = basePreset();
  p.layers[0].blendMode = 'glitter';
  p.layers[0].tint = 'red';
  const r = VFXCore.validatePreset(p);
  assert.ok(r.errors.some(function (e) { return /blendMode/.test(e); }));
  assert.ok(r.errors.some(function (e) { return /tint/.test(e); }));
});

test('粒子數超過硬上限被擋', function () {
  const p = basePreset();
  p.layers = [{
    id: 'p', type: 'particle', assetId: 'pack/star.png',
    emission: { mode: 'burst', count: 999999 }, lifetime: 1
  }];
  const r = VFXCore.validatePreset(p);
  assert.ok(r.errors.some(function (e) { return /硬上限/.test(e); }), r.errors.join('；'));
});

/* ---------------- 2 & 3. assetId 解析與路徑禁令 ---------------- */

test('assetId 解析成 URL；未知 assetId 直接失敗', function () {
  const res = resolver();
  assert.equal(res.resolve('pack/star.png'), '/asset-library/test-lib/pack/star.png');
  // 含空白與括號的相對路徑要正確編碼
  assert.equal(res.resolve('pack/smoke.png'),
    '/asset-library/test-lib/pack/PNG%20(Transparent)/smoke.png');
  assert.throws(function () { res.resolve('pack/nope.png'); }, /未知的 assetId/);
});

test('preset 不得夾帶絕對路徑或 URL', function () {
  ['D:\\MyGame\\effects-materials\\a.png', '/etc/a.png', 'http://x/a.png', 'a\\b.png']
    .forEach(function (bad) {
      const p = basePreset();
      p.layers[0].assetId = bad;
      const r = VFXCore.validatePreset(p);
      assert.equal(r.ok, false, bad + ' 應該被擋');
      assert.ok(r.errors.some(function (e) { return /assetId/.test(e); }));
    });
});

test('註冊時就檢查 assetId，不是等到播放才靜靜不顯示', function () {
  const env = runtime();
  const p = basePreset();
  p.layers[0].assetId = 'pack/missing.png';
  assert.throws(function () { env.rt.registerPreset(p); }, /未知的 assetId/);
});

test('註冊不合法的 preset 會丟出明確錯誤', function () {
  const env = runtime();
  assert.throws(function () {
    env.rt.registerPreset(basePreset({ duration: -3 }));
  }, /不合法/);
});

/* ---------------- 4. 決定性序列化 ---------------- */

test('序列化具決定性，且欄位順序與輸入順序無關', function () {
  const a = { schemaVersion: 1, id: 'x', duration: 1, layers: [{ type: 'sprite', id: 'l', assetId: 'pack/ring.png', alpha: 1 }] };
  const b = { layers: [{ alpha: 1, assetId: 'pack/ring.png', id: 'l', type: 'sprite' }], duration: 1, id: 'x', schemaVersion: 1 };
  assert.equal(VFXCore.serialisePreset(a), VFXCore.serialisePreset(b));
  assert.equal(VFXCore.serialisePreset(a), VFXCore.serialisePreset(JSON.parse(VFXCore.serialisePreset(a))));
});

test('Editor 存檔 → 載入 → 再存檔，資料不變', function () {
  const preset = JSON.parse(fs.readFileSync(path.join(root, 'vfx', 'presets', 'demo-basic.json'), 'utf8'));
  const once = VFXCore.serialisePreset(preset);
  const twice = VFXCore.serialisePreset(JSON.parse(once));
  assert.equal(once, twice, '往返一次就該收斂');
  assert.equal(VFXCore.validatePreset(JSON.parse(once)).ok, true);
});

/* ---------------- 5. Layer 生命週期 ---------------- */

test('圖層依 delay / duration 出現與消失，結束後節點回收進池', function () {
  const env = runtime();
  env.rt.registerPreset({
    schemaVersion: 1, id: 'life', duration: 1,
    layers: [{ id: 'a', type: 'sprite', assetId: 'pack/ring.png', delay: 0.5, duration: 0.25 }]
  });
  env.rt.play('life');

  env.rt.update(0.1);
  assert.equal(env.backend.counts().created, 0, 'delay 未到不該建節點');

  env.rt.update(0.5);                                  // t=0.6，圖層存活
  assert.equal(env.backend.counts().created, 1);

  env.rt.update(0.3);                                  // t=0.9，圖層已結束
  assert.equal(env.rt.stats().pooledNodes, 1, '結束的節點要回收到池裡，不是直接丟掉');

  env.rt.update(0.2);                                  // t=1.1，整個特效結束
  assert.equal(env.rt.stats().activeEffects, 0);
});

test('特效結束後所有節點都回收，沒有洩漏', function () {
  const env = runtime();
  env.rt.registerPreset({
    schemaVersion: 1, id: 'leak', duration: 0.5,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 20 }, lifetime: 0.2, speed: 10
    }]
  });
  env.rt.play('leak');
  for (let i = 0; i < 30; i++) env.rt.update(0.05);
  const stats = env.rt.stats();
  assert.equal(stats.activeEffects, 0);
  assert.equal(stats.activeParticles, 0, '粒子必須全部回收');
  assert.ok(stats.pooledNodes > 0, '回收的節點應進池供重用');

  env.rt.destroy();
  const counts = env.backend.counts();
  assert.equal(counts.live, 0, 'destroy 後不得有存活節點');
  assert.equal(counts.created, counts.destroyed);
});

test('節點池會重用，不是每次都新建', function () {
  const env = runtime();
  env.rt.registerPreset({
    schemaVersion: 1, id: 'pooled', duration: 0.3,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 10 }, lifetime: 0.1, speed: 5
    }]
  });
  for (let round = 0; round < 3; round++) {
    env.rt.play('pooled');
    for (let i = 0; i < 10; i++) env.rt.update(0.05);
  }
  assert.equal(env.backend.counts().created, 10,
    '三輪各 10 顆粒子應重用同一批節點，而不是建立 30 個');
});

/* ---------------- 6. 預算 ---------------- */

test('超過 maxActiveEffects 就不再播放，並計入 dropped', function () {
  const env = runtime({ budget: { maxActiveEffects: 2 } });
  env.rt.registerPreset(basePreset({ id: 'budget-a' }));
  assert.ok(env.rt.play('budget-a') !== null);
  assert.ok(env.rt.play('budget-a') !== null);
  assert.equal(env.rt.play('budget-a'), null, '超出預算應回傳 null 而不是硬播');
  assert.equal(env.rt.stats().droppedEffects, 1);
});

test('粒子總量受 maxParticles 限制', function () {
  const env = runtime({ budget: { maxParticles: 15, perEffectParticleLimit: 100 } });
  env.rt.registerPreset({
    schemaVersion: 1, id: 'many', duration: 1,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 50 }, lifetime: 5, speed: 1
    }]
  });
  env.rt.play('many');
  env.rt.update(0.016);
  assert.ok(env.rt.stats().activeParticles <= 15, '不得超過全域粒子預算');
  assert.ok(env.rt.stats().droppedParticles > 0);
});

test('perEffectParticleLimit 限制單一特效', function () {
  const env = runtime({ budget: { maxParticles: 1000, perEffectParticleLimit: 8 } });
  env.rt.registerPreset({
    schemaVersion: 1, id: 'one', duration: 1,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 40 }, lifetime: 5, speed: 1
    }]
  });
  env.rt.play('one');
  env.rt.update(0.016);
  assert.equal(env.rt.stats().activeParticles, 8);
});

/* ---------------- 7. 決定性亂數 ---------------- */

test('相同 seed 產生相同粒子軌跡', function () {
  function trace(seed) {
    const backend = VFXCore.createNullBackend();
    const positions = [];
    const wrapped = {
      createNode: backend.createNode,
      updateNode: function (node, t) {
        backend.updateNode(node, t);
        if (t && t.visible) positions.push(Math.round(t.x * 1000) + ',' + Math.round(t.y * 1000));
      },
      destroyNode: backend.destroyNode
    };
    const rt = VFXCore.createRuntime({ backend: wrapped, resolver: resolver() });
    rt.registerPreset({
      schemaVersion: 1, id: 'seeded', duration: 0.5,
      layers: [{
        id: 'p', type: 'particle', assetId: 'pack/star.png',
        emission: { mode: 'burst', count: 12 }, lifetime: [0.2, 0.4],
        speed: [10, 100], spread: 360, gravity: { x: 0, y: 50 }
      }]
    });
    rt.play('seeded', { seed: seed });
    for (let i = 0; i < 10; i++) rt.update(0.03);
    return positions.join('|');
  }
  assert.equal(trace(42), trace(42), '同 seed 必須完全一致');
  assert.notEqual(trace(42), trace(43), '不同 seed 應該不同');
});

test('makeRng 不依賴 Math.random', function () {
  const original = Math.random;
  Math.random = function () { throw new Error('Core 不得使用 Math.random'); };
  try {
    const rng = VFXCore.makeRng(7);
    const values = [rng(), rng(), rng()];
    values.forEach(function (v) { assert.ok(v >= 0 && v < 1); });
    const again = VFXCore.makeRng(7);
    assert.deepEqual([again(), again(), again()], values);
  } finally {
    Math.random = original;
  }
});

/* ---------------- 8. 曲線與變換 ---------------- */

test('over-life 曲線線性內插，超出範圍夾住端點', function () {
  const curve = [[0, 0], [0.5, 1], [1, 0]];
  assert.equal(VFXCore.sampleCurve(curve, 0), 0);
  assert.equal(VFXCore.sampleCurve(curve, 0.25), 0.5);
  assert.equal(VFXCore.sampleCurve(curve, 0.5), 1);
  assert.equal(VFXCore.sampleCurve(curve, 0.75), 0.5);
  assert.equal(VFXCore.sampleCurve(curve, 1), 0);
  assert.equal(VFXCore.sampleCurve(curve, 5), 0, '超出上界夾住');
  assert.equal(VFXCore.sampleCurve(3, 0.5), 3, '數字視為常數');
});

test('特效的 position / rotation / scale 會套用到圖層座標', function () {
  const backend = VFXCore.createNullBackend();
  let last = null;
  const rt = VFXCore.createRuntime({
    backend: {
      createNode: backend.createNode,
      updateNode: function (n, t) { if (t && t.visible) last = t; },
      destroyNode: backend.destroyNode
    },
    resolver: resolver()
  });
  rt.registerPreset({
    schemaVersion: 1, id: 'xform', duration: 1,
    layers: [{ id: 'a', type: 'sprite', assetId: 'pack/ring.png', position: { x: 10, y: 0 } }]
  });
  rt.play('xform', { position: { x: 100, y: 50 }, scale: 2, rotation: Math.PI / 2 });
  rt.update(0.1);
  assert.ok(Math.abs(last.x - 100) < 1e-6, '旋轉 90° 後 x 位移應該歸零');
  assert.ok(Math.abs(last.y - 70) < 1e-6, 'y 應為 50 + 10*2');
  assert.equal(last.scaleX, 2);
});

/* ---------------- 9. Runtime 介面契約 ---------------- */

test('createRuntime 缺少 backend 或 resolver 會直接失敗', function () {
  assert.throws(function () { VFXCore.createRuntime({}); }, /backend/);
  assert.throws(function () {
    VFXCore.createRuntime({ backend: VFXCore.createNullBackend() });
  }, /resolver/);
});

test('update 拒絕非法 dt', function () {
  const env = runtime();
  assert.throws(function () { env.rt.update(-1); }, /非負/);
  assert.throws(function () { env.rt.update(NaN); }, /非負/);
});

test('play 未註冊的 preset 會丟錯，不是靜靜什麼都不做', function () {
  const env = runtime();
  assert.throws(function () { env.rt.play('nope'); }, /未註冊/);
});

test('stop 只停掉指定的特效', function () {
  const env = runtime();
  env.rt.registerPreset(basePreset({ id: 'stoppable' }));
  const h1 = env.rt.play('stoppable');
  env.rt.play('stoppable');
  assert.equal(env.rt.stats().activeEffects, 2);
  assert.equal(env.rt.stop(h1), true);
  assert.equal(env.rt.stats().activeEffects, 1);
  assert.equal(env.rt.stop(h1), false, '重複 stop 應回報找不到');
});

/* ---------------- 10. Editor 與 Runtime 共用同一個 Core ---------------- */

test('Editor 與 Runtime 走同一份 Core：相同輸入產生相同 transform 序列', function () {
  function capture(label) {
    const frames = [];
    const backend = VFXCore.createNullBackend();
    const rt = VFXCore.createRuntime({
      backend: {
        createNode: backend.createNode,
        updateNode: function (n, t) {
          if (t && t.visible) frames.push(label && null, [t.x, t.y, t.alpha, t.scaleX, t.rotation].join(','));
        },
        destroyNode: backend.destroyNode
      },
      resolver: resolver()
    });
    const preset = JSON.parse(fs.readFileSync(path.join(root, 'vfx', 'presets', 'demo-basic.json'), 'utf8'));
    // 測試用素材庫沒有 demo preset 的真實 assetId，換成本測試的假素材
    preset.layers.forEach(function (l) { l.assetId = 'pack/star.png'; });
    rt.registerPreset(preset);
    rt.play(preset.id, { position: { x: 5, y: 7 }, seed: 999 });
    for (let i = 0; i < 20; i++) rt.update(1 / 60);
    return frames.join('|');
  }
  // 兩次獨立建立的 runtime（模擬 Editor 與 Runtime 各自啟動）必須產生相同結果
  assert.equal(capture('editor'), capture('runtime'));
});

test('Editor 沒有自己的 renderer：預覽與遊戲都走 backend 介面', function () {
  const editorJs = fs.readFileSync(path.join(root, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  assert.ok(/VFXCore\.createRuntime/.test(editorJs), 'Editor 必須用 VFXCore 建 runtime');
  assert.ok(/VFXPixiBackend\.createBackend/.test(editorJs), 'Editor 必須用共用的 Pixi backend');

  /* 真正該守的界線是「特效畫面不能由 Editor 自己畫」：
     Editor 不得碰 backend 的節點 API，也不得自己寫粒子／生命週期模擬。
     （預覽背景的棋盤格 TilingSprite 屬於編輯器外觀，不是特效內容，故不在禁令內。） */
  assert.equal(/\.(createNode|updateNode|destroyNode)\s*\(/.test(editorJs), false,
    'Editor 不得自行操作繪圖節點，那是 backend 在 Core 指揮下的責任');
  assert.equal(/emissionRate|spawnParticle|particles\s*\.\s*push|\.life\s*\+=/.test(editorJs), false,
    'Editor 不得自己模擬粒子；動態一律由 VFX Core 負責');
  assert.equal(/new\s+PIXI\.(Sprite|AnimatedSprite)\b/.test(editorJs), false,
    'Editor 不得自行建立特效用的 Sprite');
});

/* ---------------- 專案內的 preset 一律要通過驗證 ---------------- */

test('vfx/presets 底下的所有 preset 都合法', function () {
  const dir = path.join(root, 'vfx', 'presets');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); });
  assert.ok(files.length > 0, '至少要有一個示範 preset');
  files.forEach(function (file) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const result = VFXCore.validatePreset(preset);
    assert.deepEqual(result.errors, [], file + '：' + result.errors.join('；'));
    assert.equal(preset.id, file.replace(/\.json$/, ''), file + ' 的 id 應與檔名一致');
  });
});

test('示範 preset 引用的 assetId 都存在於事實層', function () {
  const indexPath = path.join(root, 'vfx', 'asset-index.json');
  const dir = path.join(root, 'vfx', 'presets');
  if (!fs.existsSync(indexPath) || !fs.existsSync(dir)) return;
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const res = VFXCore.createIndexResolver(index, '/assets');
  fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).forEach(function (file) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    preset.layers.forEach(function (layer) {
      if (!layer.assetId) return;
      assert.ok(res.has(layer.assetId), file + ' 引用了不存在的 assetId：' + layer.assetId);
    });
  });
});

/* ---------------- Codex Review 修正的回歸保護 ---------------- */

test('emission rate 有硬上限：無上限的 rate 會凍住主執行緒', function () {
  const p = basePreset();
  p.layers = [{
    id: 'p', type: 'particle', assetId: 'pack/star.png',
    emission: { mode: 'rate', rate: 1e9 }, lifetime: 1
  }];
  const r = VFXCore.validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(function (e) { return /rate 超過硬上限/.test(e); }), r.errors.join('；'));
});

test('rate 發射達到容量後不會空轉，且單幀有界', function () {
  const env = runtime({ budget: { maxParticles: 20, perEffectParticleLimit: 10 } });
  env.rt.registerPreset({
    schemaVersion: 1, id: 'rate-cap', duration: 5,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'rate', rate: 2000 }, lifetime: 5, speed: 1
    }]
  });
  env.rt.play('rate-cap');
  const started = Date.now();
  for (let i = 0; i < 60; i++) env.rt.update(0.5);      // 刻意用很大的 dt
  assert.ok(Date.now() - started < 2000, '不得因為發射迴圈而卡住');
  assert.ok(env.rt.stats().activeParticles <= 10);
});

test('未知欄位會被擋下，不是靜靜忽略', function () {
  const p = basePreset();
  p.layers[0].alpah = 0.5;                              // 拼錯的 alpha
  const r = VFXCore.validatePreset(p);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(function (e) { return /不支援的欄位：alpah/.test(e); }), r.errors.join('；'));

  const q = basePreset({ extraStuff: 1 });
  assert.ok(VFXCore.validatePreset(q).errors.some(function (e) { return /不支援的欄位：extraStuff/.test(e); }));

  // sprite 不得帶 particle 專屬欄位
  const s2 = basePreset();
  s2.layers[0].gravity = { x: 0, y: 1 };
  assert.ok(VFXCore.validatePreset(s2).errors.some(function (e) { return /不支援的欄位：gravity/.test(e); }));
});

test('序列化遞迴排序巢狀物件，nested key 順序不影響輸出', function () {
  const a = { schemaVersion: 1, id: 'n', duration: 1, layers: [
    { id: 'l', type: 'sprite', assetId: 'pack/ring.png', position: { x: 1, y: 2 }, scale: { x: 1, y: 1 } }] };
  const b = { schemaVersion: 1, id: 'n', duration: 1, layers: [
    { id: 'l', type: 'sprite', assetId: 'pack/ring.png', position: { y: 2, x: 1 }, scale: { y: 1, x: 1 } }] };
  assert.equal(VFXCore.serialisePreset(a), VFXCore.serialisePreset(b),
    '巢狀 key 插入順序不同也必須產生相同 bytes');
});

test('註冊後的 preset 不可被外部竄改繞過驗證', function () {
  const env = runtime();
  const preset = basePreset({ id: 'frozen' });
  env.rt.registerPreset(preset);
  // 外部改原始物件不應影響已註冊的內容
  preset.layers[0].type = 'hologram';
  const stored = env.rt.getPreset('frozen');
  assert.equal(stored.layers[0].type, 'sprite', '註冊時應存自己的拷貝');
  assert.throws(function () { 'use strict'; stored.duration = 99; }, TypeError, '註冊後的 preset 應凍結');
});

test('budget 為 0 不會被靜默換回預設值；非法 budget 直接報錯', function () {
  const env = runtime({ budget: { maxActiveEffects: 0 } });
  env.rt.registerPreset(basePreset({ id: 'zero' }));
  assert.equal(env.rt.play('zero'), null, 'maxActiveEffects:0 應該真的擋掉全部特效');

  assert.throws(function () {
    VFXCore.createRuntime({
      backend: VFXCore.createNullBackend(), resolver: resolver(),
      budget: { maxParticles: -5 }
    });
  }, /非負整數/);
  assert.throws(function () {
    VFXCore.createRuntime({
      backend: VFXCore.createNullBackend(), resolver: resolver(),
      budget: { maxParticles: 1.5 }
    });
  }, /非負整數/);
});

test('粒子朝向會跟著特效與圖層一起旋轉', function () {
  let idSeq = 0;
  function firstParticleRotation(effectRotation, layerRotation) {
    const presetId = 'rot-case-' + (++idSeq);
    const backend = VFXCore.createNullBackend();
    let rot = null;
    const rt = VFXCore.createRuntime({
      backend: {
        createNode: backend.createNode,
        updateNode: function (n, t) { if (rot === null && t && t.visible) rot = t.rotation; },
        destroyNode: backend.destroyNode
      },
      resolver: resolver()
    });
    rt.registerPreset({
      schemaVersion: 1, id: presetId, duration: 1,
      layers: [{
        id: 'p', type: 'particle', assetId: 'pack/star.png', rotation: layerRotation || 0,
        emission: { mode: 'burst', count: 1 }, lifetime: 1, speed: 0,
        rotationStart: 0, rotationSpeed: 0
      }]
    });
    rt.play(presetId, { rotation: effectRotation, seed: 1 });
    rt.update(0.01);
    return rot;
  }
  assert.ok(Math.abs(firstParticleRotation(0, 0)) < 1e-9);
  assert.ok(Math.abs(firstParticleRotation(Math.PI / 2, 0) - Math.PI / 2) < 1e-9,
    '整個特效旋轉時，粒子朝向也要跟著轉');
  assert.ok(Math.abs(firstParticleRotation(0, 0.5) - 0.5) < 1e-9, '圖層旋轉同樣要套用');
});

test('節點池有上限，冷門節點會被銷毀而非無限累積', function () {
  const backend = VFXCore.createNullBackend();
  const rt = VFXCore.createRuntime({
    backend: backend, resolver: resolver(), maxPooledPerKey: 4
  });
  rt.registerPreset({
    schemaVersion: 1, id: 'poolcap', duration: 0.2,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 20 }, lifetime: 0.05, speed: 1
    }]
  });
  rt.play('poolcap');
  for (let i = 0; i < 10; i++) rt.update(0.05);
  assert.ok(rt.stats().pooledNodes <= 4, '池不得超過上限');
  assert.ok(backend.counts().destroyed > 0, '超出上限的節點應被銷毀');
});

test('runtime.destroy 會一併收掉後端資源', function () {
  const env = runtime();
  env.rt.registerPreset(basePreset({ id: 'cleanup' }));
  env.rt.play('cleanup');
  env.rt.update(0.1);
  env.rt.destroy();
  assert.equal(env.backend.counts().live, 0);
  assert.equal(env.backend.counts().backendDestroyed, true,
    'Runtime 收攤時必須通知後端釋放貼圖等資源');
});

test('editor-server 的 safeJoin 擋掉路徑穿越', function () {
  const server = require('../tools/vfx/editor-server.cjs');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vfx-safejoin-'));
  try {
    fs.writeFileSync(path.join(tmp, 'ok.png'), 'x');
    assert.ok(server.safeJoin(tmp, 'ok.png'), '根目錄內的檔案應可服務');
    assert.equal(server.safeJoin(tmp, '../../secret.txt'), null, '../ 穿越必須被擋');
    assert.equal(server.safeJoin(tmp, '..'), null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Editor 存檔前會驗證，避免存出無法載入的檔案', function () {
  const editorJs = fs.readFileSync(path.join(root, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  /* 回寫與下載共用同一道擋門，兩條路不得有一條偷偷繞過驗證 */
  const gate = editorJs.slice(editorJs.indexOf('function presetSaveProblems'),
    editorJs.indexOf('function showSaveError'));
  assert.ok(/validatePreset/.test(gate), '存檔擋門必須先驗證 preset');
  assert.ok(/resolver\.has/.test(gate), '存檔擋門必須檢查 assetId 是否存在');

  const saveFn = editorJs.slice(editorJs.indexOf('function savePreset'),
    editorJs.indexOf('function downloadPreset'));
  const downloadFn = editorJs.slice(editorJs.indexOf('function downloadPreset'),
    editorJs.indexOf('function loadPresetFromFile'));
  assert.ok(/presetSaveProblems\(\)/.test(saveFn), '回寫前必須走擋門');
  assert.ok(/presetSaveProblems\(\)/.test(downloadFn), '下載前必須走擋門');
  /* Save 是真的回寫 server，不是又下載一份 */
  assert.ok(/method: 'PUT'/.test(saveFn) && /presetUrl\(state\.preset\.id\)/.test(saveFn),
    'savePreset 必須 PUT 回 /vfx/presets/<id>.json');
});

/* ---------------- Codex Review 第 2 輪修正的回歸保護 ---------------- */

test('stats().budget 是唯讀複本，外部不能廢掉粒子上限', function () {
  const env = runtime({ budget: { maxParticles: 10 } });
  const s = env.rt.stats();
  assert.throws(function () { 'use strict'; s.budget.maxParticles = Infinity; }, TypeError);
  env.rt.registerPreset({
    schemaVersion: 1, id: 'immutable-budget', duration: 1,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 100 }, lifetime: 5, speed: 1
    }]
  });
  env.rt.play('immutable-budget');
  env.rt.update(0.016);
  assert.ok(env.rt.stats().activeParticles <= 10, '上限必須仍然生效');
});

test('匯出的常數被凍結，不能從外部關掉驗證', function () {
  assert.throws(function () { 'use strict'; VFXCore.HARD_LIMITS.maxEmissionRate = 1e9; }, TypeError);
  assert.throws(function () { 'use strict'; VFXCore.BLEND_MODES.push('evil'); }, TypeError);
});

test('layer.maxParticles 不能繞過 perEffectParticleLimit', function () {
  const env = runtime({ budget: { maxParticles: 1000, perEffectParticleLimit: 5 } });
  env.rt.registerPreset({
    schemaVersion: 1, id: 'cap-precedence', duration: 1,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png', maxParticles: 500,
      emission: { mode: 'burst', count: 200 }, lifetime: 5, speed: 1
    }]
  });
  env.rt.play('cap-precedence');
  env.rt.update(0.016);
  assert.equal(env.rt.stats().activeParticles, 5, '單層上限只能更嚴格，不能放寬');
});

test('loop preset 搭配極大 dt 不會卡住', function () {
  const env = runtime({ budget: { maxParticles: 30, perEffectParticleLimit: 10 } });
  env.rt.registerPreset({
    schemaVersion: 1, id: 'loop-storm', duration: 0.5, loop: true,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'rate', rate: 2000 }, lifetime: 10, speed: 1
    }]
  });
  env.rt.play('loop-storm');
  const started = Date.now();
  for (let i = 0; i < 50; i++) env.rt.update(1000);      // 極端 dt
  assert.ok(Date.now() - started < 2000, '不得卡死');
});

test('destroy 之後是終態：再呼叫公開方法會明確報錯', function () {
  const env = runtime();
  env.rt.registerPreset(basePreset({ id: 'terminal' }));
  env.rt.destroy();
  env.rt.destroy();                                       // 可重複呼叫
  assert.throws(function () { env.rt.play('terminal'); }, /已 destroy/);
  assert.throws(function () { env.rt.update(0.1); }, /已 destroy/);
  assert.throws(function () { env.rt.registerPreset(basePreset({ id: 'x2' })); }, /已 destroy/);
});

test('巢狀未知欄位也會被擋', function () {
  const p = basePreset();
  p.layers = [{
    id: 'p', type: 'particle', assetId: 'pack/star.png',
    emission: { mode: 'burst', count: 5, counnt: 9 },
    lifetime: 1, spawn: { shape: 'circle', radius: 3, raduis: 4 }
  }];
  const r = VFXCore.validatePreset(p);
  assert.ok(r.errors.some(function (e) { return /emission 有不支援的欄位：counnt/.test(e); }), r.errors.join('；'));
  assert.ok(r.errors.some(function (e) { return /spawn 有不支援的欄位：raduis/.test(e); }));

  const q = basePreset();
  q.layers[0].position = { x: 1, y: 2, z: 3 };
  assert.ok(VFXCore.validatePreset(q).errors.some(function (e) { return /position 有不支援的欄位：z/.test(e); }));
});

test('純數字的 over-life 曲線也要檢查負值', function () {
  const p = basePreset();
  p.layers[0].alphaOverLife = -1;
  assert.ok(VFXCore.validatePreset(p).errors.some(function (e) { return /alphaOverLife 不得為負/.test(e); }));
  const q = basePreset();
  q.layers[0].scaleOverLife = -0.5;
  assert.ok(VFXCore.validatePreset(q).errors.some(function (e) { return /scaleOverLife 不得為負/.test(e); }));
});

test('粒子數量必須是正整數', function () {
  const p = basePreset();
  p.layers = [{
    id: 'p', type: 'particle', assetId: 'pack/star.png',
    emission: { mode: 'burst', count: 5.5 }, lifetime: 1
  }];
  assert.ok(VFXCore.validatePreset(p).errors.some(function (e) { return /count 必須是正整數/.test(e); }));
});

test('budget 的 null 與非法 maxPooledPerKey 都會報錯', function () {
  assert.throws(function () {
    VFXCore.createRuntime({
      backend: VFXCore.createNullBackend(), resolver: resolver(),
      budget: { maxParticles: null }
    });
  }, /非負整數/);
  assert.throws(function () {
    VFXCore.createRuntime({
      backend: VFXCore.createNullBackend(), resolver: resolver(), maxPooledPerKey: NaN
    });
  }, /非負整數/);
});

test('editor-server 只服務允許的目錄，且擋掉 dotfile', function () {
  const src = fs.readFileSync(path.join(root, 'tools', 'vfx', 'editor-server.cjs'), 'utf8');
  assert.ok(/REPO_ALLOWLIST/.test(src), '必須有白名單');
  assert.ok(/'\/js\/'/.test(src) && /'\/vfx\/'/.test(src));
  assert.ok(/charAt\(0\) === '\.'/.test(src), '必須擋掉以 . 開頭的路徑段');
  assert.ok(/listen\(port, '127\.0\.0\.1'/.test(src), '必須綁 loopback');
});

test('Editor 的向量預設值與 Core 一致', function () {
  const editorJs = fs.readFileSync(path.join(root, 'tools', 'vfx', 'editor', 'editor.js'), 'utf8');
  assert.ok(/VEC_DEFAULTS/.test(editorJs));
  assert.ok(/scale:\s*\{ x: 1, y: 1 \}/.test(editorJs), 'scale 預設必須是 1,1 而不是 0,0');
  assert.ok(/anchor:\s*\{ x: 0\.5, y: 0\.5 \}/.test(editorJs));
  assert.ok(/uniqueLayerId/.test(editorJs), '新增圖層必須產生唯一 id');
});

/* ---------------- CRITICAL FIX VERIFICATION 修正的回歸保護 ---------------- */

/* Fix 1：budget 是呼叫端可調的旋鈕，但不能被調成「等於沒有上限」。
   Number.MAX_VALUE 是有限整數，舊版驗證會放行，之後 emitAccumulator -= 1
   在該量級不再改變數值，發射迴圈就失去終止保證。 */

const BUDGET_FIELDS = ['maxActiveEffects', 'maxParticles', 'perEffectParticleLimit'];

test('極大 budget 在建立 runtime 時就被拒絕，不進到發射迴圈', function () {
  BUDGET_FIELDS.forEach(function (name) {
    [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER, 1e12].forEach(function (huge) {
      const budget = {};
      budget[name] = huge;
      assert.throws(function () { runtime({ budget: budget }); },
        /不得超過 HARD_LIMITS\.budget/, name + ' = ' + huge + ' 必須被擋下');
    });
  });
});

test('budget 的 HARD_LIMITS 邊界：等於上限可用，超過一就拒絕', function () {
  const limits = VFXCore.HARD_LIMITS.budget;
  BUDGET_FIELDS.forEach(function (name) {
    const atLimit = {};
    atLimit[name] = limits[name];
    assert.ok(runtime({ budget: atLimit }).rt, name + ' 等於上限應該可用');

    const overLimit = {};
    overLimit[name] = limits[name] + 1;
    assert.throws(function () { runtime({ budget: overLimit }); },
      /不得超過 HARD_LIMITS\.budget/, name + ' 超過一就要擋');
  });
});

test('HARD_LIMITS.budget 被深度凍結，預設 budget 也在上限之內', function () {
  assert.throws(function () {
    'use strict';
    VFXCore.HARD_LIMITS.budget.maxParticles = Infinity;
  }, TypeError, '淺凍結擋不住巢狀寫入，必須 deepFreeze');
  const limits = VFXCore.HARD_LIMITS.budget;
  BUDGET_FIELDS.forEach(function (name) {
    assert.ok(VFXCore.DEFAULT_BUDGET[name] <= limits[name],
      '預設 budget.' + name + ' 不得超過自己的硬上限');
  });
  // 單層粒子上限與單特效粒子上限必須一致，否則 layerParticleCap 的夾限會有死區
  assert.equal(limits.perEffectParticleLimit, VFXCore.HARD_LIMITS.maxParticlesPerLayer);
});

/* Fix 2：貼圖 retain/release 的 ownership 必須成對。
   PixiJS 是瀏覽器函式庫，這裡用最小的假 PIXI 驅動 backend——
   要驗證的是引用計數的所有權規則，不是 Pixi 本身的繪圖行為。 */

const VFXPixiBackend = require('../js/vfx-pixi-backend.js');

/* options：
     failUrls      這些 URL 的 Assets.load 會 reject
     manual        載入不自動完成，改由 _settleLoad(url) 決定何時完成
     unloadRejects Assets.unload 回傳一個 reject 的 Promise（Pixi v8 對從未成功
                   載入的 URL 就是這個行為），用來驗證我們有接住它 */
function fakePixi(options) {
  const opts = options || {};
  const failing = new Set(opts.failUrls || []);
  const loaded = [];
  const unloaded = [];
  const pending = new Map();

  function Sprite(texture) {
    this.texture = texture;
    this.destroyed = false;
    this.parent = null;
    this.scale = { set: function () {} };
  }
  Sprite.prototype.destroy = function () { this.destroyed = true; };

  function TilingSprite(o) { Sprite.call(this, o && o.texture); }
  TilingSprite.prototype = Object.create(Sprite.prototype);

  return {
    Texture: { EMPTY: { __empty: true } },
    Sprite: Sprite,
    TilingSprite: TilingSprite,
    Assets: {
      load: function (url) {
        loaded.push(url);
        if (failing.has(url)) return Promise.reject(new Error('404 ' + url));
        if (opts.manual) {
          return new Promise(function (resolve) { pending.set(url, resolve); });
        }
        return Promise.resolve({ __url: url, width: 8, height: 8 });
      },
      unload: function (url) {
        unloaded.push(url);
        if (opts.unloadRejects) return Promise.reject(new Error('never loaded: ' + url));
        return Promise.resolve();
      }
    },
    _loaded: loaded,
    _unloaded: unloaded,
    _pendingCount: function () { return pending.size; },
    _settleLoad: function (url) {
      const resolve = pending.get(url);
      if (!resolve) throw new Error('沒有等待中的載入：' + url);
      pending.delete(url);
      resolve({ __url: url, width: 8, height: 8 });
    }
  };
}

function fakeContainer() {
  return {
    children: [],
    sortableChildren: false,
    addChild: function (n) { n.parent = this; this.children.push(n); },
    removeChild: function (n) {
      const i = this.children.indexOf(n);
      if (i >= 0) this.children.splice(i, 1);
      n.parent = null;
    },
    removeChildren: function () {
      this.children.forEach(function (n) { n.parent = null; });
      this.children = [];
    }
  };
}

function spriteSpec(url, blendMode) {
  return { kind: 'sprite', assetUrl: url, blendMode: blendMode || 'normal' };
}

// setImmediate 會先清空 microtask queue，足以讓 Assets.load 的 then/catch 跑完
function settle() { return new Promise(function (r) { setImmediate(r); }); }

test('貼圖載入失敗後重試不會重複 retain，destroy 後引用計數歸零', async function () {
  const url = '/asset-library/test-lib/fail.png';
  const pixi = fakePixi({ failUrls: [url] });
  const backend = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  backend.createNode(spriteSpec(url));
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 1, '第一次請求 retain 一次');
  assert.equal(pixi._loaded.length, 1);
  assert.equal(backend.takeErrors().length, 1, '失敗必須被記錄，不能靜默');

  // 舊版把 cache 寫回 null，這裡會被當成「從未 retain」而再 retain 一次
  backend.createNode(spriteSpec(url));
  backend.createNode(spriteSpec(url, 'add'));
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 1, '失敗後重試不得重複 retain');
  assert.equal(pixi._loaded.length, 1, '已知失敗不應重複發出載入請求');
  assert.equal(backend.takeErrors().length, 0, '同一個 URL 只記錄一次錯誤');

  backend.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 0, 'destroy 後計數必須歸零，否則永遠不會 unload');
});

test('同一個 backend 重複請求同一貼圖只 retain 一次', async function () {
  const url = '/asset-library/test-lib/repeat.png';
  const pixi = fakePixi();
  const backend = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  for (let i = 0; i < 5; i++) backend.createNode(spriteSpec(url));
  await settle();
  for (let i = 0; i < 5; i++) backend.createNode(spriteSpec(url));   // 走 ready 分支
  await settle();

  assert.equal(VFXPixiBackend._refCount(url), 1);
  assert.equal(pixi._loaded.length, 1, '同一個 URL 只載入一次');

  backend.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 0);
  assert.deepEqual(pixi._unloaded, [url], '最後一個 owner 收攤時 unload 一次');
});

test('兩個 backend 共用同一貼圖時，先關閉的不得 unload', async function () {
  const url = '/asset-library/test-lib/shared.png';
  const pixi = fakePixi();
  const a = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });
  const b = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  a.createNode(spriteSpec(url));
  b.createNode(spriteSpec(url));
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 2);

  a.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 1);
  assert.deepEqual(pixi._unloaded, [], '還有人在用就不能卸載');

  b.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 0);
  assert.deepEqual(pixi._unloaded, [url], '最後一個 owner 才 unload，且只 unload 一次');
});

test('destroy 之後不再建立新的貼圖引用', async function () {
  const url = '/asset-library/test-lib/after-destroy.png';
  const pixi = fakePixi();
  const backend = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  backend.destroy();
  backend.createNode(spriteSpec(url));
  await settle();

  assert.equal(VFXPixiBackend._refCount(url), 0, 'destroy 後 retain 就再也沒有人 release');
  assert.equal(pixi._loaded.length, 0);
});

test('backend 不再用 null 表示載入失敗（避免歧義狀態）', function () {
  const src = fs.readFileSync(path.join(root, 'js', 'vfx-pixi-backend.js'), 'utf8');
  assert.ok(/state: 'loading'/.test(src) && /'failed'/.test(src),
    '失敗狀態必須是明確的 state，不能是 null');
  assert.ok(!/textureCache\[url\] = null/.test(src),
    'null 與「從未請求過」無法區分，會造成重複 retain');
});

/* ---- Codex 指出的四項 regression 缺口（全部驗證 observable behavior） ---- */

test('destroy 時仍在載入中的貼圖，settle 之後也不會洩漏或錯亂 ownership', async function () {
  const url = '/asset-library/test-lib/in-flight.png';
  const pixi = fakePixi({ manual: true });
  const backend = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  backend.createNode(spriteSpec(url));
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 1);
  assert.equal(pixi._pendingCount(), 1, '載入應該還沒完成');
  assert.deepEqual(pixi._unloaded, []);

  backend.destroy();                       // 載入還在飛的時候收攤
  assert.equal(VFXPixiBackend._refCount(url), 0, 'in-flight 的 entry 也必須 release');
  assert.deepEqual(pixi._unloaded, [url], '歸零就該卸載，不能等載入完成');

  pixi._settleLoad(url);                   // 事後才完成
  await settle();
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 0, '事後完成不得讓計數復活');
  assert.deepEqual(pixi._unloaded, [url], '也不得重複卸載');
});

test('Assets.unload 回傳 rejected Promise 時不會產生 unhandled rejection', async function () {
  const url = '/asset-library/test-lib/unload-rejects.png';
  // 從未成功載入的 URL：Pixi v8 的 unload 會非同步 reject
  const pixi = fakePixi({ failUrls: [url], unloadRejects: true });
  const backend = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  const escaped = [];
  const onUnhandled = function (reason) { escaped.push(String(reason && reason.message || reason)); };
  process.on('unhandledRejection', onUnhandled);
  try {
    backend.createNode(spriteSpec(url));
    await settle();
    backend.destroy();
    // unhandledRejection 在 microtask 排空後才會發出，多轉幾圈確保抓得到
    await settle();
    await settle();
    await settle();
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }

  assert.deepEqual(pixi._unloaded, [url], '仍然要嘗試卸載');
  assert.deepEqual(escaped, [], 'unload 的 rejection 必須被接住，不能逸出成 unhandled rejection');
});

test('backend 重複 destroy 不會 double release、負數計數或重複 unload', async function () {
  const url = '/asset-library/test-lib/double-destroy.png';
  const pixi = fakePixi();
  const a = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });
  const b = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  a.createNode(spriteSpec(url));
  b.createNode(spriteSpec(url));
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 2);

  a.destroy();
  a.destroy();
  a.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 1, '重複 destroy 只能 release 一次');
  assert.ok(VFXPixiBackend._refCount(url) >= 0, '計數不得為負');
  assert.deepEqual(pixi._unloaded, [], 'b 還在用，不能卸載');

  b.destroy();
  b.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 0);
  assert.deepEqual(pixi._unloaded, [url], '整個生命週期只 unload 一次');
});

test('載入失敗的 URL 在最後一個 owner 歸零時，仍會實際呼叫 Assets.unload', async function () {
  const url = '/asset-library/test-lib/failed-then-unload.png';
  const pixi = fakePixi({ failUrls: [url] });
  const a = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });
  const b = VFXPixiBackend.createBackend({ PIXI: pixi, container: fakeContainer() });

  a.createNode(spriteSpec(url));
  b.createNode(spriteSpec(url));
  await settle();
  assert.equal(VFXPixiBackend._refCount(url), 2, '失敗的 entry 一樣持有 ownership');
  assert.deepEqual(pixi._unloaded, [], '還沒歸零就不該卸載');

  a.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 1);
  assert.deepEqual(pixi._unloaded, [], '仍有 owner');

  b.destroy();
  assert.equal(VFXPixiBackend._refCount(url), 0);
  assert.deepEqual(pixi._unloaded, [url],
    '從未成功載入不代表沒有 ownership；歸零時必須實際呼叫 unload');
});

/* ---------------- alignToVelocity（粒子朝向對齊速度） ---------------- */

/* 錄下實際送進 backend 的 render rotation。
   Core 的 transform 是共用的 scratch 物件，只能在呼叫當下讀，不能保存引用。 */
function rotationSeries(layerExtra, steps, dt) {
  const rotations = [];
  const backend = {
    createNode: function () { return {}; },
    updateNode: function (node, t) { if (t && t.visible !== false) rotations.push(t.rotation); },
    destroyNode: function () {}
  };
  const rt = VFXCore.createRuntime({ backend: backend, resolver: resolver() });
  rt.registerPreset({
    schemaVersion: 1, id: 'align-case', duration: 20,
    layers: [Object.assign({
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 1 },
      lifetime: 19, spawn: { shape: 'point' }, spread: 0
    }, layerExtra)]
  });
  rt.play('align-case');
  for (let i = 0; i < steps; i++) rt.update(dt === undefined ? 1 / 60 : dt);
  return rotations;
}

const HALF_PI = Math.PI / 2;

test('1. alignToVelocity 預設 false：既有 rotation 行為完全不變', function () {
  const base = { speed: 100, direction: 0, rotationStart: 0.25, rotationSpeed: 1.5 };
  const implicit = rotationSeries(base, 20);
  const explicitOff = rotationSeries(Object.assign({}, base, { alignToVelocity: false }), 20);
  assert.deepEqual(implicit, explicitOff, '明寫 false 與不寫必須位元相同');
  // 速度是 +x（角度 0），但沒開啟時不得把 velocity 角度加進去
  assert.ok(Math.abs(implicit[0] - (0.25 + 1.5 / 60)) < 1e-9,
    '關閉時只有 rotationStart + rotationSpeed*dt，收到 ' + implicit[0]);
});

test('2. 水平速度 → render rotation 為 0', function () {
  const r = rotationSeries({ speed: 100, direction: 0, alignToVelocity: true }, 5);
  r.forEach(function (v) { assert.ok(Math.abs(v) < 1e-9, '應為 0，收到 ' + v); });
});

test('3. 垂直速度 → render rotation 為 -π/2', function () {
  const r = rotationSeries({ speed: 100, direction: -90, alignToVelocity: true }, 5);
  r.forEach(function (v) {
    assert.ok(Math.abs(v + HALF_PI) < 1e-6, '應為 -π/2，收到 ' + v);
  });
});

test('4. gravity 改變速度後，render rotation 跟著改變', function () {
  // 初速朝 +x，重力朝 +y：角度應從 0 單調轉向 +π/2
  const r = rotationSeries({
    speed: 100, direction: 0, gravity: { x: 0, y: 200 }, alignToVelocity: true
  }, 60);
  assert.ok(Math.abs(r[0]) < 0.05, '第一幀仍接近 0，收到 ' + r[0]);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i] > r[i - 1], '角度必須持續增加（第 ' + i + ' 幀 ' + r[i] + '）');
  }
  assert.ok(r[r.length - 1] > 0.9, '一秒後應明顯轉向下方，收到 ' + r[r.length - 1]);
  assert.ok(r[r.length - 1] < HALF_PI, '不得超過 +π/2');
});

test('5. velocityRotationOffset 正確疊加', function () {
  const off = 0.75;
  const a = rotationSeries({ speed: 100, direction: 0, alignToVelocity: true }, 3);
  const b = rotationSeries({
    speed: 100, direction: 0, alignToVelocity: true, velocityRotationOffset: off
  }, 3);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs((b[i] - a[i]) - off) < 1e-9, '差值應為 offset，收到 ' + (b[i] - a[i]));
  }
});

test('6. rotationStart 在啟用後仍然疊加，不被覆蓋', function () {
  const start = 0.3;
  const a = rotationSeries({ speed: 100, direction: 0, alignToVelocity: true }, 3);
  const b = rotationSeries({
    speed: 100, direction: 0, alignToVelocity: true, rotationStart: start
  }, 3);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs((b[i] - a[i]) - start) < 1e-9, '差值應為 rotationStart');
  }
});

test('7. rotationSpeed 在啟用後仍然疊加（相對自轉）', function () {
  const spin = 2;
  const dt = 1 / 60;
  const a = rotationSeries({ speed: 100, direction: 0, alignToVelocity: true }, 10, dt);
  const b = rotationSeries({
    speed: 100, direction: 0, alignToVelocity: true, rotationSpeed: spin
  }, 10, dt);
  for (let i = 0; i < a.length; i++) {
    const expected = spin * dt * (i + 1);
    assert.ok(Math.abs((b[i] - a[i]) - expected) < 1e-9,
      '第 ' + i + ' 幀自轉量應為 ' + expected + '，收到 ' + (b[i] - a[i]));
  }
});

test('8. rotationOverLife 在啟用後仍然疊加', function () {
  const curve = [[0, 0], [1, 2]];
  const a = rotationSeries({ speed: 100, direction: 0, alignToVelocity: true }, 10);
  const b = rotationSeries({
    speed: 100, direction: 0, alignToVelocity: true, rotationOverLife: curve
  }, 10);
  let anyDifferent = false;
  for (let i = 0; i < a.length; i++) {
    const delta = b[i] - a[i];
    assert.ok(delta >= 0 && delta < 2, '曲線值應落在 0..2');
    if (delta > 0) anyDifferent = true;
  }
  assert.ok(anyDifferent, 'rotationOverLife 必須真的產生影響');
});

test('9. 速度降到 epsilon 以下時保留最後一次有效角度', function () {
  /* dt=0.1、初速 6（+x）、重力 -30（-x）：
     第 1 幀 vx=3 → 角度 0；第 2 幀 vx≈-8.9e-16，遠低於 epsilon。
     少了門檻的話 atan2(0, 負數) 會回傳 π，朝向瞬間翻轉 180 度。 */
  const r = rotationSeries({
    speed: 6, direction: 0, gravity: { x: -30, y: 0 }, alignToVelocity: true
  }, 2, 0.1);
  assert.ok(Math.abs(r[0]) < 1e-9, '第一幀角度應為 0，收到 ' + r[0]);
  assert.ok(Math.abs(r[1]) < 1e-9,
    '速度低於 epsilon 時應沿用上一次的 0，而不是翻成 π，收到 ' + r[1]);
  assert.ok(VFXCore.VELOCITY_EPSILON > 0, 'epsilon 必須是明確匯出的正值常數');
});

test('10. 出生起就零速度：維持既有固定 rotation，不加 velocity 項', function () {
  const start = 0.7;
  const withAlign = rotationSeries({
    speed: 0, direction: 0, gravity: { x: 0, y: 0 },
    rotationStart: start, alignToVelocity: true
  }, 5);
  const withoutAlign = rotationSeries({
    speed: 0, direction: 0, gravity: { x: 0, y: 0 }, rotationStart: start
  }, 5);
  assert.deepEqual(withAlign, withoutAlign, '從未有有效速度時，開不開啟結果必須一致');
  withAlign.forEach(function (v) {
    assert.ok(Math.abs(v - start) < 1e-9, '應維持 rotationStart，收到 ' + v);
  });
});

test('11. 非 particle 圖層使用 particle 專屬欄位會被 closed-field 檢查擋下', function () {
  const p = basePreset();
  p.layers[0].alignToVelocity = true;
  const r = VFXCore.validatePreset(p);
  assert.ok(r.errors.some(function (e) { return /不支援的欄位：alignToVelocity/.test(e); }),
    r.errors.join('；'));

  const q = basePreset();
  q.layers[0].velocityRotationOffset = 1.57;
  assert.ok(VFXCore.validatePreset(q).errors.some(function (e) {
    return /不支援的欄位：velocityRotationOffset/.test(e);
  }));

  // 型別檢查
  const bad = basePreset();
  bad.layers = [{
    id: 'p', type: 'particle', assetId: 'pack/star.png',
    emission: { mode: 'burst', count: 1 }, lifetime: 1,
    alignToVelocity: 'yes', velocityRotationOffset: 'x'
  }];
  const errs = VFXCore.validatePreset(bad).errors;
  assert.ok(errs.some(function (e) { return /alignToVelocity 必須是布林值/.test(e); }), errs.join('；'));
  assert.ok(errs.some(function (e) { return /velocityRotationOffset 必須是有限數/.test(e); }));
});

test('12. 新欄位進入 canonical 序列化，且往返穩定', function () {
  const preset = {
    schemaVersion: 1, id: 'align-serial', duration: 1,
    layers: [{
      velocityRotationOffset: 1.5708, alignToVelocity: true,
      emission: { mode: 'burst', count: 3 }, lifetime: 1,
      assetId: 'pack/star.png', type: 'particle', id: 'p'
    }]
  };
  assert.equal(VFXCore.validatePreset(preset).ok, true);
  const once = VFXCore.serialisePreset(preset);
  const twice = VFXCore.serialisePreset(JSON.parse(once));
  assert.equal(once, twice, '往返必須位元相同');
  assert.ok(once.indexOf('"alignToVelocity"') > 0, '新欄位必須出現在輸出中');
  assert.ok(once.indexOf('"velocityRotationOffset"') > 0);
  // key order：兩個新欄位排在 rotationSpeed 之後、over-life 曲線之前
  assert.ok(once.indexOf('"alignToVelocity"') < once.indexOf('"velocityRotationOffset"'),
    'alignToVelocity 應排在 velocityRotationOffset 之前');
});

/* ---- Codex Review 三項 MINOR 的回歸保護 ＋ 旋轉特效下的對齊 ---- */

test('13. 特效本身被旋轉時，朝向仍對齊世界座標的行進方向', function () {
  /* p.vx/p.vy 在 effect-local space，toWorld() 才把位置轉到世界座標。
     render rotation 加了 effect.rotation，兩者必須剛好抵銷成世界方向；
     少加會落後、重複加會多轉一次。 */
  [0, 0.9, -2.1].forEach(function (effectRotation) {
    const samples = [];
    const backend = {
      createNode: function () { return {}; },
      updateNode: function (node, t) {
        if (t && t.visible !== false) samples.push({ x: t.x, y: t.y, rot: t.rotation });
      },
      destroyNode: function () {}
    };
    const rt = VFXCore.createRuntime({ backend: backend, resolver: resolver() });
    rt.registerPreset({
      schemaVersion: 1, id: 'rot-effect', duration: 5,
      layers: [{
        id: 'p', type: 'particle', assetId: 'pack/star.png',
        emission: { mode: 'burst', count: 1 }, lifetime: 4,
        spawn: { shape: 'point' }, spread: 0, speed: 100, direction: 0,
        gravity: { x: 0, y: 120 }, alignToVelocity: true
      }]
    });
    rt.play('rot-effect', { rotation: effectRotation });
    for (let i = 0; i < 40; i++) rt.update(1 / 60);

    for (let i = 1; i < samples.length; i++) {
      const travel = Math.atan2(samples[i].y - samples[i - 1].y, samples[i].x - samples[i - 1].x);
      let diff = samples[i].rot - travel;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      assert.ok(Math.abs(diff) < 1e-6,
        'effect.rotation=' + effectRotation + ' 第 ' + i + ' 幀偏差 ' + diff);
    }
  });
});

test('14. epsilon 是嚴格大於：恰好等於門檻視為無效速度', function () {
  const eps = VFXCore.VELOCITY_EPSILON;
  // 速率剛好等於 eps（朝 +x）：不得取得有效角度，應維持 rotationStart
  const atThreshold = rotationSeries({
    speed: eps, direction: 0, gravity: { x: 0, y: 0 },
    rotationStart: 0.4, alignToVelocity: true
  }, 3);
  atThreshold.forEach(function (v) {
    assert.ok(Math.abs(v - 0.4) < 1e-9, '等於門檻應視為無效，收到 ' + v);
  });
  // 略高於門檻：應取得角度 0，總和變成 0.4
  const above = rotationSeries({
    speed: eps * 10, direction: 0, gravity: { x: 0, y: 0 },
    rotationStart: 0.4, alignToVelocity: true
  }, 3);
  above.forEach(function (v) {
    assert.ok(Math.abs(v - 0.4) < 1e-9, '角度為 0，總和仍是 0.4，收到 ' + v);
  });
  // 用垂直方向確認「高於門檻時確實有加上角度」
  const aboveVertical = rotationSeries({
    speed: eps * 10, direction: -90, gravity: { x: 0, y: 0 },
    rotationStart: 0.4, alignToVelocity: true
  }, 3);
  aboveVertical.forEach(function (v) {
    assert.ok(Math.abs(v - (0.4 - Math.PI / 2)) < 1e-6,
      '高於門檻時必須加上 -π/2，收到 ' + v);
  });
});

test('15. procedural 圖層使用 particle 專屬欄位同樣被擋下', function () {
  const p = basePreset();
  p.layers = [{
    id: 'uv', type: 'procedural', assetId: 'pack/ring.png', effect: 'uvScroll',
    size: { x: 128, y: 128 }, scrollSpeed: { x: 0.1, y: 0 },
    alignToVelocity: true, velocityRotationOffset: 1
  }];
  const errs = VFXCore.validatePreset(p).errors;
  assert.ok(errs.some(function (e) { return /不支援的欄位：alignToVelocity/.test(e); }), errs.join('；'));
  assert.ok(errs.some(function (e) { return /不支援的欄位：velocityRotationOffset/.test(e); }));
});

test('16. destroy 會清空粒子 free-list，不留下殘餘狀態', function () {
  const env = runtime();
  env.rt.registerPreset({
    schemaVersion: 1, id: 'pool-clear', duration: 0.3,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 40 }, lifetime: 0.1, speed: 10
    }]
  });
  env.rt.play('pool-clear');
  for (let i = 0; i < 20; i++) env.rt.update(0.05);      // 讓粒子生了又死，free-list 填滿
  env.rt.destroy();
  // 沒有公開 API 可讀 free-list，改由原始碼確認 destroy 有清空它
  const src = fs.readFileSync(path.join(root, 'js', 'vfx-core.js'), 'utf8');
  assert.ok(/particlePool\.length = 0/.test(src), 'destroy 必須清空 particlePool');
  const destroyBody = src.slice(src.indexOf('function destroy()'), src.indexOf('function destroy()') + 700);
  assert.ok(/particlePool\.length = 0/.test(destroyBody), '清空必須發生在 destroy() 內');
});

/* ---------------- 特效層級 transform：分軸縮放與播放中途移動（Runtime Adapter 前置） ---------------- */

function captureRuntime() {
  const backend = VFXCore.createNullBackend();
  const frames = [];
  const rt = VFXCore.createRuntime({
    backend: {
      createNode: backend.createNode,
      updateNode: function (n, t) {
        if (t && t.visible) frames.push({ node: n, x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY, rotation: t.rotation });
      },
      destroyNode: backend.destroyNode
    },
    resolver: resolver()
  });
  return { rt: rt, frames: frames };
}

test('play 的 scaleX / scaleY 分軸縮放：圖層位置與精靈尺寸各走各的軸，未給時等於 scale', function () {
  const c = captureRuntime();
  c.rt.registerPreset({
    schemaVersion: 1, id: 'axis', duration: 1,
    layers: [{ id: 'a', type: 'sprite', assetId: 'pack/ring.png', position: { x: 10, y: 10 } }]
  });
  c.rt.play('axis', { position: { x: 100, y: 100 }, scaleX: 3, scaleY: 0.5 });
  c.rt.update(0.1);
  const t = c.frames[c.frames.length - 1];
  assert.equal(t.x, 130, 'x 位移沿 X 軸放大三倍');
  assert.equal(t.y, 105, 'y 位移沿 Y 軸縮成一半');
  assert.equal(t.scaleX, 3);
  assert.equal(t.scaleY, 0.5);

  c.frames.length = 0;
  c.rt.stopAll();
  c.rt.play('axis', { position: { x: 0, y: 0 }, scale: 2 });
  c.rt.update(0.1);
  const u = c.frames[c.frames.length - 1];
  assert.equal(u.x, 20); assert.equal(u.y, 20);
  assert.equal(u.scaleX, 2, '只給 scale 時兩軸都等於 scale（與擴充前相同）');
  assert.equal(u.scaleY, 2);
});

test('分軸縮放時粒子貼圖尺寸取兩軸較小者：拉長光束不會讓火花變胖', function () {
  const c = captureRuntime();
  c.rt.registerPreset({
    schemaVersion: 1, id: 'axis-p', duration: 1,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 4 }, maxParticles: 8, lifetime: 1,
      speed: 0, startScale: 0.5
    }]
  });
  c.rt.play('axis-p', { scaleX: 4, scaleY: 1 });
  c.rt.update(0.1);
  assert.ok(c.frames.length >= 4, '四顆粒子都畫了');
  c.frames.forEach(function (f) {
    assert.equal(f.scaleX, 0.5, '粒子尺寸 = startScale × min(|4|,|1|)');
    assert.equal(f.scaleY, 0.5);
  });
  c.rt.stopAll();
  c.frames.length = 0;
  c.rt.play('axis-p', { scale: 2, scaleX: 4 });
  c.rt.update(0.1);
  c.frames.forEach(function (f) {
    assert.equal(f.scaleX, 1, '有給 scale 就以 scale 為粒子尺寸，scaleX 只影響幾何');
  });
});

test('setTransform 在播放中途移動特效：精靈下一幀就在新位置，已出生的粒子留在原地', function () {
  const c = captureRuntime();
  c.rt.registerPreset({
    schemaVersion: 1, id: 'move', duration: 2,
    layers: [
      { id: 's', type: 'sprite', assetId: 'pack/ring.png', position: { x: 5, y: 0 } },
      { id: 'p', type: 'particle', assetId: 'pack/star.png', zIndex: 1,
        emission: { mode: 'burst', count: 1 }, maxParticles: 4, lifetime: 5, speed: 0 }
    ]
  });
  const h = c.rt.play('move', { position: { x: 0, y: 0 } });
  c.rt.update(0.1);
  const first = c.frames.slice();
  const spriteNode = first.find(function (f) { return f.x === 5; }).node;
  const particleNode = first.find(function (f) { return f.x === 0; }).node;
  c.frames.length = 0;
  assert.equal(c.rt.setTransform(h, { position: { x: 100, y: 50 }, rotation: Math.PI / 2, scale: 2 }), true);
  c.rt.update(0.1);
  const sprite = c.frames.find(function (f) { return f.node === spriteNode; });
  const particle = c.frames.find(function (f) { return f.node === particleNode; });
  assert.ok(Math.abs(sprite.x - 100) < 1e-9, '旋轉 90° 後 x 位移歸零，落在新原點 x');
  assert.ok(Math.abs(sprite.y - 60) < 1e-9, 'y = 50 + 5×2');
  assert.equal(sprite.scaleX, 2);
  assert.ok(Math.abs(sprite.rotation - Math.PI / 2) < 1e-9, '整個特效的旋轉套到精靈上');
  /* 粒子的位置是出生時就固定在區域座標 (0,0)，toWorld 會跟著新原點走——
     這代表「出生點 + 原點位移」：粒子本身沒有動，是原點動了。
     速度為 0 的粒子因此落在新原點上；拖尾效果來自「新粒子在新原點出生、舊粒子留在舊區域座標」。 */
  assert.ok(Math.abs(particle.x - 100) < 1e-9);
  assert.ok(Math.abs(particle.y - 50) < 1e-9);
});

test('setTransform 只更新有給的欄位；未知 handle 回 false；非有限數直接報錯', function () {
  const c = captureRuntime();
  c.rt.registerPreset(basePreset({ id: 'partial', layers: [{ id: 'a', type: 'sprite', assetId: 'pack/ring.png', position: { x: 10, y: 0 } }] }));
  const h = c.rt.play('partial', { position: { x: 1, y: 2 }, rotation: 0, scale: 3 });
  assert.equal(c.rt.setTransform(h, { position: { x: 7 } }), true, '只給 x');
  c.rt.update(0.01);
  let t = c.frames[c.frames.length - 1];
  assert.equal(t.x, 37, 'x 換成 7，位移仍 ×3');
  assert.equal(t.y, 2, 'y 沒給就不動');
  assert.equal(t.scaleX, 3, 'scale 沒給就不動');
  assert.equal(c.rt.setTransform(h, { scaleX: 1 }), true);
  c.rt.update(0.01);
  t = c.frames[c.frames.length - 1];
  assert.equal(t.scaleX, 1, '只給 scaleX 就只改 X 軸');
  assert.equal(t.scaleY, 3, 'Y 軸保留原本的 scale');
  assert.equal(c.rt.setTransform(9999, { rotation: 1 }), false, '不存在的 handle');
  assert.throws(function () { c.rt.setTransform(h, { rotation: NaN }); }, /rotation/);
  assert.throws(function () { c.rt.setTransform(h, { position: { x: Infinity } }); }, /position\.x/);
  assert.throws(function () { c.rt.play('partial', { scaleX: NaN }); }, /scaleX/);
  c.rt.stop(h);
  assert.equal(c.rt.setTransform(h, { rotation: 1 }), false, '停掉之後也回 false');
  c.rt.destroy();
  assert.throws(function () { c.rt.setTransform(h, {}); }, /destroy/);
});
