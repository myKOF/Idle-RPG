'use strict';
/* ============================================================
   vfx-editor-gizmo.test.cjs — Preview 上的直接變形操作

   受測對象：
     tools/vfx/editor/gizmo-model.js  框、把手、命中、拖曳的純數學
     tools/vfx/editor/editor.js       座標換算與選取同步的程式結構

   為什麼運算要抽出來測：拖曳變形錯的地方全在數學，而不是畫面——
   旋轉之後的縮放要沿著圖層自己的軸、縮放係數要用比值而不是絕對位置、
   重疊時誰在上面。這些在畫面上都「看起來差不多」。

   全檔反覆驗證的兩條不變量：
     **Gizmo 只改 base transform，不碰 over-life 曲線。**
     **Gizmo 的任何狀態都不得進入 preset。**
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const G = require('../tools/vfx/editor/gizmo-model.js');
const C = require('../tools/vfx/editor/curve-model.js');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');
const TEX = { width: 512, height: 512 };

function sprite(extra) {
  return Object.assign({
    id: 'a', type: 'sprite', assetId: 'x.png', zIndex: 0,
    position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, anchor: { x: 0.5, y: 0.5 }
  }, extra || {});
}
function particle(extra) {
  return Object.assign({
    id: 'p', type: 'particle', assetId: 'x.png', zIndex: 0,
    position: { x: 0, y: 0 }, emission: { mode: 'rate', rate: 10 }, lifetime: 1
  }, extra || {});
}

/* ============================================================
   GIZMO — 選取與框
   ============================================================ */

test('GIZMO-1 框只由 base transform 決定，不受 over-life 曲線影響', function () {
  /* 這是整個功能最重要的一條。播到 50% 時 scaleOverLife 是 1.5，
     框若跟著長大，使用者拖它就會把 1.5 倍寫回 base，再乘一次變 2.25。 */
  const plain = G.baseBounds(sprite({ scale: { x: 2, y: 2 } }), TEX);
  const animated = G.baseBounds(sprite({
    scale: { x: 2, y: 2 },
    alphaOverLife: [[0, 0], [1, 1]],
    scaleOverLife: [[0, 0.5], [1, 3]],
    rotationOverLife: [[0, 0], [1, Math.PI]]
  }), TEX);
  assert.deepEqual(plain, animated, '曲線一個都不該影響框');
  assert.equal(plain.w, 1024, '512 的貼圖放大兩倍就是 1024');
});

test('GIZMO-2 anchor 決定 position 落在框的哪個位置', function () {
  const centred = G.baseBounds(sprite({ anchor: { x: 0.5, y: 0.5 } }), TEX);
  assert.deepEqual(centred.pivot, { x: 0, y: 0 });
  assert.equal(centred.x, -256, '置中時左緣在 -w/2');

  const topLeft = G.baseBounds(sprite({ anchor: { x: 0, y: 0 } }), TEX);
  assert.equal(topLeft.x, 0, 'anchor 在左上時 position 就是左上角');
  assert.equal(topLeft.y, 0);
});

test('GIZMO-3 重疊時最上層優先，規則與實際繪製順序一致', function () {
  /* 後端是 sortableChildren + zIndex，zIndex 相同時由加入順序決定，
     也就是 preset.layers 的陣列順序。命中規則必須用同一套，
     否則點下去選到的會不是眼睛看到的那一個。 */
  const layers = [
    sprite({ id: 'low', zIndex: 1 }),
    sprite({ id: 'high', zIndex: 5 }),
    sprite({ id: 'mid', zIndex: 3 })
  ];
  const boundsOf = (l) => G.baseBounds(l, TEX);
  assert.equal(G.hitLayer({ x: 0, y: 0 }, layers, boundsOf).id, 'high');

  /* 同 zIndex：後加入的在上 */
  const tie = [sprite({ id: 'first', zIndex: 2 }), sprite({ id: 'second', zIndex: 2 })];
  assert.equal(G.hitLayer({ x: 0, y: 0 }, tie, boundsOf).id, 'second');

  /* 停用的圖層不參與命中——畫面上根本看不到它 */
  const off = [sprite({ id: 'hidden', zIndex: 9, enabled: false }), sprite({ id: 'shown', zIndex: 1 })];
  assert.equal(G.hitLayer({ x: 0, y: 0 }, off, boundsOf).id, 'shown');

  /* 沒命中就是 null，不能硬選一個 */
  assert.equal(G.hitLayer({ x: 9999, y: 9999 }, layers, boundsOf), null);
});

test('GIZMO-4 旋轉後的框仍然正確命中', function () {
  const l = sprite({ rotation: Math.PI / 4, scale: { x: 0.5, y: 0.1 } });
  const b = G.baseBounds(l, TEX);          // 256 × 51.2 的細長框，轉 45 度
  assert.ok(G.insideBounds({ x: 0, y: 0 }, b), '中心一定在框內');
  /* 沿著轉了 45 度的長軸走 100，仍在框內；垂直方向走 100 就出界了 */
  const along = { x: Math.cos(Math.PI / 4) * 100, y: Math.sin(Math.PI / 4) * 100 };
  const across = { x: -Math.sin(Math.PI / 4) * 100, y: Math.cos(Math.PI / 4) * 100 };
  assert.ok(G.insideBounds(along, b), '沿長軸應在框內');
  assert.ok(!G.insideBounds(across, b), '垂直於長軸應在框外');
});

