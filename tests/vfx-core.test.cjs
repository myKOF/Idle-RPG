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

/* ---------------- 粒子運動：阻力、徑向、環繞、噪聲 ----------------
   這四項的共同點是**不需要任何新素材**，成本純粹是模擬迴圈。
   加入之前粒子只會「以固定初速直線飛、外加重力」，做不出漩渦、吸引子、
   減速的餘燼，也做不出火焰與煙霧的湍流。 */

/* 錄下每個節點各自的位置序列（節點身分＝粒子身分）。 */
function motionSeries(layerExtra, steps, dt) {
  const byNode = new Map();
  const backend = {
    createNode: function () { const n = {}; byNode.set(n, []); return n; },
    updateNode: function (node, t) {
      if (t && t.visible !== false && byNode.has(node)) {
        byNode.get(node).push({ x: t.x, y: t.y, r: t.rotation });
      }
    },
    destroyNode: function () {}
  };
  const rt = VFXCore.createRuntime({ backend: backend, resolver: resolver() });
  rt.registerPreset({
    schemaVersion: 1, id: 'motion-case', duration: 30,
    layers: [Object.assign({
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 1 },
      lifetime: 29, spawn: { shape: 'point' }, spread: 0, speed: 0
    }, layerExtra)]
  });
  rt.play('motion-case');
  for (let i = 0; i < steps; i++) rt.update(dt === undefined ? 1 / 60 : dt);
  return [...byNode.values()].filter(function (s) { return s.length; });
}
const hyp = (p) => Math.sqrt(p.x * p.x + p.y * p.y);

test('MOTION-1 四個欄位都不給時，輸出與加入它們之前完全相同', function () {
  /* 這是每一次擴充都要守的那條線：既有 151 份 preset 一個欄位都沒改，
     畫面就不准有任何差別。 */
  const base = motionSeries({ speed: 120, direction: 0, gravity: { x: 0, y: 300 } }, 30)[0];
  const same = motionSeries({
    speed: 120, direction: 0, gravity: { x: 0, y: 300 },
    drag: 0, radialSpeed: 0, orbitalSpeed: 0
  }, 30)[0];
  assert.deepEqual(same, base, '把三個新欄位顯式寫成 0，結果必須逐位元相同');
});

test('DRAG-1 阻力讓粒子減速，且任何 dt 都不會把速度推成反向', function () {
  const free = motionSeries({ speed: 200, direction: 0 }, 60)[0];
  const dragged = motionSeries({ speed: 200, direction: 0, drag: 4 }, 60)[0];
  assert.ok(dragged[59].x < free[59].x * 0.5, '有阻力應該明顯落後');
  /* 一直往前，不會倒退：1/(1+d*dt) 對任何 dt 都落在 0..1。 */
  for (let i = 1; i < dragged.length; i++) {
    assert.ok(dragged[i].x >= dragged[i - 1].x - 1e-9,
      '第 ' + i + ' 幀往回跑了（阻力寫成 1-d*dt 就會這樣）');
  }
  /* 掉幀的極端情形：一幀就是 2 秒、drag=4 → 1-d*dt = -7，會把粒子甩到後面去。 */
  const spike = motionSeries({ speed: 200, direction: 0, drag: 4 }, 2, 2)[0];
  assert.ok(spike[1].x >= spike[0].x, 'dt=2s 的那一幀也不准倒退');
});

test('ORBIT-1 純環繞的粒子半徑守恆（顯式 Euler 會讓它飛散）', function () {
  /* 這一條是設計的核心：環繞若做成「加一個切線速度再積分」，
     ω=1 轉/秒、dt=1/60 跑 6 秒，起始半徑 100 會變成 712。
     所以實作是把位移向量精確旋轉 ω·dt，而不是加一個速度。 */
  const s = motionSeries({
    speed: 0, spawn: { shape: 'circle', radius: 100 },
    orbitalSpeed: Math.PI * 2
  }, 360)[0];
  const r0 = hyp(s[0]);
  assert.ok(r0 > 1, '要真的離心才驗得到（實得半徑 ' + r0.toFixed(1) + '）');
  s.forEach(function (p, i) {
    assert.ok(Math.abs(hyp(p) - r0) < r0 * 0.001,
      '第 ' + i + ' 幀半徑 ' + hyp(p).toFixed(2) + '，起始 ' + r0.toFixed(2));
  });
});

