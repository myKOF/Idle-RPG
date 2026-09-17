'use strict';
/* ============================================================
   vfx-core-hierarchy.test.cjs — 父子層級（parent）與空物件（empty）

   需求（2026-09-17）：可以把多個子物件掛在父物件底下，子物件繼承父物件的參數。
   使用者決定：
     - 繼承變換（位置／旋轉／縮放，含曲線動畫）、透明度、顏色
     - 時間軸跟著父物件：子物件的 delay 從父物件出現那一刻算起；
       父物件還沒出現或已經結束時，子物件也不出現
     - 任何圖層都能當父物件，另有不畫東西的空物件
   沒有 parent 的圖層完全走原本的算式——這一點另外用「209 份 preset 修改前後
   逐位元比對」驗過；這裡驗的是新功能本身。

   期望值一律用手算的數字或獨立的矩陣算式，不拿 Core 自己的矩陣函式來對答案。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');

const RESOLVER = { has: () => true, resolve: (id) => '/' + id };
const EPS = 1e-9;

function near(actual, expected, msg, eps) {
  assert.ok(Math.abs(actual - expected) < (eps || EPS), (msg || '') + '：期望 ' + expected + '，實得 ' + actual);
}

function sprite(id, extra) {
  return Object.assign({ id: id, type: 'sprite', assetId: id + '.png' }, extra || {});
}

function preset(layers, extra) {
  return Object.assign({ schemaVersion: 1, id: 'fx', duration: 1, loop: false, layers: layers }, extra || {});
}

/* 記錄型後端：每個節點記住最後一次收到的 transform；用素材 URL 認是哪一層 */
function recorder() {
  const nodes = [];
  const backend = {
    createNode: (spec) => { const n = { url: spec.assetUrl, last: null }; nodes.push(n); return n; },
    updateNode: (node, t) => { node.last = Object.assign({}, t); },
    destroyNode: () => {},
    destroy: () => {}
  };
  return {
    backend: backend,
    nodes: nodes,
    /* 這一層目前看得到的節點（sprite 只會有一個；粒子層可能有多個） */
    shown: (id) => nodes.filter((n) => n.url === '/' + id + '.png' && n.last && n.last.visible)
  };
}

function runtimeFor(p, playParams) {
  const rec = recorder();
  const rt = VFXCore.createRuntime({ backend: rec.backend, resolver: RESOLVER });
  rt.registerPreset(p);
  const handle = rt.play(p.id, Object.assign({ seed: 1 }, playParams || {}));
  return { rec: rec, rt: rt, handle: handle };
}

function errorsOf(p) {
  return VFXCore.validatePreset(p).errors.join('\n');
}

/* Pixi 的 rotation／scale／skewX（skewY=0）還原成矩陣的兩行，用來比對期望的矩陣 */
function columnsOf(t) {
  return {
    a: Math.cos(t.rotation) * t.scaleX, b: Math.sin(t.rotation) * t.scaleX,
    c: -Math.sin(t.rotation - t.skewX) * t.scaleY, d: Math.cos(t.rotation - t.skewX) * t.scaleY
  };
}

/* ---------------- 驗證與存檔格式 ---------------- */

test('HIER-1 驗證：父物件要存在、不能掛自己、不能成環、深度有上限', function () {
  assert.ok(VFXCore.validatePreset(preset([sprite('p'), sprite('c', { parent: 'p' })])).ok);
  assert.match(errorsOf(preset([sprite('c', { parent: 'nobody' })])), /指向不存在的圖層：nobody/);
  assert.match(errorsOf(preset([sprite('c', { parent: 'c' })])), /不能掛在自己底下/);
  assert.match(errorsOf(preset([sprite('a', { parent: 'b' }), sprite('b', { parent: 'a' })])), /形成環/);
  assert.match(errorsOf(preset([sprite('a', { parent: '' })])), /parent 必須是父物件的圖層 id/);

  const chain = [sprite('l0')];
  for (let i = 1; i <= VFXCore.MAX_PARENT_DEPTH + 1; i++) chain.push(sprite('l' + i, { parent: 'l' + (i - 1) }));
  assert.match(errorsOf(preset(chain)), /超過 8 層/);
  assert.ok(VFXCore.validatePreset(preset(chain.slice(0, VFXCore.MAX_PARENT_DEPTH + 1))).ok, '剛好 8 層可以');

  /* 父物件被停用不是錯誤：等於沒出現，子物件跟著不出現（HIER-6 驗行為） */
  assert.ok(VFXCore.validatePreset(preset([sprite('p', { enabled: false }), sprite('c', { parent: 'p' })])).ok);
});