/* ============================================================
   CAP — 只顯示 Runtime 真的支援的把手
   ============================================================ */

test('CAP-1 粒子層沒有縮放把手（Core 根本不看 layer.scale）', function () {
  const caps = G.capabilities(particle());
  assert.equal(caps.scaleX, false);
  assert.equal(caps.scaleY, false);
  assert.equal(caps.move, true, '拖曳移動的是發射器位置，這是有效的');
  assert.equal(caps.rotate, true, '加在每顆粒子的自轉上，這也是有效的');
  assert.ok(caps.note && /startScale/.test(caps.note), '要說明大小該去哪裡改');

  const hs = G.handles(G.baseBounds(particle(), null), caps);
  assert.deepEqual(hs.map(h => h.id), ['rotate'], '只該有旋轉把手');
});

test('CAP-2 這條限制不是猜的：Core 的粒子路徑確實不吃 layer.scale', function () {
  /* 直接跑 runtime 證明。若哪天 Core 改成支援了，這個測試會失敗，
     提醒把縮放把手打開——而不是讓 UI 與 Runtime 默默不同步。 */
  const seen = [];
  const backend = {
    createNode: () => ({}),
    updateNode: (n, t) => { if (t.scaleX !== undefined) seen.push(t.scaleX); },
    destroyNode: () => {}, destroy: () => {}
  };
  function run(scale) {
    seen.length = 0;
    const rt = VFXCore.createRuntime({
      backend, resolver: { has: () => true, resolve: (i) => '/' + i }
    });
    rt.registerPreset({
      schemaVersion: 1, id: 'fx', duration: 1, loop: false,
      layers: [particle({ scale: scale, startScale: 1, speed: 0 })]
    });
    rt.play('fx', { seed: 3 });
    for (let i = 0; i < 10; i++) rt.update(1 / 40);
    const out = seen.slice();
    rt.destroy();
    return out;
  }
  const a = run({ x: 1, y: 1 });
  const b = run({ x: 4, y: 4 });
  assert.ok(a.length > 0, '應該有粒子被更新');
  assert.deepEqual(a, b, 'layer.scale 對粒子完全沒有作用');
});

test('CAP-3 sprite 與 procedural 四個把手齊全', function () {
  ['sprite', 'procedural'].forEach(function (type) {
    const caps = G.capabilities({ type: type });
    assert.ok(caps.scaleX && caps.scaleY && caps.rotate && caps.move, type + ' 應支援全部');
  });
  const hs = G.handles(G.baseBounds(sprite(), TEX), G.capabilities(sprite()));
  const ids = hs.map(h => h.id).sort();
  assert.deepEqual(ids, ['e', 'n', 'ne', 'nw', 'rotate', 's', 'se', 'sw', 'w'].sort(),
    '四角 ＋ 四邊 ＋ 一個旋轉');
});

/* ============================================================
   MOVE
   ============================================================ */

test('MOVE-1 拖曳等於「起點到現在」的位移，X 與 Y 都要對', function () {
  const r = G.applyMove({ x: 10, y: 20 }, { x: 100, y: 100 }, { x: 180, y: 140 }, {});
  assert.deepEqual(r, { x: 90, y: 60 });
});

test('MOVE-2 每次都從快照重算，不累加誤差', function () {
  /* 累加 delta 的寫法在連續拖曳下會累積浮點誤差，而且 Escape 沒有乾淨的還原點 */
  const start = { x: 0, y: 0 }, p0 = { x: 0, y: 0 };
  let last = null;
  for (let i = 1; i <= 100; i++) last = G.applyMove(start, p0, { x: i * 0.1, y: 0 }, {});
  assert.equal(last.x, 10, '一百次移動之後仍然剛好是 10，不是 9.99999');
});

test('MOVE-3 Shift 對齊到 10 單位', function () {
  const free = G.applyMove({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 23, y: 47 }, {});
  assert.deepEqual(free, { x: 23, y: 47 });
  const snapped = G.applyMove({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 23, y: 47 }, { snap: true });
  assert.deepEqual(snapped, { x: 20, y: 50 });
});

test('MOVE-4 結果直接寫進 preset 的既有欄位，沒有第二套', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/layer\.position = G\.applyMove\(/.test(noComments), '拖曳要直接改 layer.position');
  ['editorPosition', 'previewPosition', 'gizmoPosition', 'editorTransform']
    .forEach(function (bad) {
      assert.ok(noComments.indexOf(bad) < 0, '不得另外發明 ' + bad);
    });
});

/* ============================================================
   SCALE
   ============================================================ */

test('SCALE-1 四角等比：拖到兩倍距離就是兩倍', function () {
  const l = sprite({ scale: { x: 0.5, y: 0.25 } });
  const b = G.baseBounds(l, TEX);
  const se = G.handles(b, G.capabilities(l)).find(h => h.id === 'se');
  const now = { x: b.pivot.x + (se.x - b.pivot.x) * 2, y: b.pivot.y + (se.y - b.pivot.y) * 2 };
  const r = G.applyScale(l.scale, se, b.pivot, 0, se, now, {});
  assert.equal(r.x, 1);
  assert.equal(r.y, 0.5);
});