test('ORBIT-2 正的角速度在螢幕上是順時針（與技能表的說法一致）', function () {
  /* 螢幕座標 y 向下。技能表寫「順時針繞行 {rps} 圈」，兩邊必須同號，
     否則同一個數字在模擬層與顯示層轉不同方向。 */
  const s = motionSeries({
    speed: 0, spawn: { shape: 'circle', radius: 100 }, orbitalSpeed: 1
  }, 20)[0];
  const a0 = Math.atan2(s[0].y, s[0].x);
  const a1 = Math.atan2(s[5].y, s[5].x);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  assert.ok(d > 0, '角度應該遞增（y 向下時即為順時針），實得 ' + d.toFixed(3));
});

test('ORBIT-3 一圈的時間就是 2π/ω（角速度是真的角速度）', function () {
  const s = motionSeries({
    speed: 0, spawn: { shape: 'circle', radius: 80 }, orbitalSpeed: Math.PI * 2
  }, 61)[0];
  /* 1 轉/秒、60fps。s[0] 是**第一次 update 之後**的位置（粒子在出生的那一幀
     就會轉一格），所以整整一圈是 s[0] → s[60]，不是 s[59]。 */
  assert.ok(Math.abs(s[60].x - s[0].x) < 0.5 && Math.abs(s[60].y - s[0].y) < 0.5,
    '一秒之後應該回到原處，實得 (' + s[60].x.toFixed(2) + ',' + s[60].y.toFixed(2) +
    ')、起點 (' + s[0].x.toFixed(2) + ',' + s[0].y.toFixed(2) + ')');
});

test('RADIAL-1 負值向心（吸引子）、正值離心', function () {
  const out = motionSeries({
    speed: 0, spawn: { shape: 'circle', radius: 50 }, radialSpeed: 100
  }, 30)[0];
  assert.ok(hyp(out[29]) > hyp(out[0]) + 40, '正值要往外');

  const inward = motionSeries({
    speed: 0, spawn: { shape: 'circle', radius: 50 }, radialSpeed: -100
  }, 30)[0];
  assert.ok(hyp(inward[29]) < hyp(inward[0]), '負值要往內（黑洞）');
});

test('RADIAL-2 位在圓心的粒子不會爆掉（方向未定義）', function () {
  /* r=0 時徑向方向沒有意義，除法會得到 NaN，畫面上就是粒子整個消失。 */
  const s = motionSeries({ speed: 0, spawn: { shape: 'point' }, radialSpeed: 100 }, 10)[0];
  s.forEach(function (p, i) {
    assert.ok(isFinite(p.x) && isFinite(p.y), '第 ' + i + ' 幀成了 NaN');
  });
});

test('NOISE-1 噪聲是位移偏移，不會累積成漂移', function () {
  /* 靜止不動的粒子加上噪聲，應該永遠待在出生點的 strength 半徑內。
     若把噪聲做成加速度，它會被吹到畫面外。 */
  const s = motionSeries({
    speed: 0, spawn: { shape: 'point' },
    noise: { strength: 20, frequency: 0.05, scrollSpeed: 2 }
  }, 600)[0];
  s.forEach(function (p, i) {
    assert.ok(hyp(p) <= 20 * Math.SQRT2 + 1e-6, '第 ' + i + ' 幀跑到 ' + hyp(p).toFixed(1) + ' 了');
  });
  const spread = Math.max.apply(null, s.map(hyp));
  assert.ok(spread > 1, '完全不動的話就不是噪聲了（最大位移 ' + spread.toFixed(2) + '）');
});

