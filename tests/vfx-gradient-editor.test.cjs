'use strict';
/* ============================================================
   vfx-gradient-editor.test.cjs — 顏色曲線（tintOverLife）的編輯與接線

   受測對象：
     tools/vfx/editor/gradient-model.js  色標的純資料運算
     tools/vfx/editor/gradient-editor.js 元件契約（在 Node 裡只驗介面與常數）
     tools/vfx/editor/editor.js          Inspector 的接線
     js/vfx-core.js                      Editor 與遊戲共用的取樣結果

   為什麼運算要抽出來測：拖曳色標越過鄰居之後的重新排序、時間夾在 0..1、
   canonical 形式（單點收斂成字串）、以及**內插必須與 Core 逐位元一致**——
   這幾件事在畫面上都長得差不多，只有比對輸出才驗得出來。
   最後那一條尤其重要：色帶是 Editor 自己畫的，Core 是遊戲在跑，
   兩邊算出不同顏色的話，作者調的東西跟看到的東西就對不上。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const G = require('../tools/vfx/editor/gradient-model.js');
const VFXCore = require('../js/vfx-core.js');

const REPO = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

/* ============================================================
   GRAD — 純資料運算
   ============================================================ */

test('GRAD-1 preset 值 ↔ 色標陣列的來回轉換', function () {
  assert.equal(G.toStops(undefined), null, '沒有欄位＝沒有曲線');
  assert.deepEqual(G.toStops('#ff0000'), [[0, '#ff0000']], '純字串是單點');
  assert.deepEqual(G.toStops([[0, '#000000'], [1, '#ffffff']]),
    [[0, '#000000'], [1, '#ffffff']]);

  /* canonical：單點且在 t=0 收斂成字串，不要讓每份 preset 都多出 [[0,"#ffffff"]]。 */
  assert.equal(G.toValue([[0, '#ff0000']]), '#ff0000');
  assert.deepEqual(G.toValue([[0.2, '#ff0000']]), [[0.2, '#ff0000']], 't 不是 0 就不收斂');
  assert.equal(G.toValue(null), undefined);
  assert.equal(G.toValue([]), undefined);
});

test('GRAD-2 拖曳越過鄰居會重新排序，而且選取跟著走', function () {
  const stops = [[0, '#ff0000'], [0.5, '#00ff00'], [1, '#0000ff']];
  const r = G.moveStop(stops, 0, 0.8);       // 把第一個拖到綠色右邊
  assert.deepEqual(r.stops.map((p) => p[1]), ['#00ff00', '#ff0000', '#0000ff']);
  assert.equal(r.index, 1, '選取要跟著搬到新位置，否則繼續拖會抓錯色標');
  assert.deepEqual(r.stops.map((p) => p[0]), [0.5, 0.8, 1]);
});

test('GRAD-3 時間夾在 0..1，並四捨五入到與數值曲線同一個精度', function () {
  assert.equal(G.moveStop([[0.5, '#ffffff']], 0, -3).stops[0][0], 0);
  assert.equal(G.moveStop([[0.5, '#ffffff']], 0, 9).stops[0][0], 1);
  /* 0.1+0.2 這種浮點噪音存進 preset 會讓「同樣的拖曳」產生不同 bytes。 */
  assert.equal(G.roundTime(0.30000000000000004), 0.3);
});

test('GRAD-4 最後一個色標刪不掉（空陣列在 preset 裡是非法值）', function () {
  const one = [[0, '#ffffff']];
  assert.deepEqual(G.removeStop(one, 0).stops, one, '要移除整條曲線得用「停用」');
  const two = [[0, '#ffffff'], [1, '#000000']];
  assert.deepEqual(G.removeStop(two, 0).stops, [[1, '#000000']]);
  assert.equal(VFXCore.validatePreset({
    schemaVersion: 1, id: 'x', duration: 1,
    layers: [{ id: 'a', type: 'sprite', assetId: 'p/a.png', tintOverLife: [] }]
  }).ok, false, '空陣列必須被 Core 擋下——這正是不准刪到 0 個的理由');
});

test('GRAD-5 非法顏色一律收斂成白，不會寫出壞掉的 preset', function () {
  assert.equal(G.normalizeColor('#GGGGGG'), '#ffffff');
  assert.equal(G.normalizeColor('red'), '#ffffff');
  assert.equal(G.normalizeColor('#AABBCC'), '#aabbcc', '大小寫統一，否則兩次同樣操作 bytes 不同');
  assert.equal(G.addStop([[0, '#ffffff']], 0.5, 'nope').stops[1][1], '#ffffff');
});

test('GRAD-6 啟用時是白→白：按下去的當下畫面不該突然改變', function () {
  /* 相乘語意下白色＝乘 1。給兩點而不是一點，是因為按「啟用」的人就是想做漸層。 */
  assert.deepEqual(G.resetStops(), [[0, '#ffffff'], [1, '#ffffff']]);
});

/* ============================================================
   SAMPLE — 內插必須與 Core 逐位元一致
   ============================================================ */

const STOPS = [[0, '#ff3300'], [0.35, '#ffcc00'], [0.7, '#3366ff'], [1, '#0b0b12']];