test('SCALE-2 邊中點只動單一軸', function () {
  const l = sprite({ scale: { x: 1, y: 1 } });
  const b = G.baseBounds(l, TEX);
  const hs = G.handles(b, G.capabilities(l));
  const east = hs.find(h => h.id === 'e');
  const wide = G.applyScale(l.scale, east, b.pivot, 0, east,
    { x: b.pivot.x + (east.x - b.pivot.x) * 3, y: east.y }, {});
  assert.equal(wide.x, 3, 'X 變三倍');
  assert.equal(wide.y, 1, 'Y 不動');

  const south = hs.find(h => h.id === 's');
  const tall = G.applyScale(l.scale, south, b.pivot, 0, south,
    { x: south.x, y: b.pivot.y + (south.y - b.pivot.y) * 2 }, {});
  assert.equal(tall.x, 1, 'X 不動');
  assert.equal(tall.y, 2, 'Y 變兩倍');
});

test('SCALE-3 旋轉後的縮放沿著圖層自己的軸，不是螢幕的軸', function () {
  /* 圖層轉 90 度時，拖「右邊中點」應該沿著它自己的橫軸縮。
     如果用螢幕座標算，會變成縮到 Y 去。 */
  const l = sprite({ scale: { x: 1, y: 1 }, rotation: Math.PI / 2 });
  const b = G.baseBounds(l, TEX);
  const east = G.handles(b, G.capabilities(l)).find(h => h.id === 'e');
  /* 轉 90 度後，「右邊」在螢幕上指向下方 */
  assert.ok(Math.abs(east.x - b.pivot.x) < 1e-6, '轉 90 度後右邊中點應在正下方');
  const now = { x: east.x, y: b.pivot.y + (east.y - b.pivot.y) * 2 };
  const r = G.applyScale(l.scale, east, b.pivot, l.rotation, east, now, {});
  assert.equal(r.x, 2, '仍然是 X 變兩倍');
  assert.equal(r.y, 1, 'Y 不受影響');
});

test('SCALE-4 縮放有下限，框不會塌成一條線', function () {
  const l = sprite();
  const b = G.baseBounds(l, TEX);
  const se = G.handles(b, G.capabilities(l)).find(h => h.id === 'se');
  const r = G.applyScale(l.scale, se, b.pivot, 0, se, b.pivot, {});
  assert.ok(Math.abs(r.x) >= G.MIN_SCALE, '塌到 0 就再也抓不到把手了');
  assert.ok(Math.abs(r.y) >= G.MIN_SCALE);
});

test('SCALE-5 Shift 對齊到 0.1', function () {
  const l = sprite({ scale: { x: 1, y: 1 } });
  const b = G.baseBounds(l, TEX);
  const se = G.handles(b, G.capabilities(l)).find(h => h.id === 'se');
  const now = { x: b.pivot.x + (se.x - b.pivot.x) * 1.37, y: b.pivot.y + (se.y - b.pivot.y) * 1.37 };
  const r = G.applyScale(l.scale, se, b.pivot, 0, se, now, { snap: true });
  assert.equal(r.x, 1.4);
});

/* ============================================================
   ROTATE
   ============================================================ */

test('ROTATE-1 角度由 pivot → 滑鼠計算，取起點到現在的差', function () {
  const pivot = { x: 0, y: 0 };
  const r = G.applyRotate(0, pivot, { x: 0, y: -100 }, { x: 100, y: 0 }, {});
  assert.equal(Math.round(C.radToDeg(r)), 90, '從正上方轉到正右方是 +90 度');
});

test('ROTATE-2 從既有角度接續，不是歸零重算', function () {
  const pivot = { x: 0, y: 0 };
  const start = C.degToRad(30);
  const r = G.applyRotate(start, pivot, { x: 0, y: -100 }, { x: 100, y: 0 }, {});
  assert.equal(Math.round(C.radToDeg(r)), 120, '30 + 90');
});