test('NOISE-2 決定性：同一份 preset 重播兩次逐位元相同', function () {
  const opts = {
    speed: 40, direction: -90, spawn: { shape: 'circle', radius: 30 },
    emission: { mode: 'rate', rate: 30 },
    noise: { strength: 15, frequency: 0.03, scrollSpeed: 1.5 }
  };
  const a = motionSeries(opts, 90);
  const b = motionSeries(opts, 90);
  assert.deepEqual(b, a, '噪聲必須由 seed 決定，不能用 Math.random');
});

test('NOISE-3 是一片場，不是每顆粒子各抖各的', function () {
  /* 相鄰的粒子要被推向同一邊（看起來才像被氣流帶著走）。
     驗法：把八顆粒子擠在 2px 內，它們的位移方向應該高度一致；
     若是各自獨立的亂數，方向就會散開。 */
  const near = motionSeries({
    speed: 0, spawn: { shape: 'box', width: 2, height: 2 },
    emission: { mode: 'burst', count: 8 },
    noise: { strength: 30, frequency: 0.02, scrollSpeed: 0 }
  }, 5);
  assert.equal(near.length, 8);
  const dirs = near.map(function (s) { return Math.atan2(s[4].y, s[4].x); });
  const spreadAng = Math.max.apply(null, dirs) - Math.min.apply(null, dirs);
  assert.ok(spreadAng < 0.5,
    '擠在 2px 內的八顆粒子被推往差很多的方向（' + spreadAng.toFixed(2) + ' 弧度），那是雜訊不是場');
});

test('NOISE-4 驗證：格式錯誤要報錯', function () {
  function errs(noise) {
    return VFXCore.validatePreset({
      schemaVersion: 1, id: 'n', duration: 1,
      layers: [{
        id: 'p', type: 'particle', assetId: 'pack/star.png',
        emission: { mode: 'burst', count: 1 }, lifetime: 1, noise: noise
      }]
    }).errors.join('；');
  }
  assert.match(errs({ strength: -1 }), /strength/);
  assert.match(errs({ strength: 5, frequency: 0 }), /frequency/);
  assert.match(errs({ frequency: 1 }), /strength/);
  assert.match(errs('big'), /必須是/);
  assert.match(errs({ strength: 5, wobble: 1 }), /wobble/);
  assert.deepEqual(VFXCore.validatePreset({
    schemaVersion: 1, id: 'n', duration: 1,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'burst', count: 1 }, lifetime: 1,
      noise: { strength: 12, frequency: 0.04, scrollSpeed: 1 },
      drag: 2, radialSpeed: -40, orbitalSpeed: 3
    }]
  }).errors, []);
});

test('MOTION-2 這四項只掛在 particle：sprite 寫了要報錯，不 silent 忽略', function () {
  ['drag', 'radialSpeed', 'orbitalSpeed', 'noise'].forEach(function (f) {
    const layer = { id: 'a', type: 'sprite', assetId: 'pack/ring.png' };
    layer[f] = f === 'noise' ? { strength: 1 } : 1;
    const r = VFXCore.validatePreset({ schemaVersion: 1, id: 'm', duration: 1, layers: [layer] });
    assert.equal(r.ok, false, f + ' 掛在 sprite 上應該被擋');
  });
});

test('MOTION-3 alignToVelocity 在有漩渦時看實際位移，不是看 p.v', function () {
  /* 環繞是直接改位置的，p.v 完全不知道它的存在。只看速度的話，
     一顆速度為 0 卻在繞圈的粒子，拖尾會永遠指著出生方向。 */
  const s = motionSeries({
    speed: 0, spawn: { shape: 'circle', radius: 100 },
    orbitalSpeed: Math.PI * 2, alignToVelocity: true
  }, 30)[0];
  const rots = s.map(function (p) { return p.r; });
  const distinct = new Set(rots.map(function (v) { return Math.round(v * 100); }));
  assert.ok(distinct.size > 10, '朝向應該跟著繞圈一直變，實際只有 ' + distinct.size + ' 種');
});

