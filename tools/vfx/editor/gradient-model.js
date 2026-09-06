'use strict';
/* ============================================================
   gradient-model.js — 顏色曲線（tintOverLife）的純資料運算

   與 curve-model.js 同一個分工：所有「用眼睛看不出對錯」的事——排序、夾限、
   內插、十六進位進出、canonical 形式——全部留在這裡，編輯元件一行都不算。

   為什麼不共用 curve-model：值不是數字。排序與時間夾限確實一樣，但內插要逐分量
   做、canonical 形式是字串、預設值是顏色而不是數值。硬塞進同一支只會讓兩邊
   都長出 typeof 判斷，而曲線編輯器的熱路徑（拖曳時每幀重畫）最不需要那個。

   內插**不自己寫**，直接呼叫 js/vfx-core.js 的 sampleColorCurve：色帶是 Editor
   畫的、實際播放是 Core 跑的，兩邊各寫一份就一定會在某次改動後分家（差一階
   在畫面上看不出來，但那正是「我在 Editor 調好的顏色進遊戲就不對」的來源）。
   用測試比對兩份實作只能事後發現，共用同一支函式則是結構上不可能分家。
   ============================================================ */

var VFXGradientModel = (function () {
  /* 瀏覽器裡 vfx-core.js 已經在 index.html 先載入；Node 裡（測試）用 require。 */
  var Core = (typeof VFXCore !== 'undefined') ? VFXCore
    : (typeof require === 'function' ? require('../../../js/vfx-core.js') : null);

  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var DEFAULT_COLOR = '#ffffff';

  /* ---------------- 顏色進出 ---------------- */

  function isColor(v) { return typeof v === 'string' && COLOR_RE.test(v); }

  function toRgb(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function toHex(r, g, b) {
    var n = (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
    return '#' + ('000000' + n.toString(16)).slice(-6);
  }

  function clamp255(v) {
    v = Math.round(v);
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  function intToHex(n) { return '#' + ('000000' + (n >>> 0).toString(16)).slice(-6); }

  /* ---------------- 取樣（委派 Core） ----------------

     Core 吃的是已解析成整數的曲線。色帶是逐像素畫的（一次重畫幾百次呼叫，
     拖曳時每幀都要重畫），每次都重新解析十六進位就是白花的成本——
     用「陣列身分」當快取鍵：model 的每個操作都回傳新陣列，不就地改，
     所以身分沒變就代表內容沒變。 */
  var cacheStops = null, cacheCurve = null;
  function intCurveOf(stops) {
    if (stops !== cacheStops) {
      cacheStops = stops;
      cacheCurve = Core.toColorCurve(stops);
    }
    return cacheCurve;
  }

  /* stops 是 [[t, '#rrggbb'], …]，已排序。回傳該時間點的顏色。 */
  function colorAt(stops, t) {
    if (!stops || !stops.length) return DEFAULT_COLOR;
    return intToHex(Core.sampleColorCurve(intCurveOf(stops), t));
  }

  /* 兩點之間的內插。走 colorAt 而不是自己算，理由同上：只有一份實作。 */
  function lerp(a, b, k) {
    return colorAt([[0, a], [1, b]], k);
  }

  /* ---------------- preset ↔ 編輯狀態 ---------------- */

  /* preset 的值（undefined／'#rrggbb'／[[t,'#rrggbb'],…]）→ 編輯用的 stop 陣列。
     null 代表「沒有這條曲線」，與 curve-model.toPoints 同一個約定。 */
  function toStops(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return isColor(value) ? [[0, value]] : null;
    if (!Array.isArray(value) || !value.length) return null;
    return value.map(function (p) { return [p[0], String(p[1])]; });
  }

  /* 回存。單點且時間在 0 的收斂成純字串——Editor 內部用陣列是實作細節，
     不該讓每份 preset 都多出 [[0,"#ffffff"]] 這種噪音。 */
  function toValue(stops) {
    if (!stops || !stops.length) return undefined;
    if (stops.length === 1 && stops[0][0] === 0) return stops[0][1];
    return stops.map(function (p) { return [p[0], p[1]]; });
  }

  /* ---------------- 夾限與四捨五入 ---------------- */

  function clampTime(t) {
    if (!isFinite(t)) return 0;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  /* 與 curve-model.roundTime 同一個精度：兩種曲線存進同一份 preset，
     時間欄位的噪音程度不該因為型別不同而不一樣。 */
  function roundTime(t) { return Math.round(t * 10000) / 10000; }

  function normalizeColor(c) {
    if (!isColor(c)) return DEFAULT_COLOR;
    return c.toLowerCase();
  }

  /* ---------------- 編輯操作 ----------------
     每一支都回傳新陣列，不就地改：Editor 的歷史（undo）靠的是前後兩份快照，
     就地改會讓「上一步」跟「這一步」指到同一個物件。 */

  /* 排序並回報指定索引搬到哪裡去了（拖曳中越過鄰居時要跟著換選取）。 */
  function sortKeepingIndex(stops, index) {
    var tagged = stops.map(function (p, i) { return { p: p, i: i }; });
    tagged.sort(function (a, b) {
      if (a.p[0] !== b.p[0]) return a.p[0] - b.p[0];
      return a.i - b.i;                       // 同一時間點維持原順序，拖曳才不會跳
    });
    var moved = -1;
    var out = tagged.map(function (e, k) {
      if (e.i === index) moved = k;
      return e.p;
    });
    return { stops: out, index: moved };
  }

  function addStop(stops, t, color) {
    var list = (stops || []).slice();
    list.push([roundTime(clampTime(t)), normalizeColor(color)]);
    var r = sortKeepingIndex(list, list.length - 1);
    return { stops: r.stops, index: r.index };
  }

  function moveStop(stops, index, t) {
    if (!stops || index < 0 || index >= stops.length) return { stops: stops, index: index };
    var list = stops.map(function (p, i) {
      return i === index ? [roundTime(clampTime(t)), p[1]] : [p[0], p[1]];
    });
    return sortKeepingIndex(list, index);
  }

  function setColor(stops, index, color) {
    if (!stops || index < 0 || index >= stops.length) return stops;
    return stops.map(function (p, i) {
      return i === index ? [p[0], normalizeColor(color)] : [p[0], p[1]];
    });
  }

  /* 最後一個色標不能刪：空陣列在 preset 裡是非法值（Core 會擋），
     而「沒有曲線」要用 clear（整個欄位移除）表達，不是留一個空陣列。 */
  function removeStop(stops, index) {
    if (!stops || stops.length <= 1 || index < 0 || index >= stops.length) {
      return { stops: stops, index: index };
    }
    var list = stops.slice();
    list.splice(index, 1);
    return { stops: list, index: Math.min(index, list.length - 1) };
  }

  /* 「啟用」時的起始狀態：白 → 白。兩點而不是一點，是因為使用者按下啟用
     就是想做漸層；給一點的話第一件事永遠是再加一點。白 → 白對畫面沒有影響
     （相乘語意下等於沒變），所以啟用的當下不會突然改變外觀。 */
  function resetStops() {
    return [[0, DEFAULT_COLOR], [1, DEFAULT_COLOR]];
  }

  function formatTime(t) { return Math.round(t * 100) + '%'; }

  return {
    COLOR_RE: COLOR_RE,
    DEFAULT_COLOR: DEFAULT_COLOR,
    isColor: isColor,
    toRgb: toRgb,
    toHex: toHex,
    lerp: lerp,
    colorAt: colorAt,
    intToHex: intToHex,
    toStops: toStops,
    toValue: toValue,
    clampTime: clampTime,
    roundTime: roundTime,
    normalizeColor: normalizeColor,
    sortKeepingIndex: sortKeepingIndex,
    addStop: addStop,
    moveStop: moveStop,
    setColor: setColor,
    removeStop: removeStop,
    resetStops: resetStops,
    formatTime: formatTime
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXGradientModel;
}