test('HIER-2 空物件：不畫東西、不需要素材；會被繼承的欄位才收，其餘報「不支援的欄位」', function () {
  assert.ok(VFXCore.LAYER_TYPES.indexOf('empty') >= 0);
  const ok = preset([{
    id: 'null', type: 'empty', position: { x: 10, y: 0 }, rotation: 0.5, scale: { x: 2, y: 1 },
    alpha: 0.5, tint: '#ff0000', delay: 0.1, duration: 0.5,
    rotationOverLife: [[0, 0], [1, 1]], offsetXOverLife: [[0, 0], [1, 20]], outerScale: { x: 1, y: 0.5 }
  }, sprite('c', { parent: 'null' })]);
  assert.ok(VFXCore.validatePreset(ok).ok, errorsOf(ok));
  ['assetId', 'blendMode', 'anchor', 'zIndex', 'sheet'].forEach(function (key) {
    const layer = { id: 'null', type: 'empty' };
    layer[key] = key === 'assetId' ? 'x.png' : key === 'blendMode' ? 'add'
      : key === 'anchor' ? { x: 0, y: 0 } : key === 'zIndex' ? 1 : { columns: 2, rows: 2 };
    assert.match(errorsOf(preset([layer])), new RegExp('不支援的欄位：' + key), key + ' 在空物件上不會有效果，要報錯');
  });
});

test('HIER-3 子發射器的來源層與目標層必須掛在同一個父物件底下', function () {
  const particle = (id, extra) => Object.assign({
    id: id, type: 'particle', assetId: id + '.png', lifetime: 1, emission: { mode: 'burst', count: 1 }
  }, extra || {});
  const bad = preset([
    sprite('p'),
    particle('src', { parent: 'p', subEmitter: { layer: 'puff', on: 'death', count: 1 } }),
    particle('puff', { emission: { mode: 'sub' } })
  ]);
  assert.match(errorsOf(bad), /必須掛在同一個父物件底下/);
  const good = preset([
    sprite('p'),
    particle('src', { parent: 'p', subEmitter: { layer: 'puff', on: 'death', count: 1 } }),
    particle('puff', { parent: 'p', emission: { mode: 'sub' } })
  ]);
  assert.ok(VFXCore.validatePreset(good).ok, errorsOf(good));
});

test('HIER-4 存檔：parent 緊接在 type 後面，存檔→載入→再存檔位元相同', function () {
  const p = preset([{ id: 'n', type: 'empty' }, sprite('c', { alpha: 0.5, parent: 'n' })]);
  const text = VFXCore.serialisePreset(p);
  const layer = JSON.parse(text).layers[1];
  assert.deepEqual(Object.keys(layer).slice(0, 4), ['id', 'type', 'parent', 'assetId']);
  assert.equal(VFXCore.serialisePreset(JSON.parse(text)), text);
});

/* ---------------- 變換 ---------------- */

test('HIER-5 子物件的位置／旋轉／縮放接在父物件後面，特效本身的變換最後才套', function () {
  const p = preset([
    sprite('p', { position: { x: 100, y: 0 }, rotation: Math.PI / 2, scale: { x: 2, y: 2 } }),
    sprite('c', { parent: 'p', position: { x: 10, y: 0 }, rotation: 0.25 })
  ]);
  const r = runtimeFor(p, { position: { x: 5, y: 5 } });
  r.rt.update(0);
  const c = r.rec.shown('c')[0].last;
  /* 父物件轉 90 度、放大 2 倍：子物件的 (10,0) 變成 (0,20)，加上父物件位置與特效位置 */
  near(c.x, 105, 'x'); near(c.y, 25, 'y');
  near(c.rotation, Math.PI / 2 + 0.25, '旋轉相加');
  near(c.scaleX, 2, 'scaleX'); near(c.scaleY, 2, 'scaleY');
  near(c.skewX, 0, '等比縮放不會斜切');

  /* 父物件本身照舊畫在原本的位置 */
  const parentNode = r.rec.shown('p')[0].last;
  near(parentNode.x, 105, '父物件 x'); near(parentNode.y, 5, '父物件 y');
});

