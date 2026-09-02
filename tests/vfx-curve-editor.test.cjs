'use strict';
/* ============================================================
   vfx-curve-editor.test.cjs — Over-Life 圖形化曲線編輯

   受測對象：
     tools/vfx/editor/curve-model.js  曲線的純資料運算（新增／拖曳／刪除／夾限／換算）
     js/vfx-core.js                   分軸縮放曲線與 play(startTime)

   為什麼運算要抽出來測：曲線編輯真正會出錯的地方全在資料層——
   拖過鄰居之後的重新排序、時間夾在 0..1、度與弧度的來回換算、
   以及「舊 preset 一個欄位都沒改也必須逐位元相同」。
   這些在畫面上都長得差不多，只有比對輸出才驗得出來。

   全檔反覆驗證的一條不變量：
     **沒有指定分軸曲線的既有 preset，runtime 輸出必須與擴充前完全相同。**
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const C = require('../tools/vfx/editor/curve-model.js');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');

/* ---------------- 各屬性的 policy（與 editor.js 的 CURVE_POLICY 對齊） ---------------- */
const ALPHA = { min: 0, max: null, baseline: [0, 1], defaultValue: 1 };
const SCALE = { min: 0, max: null, baseline: [0, 1.5], defaultValue: 1 };
/* baseline 用弧度，與 editor.js 一致。寫成 [-180, 180] 會被當成 180 弧度——
   見 CURVE-20，那是實際踩過的坑。 */
const ROT = {
  min: null, max: null, baseline: [-Math.PI / 36, Math.PI / 36], defaultValue: 0, unit: '°',
  toDisplay: C.radToDeg, fromDisplay: C.degToRad
};

/* ---------------- 測試用 preset ---------------- */
function spritePreset(extra) {
  const layer = Object.assign({
    id: 'a', type: 'sprite', assetId: 'x.png', zIndex: 0,
    scale: { x: 1, y: 1 }
  }, extra || {});
  return { schemaVersion: 1, id: 'fx', duration: 1, loop: false, layers: [layer] };
}

const RESOLVER = { has: () => true, resolve: (id) => '/' + id };

/* 跑 runtime 並記錄每一幀的 transform。比對欄位不夠——
   要證明的是「畫面沒變」，那就得比對後端實際收到的東西。 */
function record(preset, frames) {
  const seen = [];
  const backend = {
    createNode: (spec) => ({ spec: spec }),
    updateNode: (node, t) => {
      seen.push([t.visible, r6(t.x), r6(t.y), r6(t.rotation),
        r6(t.scaleX), r6(t.scaleY), r6(t.alpha), t.tint].join('|'));
    },
    destroyNode: () => {},
    destroy: () => {}
  };
  const rt = VFXCore.createRuntime({ backend, resolver: RESOLVER });
  rt.registerPreset(preset);
  rt.play(preset.id, { position: { x: 0, y: 0 }, seed: 7 });
  for (let i = 0; i < (frames || 40); i++) rt.update(1 / 40);
  rt.destroy();
  return seen;
}
function r6(v) { return v === undefined ? '-' : Number(v).toFixed(6); }

/* runtime.destroy() 會把節點藏起來再收攤，所以錄到的最後一幀永遠是
   visible:false 的隱藏 transform。要看「畫面上的值」就得取最後一個可見幀。
   指紋比對則刻意連隱藏幀一起算——收攤行為改變同樣是行為改變。 */
function lastVisible(seen) {
  for (let i = seen.length - 1; i >= 0; i--) {
    const f = seen[i].split('|');
    if (f[0] === 'true') return f;
  }
  throw new Error('沒有任何可見的幀');
}
function fingerprint(preset, frames) {
  return crypto.createHash('sha256').update(record(preset, frames).join('\n')).digest('hex').slice(0, 16);
}

/* ============================================================
   CURVE — 曲線資料運算
   ============================================================ */

test('CURVE-1 載入既有曲線：三種形式都能進編輯狀態再原樣回存', function () {
  assert.equal(C.toPoints(undefined), null, '沒有曲線就是 null');
  assert.deepEqual(C.toPoints(0.5), [[0, 0.5]], '常數展開成單點');
  assert.deepEqual(C.toPoints([[0, 1], [1, 0]]), [[0, 1], [1, 0]]);

  /* 回存要收斂回 canonical 形式，不能讓每個 preset 都多出 [[0,1]] 這種噪音 */
  assert.equal(C.toCurve(null), undefined);
  assert.equal(C.toCurve([[0, 0.5]]), 0.5, '單點且 t=0 收斂成純數字');
  assert.deepEqual(C.toCurve([[0, 1], [1, 0]]), [[0, 1], [1, 0]]);

  /* 單點但 t≠0 不能收斂成數字：sampleCurve 對它們的行為其實一樣，
     但收斂會遺失使用者放的位置，下次打開就跑掉了 */
  assert.deepEqual(C.toCurve([[0.5, 2]]), [[0.5, 2]]);
});

test('CURVE-2 新增控制點：落在點擊位置並維持時間遞增', function () {
  let r = C.addPoint([[0, 1], [1, 0]], 0.5, 0.25, ALPHA);
  assert.deepEqual(r.points, [[0, 1], [0.5, 0.25], [1, 0]]);
  assert.equal(r.index, 1, '回傳新點的索引，讓它可以直接被拖');

  /* 點數上限是 Core 的 HARD_LIMITS.maxCurvePoints，不是 UI 自訂的 */
  const full = [];
  for (let i = 0; i < 16; i++) full.push([i / 15, 1]);
  const rejected = C.addPoint(full, 0.5, 2, ALPHA);
  assert.equal(rejected.index, -1);
  assert.equal(rejected.rejected, 'maxPoints');
  assert.equal(rejected.points.length, 16, '被擋下時不得偷偷加進去');
});

