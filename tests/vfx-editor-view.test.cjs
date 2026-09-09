'use strict';
/* ============================================================
   vfx-editor-view.test.cjs — 「怎麼看」與「現在多大」

   涵蓋座標格線、滾輪縮放、預覽循環，以及群組 Inspector 上那幾個
   「這東西現在多大」的欄位。共同點是它們全都不該影響出貨資料：
   看的方式改了，preset 一個 byte 都不能動。

   受測對象：
     tools/vfx/editor/view-model.js   格線刻度、線色、縮放倍率的純計算
     tools/vfx/editor/editor.js       接線結構（畫在哪一層、誰不進 preset）

   為什麼要有這一份：格線是量尺。它算錯不會報錯，也不會看起來壞掉——
   只會安靜地量出錯的距離，而「這個特效比判定範圍大一圈」正是靠它判斷的。
   所以比例尺的來源（js/battlefield.js 的 1 米 = 10 系統單位）在這裡被釘住，
   兩邊分家時由測試喊出來，而不是等到有人照著錯的格線調完一整批 preset。
   ============================================================ */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const V = require('../tools/vfx/editor/view-model.js');

const REPO = path.resolve(__dirname, '..');
const editorSrc = () => fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.js'), 'utf8');
const stripped = () => editorSrc()
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/* ============================================================
   比例尺：與遊戲同一把尺
   ============================================================ */

test('VIEW-1 1 米 = 10px，與 js/battlefield.js 的系統距離單位同一個值', function () {
  const bf = fs.readFileSync(path.join(REPO, 'js/battlefield.js'), 'utf8');
  const m = /BF_SYSTEM_UNITS_PER_METER\s*=\s*(\d+)/.exec(bf);
  assert.ok(m, 'battlefield.js 應該還有 BF_SYSTEM_UNITS_PER_METER');
  assert.equal(V.PX_PER_METRE, Number(m[1]),
    '格線的每米像素數必須與模擬層一致，否則編輯器量出來的距離是假的');
});

test('VIEW-2 系統距離單位就是螢幕像素（battle-renderer 直接拿米×每米單位當 px 用）', function () {
  const src = fs.readFileSync(path.join(REPO, 'js/battle-renderer.js'), 'utf8');
  /* projectileArcPx 是這條等式唯一寫成程式的地方：它回傳的是像素，
     算式卻是「米 × BF_SYSTEM_UNITS_PER_METER」。這行若被改成另外乘一個
     鏡頭縮放，格線的前提就不成立了，要在這裡被擋下來。 */
  const fn = src.slice(src.indexOf('function projectileArcPx'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/m\s*\*\s*perM/.test(body),
    'projectileArcPx 應該仍然是「米 × 每米單位」直接當像素；' +
    '若改成再乘鏡頭縮放，view-model.js 的比例尺假設要一起重新檢討');
});

test('VIEW-3 一大格 6 米 = 60px，小格 1 米', function () {
  assert.equal(V.METRES_PER_CELL, 6);
  assert.equal(V.METRES_PER_MINOR, 1);
  const spec = V.gridSpec({ width: 601, height: 10, originX: 0, originY: 5, zoom: 1 });
  assert.equal(spec.majorPx, 60, '一大格 60px');
  assert.equal(spec.minorPx, 10, '一小格 10px');
});

/* ============================================================
   刻度
   ============================================================ */

test('VIEW-4 刻度必定有一條落在原點上', function () {
  const ticks = V.gridTicks(137.5, 400, 60);
  assert.ok(ticks.some(v => Math.abs(v - 137.5) < 1e-9), '原點自己要是一條線');
  ticks.forEach(v => assert.ok(v >= 0 && v <= 400, '刻度不得跑到畫布外：' + v));
});

test('VIEW-5 原點在畫布外時刻度仍與它對齊', function () {
  const ticks = V.gridTicks(-95, 200, 60);
  assert.ok(ticks.length > 0);
  ticks.forEach(function (v) {
    const k = (v + 95) / 60;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, '每條線都要是原點的整數倍：' + v);
  });
});

test('VIEW-6 小格不與大格、軸線重疊（重疊會讓 alpha 疊起來，粗細分不出來）', function () {
  const spec = V.gridSpec({ width: 600, height: 400, originX: 300, originY: 200, zoom: 1 });
  const majors = new Set(spec.majorX.map(v => Math.round(v * 1000)));
  spec.minorX.forEach(function (v) {
    assert.ok(!majors.has(Math.round(v * 1000)), '小格與大格重疊了：' + v);
    assert.ok(Math.abs(v - spec.axisX) > 1e-6, '小格畫在軸線上了：' + v);
  });
  spec.majorX.forEach(function (v) {
    assert.ok(Math.abs(v - spec.axisX) > 1e-6, '大格畫在軸線上了：' + v);
  });
});