test('HIER-6 父物件非等比縮放、子物件旋轉：畫出來的矩陣就是 S(父) · R(子)，含斜切', function () {
  const angle = Math.PI / 4;
  const p = preset([
    sprite('p', { scale: { x: 2, y: 1 } }),
    sprite('c', { parent: 'p', rotation: angle })
  ]);
  const r = runtimeFor(p);
  r.rt.update(0);
  const cols = columnsOf(r.rec.shown('c')[0].last);
  /* S(2,1)·R(45°) = [[2cos, -2sin], [sin, cos]]：第一行 (2cos, sin)，第二行 (-2sin, cos) */
  near(cols.a, 2 * Math.cos(angle), 'a'); near(cols.b, Math.sin(angle), 'b');
  near(cols.c, -2 * Math.sin(angle), 'c'); near(cols.d, Math.cos(angle), 'd');
  assert.ok(Math.abs(r.rec.shown('c')[0].last.skewX) > 0.1, '這個情況一定有斜切');
});

test('HIER-7 特效本身非等比縮放＋旋轉時，子物件與「同樣位置的根圖層」畫在同一個地方', function () {
  /* 父物件是恆等變換的空物件：子物件應該與沒有父物件的同一層完全重合 */
  const layer = { position: { x: 30, y: -12 }, rotation: 0.7, scale: { x: 1.2, y: 0.8 } };
  const p = preset([
    { id: 'n', type: 'empty' },
    sprite('c', Object.assign({ parent: 'n' }, layer)),
    sprite('root', layer)
  ], { sizing: { shape: 'rectangle', widthM: 2, heightM: 1, authored: { width: 100, height: 50 } } });
  const r = runtimeFor(p, { position: { x: 7, y: 3 }, rotation: -0.4, scaleX: 1.6, scaleY: 0.5 });
  r.rt.update(0);
  const c = r.rec.shown('c')[0].last;
  const root = r.rec.shown('root')[0].last;
  near(c.x, root.x, 'x', 1e-9); near(c.y, root.y, 'y', 1e-9);
  const cc = columnsOf(c), rc = columnsOf(root);
  ['a', 'b', 'c', 'd'].forEach((k) => near(cc[k], rc[k], k, 1e-9));
});

test('HIER-8 父物件的曲線動畫帶著子物件走；三層串接', function () {
  const p = preset([
    { id: 'spin', type: 'empty', rotationOverLife: [[0, 0], [1, Math.PI]] },
    { id: 'arm', type: 'empty', parent: 'spin', position: { x: 50, y: 0 } },
    sprite('tip', { parent: 'arm', position: { x: 10, y: 0 } })
  ]);
  const r = runtimeFor(p);
  for (let i = 0; i < 30; i++) r.rt.update(1 / 60);          // 0.5 秒 → 轉了 90 度
  const tip = r.rec.shown('tip')[0].last;
  near(tip.x, 0, 'x', 1e-6); near(tip.y, 60, 'y', 1e-6);
  near(tip.rotation, Math.PI / 2, '子物件的朝向也跟著轉', 1e-6);
  for (let i = 0; i < 15; i++) r.rt.update(1 / 60);          // 0.75 秒 → 135 度（快取不能停在上一幀）
  const later = r.rec.shown('tip')[0].last;
  near(later.x, 60 * Math.cos(Math.PI * 0.75), 'x（0.75 秒）', 1e-6);
  near(later.y, 60 * Math.sin(Math.PI * 0.75), 'y（0.75 秒）', 1e-6);
  assert.equal(r.rec.nodes.length, 1, '空物件不建立任何節點');
});

/* ---------------- 透明度、顏色 ---------------- */

test('HIER-9 透明度與顏色一路相乘（含父物件的曲線）', function () {
  const p = preset([
    { id: 'n', type: 'empty', alpha: 0.5, alphaOverLife: [[0, 1], [1, 0]], tint: '#808080' },
    sprite('p', { parent: 'n', tint: '#ff0000' }),
    sprite('c', { parent: 'p', alpha: 0.8 })
  ]);
  const r = runtimeFor(p, { opacity: 0.5 });
  for (let i = 0; i < 30; i++) r.rt.update(1 / 60);          // progress 0.5：曲線 0.5
  const c = r.rec.shown('c')[0].last;
  near(c.alpha, 0.5 * 0.8 * (0.5 * 0.5), '特效 × 自己 × 父物件 × 祖父（含曲線）', 1e-6);
  /* #808080 × #ff0000 × #ffffff：紅色通道 128，其餘 0 */
  assert.equal(c.tint, 0x800000, '顏色逐層相乘：0x' + c.tint.toString(16));
});