test('CURVE-3 拖曳控制點：拖過鄰居會重新排序，索引跟著它走', function () {
  const pts = [[0, 1], [0.3, 2], [0.6, 3]];
  /* 把中間那點拖到最後面 */
  const r = C.movePoint(pts, 1, 0.9, 2, SCALE);
  assert.deepEqual(r.points, [[0, 1], [0.6, 3], [0.9, 2]]);
  assert.equal(r.index, 2, '排序後索引要更新，否則接下來的拖曳會抓到別的點');
  assert.deepEqual(pts, [[0, 1], [0.3, 2], [0.6, 3]], '不得就地修改輸入');
});

test('CURVE-4 刪除控制點', function () {
  const r = C.removePoint([[0, 1], [0.5, 2], [1, 0]], 1);
  assert.deepEqual(r.points, [[0, 1], [1, 0]]);
  /* 刪光是合理終點：等於「這條曲線不存在」 */
  let one = C.removePoint([[0, 1]], 0);
  assert.deepEqual(one.points, []);
  assert.equal(C.toCurve(one.points), undefined);
});

test('CURVE-5 normalized time 夾在 0..1', function () {
  assert.equal(C.clampTime(-0.4), 0);
  assert.equal(C.clampTime(1.7), 1);
  assert.equal(C.clampTime(0.42), 0.42);
  const r = C.movePoint([[0.5, 1]], 0, 3.2, 1, SCALE);
  assert.equal(r.points[0][0], 1, '拖出畫面右邊只能停在 100%');

  /* 浮點噪音不得進 preset：拖曳算出來的 0.30000000000000004 要收成 0.3 */
  assert.equal(C.roundTime(0.1 + 0.2), 0.3);
});

test('CURVE-6 透明度只夾下限 0，不夾上限 1', function () {
  assert.equal(C.clampValue(-0.5, ALPHA), 0, '負的不透明度沒有意義');
  /* 這一條刻意與「Opacity 0..1」的直覺相反。alphaOverLife 是乘在 layer.alpha
     上的係數，現有 preset 大量使用 >1 讓亮部過曝；夾到 1 會靜靜改掉它們。 */
  assert.equal(C.clampValue(1.26, ALPHA), 1.26, '既有 preset 真的有 1.26，不得被夾掉');
});

test('CURVE-7 縮放可以大於 1，且不得為負', function () {
  assert.equal(C.clampValue(4, SCALE), 4);
  assert.equal(C.clampValue(-1, SCALE), 0, 'Core 的 nonNegative 規定縮放不得為負');
  /* Y 軸範圍要跟著資料放大，否則 4 倍的曲線會被切掉 */
  const r = C.valueRange([[0, 1], [1, 4]], SCALE);
  assert.ok(r.hi >= 4, 'Y 軸上限要涵蓋最大值，實得 ' + r.hi);
  assert.ok(r.lo >= 0, '有下限的屬性不該把 Y 軸畫到負的去');
  /* 平坦曲線也要有可用的範圍，不能塌成一條線 */
  const flat = C.valueRange([[0, 1], [1, 1]], SCALE);
  assert.ok(flat.hi > flat.lo);
});

test('CURVE-8 控制點順序：輸出永遠時間遞增，且能通過 Core 驗證', function () {
  let pts = [[0, 1]];
  [[0.8, 0.2], [0.2, 0.9], [0.5, 0.5], [0.1, 1]].forEach(function (p) {
    pts = C.addPoint(pts, p[0], p[1], ALPHA).points;
  });
  const times = pts.map(p => p[0]);
  assert.deepEqual(times.slice().sort((a, b) => a - b), times, '時間必須遞增');

  const preset = spritePreset({ alphaOverLife: C.toCurve(pts) });
  const check = VFXCore.validatePreset(preset);
  assert.ok(check.ok, '編輯器產出的曲線必須直接通過 Core 驗證：' + check.errors.join('; '));
});

test('CURVE-9 canonical 序列化：存檔→載入→再存檔逐位元相同', function () {
  const pts = C.addPoint([[0, 1], [1, 0]], 0.5, 1.5, SCALE).points;
  const preset = spritePreset({ scaleOverLife: C.toCurve(pts) });
  const once = VFXCore.serialisePreset(preset);
  const twice = VFXCore.serialisePreset(JSON.parse(once));
  assert.equal(once, twice);
  assert.ok(once.indexOf('"scaleOverLife": [') > 0 || once.indexOf('"scaleOverLife":[') > 0);
});

test('CURVE-10 度↔弧度來回換算不失真', function () {
  [0, 90, 180, 360, 720, -1080, 1440].forEach(function (deg) {
    const rad = C.degToRad(deg);
    assert.ok(Math.abs(C.radToDeg(rad) - deg) < 1e-9, deg + '° 來回換算失真');
  });
  /* 顯示層：使用者看到度，preset 裡存的是弧度 */
  assert.equal(C.formatValue(Math.PI, ROT), '180°');
  assert.equal(C.formatValue(Math.PI * 8, ROT), '1440°');
  assert.equal(C.formatValue(1.5, SCALE), '1.5', '非旋轉屬性不加單位也不換算');

  /* 現有 preset 的旋轉曲線就是靠這個換算才讀得懂 */
  const real = JSON.parse(fs.readFileSync(path.join(REPO, 'vfx/presets/black-hole.json'), 'utf8'));
  const withRot = real.layers.filter(l => Array.isArray(l.rotationOverLife));
  assert.ok(withRot.length > 0, 'black-hole 應該有旋轉曲線可供驗證');
  withRot.forEach(function (l) {
    l.rotationOverLife.forEach(function (p) {
      const back = C.degToRad(C.radToDeg(p[1]));
      assert.ok(Math.abs(back - p[1]) < 1e-9, l.id + ' 的旋轉值換算後對不回來');
    });
  });
});