test('VIEW-7 縮太小時整組不畫，而不是糊成一片灰', function () {
  const tiny = V.gridSpec({ width: 600, height: 400, originX: 300, originY: 200, zoom: 0.25 });
  assert.equal(tiny.minorPx, 2.5);
  assert.equal(tiny.minorX.length, 0, '2.5px 的小格讀不出格數，只會蓋掉特效');
  assert.ok(tiny.majorX.length > 0, '大格 15px 仍然畫得出來');
});

test('VIEW-8 極端輸入不會生出百萬條線把分頁鎖死', function () {
  assert.deepEqual(V.gridTicks(0, 4000, 0), []);
  assert.deepEqual(V.gridTicks(0, 4000, -5), []);
  assert.deepEqual(V.gridTicks(0, 1e6, 0.01), [], '線太多就整組放棄，畫不出來比卡死好');
  assert.deepEqual(V.gridSpec({ width: 0, height: 0, zoom: 1 }).majorX, []);
});

/* ============================================================
   縮放
   ============================================================ */

test('VIEW-9 滾輪往上放大、往下縮小，且夾在上下限內', function () {
  assert.ok(V.zoomByWheel(1, -100, 0) > 1, '滾輪往上（負 delta）＝放大');
  assert.ok(V.zoomByWheel(1, 100, 0) < 1, '滾輪往下＝縮小');
  assert.equal(V.zoomByWheel(V.ZOOM_MAX, -100000, 0), V.ZOOM_MAX);
  assert.equal(V.zoomByWheel(V.ZOOM_MIN, 100000, 0), V.ZOOM_MIN);
});

test('VIEW-10 一次滾動的幅度有上限（有些觸控板會送出上千的 delta）', function () {
  const one = V.zoomByWheel(1, -100, 0);
  const huge = V.zoomByWheel(1, -100000, 0);
  assert.ok(huge < 2, '單一事件不該一口氣跳好幾倍：' + huge);
  assert.ok(huge > one, '但仍然要比一格多');
});

test('VIEW-11 deltaMode 換算：行與頁的數字比像素小兩個數量級', function () {
  /* 同一支滾輪在不同瀏覽器可能回報 deltaY=100（像素）或 deltaY=3（行）。
     不換算的話，同一個動作在其中一邊等於完全沒動。 */
  const byLine = V.zoomByWheel(1, -3, 1);
  assert.ok(byLine > 1.05, '以行為單位時仍要有明顯的縮放：' + byLine);
  assert.ok(V.zoomByWheel(1, -1, 2) > V.zoomByWheel(1, -1, 0), '頁 > 像素');
});

test('VIEW-12 壞掉的倍率退回 1，不是 NaN 或 0', function () {
  assert.equal(V.clampZoom(NaN), 1);
  assert.equal(V.clampZoom(0), 1);
  assert.equal(V.clampZoom(-2), 1);
  assert.equal(V.clampZoom(undefined), 1);
});

/* ============================================================
   線色
   ============================================================ */

test('VIEW-13 深色背景配亮線、淺色背景配暗線', function () {
  assert.equal(V.gridPalette('#101014').colour, 0xffffff, '預設深色背景要用淺色格線');
  assert.equal(V.gridPalette('checker').colour, 0xffffff, '棋盤格是兩種深灰');
  assert.equal(V.gridPalette('#e8e8e8').colour, 0x000000,
    '淺色背景上的白線等於沒畫——背景是隨手切換的，不能有一種背景讓格線消失');
});

test('VIEW-14 格線一律很淡：軸線最明顯，但也遠不到會蓋掉特效的程度', function () {
  const p = V.gridPalette('#101014');
  assert.ok(p.minorAlpha < p.majorAlpha && p.majorAlpha < p.axisAlpha, '三層要分得出來');
  assert.ok(p.axisAlpha <= 0.4, '軸線太實會被誤認為特效的一部分');
});

/* ============================================================
   接線結構
   ============================================================ */

test('VIEW-15 格線畫在背景與特效之間', function () {
  /* 畫在特效上面的話，線會橫過火焰，看起來像素材裂了。
     順序就是唯一的保證，所以它由 addChild 的先後決定。 */
  const src = stripped();
  const boot = src.slice(src.indexOf('app.stage.addChild(bgSolid)'));
  const gridAt = boot.indexOf('app.stage.addChild(grid.gfx)');
  const rootAt = boot.indexOf('app.stage.addChild(root)');
  assert.ok(gridAt >= 0 && rootAt >= 0);
  assert.ok(gridAt < rootAt, '格線要比 stageRoot 早進 stage');
});

