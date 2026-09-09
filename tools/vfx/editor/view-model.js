'use strict';
/* ============================================================
   view-model.js — 預覽區的「怎麼看」：縮放倍率與座標格線

   純計算，沒有 Pixi、沒有 DOM。格線間距、線的取捨與縮放上下限因此可以在
   node 裡直接驗證（tests/vfx-editor-view.test.cjs），不必開瀏覽器。

   ---- 比例尺不是這裡發明的 ----
   模擬層以「系統距離單位」記距離，js/battlefield.js 定死
     BF_SYSTEM_UNITS_PER_METER = 10
   而 js/battle-renderer.js 的 projectileArcPx() 把「米 × 10」直接當螢幕像素用，
   所以遊戲畫面上 1 米就是 10px。Preset 的座標空間與螢幕像素 1:1
   （vfx-runtime.js 的名目半徑 100px 對應事件的 area.r，而 area.r 就是系統單位），
   於是編輯器裡量到的 1 米也是 10px——格線量的距離與遊戲裡量到的是同一個。

   這兩個數字一旦分家，格線不會報錯，只會安靜地量出錯的距離，而「特效比範圍大
   一圈」這種問題正是靠它判斷的。所以 tests 有一條專門比對本檔與 battlefield.js。

   一大格 6 米是設計指定的刻度。大格再切成 1 米的小格，「大格」才有對照物，
   也才讀得出半格是 3 米。
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VFXViewModel = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var PX_PER_METRE = 10;        // 見檔頭：與 BF_SYSTEM_UNITS_PER_METER 同一個值
  var METRES_PER_CELL = 6;      // 一大格
  var METRES_PER_MINOR = 1;     // 一小格

  /* 螢幕上窄於這個間距就整組不畫。線距只剩幾個像素時，一片線讀不出格數，
     只會變成一層灰霧蓋在特效上——那時候格線是干擾，不是工具。 */
  var MIN_MINOR_PX = 6;
  var MIN_MAJOR_PX = 10;

  var ZOOM_MIN = 0.25, ZOOM_MAX = 8;

  /* 滾一格（多數瀏覽器 deltaY≈100）約 1.16 倍。用指數而不是固定加減：
     縮放是乘法的，固定加減會讓放大很鈍、縮小兩下就撞到下限。 */
  var WHEEL_EXPONENT = 0.0015;
  /* 一次事件的位移量上限。某些觸控板與滑鼠驅動會送出上千的 deltaY，
     不夾住的話輕輕一撥就跳到上下限，看起來像縮放壞掉。 */
  var WHEEL_MAX_DELTA = 400;
  /* deltaMode：0=像素、1=行、2=頁。行與頁的數字比像素小兩個數量級，
     不換算的話同一支滾輪在不同瀏覽器上會差一百倍。 */
  var DELTA_MODE_PX = [1, 16, 400];

  function clampZoom(z) {
    var v = Number(z);
    if (!isFinite(v) || v <= 0) return 1;
    return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v));
  }

  function zoomByWheel(zoom, deltaY, deltaMode) {
    var unit = DELTA_MODE_PX[deltaMode] || DELTA_MODE_PX[0];
    var d = (Number(deltaY) || 0) * unit;
    d = Math.max(-WHEEL_MAX_DELTA, Math.min(WHEEL_MAX_DELTA, d));
    return clampZoom(clampZoom(zoom) * Math.exp(-d * WHEEL_EXPONENT));
  }

  /* [0, size] 之間、且必定有一條剛好落在 origin 上的刻度位置。
     用索引乘法而不是「一路 += spacing」：後者累積浮點誤差，縮到很小的時候
     最右邊那幾條會慢慢偏掉，格線就不再與原點對齊。 */
  function gridTicks(origin, size, spacing) {
    var out = [];
    if (!(spacing > 0) || !(size > 0)) return out;
    var first = Math.ceil((0 - origin) / spacing);
    var last = Math.floor((size - origin) / spacing);
    /* 防呆：spacing 若因為某個 bug 變得極小，這裡會生出上百萬個座標並在繪製時
       把分頁鎖死。畫不出來比卡死好。 */
    if (last - first > 4096) return out;
    for (var k = first; k <= last; k++) out.push(origin + k * spacing);
    return out;
  }

  /* 同一個位置畫兩條線，alpha 會疊起來——大格與小格就分不出深淺，
     軸線也會比它該有的更亮。所以細的那一組要把重疊的位置剔掉。 */
  function notMultipleOf(origin, spacing) {
    return function (v) {
      if (!(spacing > 0)) return true;
      var k = (v - origin) / spacing;
      return Math.abs(k - Math.round(k)) > 1e-6;
    };
  }
  function notAt(origin) {
    return function (v) { return Math.abs(v - origin) > 1e-6; };
  }

  /* opts = { width, height, originX, originY, zoom }，全部是畫布上的 CSS 像素。
     originX/originY 是特效原點（0,0）在畫布上的位置。 */
  function gridSpec(opts) {
    var o = opts || {};
    var zoom = clampZoom(o.zoom);
    var w = Math.max(0, Number(o.width) || 0);
    var h = Math.max(0, Number(o.height) || 0);
    var ox = Number(o.originX) || 0;
    var oy = Number(o.originY) || 0;
    var minorPx = PX_PER_METRE * METRES_PER_MINOR * zoom;
    var majorPx = PX_PER_METRE * METRES_PER_CELL * zoom;

    var spec = {
      zoom: zoom,
      minorPx: minorPx,
      majorPx: majorPx,
      minorX: [], minorY: [],
      majorX: [], majorY: [],
      /* 軸線只在畫得到的時候才有意義；縮放後原點仍在畫布中央，
         但畫布很扁時另一軸可能落在外面。 */
      axisX: (ox >= 0 && ox <= w) ? ox : null,
      axisY: (oy >= 0 && oy <= h) ? oy : null
    };

    if (majorPx >= MIN_MAJOR_PX) {
      spec.majorX = gridTicks(ox, w, majorPx).filter(notAt(ox));
      spec.majorY = gridTicks(oy, h, majorPx).filter(notAt(oy));
    }
    if (minorPx >= MIN_MINOR_PX) {
      spec.minorX = gridTicks(ox, w, minorPx)
        .filter(notAt(ox)).filter(notMultipleOf(ox, majorPx));
      spec.minorY = gridTicks(oy, h, minorPx)
        .filter(notAt(oy)).filter(notMultipleOf(oy, majorPx));
    }
    return spec;
  }

  /* sRGB 相對亮度（Rec.709 權重）。這裡只需要回答「偏亮還是偏暗」，
     所以不做 gamma 展開。 */
  function luminanceOf(background) {
    if (background === 'checker') return 0.12;   // 棋盤格是兩種深灰
    if (typeof background !== 'string') return 0;
    var m = /^#([0-9a-f]{6})$/i.exec(background);
    if (!m) return 0;
    var n = parseInt(m[1], 16);
    return (((n >> 16) & 255) * 0.2126 +
            ((n >> 8) & 255) * 0.7152 +
            (n & 255) * 0.0722) / 255;
  }

  /* 「淺色格線」在深色背景上成立，在淺色背景上等於沒畫。而背景本來就是隨手
     切換的（bg-bar 有雪地灰藍與淺色兩張，加法混合的素材要靠它們判斷可讀性），
     所以線色跟著背景亮度翻轉：深底配亮線、亮底配暗線。兩種情況下看到的
     都是「一層淡淡的格線」，不會有一種背景讓格線整個消失。 */
  function gridPalette(background) {
    var onDark = luminanceOf(background) < 0.5;
    return {
      colour: onDark ? 0xffffff : 0x000000,
      minorAlpha: onDark ? 0.07 : 0.06,
      majorAlpha: onDark ? 0.16 : 0.13,
      axisAlpha: onDark ? 0.30 : 0.24
    };
  }

  return {
    PX_PER_METRE: PX_PER_METRE,
    METRES_PER_CELL: METRES_PER_CELL,
    METRES_PER_MINOR: METRES_PER_MINOR,
    MIN_MINOR_PX: MIN_MINOR_PX,
    MIN_MAJOR_PX: MIN_MAJOR_PX,
    ZOOM_MIN: ZOOM_MIN,
    ZOOM_MAX: ZOOM_MAX,
    clampZoom: clampZoom,
    zoomByWheel: zoomByWheel,
    gridTicks: gridTicks,
    gridSpec: gridSpec,
    luminanceOf: luminanceOf,
    gridPalette: gridPalette
  };
});
