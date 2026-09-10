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
   鏡頭平移
   ============================================================ */

test('VIEW-26 平移量存成「離中心多遠」，不是絕對座標', function () {
  /* 畫布尺寸一變（拉側欄、改視窗大小）就得重算中心。記絕對座標的話，
     每次 resize 鏡頭都會跳掉。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function recentreStage'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/renderer\.width \/ 2 \+ state\.panX/.test(body), '中心加平移量');
  assert.ok(/renderer\.height \/ 2 \+ state\.panY/.test(body));
  /* resize 之後要重算，否則鏡頭會停在舊中心 */
  assert.ok(/app\.renderer\.on\('resize', recentreStage\)/.test(src));
  assert.ok(/app\.renderer\.resize\(w, h\);\s*recentreStage\(\)/.test(src),
    'syncCanvasSize 改完尺寸也要重算');
});

test('VIEW-27 平移用中鍵與右鍵，左鍵完整留給 Gizmo', function () {
  /* 左鍵在預覽區已經是「選取與變形」。再兼一個平移就得靠修飾鍵區分，
     而修飾鍵拖到一半放開會變成在拖圖層——那是會改到資料的誤操作。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function onPreviewPointerDown'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/e\.button === 1 \|\| e\.button === 2/.test(body), '中鍵與右鍵都要能平移');
  assert.ok(/beginPan\(e\)/.test(body));
  const panAt = body.indexOf('beginPan');
  const leftAt = body.indexOf('e.button !== 0');
  assert.ok(panAt < leftAt, '平移分支要排在左鍵守門之前');

  /* 右鍵要能拖，就不能讓內容功能表跳出來——而且只擋畫布，別處的右鍵照常 */
  const wire = src.slice(src.indexOf('function wirePreviewView'));
  assert.ok(/canvas\.addEventListener\('contextmenu'/.test(wire.slice(0, 1600)),
    '畫布要擋掉 contextmenu');
});

test('VIEW-28 「回到預設視角」把縮放與平移一起歸零', function () {
  /* 只回縮放的話，按完還要自己把特效拖回中間——那不叫回到預設。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function resetCamera'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/state\.panX = 0/.test(body) && /state\.panY = 0/.test(body));
  assert.ok(/applyZoom\(1\)/.test(body));
  assert.ok(/btn\.onclick = resetCamera/.test(src), '按鈕要接到它');
});

test('VIEW-29B 檢視偏好放 cookie，因為 localStorage 是依連接埠分開的', function () {
  /* 五份工作副本共用 28361~28370，啟動器抓到哪一個埠取決於當下誰先占著。
     localStorage 依 origin 分隔而 origin 含連接埠，所以昨天在 28361 調好的
     背景色，今天開在 28363 就整份不見——使用者看到的現象是「編輯器不記得
     我的設定」。實測 28362 設好之後，28365 的 localStorage 是 null。
     cookie 不分連接埠，同一台機器共用同一份。 */
  const src = stripped();
  assert.ok(/PREFS_COOKIE/.test(src), '要有一份共用的偏好 cookie');
  ['background', 'grid', 'previewLoop'].forEach(function (key) {
    assert.ok(new RegExp("writePref\\('" + key + "'").test(src), key + ' 要寫進偏好');
    assert.ok(new RegExp("readPref\\('" + key + "'").test(src), key + ' 要從偏好讀');
  });
  /* 這三個不得再直接寫 localStorage，否則兩份儲存會分家 */
  ['BG_STORAGE_KEY', 'GRID_STORAGE_KEY', 'PREVIEW_LOOP_KEY'].forEach(function (k) {
    assert.ok(!new RegExp('localStorage\\.setItem\\(' + k).test(src),
      k + ' 不該再直接寫 localStorage');
  });
  /* 舊值要搬過來一次，不然換儲存方式等於把使用者現有的設定重設掉 */
  const fn = src.slice(src.indexOf('function readPref('));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/localStorage\.getItem\(legacyStorageKey\)/.test(body), '要讀得到舊值');
  assert.ok(/writePref\(key, legacy\)/.test(body), '而且要搬進 cookie');

  /* 圖層收合狀態刻意留在 localStorage：一份 preset 一筆，160 多份會撞上
     cookie 的 4KB 上限，而且它是短期狀態不是長期偏好。 */
  assert.ok(/localStorage\.setItem\(collapsedKey\(\)/.test(src),
    '收合狀態仍然走 localStorage');
});

test('VIEW-29 平移與縮放一樣不進 preset、不進歷史、不記 localStorage', function () {
  const src = stripped();
  const snap = src.slice(src.indexOf('function historySnapshot'));
  const body = snap.slice(0, snap.indexOf('\n  }'));
  ['panX', 'panY'].forEach(function (bad) {
    assert.ok(body.indexOf(bad) < 0, '歷史快照不該包含 ' + bad);
  });
  /* 刻意不持久化：隔天打開發現特效不在畫面中央，會以為它壞了。 */
  assert.ok(!/panX[\s\S]{0,80}localStorage/.test(src), '平移量不得寫進 localStorage');
});

/* ============================================================
   瀏覽器快捷鍵與離開保護
   ============================================================ */

test('VIEW-30 會打斷編輯的瀏覽器快捷鍵要吃掉，攔不到的不要假裝攔得到', function () {
  const src = stripped();
  const keys = src.match(/var BROWSER_SHORTCUT_KEYS = '([^']+)'/);
  assert.ok(keys, '要有一份明確的清單');
  ['o', 'p', 'f', 'g', 'd', 'u'].forEach(function (k) {
    assert.ok(keys[1].indexOf(k) >= 0, 'Ctrl+' + k + ' 應該擋（列印／開檔／尋找／書籤／原始碼）');
  });
  /* 編輯器自己要用的，或文字欄位需要的，不能被這條吃掉 */
  ['c', 'v', 'x', 'a', 'z', 'y'].forEach(function (k) {
    assert.ok(keys[1].indexOf(k) < 0, 'Ctrl+' + k + ' 不得被一律擋掉');
  });
  /* Ctrl+R 不擋：重整有時候就是想要的，未存檔的保護交給 beforeunload，
     那條連「直接關分頁」也一起顧到，不是只擋一種按法。 */
  assert.ok(keys[1].indexOf('r') < 0, 'Ctrl+R 不該擋');
  assert.ok(/Ctrl\+W／T／N/.test(editorSrc()),
    '要寫明哪些是攔不到的——列進清單只會給人「已經擋住了」的錯覺');
});