test('CURVE-14 Reset 回到單一常數點', function () {
  assert.deepEqual(C.resetPoints(SCALE), [[0, 1]]);
  assert.deepEqual(C.resetPoints(ROT), [[0, 0]]);
  assert.equal(C.toCurve(C.resetPoints(ALPHA)), 1, 'Reset 後存出去是純數字 1');
});

test('CURVE-15 啟用／停用：停用等於這個欄位不存在', function () {
  const layer = { id: 'a', type: 'sprite', assetId: 'x.png', alphaOverLife: [[0, 1], [1, 0]] };
  /* 停用 */
  const cleared = C.toCurve(null);
  assert.equal(cleared, undefined);
  delete layer.alphaOverLife;
  const preset = spritePreset(layer);
  assert.ok(VFXCore.validatePreset(preset).ok);
  assert.ok(VFXCore.serialisePreset(preset).indexOf('alphaOverLife') < 0,
    '停用後不得在檔案裡留下空欄位');
});

test('CURVE-16 既有 preset 全部維持合法，且往返序列化不變', function () {
  const dir = path.join(REPO, 'vfx', 'presets');
  const files = fs.readdirSync(dir).filter(f => /\.json$/.test(f));
  assert.ok(files.length >= 5);
  files.forEach(function (f) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const preset = JSON.parse(text);
    const check = VFXCore.validatePreset(preset);
    assert.ok(check.ok, f + ' 不合法：' + check.errors.join('; '));

    /* 每一條既有曲線都要能進編輯狀態再原樣回來 */
    preset.layers.forEach(function (l) {
      ['alphaOverLife', 'scaleOverLife', 'rotationOverLife'].forEach(function (k) {
        if (l[k] === undefined) return;
        const back = C.toCurve(C.toPoints(l[k]));
        assert.deepEqual(back, l[k], f + ' / ' + l.id + ' 的 ' + k + ' 往返後不同');
      });
    });
  });
});

/* ============================================================
   AXIS — 分軸縮放
   ============================================================ */

test('AXIS-1 舊的等比 preset 一個欄位都沒加時，runtime 輸出逐位元相同', function () {
  /* 先證明指紋有鑑別力，否則「相同」可能只是因為它什麼都沒看 */
  const a = fingerprint(spritePreset({ scaleOverLife: [[0, 1], [1, 2]] }));
  const b = fingerprint(spritePreset({ scaleOverLife: [[0, 1], [1, 3]] }));
  assert.notEqual(a, b, '指紋必須分得出不同的縮放曲線');

  /* 真正的回歸保護：拿現有 preset 跑，結果必須與這次擴充無關 */
  const dir = path.join(REPO, 'vfx', 'presets');
  fs.readdirSync(dir).filter(f => /\.json$/.test(f)).forEach(function (f) {
    const preset = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const hasNew = preset.layers.some(l =>
      l.scaleXOverLife !== undefined || l.scaleYOverLife !== undefined);
    assert.equal(hasNew, false, f + ' 不該已經帶有分軸欄位');
  });

  /* 等價性：不給分軸 vs 兩軸都給同一條曲線 → 必須完全相同 */
  const curve = [[0, 1], [0.5, 1.8], [1, 0.4]];
  const uniform = fingerprint(spritePreset({ scaleOverLife: curve }));
  const split = fingerprint(spritePreset({
    scaleOverLife: curve, scaleXOverLife: curve, scaleYOverLife: curve
  }));
  assert.equal(uniform, split, '兩軸給同一條曲線必須等同於等比');
});

test('AXIS-2 Link 開啟：等比曲線同時作用在兩軸', function () {
  const seen = record(spritePreset({ scaleOverLife: [[0, 1], [1, 2]] }), 10);
  seen.forEach(function (line) {
    const f = line.split('|');
    assert.equal(f[4], f[5], 'scaleX 與 scaleY 在等比模式下必須相等');
  });
});

test('AXIS-3 Link 關閉後兩軸可以不同，且畫面確實不一樣', function () {
  const linked = fingerprint(spritePreset({ scaleOverLife: [[0, 1], [1, 2]] }));
  const unlinked = fingerprint(spritePreset({
    scaleXOverLife: [[0, 1], [1, 2]], scaleYOverLife: [[0, 1], [1, 0.5]]
  }));
  assert.notEqual(linked, unlinked);
});

test('AXIS-4 只給 X：X 走自己的曲線，Y 沿用等比曲線', function () {
  const seen = record(spritePreset({
    scaleOverLife: [[0, 1], [1, 3]],
    scaleXOverLife: [[0, 1], [1, 1]]
  }), 20);
  const last = lastVisible(seen);
  assert.equal(Number(last[4]).toFixed(3), '1.000', 'X 應該維持 1');
  /* 20 幀 × 1/40 秒 = 生命週期的 50%，等比曲線 1→3 在此為 2.0（精確值，不用門檻） */
  assert.equal(Number(last[5]).toFixed(3), '2.000', 'Y 應沿用等比曲線，實得 ' + last[5]);
});

test('AXIS-5 只給 Y：Y 走自己的曲線，X 沿用等比曲線', function () {
  const seen = record(spritePreset({
    scaleOverLife: [[0, 1], [1, 3]],
    scaleYOverLife: [[0, 1], [1, 1]]
  }), 20);
  const last = lastVisible(seen);
  assert.equal(Number(last[4]).toFixed(3), '2.000', 'X 應沿用等比曲線，實得 ' + last[4]);
  assert.equal(Number(last[5]).toFixed(3), '1.000', 'Y 應該維持 1');
});