/* ---------------- tintOverLife（顏色隨生命變化） ----------------
   加入這一項之前，一個圖層從生到死只有一個固定顏色：火星不會冷卻、
   煙不會轉灰、電弧不會褪成藍白。作者只能把同一張圖疊三層、各給一個顏色，
   用離散階梯假裝漸層——151 份 preset 裡有 36 組這樣的疊層，佔掉 16% 的圖層預算。 */

/* 錄下實際送進 backend 的 tint（scratch 物件只能當下讀，不能存引用）。 */
function tintSeries(preset, steps, dt) {
  const tints = [];
  const backend = {
    createNode: function () { return {}; },
    updateNode: function (node, t) { if (t && t.visible !== false) tints.push(t.tint); },
    destroyNode: function () {}
  };
  const rt = VFXCore.createRuntime({ backend: backend, resolver: resolver() });
  rt.registerPreset(preset);
  rt.play(preset.id);
  for (let i = 0; i < steps; i++) rt.update(dt === undefined ? 0.25 : dt);
  return tints;
}
function spritePreset(layerExtra) {
  return {
    schemaVersion: 1, id: 'tint-case', duration: 1,
    layers: [Object.assign({ id: 'a', type: 'sprite', assetId: 'pack/ring.png' }, layerExtra)]
  };
}

test('TINT-1 沒有 tintOverLife 時行為完全不變（既有 151 份 preset 的相容性）', function () {
  const flat = tintSeries(spritePreset({ tint: '#86efac' }), 4);
  assert.ok(flat.length >= 3);
  flat.forEach(function (v) { assert.equal(v, 0x86efac); });
});

test('TINT-2 曲線在 sRGB 分量上線性內插', function () {
  /* 黑→白。update 是「先推進再畫」，所以 4 次 0.25 秒取到的是
     生命進度 0.25／0.5／0.75 三格（t=1 時特效已結束，不再送 transform）。 */
  const series = tintSeries(spritePreset({
    tint: '#ffffff', tintOverLife: [[0, '#000000'], [1, '#ffffff']]
  }), 4);
  assert.equal(series.length, 3, '取樣格數：' + series.length);
  const grey = series.map(function (v) { return (v >> 16) & 255; });
  assert.ok(Math.abs(grey[0] - 64) <= 2, '25% 應該是 1/4 灰，實際 ' + grey[0]);
  assert.ok(Math.abs(grey[1] - 127) <= 2, '50% 應該是中灰，實際 ' + grey[1]);
  assert.ok(Math.abs(grey[2] - 191) <= 2, '75% 應該是 3/4 灰，實際 ' + grey[2]);
  series.forEach(function (v, i) {
    assert.equal((v >> 8) & 255, grey[i], '灰階三分量要一致');
    assert.equal(v & 255, grey[i]);
  });
});

test('TINT-3 曲線是「乘在 tint 上」，不是取代它', function () {
  /* 這是與 alphaOverLife 一致的語意，也是 Unity 的 startColor × colorOverLifetime。
     取代語意會讓 tint 變成填了沒用的欄位，那正是規格禁止的 silent fallback。 */
  const series = tintSeries(spritePreset({
    tint: '#ff0000', tintOverLife: [[0, '#ffffff'], [1, '#ffffff']]
  }), 3);
  series.forEach(function (v) { assert.equal(v, 0xff0000, '乘白色＝不變'); });

  const halved = tintSeries(spritePreset({
    tint: '#ff0000', tintOverLife: '#808080'
  }), 2);
  assert.equal((halved[0] >> 16) & 255, 128, '乘 50% 灰＝紅色減半');
  assert.equal(halved[0] & 0xffff, 0, '沒有紅色以外的分量被憑空加進來');
});