test('VIEW-31 未存檔時攔住重整與關分頁，主動離開時不重複問', function () {
  const src = stripped();
  const at = src.indexOf("addEventListener('beforeunload'");
  assert.ok(at > 0, '要有 beforeunload 守門');
  const body = src.slice(at, at + 400);
  assert.ok(/isDirty\(\)/.test(body), '只有未存檔才攔');
  assert.ok(/leavingOnPurpose/.test(body),
    '切換 preset 與關閉編輯器自己問過了，不能再讓瀏覽器問第二次');
  /* 那兩條路都要記得舉旗，否則使用者會被連問兩遍 */
  const choose = src.slice(src.indexOf('function choosePreset'));
  assert.ok(/leavingOnPurpose = true/.test(choose.slice(0, choose.indexOf('\n  }'))));
  const quit = src.slice(src.indexOf('function quitEditor'));
  assert.ok(/leavingOnPurpose = true/.test(quit.slice(0, quit.indexOf('\n  }'))));
});

/* ============================================================
   ＋ 新增素材
   ============================================================ */

test('VIEW-35 用途那一欄再長，也不能把特效名稱擠掉或蓋住', function () {
  /* 要找的東西是 id，那是這份清單的主體。用途是輔助資訊，放不下就截斷，
     完整的逐階清單在 tooltip 裡。 */
  const css = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.css'), 'utf8');
  const idRule = css.slice(css.indexOf('.combo-id {'), css.indexOf('.combo-use'));
  assert.ok(/flex:\s*0 0 auto/.test(idRule), 'id 那一欄不得收縮');
  const useRule = css.slice(css.indexOf('.combo-use {'));
  const useBody = useRule.slice(0, useRule.indexOf('}'));
  assert.ok(/flex:\s*1 1 auto/.test(useBody), '用途那欄吃掉剩下的空間');
  assert.ok(/min-width:\s*0/.test(useBody), '沒有 min-width:0 的話 flex 項目不會收縮');
  assert.ok(/text-overflow:\s*ellipsis/.test(useBody), '放不下要截斷，不是撐開');

  const src = stripped();
  const fn = src.slice(src.indexOf('function renderComboList'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/row\.all/.test(body), 'tooltip 要給逐階的完整清單');
  /* 搜尋要用完整的那一份，否則打「水龍捲」這種被收攏掉的階段名會找不到 */
  const fill = src.slice(src.indexOf('function fillPresetPicker'));
  const fillBody = fill.slice(0, fill.indexOf('\n  }'));
  assert.ok(/search:\s*\(id \+ ' ' \+ all\.join/.test(fillBody),
    '搜尋字串要用逐階的完整清單');
});

test('VIEW-32 左欄的素材瀏覽器整區刪乾淨，只留一顆「新增素材」', function () {
  /* 選材的實際流程一直是走素材選擇器（有預覽、有詳情、有篩選），
     左欄那份 300 列的清單只是把整欄佔滿，讓圖層多的 preset 展不開。 */
  const html = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/index.html'), 'utf8');
  ['asset-browser', 'asset-list', 'asset-count', 'asset-collapse', 'f-text', 'f-usage']
    .forEach(function (id) {
      assert.ok(html.indexOf('id="' + id + '"') < 0, id + ' 應該已經刪掉');
    });
  assert.ok(/id="btn-add-asset"/.test(html), '要有「新增素材」按鈕');
  /* 死掉的樣式也要一起清掉，不然下一個人會以為那些元素還在 */
  const css = fs.readFileSync(path.join(REPO, 'tools/vfx/editor/editor.css'), 'utf8');
  ['#asset-list', '.asset-row', '.count-row', '.mini-toggle'].forEach(function (sel) {
    assert.ok(css.indexOf(sel) < 0, sel + ' 的樣式應該一起刪掉');
  });
  const src = stripped();
  assert.ok(src.indexOf('renderAssetBrowser') < 0, 'renderAssetBrowser 應該已經移除');
});

test('VIEW-33 「新增素材」與「更換素材」共用同一個選擇器，只差寫到哪裡', function () {
  /* 挑素材這件事本身完全一樣，沒有理由做第二個對話框。 */
  const src = stripped();
  assert.equal((src.match(/function showPicker\(/g) || []).length, 1);
  const open = src.slice(src.indexOf('function openPickerForNewLayer'));
  const openBody = open.slice(0, open.indexOf('\n  }'));
  assert.ok(/picker\.createType/.test(openBody), '用 createType 區分兩種用途');
  assert.ok(/new-layer-type/.test(openBody),
    '型別沿用 Layers 的下拉，不要另訂一個預設值讓兩顆按鈕行為不一致');

  const apply = src.slice(src.indexOf('function applyPicker'));
  const applyBody = apply.slice(0, apply.indexOf('\n  }'));
  assert.ok(/addLayerInner\(type, value\)/.test(applyBody), '新增模式要直接長出圖層');
  /* 新增與設定素材必須是同一筆歷史：分兩筆的話 Ctrl+Z 一次只會把素材清掉、
     留下一個空圖層，看起來像沒還原乾淨。 */
  assert.ok(/edit\('新增素材圖層', function \(\) \{ addLayerInner/.test(applyBody),
    '兩件事要包在同一個 edit() 裡');
});

test('VIEW-34 新圖層要進單一根群組，不能掉到根層級', function () {
  /* 掉到根層級的話，存檔之後 LAYOUT-3 會紅，而且是編輯器自己造成的違規
     ——規則擋得住 preset-kit 產生的檔案，卻擋不住從編輯器加出來的層。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function addLayerInner'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/rootGroup\.layerIds\.push\(base\.id\)/.test(body), '要放進根群組');
  assert.ok(/groups\.length === 1/.test(body),
    '只有「剛好一個群組」才這樣做——使用者自己分好幾組時不要亂猜放哪一組');
  assert.ok(/order\.push/.test(body), '沒有根群組時仍然要退回根層級');
});

/* ============================================================
   複製 Preset 名稱
   ============================================================ */

test('VIEW-24 複製名稱兩條路都走，因為兩條都驗證不了自己', function () {
  /* execCommand 與 navigator.clipboard 在不同環境各自會「回報成功但沒寫進去」，
     而兩者都無法回頭讀回來確認（readText 要另一個權限、還會跳詢問）。
     所以不能挑一條當主要路徑，只能兩條都試。 */
  const src = stripped();
  const fn = src.slice(src.indexOf('function writeClipboard'));
  const body = fn.slice(0, fn.indexOf('\n  }'));
  assert.ok(/legacyCopy\(/.test(body), '要有 execCommand 那一條');
  assert.ok(/navigator\.clipboard/.test(body), '要有 Clipboard API 那一條');
  assert.ok(/\.catch\(/.test(body), 'Clipboard API 失敗時要退回另一條的結果，不得整個炸掉');
});

test('VIEW-25 複製的是實際載入的那一份，而且失敗要說出來', function () {
  const src = stripped();
  const copy = src.slice(src.indexOf('function copyPresetName'));
  const body = copy.slice(0, copy.indexOf('\n  }'));
  assert.ok(/state\.sourcePresetId/.test(body),
    '要複製實際載入的來源 id；state.preset.id 是可編輯欄位，可能還沒落檔');
  /* 更不能取搜尋框裡的文字：那裡放的是使用者正在打的關鍵字，而且顯示時是
     「id（用途）」，不是可以直接貼去用的檔名。 */
  assert.ok(!/preset-search/.test(body), '不得從搜尋框取值');
  const flash = src.slice(src.indexOf('function flashCopyResult'));
  assert.ok(/ok \?/.test(flash.slice(0, 400)),
    '成功與失敗要顯示不同的字——複製沒成功卻不說，使用者會貼出上一次的內容');
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