test('SAMPLE-1 色帶與 Core 走同一支取樣器，不是兩份各自實作', function () {
  /* 這是結構性的保證：gradient-model 不自己內插，直接呼叫 Core。
     兩份實作只要差一個 |0 與 Math.round，色帶與實際播放就會差一階——
     在畫面上看不出來，卻正是「Editor 調好的顏色進遊戲不對」的來源。 */
  const curve = VFXCore.toColorCurve(STOPS);
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    assert.equal(G.colorAt(STOPS, t), G.intToHex(VFXCore.sampleColorCurve(curve, t)),
      't=' + t.toFixed(3) + ' 兩邊不一致');
  }
  /* 委派是靠原始碼保證的，順便釘住它不被改回自己算。 */
  const src = read('tools/vfx/editor/gradient-model.js');
  assert.match(src, /Core\.sampleColorCurve/);
  assert.ok(!/\(y\.r - x\.r\)/.test(src), 'gradient-model 不該再有自己的逐分量內插');
});

test('SAMPLE-2 端對端：跑完整個 runtime 播出來的顏色與色帶一致', function () {
  /* 與 SAMPLE-1 的差別：這一條經過 dt 累加。update(1/50) 跑五十次之後的
     生命進度不會剛好是 0.70000000，落在色標正上方時因此可能差一階——
     這裡容許每分量 ±1，內插公式本身由 SAMPLE-1 逐點釘死。 */
  const stops = STOPS;
  const tints = [];
  const backend = {
    createNode: () => ({}),
    updateNode: (node, t) => { if (t && t.visible !== false) tints.push(t.tint); },
    destroyNode: () => {}
  };
  const rt = VFXCore.createRuntime({
    backend: backend,
    resolver: VFXCore.createIndexResolver(
      { libraryId: 'l', assets: [{ assetId: 'p/a.png', relativePath: 'a.png' }] }, '/x')
  });
  rt.registerPreset({
    schemaVersion: 1, id: 'grad', duration: 1,
    layers: [{ id: 'a', type: 'sprite', assetId: 'p/a.png', tint: '#ffffff', tintOverLife: stops }]
  });
  rt.play('grad');
  const STEPS = 50;
  for (let i = 0; i < STEPS; i++) rt.update(1 / STEPS);
  assert.ok(tints.length >= STEPS - 1, '取樣格數：' + tints.length);
  tints.forEach(function (got, i) {
    const t = (i + 1) / STEPS;
    const want = parseInt(G.colorAt(stops, t).slice(1), 16);
    [16, 8, 0].forEach(function (sh) {
      const a = (got >> sh) & 255, b = (want >> sh) & 255;
      assert.ok(Math.abs(a - b) <= 1,
        't=' + t.toFixed(2) + ' 差太多：播出 ' + got.toString(16) + '、色帶 ' + want.toString(16));
    });
  });
});

/* ============================================================
   WIRE — 接線（在 Node 裡只驗契約，DOM 的部分靠目視）
   ============================================================ */

test('WIRE-1 元件介面與 curve-editor 對齊（editor.js 對所有元件一視同仁）', function () {
  const src = read('tools/vfx/editor/gradient-editor.js');
  /* editor.js 會對 liveEditors 裡的每一個呼叫這些，少一個就會在換層時炸掉。 */
  ['redraw:', 'reset: function', 'clear: function', 'hasFocus: function',
    'setCursor: function', 'destroy: function'].forEach(function (m) {
    assert.ok(src.indexOf(m) > 0, '缺少 ' + m);
  });
  assert.match(src, /el: el/);
});

test('WIRE-2 色標上限與 Core 的曲線點數硬上限一致', function () {
  const src = read('tools/vfx/editor/gradient-editor.js');
  const m = src.match(/MAX_STOPS = (\d+)/);
  assert.ok(m, '找不到 MAX_STOPS');
  assert.equal(Number(m[1]), VFXCore.HARD_LIMITS.maxCurvePoints,
    'Editor 讓人加到超過 Core 的上限，就會存出一份存得下卻載不起來的 preset');
});

test('WIRE-3 Inspector 有 Color 區塊，且走的是 gradientBlock', function () {
  const src = read('tools/vfx/editor/editor.js');
  assert.match(src, /curveSection\(host, 'color', 'Color'/);
  assert.match(src, /gradientBlock\(body, layer, 'tintOverLife'\)/);
  assert.match(src, /overLifeOpen = \{ opacity: true, color: false/);
  /* 三段式回呼要接上歷史與預覽，否則 undo 會跳過顏色的修改。 */
  const block = src.slice(src.indexOf('function gradientBlock'), src.indexOf('function writeCurve'));
  ['editBegin(', 'previewSoon()', 'onPresetChanged()', 'editCommit()', 'liveEditors.push']
    .forEach(function (hook) {
      assert.ok(block.indexOf(hook) > 0, 'gradientBlock 少接 ' + hook);
    });
});

test('WIRE-4 index.html 有載入兩個新檔，且在 editor.js 之前', function () {
  const html = read('tools/vfx/editor/index.html');
  const at = {
    model: html.indexOf('gradient-model.js'),
    editor: html.indexOf('gradient-editor.js'),
    main: html.indexOf('editor/editor.js')
  };
  assert.ok(at.model > 0 && at.editor > 0, '兩個檔都要載入');
  assert.ok(at.model < at.editor, 'model 要在 editor 之前（editor 直接引用 VFXGradientModel）');
  assert.ok(at.editor < at.main, '要在 editor.js 之前');
});

test('WIRE-5 既有 151 份 preset 沒有一份帶 tintOverLife（本次不動既有資料）', function () {
  const dir = path.join(REPO, 'vfx/presets');
  const withCurve = fs.readdirSync(dir).filter(function (f) {
    return f.endsWith('.json') && read('vfx/presets/' + f).indexOf('tintOverLife') >= 0;
  });
  assert.deepEqual(withCurve, [],
    '這一輪只加能力不改資料；要改既有 preset 應該是另一次獨立的提交');
});