test('TINT-4 粒子逐顆各自取樣自己的生命進度', function () {
  /* 整層共用一個 tint 是加入本功能之前的行為；有曲線時同一層裡先出生的
     粒子必須比後出生的更「老」，顏色因此不同——這正是火星冷卻的做法。 */
  const seen = [];
  const backend = {
    createNode: function () { return {}; },
    updateNode: function (node, t) { if (t && t.visible !== false) seen.push(t.tint); },
    destroyNode: function () {}
  };
  const rt = VFXCore.createRuntime({ backend: backend, resolver: resolver() });
  rt.registerPreset({
    schemaVersion: 1, id: 'tint-particles', duration: 10,
    layers: [{
      id: 'p', type: 'particle', assetId: 'pack/star.png',
      emission: { mode: 'rate', rate: 20 }, lifetime: 1,
      tint: '#ffffff', tintOverLife: [[0, '#ffffff'], [1, '#000000']]
    }]
  });
  rt.play('tint-particles');
  for (let i = 0; i < 40; i++) rt.update(1 / 30);
  const distinct = new Set(seen);
  assert.ok(distinct.size > 3, '同一層的粒子應該有多種顏色，實際只有 ' + distinct.size + ' 種');
  assert.ok(Math.max.apply(null, [...distinct].map(function (v) { return (v >> 16) & 255; })) > 200,
    '剛出生的粒子要接近白');
  assert.ok(Math.min.apply(null, [...distinct].map(function (v) { return (v >> 16) & 255; })) < 60,
    '快死的粒子要接近黑');
});

test('TINT-5 驗證：格式錯誤要報錯，不 silent fallback', function () {
  function errsOf(v) {
    const p = spritePreset({ tintOverLife: v });
    return VFXCore.validatePreset(p).errors.join('；');
  }
  assert.match(errsOf('red'), /必須是 #rrggbb/);
  assert.match(errsOf([[0, '#fff']]), /\[t, '#rrggbb'\]/);
  assert.match(errsOf([[1, '#000000'], [0, '#ffffff']]), /遞增/);
  assert.match(errsOf([[1.5, '#000000']]), /0\.\.1/);
  assert.match(errsOf([]), /必須是 #rrggbb 或/);
  assert.deepEqual(VFXCore.validatePreset(spritePreset({
    tintOverLife: [[0, '#ffffff'], [0.5, '#ffcc00'], [1, '#000000']]
  })).errors, []);
});

test('TINT-6 三種圖層型別都吃得到（沒有型別會「填了卻沒效果」）', function () {
  ['sprite', 'particle', 'procedural'].forEach(function (type) {
    const layer = { id: 'x', type: type, assetId: 'pack/ring.png', tintOverLife: '#808080' };
    if (type === 'particle') { layer.emission = { mode: 'burst', count: 1 }; layer.lifetime = 1; }
    if (type === 'procedural') { layer.effect = 'uvScroll'; layer.size = { x: 8, y: 8 }; }
    const r = VFXCore.validatePreset({ schemaVersion: 1, id: 't', duration: 1, layers: [layer] });
    assert.deepEqual(r.errors, [], type + ' 應該接受 tintOverLife');
  });
});

test('TINT-7 序列化後仍然位元穩定，且既有 preset 的輸出不變', function () {
  const withCurve = spritePreset({ tint: '#86efac', tintOverLife: [[0, '#ffffff'], [1, '#000000']] });
  const once = VFXCore.serialisePreset(withCurve);
  assert.equal(VFXCore.serialisePreset(JSON.parse(once)), once, '存→載→再存必須位元相同');
  assert.match(once, /"tintOverLife"/);
  /* 沒有這個欄位的 preset，序列化結果不因為新增欄位而改變。 */
  const plain = spritePreset({ tint: '#86efac' });
  assert.ok(VFXCore.serialisePreset(plain).indexOf('tintOverLife') < 0);
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