test('AXIS-6 序列化：新欄位有固定的鍵順序，往返逐位元相同', function () {
  const preset = spritePreset({
    scaleOverLife: [[0, 1], [1, 2]],
    scaleXOverLife: [[0, 1], [1, 3]],
    scaleYOverLife: [[0, 1], [1, 0.5]]
  });
  const once = VFXCore.serialisePreset(preset);
  assert.equal(once, VFXCore.serialisePreset(JSON.parse(once)));
  /* 鍵順序固定在 scaleOverLife 之後、rotationOverLife 之前 */
  assert.ok(once.indexOf('scaleOverLife') < once.indexOf('scaleXOverLife'));
  assert.ok(once.indexOf('scaleXOverLife') < once.indexOf('scaleYOverLife'));
});

test('AXIS-7 粒子層不接受分軸欄位（那裡兩軸永遠相等）', function () {
  const preset = {
    schemaVersion: 1, id: 'fx', duration: 1, loop: false,
    layers: [{
      id: 'p', type: 'particle', assetId: 'x.png',
      emission: { mode: 'rate', rate: 10 }, lifetime: 1,
      scaleXOverLife: [[0, 1], [1, 2]]
    }]
  };
  const check = VFXCore.validatePreset(preset);
  assert.equal(check.ok, false, '收下來卻不生效才是最糟的結果，必須明確報錯');
  assert.ok(check.errors.some(e => /scaleXOverLife/.test(e)), check.errors.join('; '));

  /* sprite 與 procedural 則必須接受 */
  assert.ok(VFXCore.validatePreset(spritePreset({ scaleXOverLife: [[0, 1], [1, 2]] })).ok);
});

/* ============================================================
   PREVIEW — 播放頭保留
   ============================================================ */

test('CURVE-11 即時預覽：play(startTime) 讓重建後的畫面停在原處', function () {
  const preset = spritePreset({ scaleOverLife: [[0, 1], [1, 3]] });
  const backend = {
    createNode: (spec) => ({ spec: spec }),
    updateNode: (node, t) => { backend.last = t.scaleX; },
    destroyNode: () => {}, destroy: () => {}
  };
  const rt = VFXCore.createRuntime({ backend, resolver: RESOLVER });
  rt.registerPreset(preset);

  /* 從頭播到一半 */
  const h = rt.play('fx', { seed: 1 });
  for (let i = 0; i < 20; i++) rt.update(1 / 40);
  const midScale = backend.last;
  const midTime = rt.timeOf(h);
  assert.ok(midTime > 0.4 && midTime < 0.6, '播放頭應該在中段，實得 ' + midTime);

  /* 模擬 Editor 的重建：停掉、重新註冊、帶著播放頭重播 */
  rt.stopAll();
  rt.registerPreset(preset);
  rt.play('fx', { seed: 1, startTime: midTime });
  rt.update(0);
  assert.ok(Math.abs(backend.last - midScale) < 1e-9,
    '重建後畫面必須停在原本的時間點，否則調 50% 的曲線永遠看不到效果');

  /* 沒有給 startTime 時行為完全不變 */
  rt.stopAll();
  rt.play('fx', { seed: 1 });
  rt.update(0);
  assert.ok(Math.abs(backend.last - 1) < 1e-9, '預設仍從第 0 秒開始');
  rt.destroy();
});

test('CURVE-11b timeOf 對已結束或不存在的 handle 回傳 null', function () {
  const backend = {
    createNode: () => ({}), updateNode: () => {}, destroyNode: () => {}, destroy: () => {}
  };
  const rt = VFXCore.createRuntime({ backend, resolver: RESOLVER });
  rt.registerPreset(spritePreset({}));
  assert.equal(rt.timeOf(999), null);
  const h = rt.play('fx', {});
  assert.equal(typeof rt.timeOf(h), 'number');
  rt.stopAll();
  assert.equal(rt.timeOf(h), null, '停掉之後不該還回報一個時間');
  rt.destroy();
});

test('CURVE-11c startTime 只接受非負有限數', function () {
  const backend = {
    createNode: () => ({}), updateNode: () => {}, destroyNode: () => {}, destroy: () => {}
  };
  const rt = VFXCore.createRuntime({ backend, resolver: RESOLVER });
  rt.registerPreset(spritePreset({}));
  assert.throws(() => rt.play('fx', { startTime: -1 }), /startTime/);
  assert.throws(() => rt.play('fx', { startTime: NaN }), /startTime/);
  rt.destroy();
});

/* ============================================================
   鍵盤優先權
   ============================================================ */

test('CURVE-12 焦點在曲線編輯器時，Delete 不會刪到圖層', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = noComments.slice(noComments.indexOf('function onKeyDown'));
  const curveGuard = body.indexOf('inCurveEditor(document.activeElement)');
  const del = body.indexOf("k === 'delete'");
  assert.ok(curveGuard >= 0, 'onKeyDown 必須有曲線編輯器的守門');
  assert.ok(curveGuard < del, '守門要排在 Delete 分支之前');

  /* 曲線元件自己也要擋住事件冒泡，這是第一道防線 */
  const ce = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/curve-editor.js'), 'utf8');
  const keyBlock = ce.slice(ce.indexOf("el.addEventListener('keydown'"));
  assert.ok(/stopPropagation\(\)/.test(keyBlock.slice(0, 400)),
    '曲線元件的 keydown 必須 stopPropagation，否則 document 上的刪圖層也會被觸發');
  assert.ok(keyBlock.indexOf('stopPropagation') < keyBlock.indexOf('removePoint'),
    'stopPropagation 要在真正刪點之前，提早 return 的路徑也才擋得住');
});