/* ---------------- 時間軸 ---------------- */

test('HIER-10 時間軸跟著父物件：延遲從父物件出現算起，父物件沒出現或結束時子物件不出現', function () {
  const p = preset([
    sprite('p', { delay: 0.3, duration: 0.4 }),
    sprite('c', { parent: 'p', delay: 0.1 })
  ]);
  const r = runtimeFor(p);
  const at = (sec) => { while (r.rt.timeOf(r.handle) < sec - 1e-9) r.rt.update(0.01); return r.rec.shown('c').length; };
  assert.equal(at(0.35), 0, '父物件剛出現 0.05 秒，子物件的 0.1 秒延遲還沒到');
  assert.equal(at(0.45), 1, '父物件出現 0.15 秒，子物件出現了');
  assert.equal(at(0.72), 0, '父物件在 0.7 秒結束，子物件跟著消失（子物件自己的持續時間還沒到）');
});

test('HIER-11 父物件被停用：子物件完全不出現', function () {
  const p = preset([sprite('p', { enabled: false }), sprite('c', { parent: 'p' })]);
  const r = runtimeFor(p);
  for (let i = 0; i < 20; i++) r.rt.update(1 / 60);
  assert.equal(r.rec.shown('c').length, 0);
});

/* ---------------- 粒子 ---------------- */

function particleLayer(id, extra) {
  return Object.assign({
    id: id, type: 'particle', assetId: id + '.png', lifetime: 5, speed: 0,
    emission: { mode: 'burst', count: 1 }
  }, extra || {});
}

test('HIER-12 粒子層當子物件：發射點跟著父物件；世界座標粒子留在出生處，區域座標粒子跟著走', function () {
  const moving = { id: 'mover', type: 'empty', rotation: Math.PI / 2, offsetXOverLife: [[0, 0], [1, 100]] };
  const make = (worldSpace) => runtimeFor(preset([
    moving,
    particleLayer('spark', { parent: 'mover', position: { x: 10, y: 0 }, worldSpace: worldSpace })
  ], { duration: 1 }));

  const world = make(true);
  const local = make(false);
  world.rt.update(0); local.rt.update(0);
  /* 出生時父物件在原點、轉 90 度：發射點 (10,0) 變成 (0,10) */
  near(world.rec.shown('spark')[0].last.x, 0, '出生 x', 1e-6);
  near(world.rec.shown('spark')[0].last.y, 10, '出生 y', 1e-6);
  for (let i = 0; i < 30; i++) { world.rt.update(1 / 60); local.rt.update(1 / 60); }
  /* 0.5 秒後父物件往 x 移了 50 */
  near(world.rec.shown('spark')[0].last.x, 0, '世界座標粒子留在出生的地方', 1e-6);
  near(local.rec.shown('spark')[0].last.x, 50, '區域座標粒子跟著父物件走', 1e-6);
  near(local.rec.shown('spark')[0].last.rotation, Math.PI / 2, '粒子圖也跟著父物件轉', 1e-6);
});

test('HIER-13 粒子層當子物件：父物件沒出現就不發射，父物件淡出時粒子一起淡出', function () {
  const r = runtimeFor(preset([
    sprite('p', { delay: 0.2, duration: 0.5, alphaOverLife: [[0, 1], [1, 0]] }),
    particleLayer('spark', { parent: 'p', emission: { mode: 'rate', rate: 30 } })
  ]));
  for (let i = 0; i < 10; i++) r.rt.update(0.01);            // 0.1 秒：父物件還沒出現
  assert.equal(r.rec.shown('spark').length, 0, '父物件沒出現就不發射');
  for (let i = 0; i < 25; i++) r.rt.update(0.01);            // 0.35 秒：父物件出現 0.15 秒
  const shown = r.rec.shown('spark');
  assert.ok(shown.length > 0, '父物件出現後開始發射');
  near(shown[0].last.alpha, 1 - 0.15 / 0.5, '粒子透明度乘上父物件現在的透明度', 0.02);
});