test('VIEW-16 格線不掛在 stageRoot 底下，所以線寬不隨縮放變粗', function () {
  const src = stripped();
  const fn = src.slice(src.indexOf('function strokeGridLines'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/width:\s*1\b/.test(body), '線寬固定 1px');
  assert.ok(src.indexOf('stageRoot.addChild(grid') < 0, '格線不得掛進 stageRoot');
});

test('VIEW-17 縮放與格線都不進 preset，也不進 Undo 歷史', function () {
  /* 它們是「怎麼看」，與背景色同一類。進了歷史，Ctrl+Z 會變成
     一件無法預期的事；進了 preset，換個角度看就變成一筆 git diff。 */
  const src = stripped();
  const snap = src.slice(src.indexOf('function historySnapshot'));
  const body = snap.slice(0, snap.indexOf('\n  }'));
  ['zoom', 'gridOn', 'previewLoop'].forEach(function (bad) {
    assert.ok(body.indexOf(bad) < 0, '歷史快照不該包含 ' + bad);
  });
  const zoomFn = src.slice(src.indexOf('function applyZoom'));
  assert.ok(zoomFn.slice(0, zoomFn.indexOf('\n  }')).indexOf('state.preset') < 0,
    '縮放不得寫進 preset');
});

test('VIEW-18 滾輪必須 preventDefault，否則整頁會跟著捲走', function () {
  const src = stripped();
  const fn = src.slice(src.indexOf('function wirePreviewView'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/addEventListener\('wheel'/.test(body));
  assert.ok(/preventDefault/.test(body), '要擋掉預設捲動');
  assert.ok(/passive:\s*false/.test(body), 'passive 監聽者的 preventDefault 是無效的');
});

test('VIEW-19 Gizmo 的框跟著 stageRoot 一起縮放', function () {
  /* 少同步 scale 的話，放大之後框會停在 100% 的大小，看起來像框跑掉了。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function drawGizmo'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/c\.scale\.set\(/.test(body), 'overlay 要跟著設 scale');
  assert.ok(/scale\.x\s*!==\s*state\.stageRoot\.scale\.x/.test(body),
    '要偵測 scale 變了才重畫，而不是每幀都設');
});

/* ============================================================
   預覽循環
   ============================================================ */

test('VIEW-20 預覽循環不碰 preset.loop', function () {
  /* preset.loop 是出貨資料（遊戲裡這個特效會不會自己重複）。
     兩者共用一個勾選框的話，「想重看一次爆點」就會改到出貨資料。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function tickPreviewLoop'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(body.indexOf('preset.loop') < 0, '預覽循環不得讀寫 preset.loop');
  assert.ok(/timeOf/.test(body),
    '要靠 Core 說「這個 effect 已經收掉了」來判斷播完，' +
    '自己用 duration 算會把拖尾粒子切掉');
});

test('VIEW-21 preset.loop 仍然編輯得到（移到 Inspector，不是被刪掉）', function () {
  const src = stripped();
  const fn = src.slice(src.indexOf('function renderPresetSection'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/state\.preset\.loop\s*=/.test(body), 'Inspector 要能寫回 preset.loop');
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  assert.ok(html.indexOf('id="chk-preview-loop"') >= 0);
  assert.ok(html.indexOf('id="chk-loop"') < 0,
    '工具列那一格已經改成純預覽，舊 id 不該還留著');
});

/* ============================================================
   群組 Inspector
   ============================================================ */

test('VIEW-22 群組的數值變形走與拖曳同一條路', function () {
  /* 自己另外寫一套「用數字縮放」的話，粒子的 startScale／speed／spawn／gravity
     這些只有群組變形才會動到的欄位一定會漏掉，於是用拖的和用打的結果不一樣。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function applyGroupDelta'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/G\.groupSnapshot/.test(body));
  assert.ok(/G\.applyGroupTransform/.test(body));
  assert.ok(/G\.writeGroupTransform/.test(body));
});

test('VIEW-23 群組 Inspector 的絕對值欄位由 groupBounds 即時算出來', function () {
  /* 群組沒有自己的 transform（變形當場攤到子圖層），所以「現在多大」
     只能現算。把一個「原始大小」記進 layout 的話，只要有人單獨改過其中
     一層，那個數字就開始說謊，而且不會有任何跡象。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function renderGroupSection'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/G\.groupBounds\(/.test(body), '寬高與中心要現算');
  assert.ok(/PX_PER_METRE/.test(body), '要一併標出米數，與格線同一把尺');
  const layout = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/layout-schema.js'), 'utf8');
  assert.ok(!/baselineScale|originalSize/.test(layout),
    'layout 不該為了顯示倍率而記一個會過期的基準值');
});