test('ROTATE-3 存進 preset 的是弧度，顯示才是度', function () {
  const r = G.applyRotate(0, { x: 0, y: 0 }, { x: 0, y: -100 }, { x: 100, y: 0 }, {});
  assert.ok(Math.abs(r - Math.PI / 2) < 1e-5, '回傳弧度，實得 ' + r);
  /* 換算沿用 curve-model 的 helper，gizmo-model 裡不得有第二份 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/gizmo-model.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/180\s*\/\s*Math\.PI/.test(noComments),
    'gizmo-model 不得自己寫弧度轉度，那份規則在 curve-model');
});

test('ROTATE-4 Shift 對齊到 15 度', function () {
  const pivot = { x: 0, y: 0 };
  const p = { x: Math.cos(C.degToRad(-58)) * 100, y: Math.sin(C.degToRad(-58)) * 100 };
  const r = G.applyRotate(0, pivot, { x: 100, y: 0 }, p, { snap: true });
  assert.equal(Math.round(C.radToDeg(r)), -60, '-58 度對齊到 -60');
  assert.equal(G.SNAP.rotateDeg, 15);
});

/* ============================================================
   ANIM — base 與 evaluated 分離
   ============================================================ */

test('ANIM-1 縮放拖曳不被 scaleOverLife 污染', function () {
  /* 用真的 runtime 取出「當下畫面上的縮放」，再確認 gizmo 算出來的 base
     與它無關。若實作誤把 evaluated 寫回 base，這裡就會抓到。 */
  const layer = sprite({ scale: { x: 0.42, y: 0.17 }, scaleOverLife: [[0, 0.7], [1, 1.25]] });
  let evaluated = null;
  const rt = VFXCore.createRuntime({
    backend: {
      createNode: () => ({}),
      updateNode: (n, t) => { if (t.scaleX !== undefined) evaluated = t.scaleX; },
      destroyNode: () => {}, destroy: () => {}
    },
    resolver: { has: () => true, resolve: (i) => '/' + i }
  });
  rt.registerPreset({ schemaVersion: 1, id: 'fx', duration: 1, loop: false, layers: [layer] });
  rt.play('fx', { seed: 1 });
  rt.update(0.5);
  rt.destroy();
  assert.ok(Math.abs(evaluated - 0.42 * 0.975) < 1e-6,
    '當下畫面上的縮放應該是 base × 曲線，實得 ' + evaluated);

  const b = G.baseBounds(layer, TEX);
  const se = G.handles(b, G.capabilities(layer)).find(h => h.id === 'se');
  const now = { x: b.pivot.x + (se.x - b.pivot.x) * 2, y: b.pivot.y + (se.y - b.pivot.y) * 2 };
  const r = G.applyScale(layer.scale, se, b.pivot, 0, se, now, {});
  assert.equal(r.x, 0.84, 'base 剛好兩倍，不含曲線的 0.975');
  assert.equal(r.y, 0.34);
});

test('ANIM-2 旋轉拖曳不被 rotationOverLife 污染', function () {
  const layer = sprite({ rotation: C.degToRad(30), rotationOverLife: [[0, 0], [1, Math.PI]] });
  const b = G.baseBounds(layer, TEX);
  assert.equal(b.rotation, layer.rotation, '框只用 base rotation');
  const r = G.applyRotate(layer.rotation, b.pivot, { x: 100, y: 0 }, { x: 0, y: 100 }, {});
  assert.equal(Math.round(C.radToDeg(r)), 120, '30 + 90，曲線完全不參與');
});

test('ANIM-3 拖曳只碰三個 base 欄位，曲線一個都不動', function () {
  const layer = sprite({
    scale: { x: 1, y: 1 },
    alphaOverLife: [[0, 1], [1, 0]],
    scaleOverLife: [[0, 1], [1, 2]],
    rotationOverLife: [[0, 0], [1, 1]]
  });
  const before = JSON.stringify(layer);
  const snap = G.snapshot(layer);
  layer.position = G.applyMove({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 5 }, {});
  layer.rotation = G.applyRotate(0, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, {});
  ['alphaOverLife', 'scaleOverLife', 'rotationOverLife'].forEach(function (k) {
    assert.deepEqual(layer[k], JSON.parse(before)[k], k + ' 不該被動到');
  });
  G.restore(layer, snap);
  assert.equal(JSON.stringify(layer), before, '還原之後必須與原本逐字相同');
});

/* ============================================================
   SAFETY
   ============================================================ */

test('SAFETY-1 Gizmo 狀態不得進入 preset', function () {
  const layer = sprite();
  const snap = G.snapshot(layer);
  G.baseBounds(layer, TEX);
  G.handles(G.baseBounds(layer, TEX), G.capabilities(layer));
  G.hitLayer({ x: 0, y: 0 }, [layer], (l) => G.baseBounds(l, TEX));
  G.restore(layer, snap);
  const preset = { schemaVersion: 1, id: 'fx', duration: 1, loop: false, layers: [layer] };
  const check = VFXCore.validatePreset(preset);
  assert.ok(check.ok, '不得混入未知欄位：' + check.errors.join('; '));
  const text = VFXCore.serialisePreset(preset);
  ['selected', 'hovered', 'gizmo', 'bounds', 'handle', 'overlay'].forEach(function (w) {
    assert.ok(text.indexOf(w) < 0, '序列化結果不得出現 ' + w);
  });
});

test('SAFETY-2 沒有做任何變形時，既有 preset 的輸出逐位元不變', function () {
  const dir = path.join(REPO, 'vfx', 'presets');
  fs.readdirSync(dir).filter(f => /\.json$/.test(f)).forEach(function (f) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const preset = JSON.parse(text);
    /* 只是把每一層丟給 gizmo 算框與把手，不做任何拖曳 */
    preset.layers.forEach(function (l) {
      G.baseBounds(l, TEX);
      G.capabilities(l);
      G.handles(G.baseBounds(l, TEX), G.capabilities(l));
    });
    assert.equal(VFXCore.serialisePreset(preset), VFXCore.serialisePreset(JSON.parse(text)),
      f + ' 被 gizmo 讀過之後就變了');
  });
});

test('SAFETY-3 Core 與 Backend 完全不知道 gizmo 的存在', function () {
  ['js/vfx-core.js', 'js/vfx-pixi-backend.js'].forEach(function (rel) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    /* handle 不列入：Core 的 play() 本來就回傳 effect handle，那與 gizmo 無關。
       擋的是「選取／覆蓋層／框」這些純粹屬於編輯器的概念。 */
    ['gizmo', 'Gizmo', 'selected', 'hovered', 'boundingBox', 'overlay']
      .forEach(function (w) {
        assert.ok(src.indexOf(w) < 0, rel + ' 不該提到 ' + w + '——那是 Editor 的事');
      });
  });
});