test('CURVE-13 焦點在文字輸入時，Delete 兩者都不刪', function () {
  const M = require('../tools/vfx/editor/layer-model.js');
  /* 守門仍然是同一個 isTextEntry，而且排在曲線守門之前 */
  assert.equal(M.isTextEntry({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(M.isTextEntry({ tagName: 'TEXTAREA' }), true);

  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const body = noComments.slice(noComments.indexOf('function onKeyDown'));
  assert.ok(body.indexOf('isTextEntry(document.activeElement)') <
    body.indexOf('inCurveEditor(document.activeElement)'),
    '文字輸入的守門要排在最前面');
});

/* ============================================================
   元件的泛用性
   ============================================================ */

test('CURVE-17 曲線元件不認識任何特定屬性（可重用）', function () {
  const model = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/curve-model.js'), 'utf8');
  const view = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/curve-editor.js'), 'utf8');
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  [['curve-model.js', strip(model)], ['curve-editor.js', strip(view)]].forEach(function (pair) {
    ['alphaOverLife', 'scaleOverLife', 'rotationOverLife', 'fire-tornado', 'black-hole',
      'lightning-orb'].forEach(function (word) {
      assert.ok(pair[1].indexOf(word) < 0,
        pair[0] + ' 不該提到 ' + word + '——屬性與 preset 名稱都必須由呼叫端注入');
    });
  });
  /* 而且畫面層不得自己做資料運算。
     Math.round 不列入禁止：畫布上要把座標對齊到整數像素才畫得出 1px 細線，
     那是繪圖不是資料。真正該擋的是排序與夾限——它們一旦在兩邊各寫一份，
     就會出現「畫面看到的順序」與「存進檔案的順序」不一致。 */
  assert.ok(/VFXCurveModel/.test(view), 'curve-editor 必須委派給 curve-model');
  /* 禁止的是「自己再實作一份」，不是「呼叫」——M.clampTime(...) 正是要的寫法。
     所以擋的是本地定義與裸呼叫，不是所有出現過這些名字的地方。 */
  /* 把所有 M.xxx 的呼叫抹掉後，這些名字就不該再出現在任何地方——
     還剩下的一定是本地定義或裸呼叫。 */
  const delegatedOnly = strip(view).replace(/M\.\w+/g, 'M_CALL');
  ['clampTime', 'clampValue', 'sortKeepingIndex', 'roundTime', 'valueAt'].forEach(function (fn) {
    assert.ok(delegatedOnly.indexOf(fn) < 0,
      'curve-editor 只能透過 M.' + fn + ' 使用它，不得自己定義或裸呼叫');
  });
  assert.ok(strip(view).indexOf('.sort(') < 0, 'curve-editor 不該自己排序');
  ['addPoint', 'movePoint', 'removePoint', 'toPoints', 'toCurve'].forEach(function (fn) {
    assert.ok(view.indexOf('M.' + fn + '(') >= 0,
      'curve-editor 必須呼叫 M.' + fn + '，而不是自己實作一份');
  });
});

test('CURVE-18 Editor 頁面有載入這兩個模組', function () {
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  assert.ok(/curve-model\.js/.test(html));
  assert.ok(/curve-editor\.js/.test(html));
  assert.ok(html.indexOf('curve-model.js') < html.indexOf('curve-editor.js'),
    'model 要先於 view 載入');
  assert.ok(html.indexOf('curve-editor.js') < html.indexOf('editor/editor.js'));
});

test('CURVE-19 Inspector 不再用 JSON 文字框編曲線', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ['alphaOverLife', 'scaleOverLife', 'rotationOverLife'].forEach(function (k) {
    assert.ok(noComments.indexOf("json('" + k + "'") < 0,
      k + ' 不該再是 JSON 文字欄位');
  });
  assert.ok(/VFXCurveEditor\.create\(/.test(noComments), 'Inspector 必須改用曲線元件');
});

test('CURVE-20 policy 的 baseline 必須是儲存單位，不是顯示單位', function () {
  /* 這條是實際踩到的：旋轉的 baseline 一開始寫成 [-180, 180]，看起來像
     「±180 度」，但 valueRange 是拿它跟曲線上的**弧度**比大小，於是 Y 軸
     變成 ±180 弧度（±10313 度）。在圖上點一下就得到 -62755° 這種值。
     單位錯誤在畫面上只表現為「數字怪怪的」，很容易被當成手滑忽略。 */
  const wrong = { baseline: [-180, 180], toDisplay: C.radToDeg, fromDisplay: C.degToRad };
  const right = { baseline: [-Math.PI / 36, Math.PI / 36], toDisplay: C.radToDeg, fromDisplay: C.degToRad };
  const realCurve = [[0, -0.05], [0.5, 0.05], [1, -0.05]];   // fire-tornado / funnel-body

  const bad = C.valueRange(realCurve, wrong);
  assert.ok(C.radToDeg(bad.hi) > 9000, '寫成度會讓 Y 軸上限爆到 ' + C.radToDeg(bad.hi) + '°');

  const good = C.valueRange(realCurve, right);
  assert.ok(C.radToDeg(good.hi) < 20 && C.radToDeg(good.hi) > 4,
    'Y 軸上限應該落在十幾度，實得 ' + C.radToDeg(good.hi) + '°');
  assert.ok(good.hi >= 0.05 && good.lo <= -0.05, '範圍仍必須涵蓋曲線本身');

  /* Editor 實際使用的 policy 必須是弧度那一版 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const rotBlock = src.slice(src.indexOf('    rotation: {'), src.indexOf('    rotation: {') + 300);
  assert.ok(/Math\.PI/.test(rotBlock),
    '旋轉的 baseline 必須用弧度（Math.PI）表示，實際內容：' + rotBlock.slice(0, 160));
});

test('CURVE-21 大角度旋轉曲線仍然完整顯示', function () {
  /* black-hole 的旋轉跨到 ±25 弧度（±1440 度），基準訂小不能把它切掉 */
  const big = C.valueRange([[0, 0], [1, 25.1327]], ROT);
  assert.ok(big.hi >= 25.1327, 'Y 軸要涵蓋 ' + big.hi);
  assert.equal(C.formatValue(25.1327, ROT), '1440°');
});

/* ============================================================
   ROT-XY — 繞 X／Y 軸翻轉（正交投影）
   ============================================================ */

test('ROT-1 繞 X 軸旋轉壓縮高度，180° 變成鏡像', function () {
  const seen = record(spritePreset({ rotationXOverLife: [[0, 0], [1, Math.PI]] }), 40);
  const first = seen[0].split('|');
  assert.equal(Number(first[4]).toFixed(3), '1.000', '寬度不受繞 X 軸影響');
  /* cos 投影：0°→1、90°→0、180°→-1（負縮放就是鏡像，也就是翻到背面） */
  const mid = lastVisible(seen.slice(0, 21));
  assert.ok(Math.abs(Number(mid[5])) < 0.1, '接近 90° 時高度應該趨近 0，實得 ' + mid[5]);
  const end = lastVisible(seen);
  assert.ok(Number(end[5]) < -0.9, '接近 180° 時高度應為 -1 附近，實得 ' + end[5]);
});

test('ROT-2 繞 Y 軸旋轉壓縮寬度，且不動高度', function () {
  const seen = record(spritePreset({ rotationYOverLife: [[0, 0], [1, Math.PI]] }), 40);
  seen.forEach(function (line) {
    const f = line.split('|');
    if (f[0] !== 'true') return;
    assert.equal(Number(f[5]).toFixed(3), '1.000', '高度不受繞 Y 軸影響');
  });
  const end = lastVisible(seen);
  assert.ok(Number(end[4]) < -0.9, '接近 180° 時寬度應為 -1 附近，實得 ' + end[4]);
});

test('ROT-3 軸與被壓縮的方向是交叉的（不能寫反）', function () {
  /* 這一條專門擋「rotationX 卻去乘 scaleX」這種一眼看不出來的錯：
     繞水平軸轉，變矮不是變窄。 */
  const x90 = lastVisible(record(spritePreset({ rotationXOverLife: Math.PI / 2 }), 4));
  assert.equal(Number(x90[4]).toFixed(3), '1.000', '繞 X 軸 90° 時寬度不變');
  assert.ok(Math.abs(Number(x90[5])) < 1e-6, '繞 X 軸 90° 時高度應為 0');

  const y90 = lastVisible(record(spritePreset({ rotationYOverLife: Math.PI / 2 }), 4));
  assert.ok(Math.abs(Number(y90[4])) < 1e-6, '繞 Y 軸 90° 時寬度應為 0');
  assert.equal(Number(y90[5]).toFixed(3), '1.000', '繞 Y 軸 90° 時高度不變');
});

test('ROT-4 翻轉與縮放曲線相乘，不是互相取代', function () {
  const both = lastVisible(record(spritePreset({
    scaleOverLife: 2,
    rotationXOverLife: Math.PI / 3          // cos60° = 0.5
  }), 4));
  assert.equal(Number(both[4]).toFixed(3), '2.000', '寬度只受縮放影響');
  assert.equal(Number(both[5]).toFixed(3), '1.000', '高度＝2 × cos60° = 1');
});

test('ROT-5 沒給翻轉曲線時輸出逐位元不變', function () {
  const plain = fingerprint(spritePreset({ scaleOverLife: [[0, 1], [1, 2]] }));
  const zero = fingerprint(spritePreset({ scaleOverLife: [[0, 1], [1, 2]], rotationXOverLife: 0 }));
  assert.equal(plain, zero, 'cos(0)=1，明確給 0 必須等同於不給');
  const tilted = fingerprint(spritePreset({
    scaleOverLife: [[0, 1], [1, 2]], rotationXOverLife: 0.5
  }));
  assert.notEqual(plain, tilted, '指紋要能分辨有沒有翻轉');
});

test('ROT-6 粒子層不接受 X／Y 翻轉（沒有分軸縮放可以承載）', function () {
  const preset = {
    schemaVersion: 1, id: 'fx', duration: 1, loop: false,
    layers: [{
      id: 'p', type: 'particle', assetId: 'x.png',
      emission: { mode: 'rate', rate: 10 }, lifetime: 1,
      rotationXOverLife: [[0, 0], [1, 1]]
    }]
  };
  const check = VFXCore.validatePreset(preset);
  assert.equal(check.ok, false);
  assert.ok(check.errors.some(e => /rotationXOverLife/.test(e)), check.errors.join('; '));
  /* Z 軸旋轉粒子是支援的，不能連它一起擋掉 */
  preset.layers[0].rotationXOverLife = undefined;
  delete preset.layers[0].rotationXOverLife;
  preset.layers[0].rotationOverLife = [[0, 0], [1, 1]];
  assert.ok(VFXCore.validatePreset(preset).ok);
});

test('ROT-7 序列化鍵順序固定，往返逐位元相同', function () {
  const preset = spritePreset({
    rotationOverLife: [[0, 0], [1, 1]],
    rotationXOverLife: [[0, 0], [1, 2]],
    rotationYOverLife: [[0, 0], [1, 3]]
  });
  const once = VFXCore.serialisePreset(preset);
  assert.equal(once, VFXCore.serialisePreset(JSON.parse(once)));
  assert.ok(once.indexOf('rotationOverLife') < once.indexOf('rotationXOverLife'));
  assert.ok(once.indexOf('rotationXOverLife') < once.indexOf('rotationYOverLife'));
});

/* ============================================================
   COMPARE — 對照模式的共用時間游標
   ============================================================ */

test('COMPARE-1 游標讀數用的是 Core 的插值，不是另一套', function () {
  /* 讀數若和實際播出來的值差一點點，對照就失去意義了 */
  const curve = [[0, 1], [0.5, 2], [1, 0]];
  [0, 0.1, 0.25, 0.5, 0.73, 1].forEach(function (t) {
    assert.equal(C.valueAt(curve, t), VFXCore.sampleCurve(curve, t),
      't=' + t + ' 的取樣結果必須與 Core 相同');
  });
  /* 超出點的範圍時取端點值——沿用 Core 的行為，不另外定規則 */
  assert.equal(C.valueAt([[0.3, 5]], 0.9), 5);
  assert.equal(C.valueAt(null, 0.5), null);
});

test('COMPARE-2 對照模式攤開全部，且共用同一個游標', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(/overLifeMode === 'compare'/.test(noComments), '要有對照模式');
  assert.ok(/function broadcastCursor/.test(noComments), '要有游標廣播');
  assert.ok(/onCursor: broadcastCursor/.test(noComments), '每張圖都要接上廣播');

  const view = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/curve-editor.js'), 'utf8');
  assert.ok(/setCursor: function/.test(view), '曲線元件要能接收共用游標');
  assert.ok(/M\.valueAt\(/.test(view), '游標讀數必須走 curve-model 的取樣');
});

test('COMPARE-3 詞彙表下拉選單中文化，但值仍是英文原值', function () {
  const vocab = require('../tools/vfx/vfx-semantic-vocab.cjs');
  ['shape', 'usage', 'element', 'tag'].forEach(function (g) {
    const values = vocab[g.toUpperCase()];
    values.forEach(function (v) {
      const label = vocab.labelOf(g, v);
      assert.ok(/[\u4e00-\u9fff]/.test(label), g + '/' + v + ' 缺中文標籤');
      assert.ok(label.indexOf(v) >= 0, g + '/' + v + ' 的標籤要保留英文原值以便對照資料');
    });
  });
  /* 沒登記的字彙回傳原值，而不是 undefined 或空白 */
  assert.equal(vocab.labelOf('usage', 'somethingNew'), 'somethingNew');

  /* option 的 value 必須是原值：它會直接拿去比對 semantics 檔 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = src.slice(src.indexOf('function fillSelect'), src.indexOf('function currentAssetFilters'));
  assert.ok(/o\.value = v;/.test(fn), 'option 的 value 不得中文化');
  assert.ok(/VFXSemanticVocab\.labelOf\(group, v\)/.test(fn), '只有顯示文字換成中文');
});

test('COMPARE-4 沒登記中文的分組不得顯示成 undefined', function () {
  /* fillSelect 除了詞彙表，也被圖層型別的下拉用到。
     那個分組不在 LABELS.field 裡，少了 fallback 會變成「undefined（全部）」，
     而且字串變長還把旁邊的按鈕擠到換行。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const fn = src.slice(src.indexOf('function fillSelect'), src.indexOf('function currentAssetFilters'));
  assert.ok(/LABELS\.field\[group\] \|\| group/.test(fn),
    'fillSelect 必須對未登記的分組保留原字串');

  /* 每個實際的呼叫端都要有可顯示的標題 */
  const vocab = require('../tools/vfx/vfx-semantic-vocab.cjs');
  /* 第一個參數裡本身就有括號（$(p + 'usage')），所以抓到分號為止，
     再取最後一個字串常數當分組名 */
  const calls = src.match(/fillSelect\(.*?'\);/g) || [];
  assert.ok(calls.length >= 5, '應該找得到所有 fillSelect 呼叫，實得 ' + calls.length);
  calls.forEach(function (c) {
    const group = c.match(/'([^']+)'\);$/)[1];
    const title = vocab.LABELS.field[group] || group;
    assert.ok(/[\u4e00-\u9fff]/.test(title), group + ' 的下拉標題不是中文：' + title);
  });
});

test('COMPARE-5 取得焦點不得捲動面板（否則點擊落點會跑掉）', function () {
  /* 實際踩到的：mousedown 先呼叫 el.focus()，瀏覽器把這張圖捲進可視範圍，
     接著 localPos() 用的是**捲動後**的 getBoundingClientRect，
     於是點在垂直中央卻得到 -101.8°（正確值 -0.5°）。
     Inspector 是可捲動的窄面板，對照模式又同時攤開五張圖，一定會遇到。 */
  const view = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/curve-editor.js'), 'utf8');
  /* 不能用 '});' 當結尾切——focus({ preventScroll: true }); 自己就含有那三個字元，
     會把要檢查的那一行切掉。取固定長度就夠涵蓋處理常式的開頭。 */
  const down = view.slice(view.indexOf("canvas.addEventListener('mousedown'"));
  const body = down.slice(0, 900);
  const posAt = body.indexOf('localPos(e)');
  const focusAt = body.indexOf('.focus(');
  assert.ok(posAt >= 0 && focusAt >= 0, 'mousedown 要同時有座標換算與取得焦點');
  assert.ok(posAt < focusAt, '必須先換算座標再取得焦點');
  assert.ok(/focus\(\{\s*preventScroll:\s*true\s*\}\)/.test(body),
    'focus 必須帶 preventScroll，否則面板會跳位');
});

test('BOOT-1 啟動前先點名所有相依模組，且清單與 index.html 一致', function () {
  /* 實際發生過：使用者連到一個舊的 editor-server 行程，它的白名單還沒開放
     vfx-semantic-vocab.cjs，於是那支檔案回 403。錯誤在啟動流程很後面才以
     "VFXSemanticVocab is not defined" 炸出來，把整個 renderLayerList() 一起帶走，
     畫面上看起來像是「圖層分組全部不見了」。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(/function checkModules/.test(src), '要有啟動前的模組點名');
  const fn = src.slice(src.indexOf('function checkModules'), src.indexOf('function boot()'));
  assert.ok(/403/.test(fn), '訊息要指出真正的成因（舊伺服器回 403）');
  assert.ok(!/直接開檔案/.test(fn),
    '不得再用「是不是直接開檔案」誤導——那個情境下 fetch 早就先失敗了');

  /* 點名清單必須涵蓋頁面實際載入的每一支腳本，否則以後新增模組又會漏掉 */
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  const scripts = (html.match(/<script src="\/([^"]+)"/g) || [])
    .map(function (t) { return t.match(/src="\/([^"]+)"/)[1]; })
    .filter(function (u) { return u.indexOf('editor/editor.js') < 0; });
  assert.ok(scripts.length >= 8, '應該找得到所有 script 標籤，實得 ' + scripts.length);
  scripts.forEach(function (u) {
    assert.ok(fn.indexOf(u) >= 0, u + ' 沒有列進啟動點名清單');
  });
});

test('BOOT-2 圖層樹先於素材瀏覽器渲染', function () {
  /* 素材瀏覽器要用到詞彙表；它先跑的話，詞彙表一出事就會連圖層分組
     一起消失，使用者會以為群組被刪了。順序本身就是保護。 */
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const boot = noComments.slice(noComments.indexOf('function boot()'));
  const layers = boot.indexOf('renderLayerList();');
  const vocab = boot.indexOf('collectVocab();');
  const browser = boot.indexOf('renderAssetBrowser();');
  assert.ok(layers >= 0 && vocab >= 0 && browser >= 0);
  assert.ok(layers < vocab, 'renderLayerList 必須排在 collectVocab 之前');
  assert.ok(layers < browser, 'renderLayerList 必須排在 renderAssetBrowser 之前');
});

/* ============================================================
   DEG — 整個編輯器以角度為單位、旋轉上下限固定 ±360°
   ============================================================ */

const ROT360 = {
  min: -Math.PI * 2, max: Math.PI * 2, fixedRange: true,
  baseline: [-Math.PI * 2, Math.PI * 2], defaultValue: 0, decimals: 1, unit: '°',
  toDisplay: C.radToDeg, fromDisplay: C.degToRad
};

test('DEG-1 旋轉的 Y 軸固定在 ±360°，不隨資料放大', function () {
  const small = C.valueRange([[0, 0], [1, 0.05]], ROT360);
  const big = C.valueRange([[0, 0], [1, 25.13]], ROT360);
  assert.deepEqual(small, big, '不論曲線大小，軸都必須一樣');
  assert.equal(Math.round(C.radToDeg(small.lo)), -360);
  assert.equal(Math.round(C.radToDeg(small.hi)), 360);

  /* 對照組：沒有 fixedRange 的屬性仍然要自動放大，否則 4 倍的縮放會被切掉 */
  const scale = C.valueRange([[0, 1], [1, 4]], SCALE);
  assert.ok(scale.hi >= 4);
});

test('DEG-2 拖曳夾在 ±360°，不能無限往上拉', function () {
  assert.equal(Math.round(C.radToDeg(C.clampValue(C.degToRad(1000), ROT360))), 360);
  assert.equal(Math.round(C.radToDeg(C.clampValue(C.degToRad(-5000), ROT360))), -360);
  assert.equal(Math.round(C.radToDeg(C.clampValue(C.degToRad(180), ROT360))), 180);

  const moved = C.movePoint([[0, 0], [1, 0]], 1, 1, C.degToRad(9999), ROT360);
  assert.equal(Math.round(C.radToDeg(moved.points[1][1])), 360, '拖到天上也只能停在 360°');
});

test('DEG-3 載入的界外舊值不會被靜靜改寫，但會被指出來', function () {
  const legacy = [[0, 0], [1, 25.13]];                 // 1440°
  assert.equal(C.outOfRangeCount(legacy, ROT360), 1);
  /* 只是回報，不是自動修正——存檔前不動使用者的檔案 */
  assert.deepEqual(C.toCurve(legacy), legacy);
  /* 沒有 fixedRange 的屬性不適用這個概念 */
  assert.equal(C.outOfRangeCount([[0, 99]], SCALE), 0);
});

test('DEG-4 編輯器裡不再有以弧度呈現的欄位', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(!/\(rad\)/.test(src), 'Inspector 不該再有標示 (rad) 的欄位');
  /* 這幾個欄位在 schema 裡是弧度，畫面上必須是度 */
  ['rotation', 'velocityRotationOffset'].forEach(function (k) {
    assert.ok(src.indexOf("deg('" + k + "'") >= 0, k + ' 應改用角度欄位');
  });
  ['rotationStart', 'rotationSpeed'].forEach(function (k) {
    assert.ok(src.indexOf("degRange('" + k + "'") >= 0, k + ' 應改用角度範圍欄位');
  });
  /* direction／spread 在 schema 裡本來就是度，不得被重複換算 */
  assert.ok(/num\('direction'/.test(src), 'direction 在 schema 裡已是角度，不能再換一次');
  assert.ok(/num\('spread'/.test(src), 'spread 在 schema 裡已是角度，不能再換一次');
});

test('DEG-5 角度欄位的換算來回不失真，格式錯誤要被擋下', function () {
  const src = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
  assert.ok(/function angleRangeFromText/.test(src));
  assert.ok(/return INVALID;/.test(src), '格式錯誤必須明確擋下，不得靜靜吃掉');

  /* 換算本身：單值與 [min,max] 兩種形式都要能來回 */
  [0, 30, 90, 180, 360, -360].forEach(function (d) {
    assert.ok(Math.abs(C.radToDeg(C.degToRad(d)) - d) < 1e-9, d + '° 來回失真');
  });
});