test('HIER-14 粒子層當父物件：子物件跟著發射點的位置（不是跟著個別粒子）', function () {
  const r = runtimeFor(preset([
    particleLayer('emitter', { position: { x: 40, y: 0 }, rotation: 1.2, scale: { x: 3, y: 3 } }),
    sprite('c', { parent: 'emitter', position: { x: 5, y: 0 } })
  ]));
  r.rt.update(0);
  const c = r.rec.shown('c')[0].last;
  near(c.x, 45, 'x'); near(c.y, 0, 'y');
  near(c.rotation, 0, '粒子層的 rotation 轉的是粒子的圖，不傳給子物件');
  near(c.scaleX, 1, '粒子層的 scale 也不傳給子物件');
});

/* ---------------- 共用矩陣工具（給 Editor 用） ---------------- */

test('HIER-15 矩陣工具：乘反矩陣回到恆等、分解後能還原、layerMatrix 與實際畫出來的一致', function () {
  const m = VFXCore.layerMatrix({ id: 'x', type: 'sprite', position: { x: 12, y: -7 }, rotation: 0.8,
    scale: { x: 1.5, y: 0.6 }, outerScale: { x: 1, y: 0.4 } });
  const inv = VFXCore.invertMatrix(m);
  const id = VFXCore.multiplyMatrix(m, inv);
  near(id.a, 1, 'a'); near(id.b, 0, 'b'); near(id.c, 0, 'c'); near(id.d, 1, 'd');
  near(id.tx, 0, 'tx', 1e-9); near(id.ty, 0, 'ty', 1e-9);
  const parts = VFXCore.decomposeMatrix(m);
  const cols = columnsOf(parts);
  ['a', 'b', 'c', 'd'].forEach((k) => near(cols[k], m[k], '分解再還原 ' + k));
  assert.equal(VFXCore.invertMatrix({ a: 0, b: 0, c: 0, d: 1, tx: 0, ty: 0 }), null, '退化矩陣回傳 null');

  /* 與 Runtime 實際畫出來的一致（根圖層，特效恆等） */
  const layer = sprite('solo', { position: { x: 12, y: -7 }, rotation: 0.8, scale: { x: 1.5, y: 0.6 },
    outerScale: { x: 1, y: 0.4 } });
  const r = runtimeFor(preset([layer]));
  r.rt.update(0);
  const drawn = columnsOf(r.rec.shown('solo')[0].last);
  ['a', 'b', 'c', 'd'].forEach((k) => near(drawn[k], m[k], '實際畫出來的 ' + k, 1e-9));
});

/* ---------------- 跨模組守門 ---------------- */

test('HIER-16 Runtime Adapter 依圖層 id 拆解／改寫的 preset，暫時不得使用父子層級', function () {
  /* js/vfx-runtime.js 的 registerPresets 對這幾份 preset 做了特殊處理：依圖層 id 過濾成兩半或三柱、
     逐層平移 position、逐層改寫 alpha／alphaOverLife、從另一份 preset 複製變換欄位。
     這些都假設每一層的數值是「相對特效」的。一旦圖層掛在父物件底下，數值變成相對父物件：
     父子兩邊都被平移就會移兩次；父物件被濾掉，子物件的 parent 指向不存在的圖層，整份註冊失敗。
     要在這幾份用 parent，得先讓那一段拆解認得父子關係，再把 id 從這份清單拿掉。 */
  const special = ['aura-rockarmor-stone', 'aura-earth-reversal', 'ground-firewall',
    'burst-vacuum-shockwave', 'slash-wind-crescent'];
  const runtimeSrc = fs.readFileSync(path.join(REPO, 'js/vfx-runtime.js'), 'utf8');
  special.forEach(function (id) {
    assert.ok(runtimeSrc.indexOf("'" + id + "'") >= 0,
      id + ' 已經不在 vfx-runtime.js 的特殊處理裡——這份清單要跟著更新');
  });
  const offenders = special.filter(function (id) {
    const file = path.join(REPO, 'vfx', 'presets', id + '.json');
    if (!fs.existsSync(file)) return false;
    const p = JSON.parse(fs.readFileSync(file, 'utf8'));
    return p.layers.some(function (l) { return l.parent || l.type === 'empty'; });
  });
  assert.deepEqual(offenders, [],
    '這幾份用了父子層級，但 Runtime Adapter 的拆解還不認得它（見 VFX_CORE_AND_PRESET_SCHEMA §2.5）');
});