/* ============================================================
   結構 — 座標換算與選取同步
   ============================================================ */

test('COORD-1 座標換算集中在兩個 helper，沒有散落的 clientX 加減', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/function clientToPreview/.test(noComments));
  assert.ok(/function previewToEffectLocal/.test(noComments));

  /* 換算不得假設 1 CSS px = 1 VFX 單位：必須用實際的 bounding rect 比例，
     否則之後加 zoom 或換 DPI 一定壞 */
  const fn = noComments.slice(noComments.indexOf('function clientToPreview'),
    noComments.indexOf('function previewToEffectLocal'));
  assert.ok(/getBoundingClientRect\(\)/.test(fn), '要用實際尺寸算比例');
  assert.ok(/renderer\.width/.test(fn), '要和 renderer 尺寸比對');

  /* helper 以外只准把 clientX 原封不動傳進去，不准自己做算術。
     `layer.x += event.clientX` 這種寫法之後加 zoom 一定壞。 */
  const outside = noComments.replace(fn, '').replace(/clientToEffectLocal\(e\.clientX, e\.clientY\)/g, '');
  assert.ok(!/clientX\s*[-+*/]/.test(outside) && !/[-+*/]\s*[\w.]*clientX/.test(outside),
    'helper 之外不得對 clientX 做算術');
});

test('COORD-2 stageRoot 的縮放與旋轉有算進去（為之後的 zoom 預留）', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = src.slice(src.indexOf('function previewToEffectLocal'),
    src.indexOf('function clientToEffectLocal'));
  assert.ok(/root\.scale/.test(fn), '要把 stageRoot 的縮放算進去');
  assert.ok(/root\.rotation/.test(fn), '要把 stageRoot 的旋轉算進去');
});

test('SYNC-1 Layer List 與 Preview 共用同一份 selection state', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/function selectLayerById/.test(noComments));
  const fn = noComments.slice(noComments.indexOf('function selectLayerById'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/setSelection\(/.test(body), 'Preview 選取必須走同一個 setSelection');
  assert.ok(/renderLayerList\(\)/.test(body), '要同步重繪 Layer List');
  assert.ok(/renderInspector\(\)/.test(body), '要同步重繪 Inspector');

  /* 不得另外開一份 */
  ['gizmoSelected', 'previewSelection', 'selectedInPreview'].forEach(function (bad) {
    assert.ok(noComments.indexOf(bad) < 0, '不得另外維護 ' + bad);
  });
});

test('SYNC-2 拖曳期間只更新 transform 欄位，不重建整個 Inspector', function () {
  /* 每次 pointermove 重建 Inspector 會把曲線元件整組換掉，
     正在拖的 canvas 被移除，拖曳就斷了。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const move = noComments.slice(noComments.indexOf('function onPreviewPointerMove'));
  const body = move.slice(0, move.indexOf('\n  }'));
  assert.ok(/syncTransformInputs\(/.test(body), '拖曳期間要同步輸入框的值');
  assert.ok(!/renderInspector\(\)/.test(body), '拖曳期間不得重建整個 Inspector');
  assert.ok(/previewSoon\(\)/.test(body), '預覽要用 rAF 合併的更新');
  ['rebuildPreview()', 'registerPreset(', 'loadPreset'].forEach(function (bad) {
    assert.ok(body.indexOf(bad) < 0, '拖曳期間不得 ' + bad);
  });
});

test('KEYBOARD-1 Escape 取消拖曳，且排在所有守門之前', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const fn = noComments.slice(noComments.indexOf('function onKeyDown'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  const esc = body.indexOf("'Escape'");
  const text = body.indexOf('isTextEntry');
  const del = body.indexOf("k === 'delete'");
  assert.ok(esc >= 0, '要有 Escape 分支');
  assert.ok(esc < text && esc < del,
    'Escape 要排在最前面：拖曳中不論焦點在哪都該能取消，它不會誤刪東西');
});

test('KEYBOARD-2 既有的 Delete 優先權完全沒動', function () {
  /* 加了 Preview 選取之後，Delete 仍然只能在圖層面板生效 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const fn = noComments.slice(noComments.indexOf('function onKeyDown'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  const text = body.indexOf('isTextEntry(document.activeElement)');
  const curve = body.indexOf('inCurveEditor(document.activeElement)');
  const del = body.indexOf("k === 'delete'");
  assert.ok(text >= 0 && curve >= 0 && del >= 0);
  assert.ok(text < del, '文字輸入的守門仍在 Delete 之前');
  assert.ok(curve < del, '曲線編輯器的守門仍在 Delete 之前');
});

test('PERF-1 框只在需要時重畫，不是每幀 clear', function () {
  /* 每幀 clear() 一個 Graphics 是實測過的效能陷阱，而 base transform
     只有在編輯時才會變。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const fn = noComments.slice(noComments.indexOf('function drawGizmo'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/gizmo\.dirty/.test(body), '要有 dirty 判斷');
  assert.ok(body.indexOf('if (!gizmo.dirty) return;') < body.indexOf('g.clear()'),
    'dirty 判斷必須在 clear 之前，否則等於每幀都清');
});

test('PERF-2 框畫在 stageRoot 之外，後端看不到它', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = src.slice(src.indexOf('function ensureOverlay'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/app\.stage\.addChild\(c\)/.test(body),
    '覆蓋層要加在 stage 上，與 stageRoot 平行');
  assert.ok(!/stageRoot\.addChild/.test(body),
    '加進 stageRoot 的話後端就會把它當成特效的一部分');
});

/* ============================================================
   GROUP — 群組當父物件

   群組存在 layout（editor-only、不具權威性），preset 裡沒有父子結構。
   所以變形是**當場攤到子圖層的 base transform**，存出去仍是一張平的表——
   Runtime 與 Editor 看到的是同一份東西。
   ============================================================ */

const sizeOf = () => TEX;

test('GROUP-1 群組框是子圖層的聯集，pivot 在中心', function () {
  const kids = [
    sprite({ id: 'l', position: { x: -200, y: 0 }, scale: { x: 0.1, y: 0.1 } }),
    sprite({ id: 'r', position: { x: 200, y: 0 }, scale: { x: 0.1, y: 0.1 } })
  ];
  const b = G.groupBounds(kids, sizeOf);
  assert.equal(b.pivot.x, 0, '兩個對稱的子圖層，中心應在原點');
  assert.equal(b.pivot.y, 0);
  assert.ok(b.w >= 400, '框要涵蓋兩邊，實得 ' + b.w);
  assert.equal(b.rotation, 0, '群組框永遠軸對齊');
  assert.equal(G.groupBounds([], sizeOf), null, '空群組沒有框');
});

test('GROUP-2 移動整組：每個子圖層位移相同', function () {
  const kids = [
    sprite({ id: 'a', position: { x: -100, y: 0 } }),
    sprite({ id: 'b', position: { x: 100, y: 50 } })
  ];
  const snap = G.groupSnapshot(kids);
  const out = G.applyGroupTransform(snap, { x: 0, y: 0 }, { dx: 30, dy: -20 });
  assert.deepEqual(out[0].position, { x: -70, y: -20 });
  assert.deepEqual(out[1].position, { x: 130, y: 30 });
  out.forEach(function (o) {
    assert.equal(o.scale, undefined, '純移動不該碰縮放');
    assert.equal(o.rotation, undefined, '純移動不該碰旋轉');
  });
});

test('GROUP-3 縮放整組：子圖層等比縮放，且相對中心的距離也縮', function () {
  /* 這就是使用者要的「父物件縮放＝子物件等比縮放」。
     只縮 scale 不縮位置的話，整組會散開而不是變小。 */
  const kids = [
    sprite({ id: 'a', position: { x: -100, y: 0 }, scale: { x: 1, y: 1 } }),
    sprite({ id: 'b', position: { x: 100, y: 0 }, scale: { x: 2, y: 2 } })
  ];
  const out = G.applyGroupTransform(G.groupSnapshot(kids), { x: 0, y: 0 }, { sx: 0.5, sy: 0.5 });
  assert.deepEqual(out[0].position, { x: -50, y: 0 }, '距離中心的偏移要一起縮');
  assert.deepEqual(out[0].scale, { x: 0.5, y: 0.5 });
  assert.deepEqual(out[1].position, { x: 50, y: 0 });
  assert.deepEqual(out[1].scale, { x: 1, y: 1 }, '原本 2 倍的縮一半變 1 倍');
});

test('GROUP-4 縮放整組時，粒子子層的「長度」欄位也要縮', function () {
  /* 粒子不吃 layer.scale。只縮 sprite 而不管粒子的話，縮小群組之後
     粒子仍用原本的大小與速度飛出去，看起來就不是同一個特效變小了。 */
  const kid = particle({
    id: 'p', position: { x: 100, y: 0 },
    startScale: 0.5, speed: [30, 60],
    spawn: { shape: 'circle', radius: 30 }, gravity: { x: 0, y: 100 }
  });
  const out = G.applyGroupTransform(G.groupSnapshot([kid]), { x: 0, y: 0 }, { sx: 2, sy: 2 })[0];
  assert.equal(out.startScale, 1, '粒子大小');
  assert.deepEqual(out.speed, [60, 120], '飛行速度（範圍形式）');
  assert.equal(out.spawn.radius, 60, '發射區域');
  assert.deepEqual(out.gravity, { x: 0, y: 200 }, '加速度也是長度／時間平方');
  assert.deepEqual(out.position, { x: 200, y: 0 });
  assert.equal(out.scale, undefined, '不得寫 layer.scale——粒子根本不看它');
});

test('GROUP-5 旋轉整組：位置繞中心轉，角度累加', function () {
  const kids = [sprite({ id: 'a', position: { x: 100, y: 0 }, rotation: 0 })];
  const out = G.applyGroupTransform(G.groupSnapshot(kids), { x: 0, y: 0 }, { rot: Math.PI / 2 })[0];
  assert.equal(out.position.x, 0);
  assert.equal(out.position.y, 100, '(100,0) 繞原點轉 90 度到 (0,100)');
  assert.ok(Math.abs(out.rotation - Math.PI / 2) < 1e-5, '自身角度也要跟著轉');
});

test('GROUP-6 旋轉整組時，粒子的發射方向與重力也要轉', function () {
  /* 不轉的話，整組轉了 90 度但粒子還往原本的方向噴 */
  const kid = particle({ id: 'p', position: { x: 0, y: 0 }, direction: -90, gravity: { x: 0, y: 100 } });
  const out = G.applyGroupTransform(G.groupSnapshot([kid]), { x: 0, y: 0 }, { rot: Math.PI / 2 })[0];
  assert.equal(out.direction, 0, 'direction 的單位是度，-90 + 90 = 0');
  assert.equal(Math.round(out.gravity.x), -100, '重力向量跟著轉');
  assert.ok(Math.abs(out.gravity.y) < 1e-6);
});

test('GROUP-7 縮放與旋轉的套用順序：先縮再轉', function () {
  /* 順序反過來會在非等比縮放時把圖形拉歪 */
  const kids = [sprite({ id: 'a', position: { x: 100, y: 0 } })];
  const out = G.applyGroupTransform(G.groupSnapshot(kids), { x: 0, y: 0 },
    { sx: 2, sy: 1, rot: Math.PI / 2 })[0];
  /* 先縮：(100,0) → (200,0)；再轉 90 度：→ (0,200) */
  assert.equal(Math.round(out.position.x), 0);
  assert.equal(Math.round(out.position.y), 200);
});

test('GROUP-8 每次都從快照重算，連續拖曳不累加誤差', function () {
  const kids = [sprite({ id: 'a', position: { x: 100, y: 0 }, scale: { x: 1, y: 1 } })];
  const snap = G.groupSnapshot(kids);
  for (let i = 0; i < 50; i++) {
    G.writeGroupTransform(kids, G.applyGroupTransform(snap, { x: 0, y: 0 }, { sx: 2, sy: 2 }));
  }
  assert.deepEqual(kids[0].scale, { x: 2, y: 2 }, '五十次同樣的拖曳仍是 2 倍，不是 2 的 50 次方');
  assert.deepEqual(kids[0].position, { x: 200, y: 0 });
});

test('GROUP-9 Escape 還原整組，逐字回到原狀', function () {
  const kids = [
    sprite({ id: 'a', position: { x: 10, y: 20 }, scale: { x: 1, y: 1 } }),
    particle({ id: 'p', position: { x: 5, y: 5 }, speed: 40, spawn: { shape: 'circle', radius: 12 } })
  ];
  const before = JSON.stringify(kids);
  const snap = G.groupSnapshot(kids);
  G.writeGroupTransform(kids,
    G.applyGroupTransform(snap, { x: 0, y: 0 }, { dx: 99, sx: 3, sy: 3, rot: 1 }));
  assert.notEqual(JSON.stringify(kids), before, '先確認真的改到了');
  G.restoreGroup(kids, snap);
  assert.equal(JSON.stringify(kids), before, '還原後必須逐字相同');
});

test('GROUP-10 群組變形的結果仍是合法的平坦 preset', function () {
  /* 群組不進 preset：存出去的永遠是一張平的 layers 表，
     Runtime 與 Editor 看到同一份東西。 */
  const kids = [
    sprite({ id: 'a', position: { x: -50, y: 0 } }),
    particle({ id: 'p', position: { x: 50, y: 0 }, speed: 20, startScale: 1 })
  ];
  G.writeGroupTransform(kids,
    G.applyGroupTransform(G.groupSnapshot(kids), { x: 0, y: 0 }, { sx: 1.5, sy: 1.5, rot: 0.3 }));
  const preset = { schemaVersion: 1, id: 'fx', duration: 1, loop: false, layers: kids };
  const check = VFXCore.validatePreset(preset);
  assert.ok(check.ok, '不得產生不合法的欄位：' + check.errors.join('; '));
  const text = VFXCore.serialisePreset(preset);
  ['group', 'parent', 'children'].forEach(function (w) {
    assert.ok(text.indexOf(w) < 0, 'preset 不該出現 ' + w);
  });
});

test('GROUP-11 群組能力四種都有，且 Editor 走同一套把手', function () {
  const caps = G.groupCapabilities([sprite(), particle()]);
  assert.ok(caps.move && caps.scaleX && caps.scaleY && caps.rotate);
  const empty = G.groupCapabilities([]);
  assert.equal(empty.move, false);
  assert.equal(empty.scaleX, false);

  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/function gizmoTarget/.test(noComments), '圖層與群組要共用同一個目標抽象');
  assert.ok(/G\.groupBounds\(/.test(noComments));
  assert.ok(/G\.applyGroupTransform\(/.test(noComments));
  assert.ok(/G\.restoreGroup\(/.test(noComments), 'Escape 也要能還原整組');
});

/* ============================================================
   ROW — Layer List 的操作
   ============================================================ */

test('ROW-1 點擊已選取的項目＝取消選取', function () {
  const M = require('../tools/vfx/editor/layer-model.js');
  const visible = ['layer:a', 'layer:b'];
  const s1 = M.applyClick({ selected: [], active: null, anchor: null }, visible, 'layer:a', {});
  assert.deepEqual(s1.selected, ['layer:a']);
  const s2 = M.applyClick(s1, visible, 'layer:a', {});
  assert.deepEqual(s2.selected, [], '同一個再點一次要變成沒有選取');
  assert.equal(s2.active, null);
  const s3 = M.applyClick(s1, visible, 'layer:b', {});
  assert.deepEqual(s3.selected, ['layer:b'], '點別的仍是正常切換');
});

test('ROW-2 多選狀態下的普通點擊仍然收斂成單選', function () {
  /* 這是把選取範圍縮小的唯一辦法，不能因為「已經選到了」就變成取消 */
  const M = require('../tools/vfx/editor/layer-model.js');
  const visible = ['layer:a', 'layer:b', 'layer:c'];
  const multi = { selected: ['layer:a', 'layer:b'], active: 'layer:b', anchor: 'layer:a' };
  const r = M.applyClick(multi, visible, 'layer:b', {});
  assert.deepEqual(r.selected, ['layer:b'], '應收斂成只有 b，而不是清空');
  assert.equal(r.active, 'layer:b');
});

test('ROW-3 Ctrl 與 Shift 的行為完全沒變', function () {
  const M = require('../tools/vfx/editor/layer-model.js');
  const visible = ['layer:a', 'layer:b', 'layer:c'];
  const one = { selected: ['layer:a'], active: 'layer:a', anchor: 'layer:a' };
  const ctrl = M.applyClick(one, visible, 'layer:a', { ctrl: true });
  assert.deepEqual(ctrl.selected, [], 'Ctrl 點自己仍然是 toggle');
  const shift = M.applyClick(one, visible, 'layer:c', { shift: true });
  assert.deepEqual(shift.selected, ['layer:a', 'layer:b', 'layer:c']);
});

test('ROW-4 改動勾選會把焦點移到該列', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const layerFn = noComments.slice(noComments.indexOf('function layerRow'));
  const layerBody = layerFn.slice(0, layerFn.indexOf('\n  }'));
  assert.ok(/selectLayerById\(layer\.id\)/.test(layerBody), '改了圖層的勾選要選到該圖層');
  const groupFn = noComments.slice(noComments.indexOf('function groupRow'));
  const groupBody = groupFn.slice(0, groupFn.indexOf('\n  }'));
  assert.ok(/selectGroupById\(r\.id\)/.test(groupBody), '改了群組的勾選要選到該群組');
});

test('ROW-5 群組改名是就地編輯，不用 window.prompt', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/window\.prompt/.test(noComments),
    'prompt 會擋住整個分頁，而且看不到自己在改哪一列');
  assert.ok(/function beginInlineRename/.test(noComments));

  const fn = noComments.slice(noComments.indexOf('function beginInlineRename'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.ok(/'Enter'/.test(body) && /'Escape'/.test(body), 'Enter 套用、Escape 取消');
  assert.ok(/onblur/.test(body), '失焦也要有明確行為');
  assert.ok(/stopPropagation/.test(body),
    '輸入框的鍵盤事件不得冒泡出去，否則會觸發圖層面板的快捷鍵');
  assert.ok(/markLayoutDirty\(\)/.test(body), '群組名存在 layout，要標記為未存檔');
  assert.ok(/maxNameLength/.test(body), '長度上限要沿用 layout schema 的定義');
});

test('ROW-6 就地改名要寫到 layout 裡的群組，不是顯示用的列物件', function () {
  /* reconcile 產生的列是副本（layout-schema.js 的 rows.push({ name: g.name })）。
     寫到列上不會有任何效果，而且下一次重繪就消失——畫面看起來像是「改了又跳回去」。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const at = src.indexOf('function beginInlineRename');
  const body = src.slice(at, at + 1600);
  assert.ok(body.indexOf('groupById(') >= 0, '必須查出 layout 裡真正的群組物件');
  assert.ok(body.indexOf('group.name = ') >= 0, '要寫在那個物件上');

  /* layout-schema 確實回傳副本，這條前提要守住 */
  const LS = require('../tools/vfx/editor/layout-schema.js');
  const layout = { schemaVersion: 1, presetId: 'fx', groups: [{ id: 'g', name: '原名', layerIds: ['a'] }], order: ['group:g'] };
  const rec = LS.reconcile([{ id: 'a' }], layout);
  const row = rec.rows.find(r => r.kind === 'group');
  row.name = '改到副本';
  assert.equal(layout.groups[0].name, '原名', 'reconcile 的列確實是副本');
});
