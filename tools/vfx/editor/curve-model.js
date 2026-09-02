'use strict';
/* ============================================================
   curve-model.js — Over-Life 曲線的純資料運算

   為什麼要獨立成模組：曲線編輯真正容易寫錯的地方全都在資料層——
   拖曳後的重新排序、時間夾在 0..1、值的下限、點數上限、
   以及「顯示單位」與「儲存單位」的換算（旋轉在畫面上是度、存檔是弧度）。
   這些用眼睛看畫面看不出對錯，抽成純函式才驗得到。
   curve-editor.js 只負責畫圖與滑鼠事件，一行運算都不做。

   資料格式沿用 Core 既有的 canonical 形式，**沒有第二套格式**：

     undefined            這個屬性沒有曲線
     <number>             整段生命週期都是這個值
     [[t,v],[t,v],…]      線性插值，t ∈ 0..1 且遞增

   取樣一律呼叫 VFXCore.sampleCurve，不在這裡重寫一份插值。
   ============================================================ */

var VFXCurveModel = (function () {

  /* Core 的 HARD_LIMITS.maxCurvePoints。這裡不 import Core 的常數（瀏覽器端是
     全域、Node 端是 require，兩邊拿法不同），改成由呼叫端在 policy 裡覆寫。 */
  var DEFAULT_MAX_POINTS = 16;

  /* 取樣一律用 Core 的 sampleCurve。插值規則只能有一份——對照模式的游標讀數
     若和實際播出來的值差一點點，這個功能就失去意義了。
     兩種載入方式都試，是因為同一個檔案要同時給瀏覽器與 Node 測試用。 */
  var coreSample = (function () {
    if (typeof VFXCore !== 'undefined' && VFXCore && VFXCore.sampleCurve) return VFXCore.sampleCurve;
    if (typeof require === 'function') {
      try { return require('../../../js/vfx-core.js').sampleCurve; } catch (e) { /* 瀏覽器端沒有 */ }
    }
    return null;
  })();

  /* 曲線在某個時間點的值。超出點的範圍時取端點值——那是 Core 的行為，
     不是這裡另外定的規則。 */
  function valueAt(points, t) {
    if (!points || !points.length) return null;
    if (!coreSample) throw new Error('curve-model 找不到 VFXCore.sampleCurve');
    return coreSample(points, t);
  }

  /* ---------------- 單位換算 ----------------
     Core 的 rotationOverLife 是弧度：它會直接加進 transform.rotation，
     而 Pixi 的 node.rotation 就是弧度。但人工編輯時沒有人想輸入 12.56637，
     所以 Editor 一律顯示度數，讀檔時轉成度、存檔時轉回弧度。
     換算只在這裡發生，Preset 裡永遠是弧度。 */
  var RAD2DEG = 180 / Math.PI;
  var DEG2RAD = Math.PI / 180;
  function radToDeg(v) { return v * RAD2DEG; }
  function degToRad(v) { return v * DEG2RAD; }

  /* ---------------- policy ----------------
     每個屬性的規則不同，全部由呼叫端注入，模組本身不認識 alpha／scale／rotation。
     這是「generic property curve component」的具體作法：
     元件不知道自己在編什麼，只知道值的上下限與單位怎麼換。

       min / max     值的夾限，null 代表該方向不夾
       baseline      Y 軸至少要顯示到的範圍 [lo, hi]。
                     **單位是儲存值不是顯示值**——它會直接跟曲線上的數字比大小。
                     旋轉要寫 ±π/36 這種弧度，寫 ±5 會被當成 5 弧度（286 度）。
       toDisplay     儲存值 → 顯示值（旋轉：弧度→度）
       fromDisplay   顯示值 → 儲存值
       unit          顯示單位後綴
       decimals      顯示小數位
       defaultValue  Reset 後的常數值
       maxPoints     點數上限
       fixedRange    Y 軸固定成 [min, max]，不隨資料放大。
                     旋轉用它把上下限釘在 ±360°：軸會跟著拖曳一直長高的話，
                     永遠拉不到「盡頭」，也就看不出自己轉了幾分之幾圈。 */
  function policyDefaults(p) {
    var o = p || {};
    return {
      min: o.min === undefined ? null : o.min,
      max: o.max === undefined ? null : o.max,
      baseline: o.baseline || [0, 1],
      toDisplay: o.toDisplay || function (v) { return v; },
      fromDisplay: o.fromDisplay || function (v) { return v; },
      unit: o.unit || '',
      decimals: o.decimals === undefined ? 3 : o.decimals,
      defaultValue: o.defaultValue === undefined ? 1 : o.defaultValue,
      maxPoints: o.maxPoints || DEFAULT_MAX_POINTS,
      fixedRange: o.fixedRange === true
    };
  }

  /* ---------------- 正規化 ----------------
     把三種輸入形式統一成點陣列，方便編輯。
     常數會展開成單點——不是兩點：單點在 sampleCurve 底下同樣是整段常數
     （t 小於等於第一點取第一點、大於等於最後一點取最後一點），
     而且使用者一拖就自然變成真正的曲線，不必先刪掉多餘的端點。 */
  function toPoints(curve) {
    if (curve === undefined || curve === null) return null;
    if (typeof curve === 'number') return [[0, curve]];
    if (!Array.isArray(curve) || !curve.length) return null;
    return curve.map(function (p) { return [p[0], p[1]]; });
  }

  /* 回存。單點且時間在 0 的曲線收斂成純數字——canonical 形式該是什麼就是什麼，
     不要因為 Editor 內部用陣列，就讓每個 preset 都多出 [[0,1]] 這種噪音。 */
  function toCurve(points) {
    if (!points || !points.length) return undefined;
    if (points.length === 1 && points[0][0] === 0) return points[0][1];
    return points.map(function (p) { return [p[0], p[1]]; });
  }

  /* ---------------- 夾限 ---------------- */
  function clampTime(t) {
    if (!isFinite(t)) return 0;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  }

  function clampValue(v, policy) {
    var p = policyDefaults(policy);
    if (!isFinite(v)) return p.min === null ? 0 : p.min;
    if (p.min !== null && v < p.min) return p.min;
    if (p.max !== null && v > p.max) return p.max;
    return v;
  }

  /* 浮點誤差會讓 0.1+0.2 這種時間值變成 0.30000000000000004，
     存進 preset 就是一串噪音，而且兩次「同樣的拖曳」會得到不同 bytes。
     時間統一取到小數第 4 位（0.01% 的生命週期，遠比人眼與滑鼠精度細）。 */
  function roundTime(t) { return Math.round(t * 10000) / 10000; }
  function roundValue(v) { return Math.round(v * 1000000) / 1000000; }

  /* ---------------- 排序 ----------------
     拖曳可以把一個點拖過它的鄰居，這時必須重新排序，否則存出去的曲線
     時間不遞增，Core 的 validateCurve 會直接判定不合法。
     排序後原本那個點的索引會變，所以回傳新索引讓呼叫端繼續跟著它拖。 */
  function sortKeepingIndex(points, index) {
    var tagged = points.map(function (p, i) { return { p: p, i: i }; });
    tagged.sort(function (a, b) {
      if (a.p[0] !== b.p[0]) return a.p[0] - b.p[0];
      return a.i - b.i;                       // 同時間維持原相對順序，拖曳才不會跳動
    });
    var out = [], at = index;
    for (var k = 0; k < tagged.length; k++) {
      out.push(tagged[k].p);
      if (tagged[k].i === index) at = k;
    }
    return { points: out, index: at };
  }

  /* ---------------- 編輯操作 ----------------
     全部回傳新陣列，不就地修改輸入：Editor 那邊要靠「拿到新值才寫回 preset」
     來決定何時算改過，就地改會讓 dirty 判斷失準。 */

  function addPoint(points, t, v, policy) {
    var p = policyDefaults(policy);
    var list = (points || []).map(function (q) { return [q[0], q[1]]; });
    if (list.length >= p.maxPoints) return { points: list, index: -1, rejected: 'maxPoints' };
    list.push([roundTime(clampTime(t)), roundValue(clampValue(v, p))]);
    return sortKeepingIndex(list, list.length - 1);
  }

  function movePoint(points, index, t, v, policy) {
    var p = policyDefaults(policy);
    var list = (points || []).map(function (q) { return [q[0], q[1]]; });
    if (index < 0 || index >= list.length) return { points: list, index: index };
    list[index] = [roundTime(clampTime(t)), roundValue(clampValue(v, p))];
    return sortKeepingIndex(list, index);
  }

  /* 刪到剩 0 點會讓曲線變成 undefined（等於沒有這條曲線），那是合理的終點，
     但要由呼叫端明確決定，所以這裡照刪，不自己攔。 */
  function removePoint(points, index) {
    var list = (points || []).map(function (q) { return [q[0], q[1]]; });
    if (index < 0 || index >= list.length) return { points: list, index: -1 };
    list.splice(index, 1);
    return { points: list, index: Math.min(index, list.length - 1) };
  }

  function resetPoints(policy) {
    var p = policyDefaults(policy);
    return [[0, p.defaultValue]];
  }

  /* ---------------- Y 軸範圍 ----------------
     不同屬性的合理範圍差很多：透明度多半落在 0..1 附近，
     縮放常常要到 2、4 甚至更高，旋轉可能是 ±1440 度。
     所以取「baseline 與實際資料的聯集」再留一點邊界，
     既不會把 0..1 的曲線畫成一條貼著底的線，也不會把 4 倍的縮放切掉。 */
  function valueRange(points, policy) {
    var p = policyDefaults(policy);
    /* 固定範圍：軸就是允許的範圍本身，不看資料。
       超出範圍的既有點會被畫到框外——那是刻意的，讓人看得出「這條曲線有東西
       在界外」，而不是靜靜地把檔案改掉。一拖它就會落回範圍內。 */
    if (p.fixedRange && p.min !== null && p.max !== null) {
      return { lo: p.min, hi: p.max };
    }
    var lo = p.baseline[0], hi = p.baseline[1];
    (points || []).forEach(function (q) {
      if (q[1] < lo) lo = q[1];
      if (q[1] > hi) hi = q[1];
    });
    if (hi - lo < 1e-6) { hi = lo + 1; }
    var pad = (hi - lo) * 0.1;
    lo -= pad; hi += pad;
    /* 有下限的屬性（透明度、縮放都不得為負）不要把 Y 軸畫到負的去，
       否則畫面上有一半是永遠碰不到的區域。 */
    if (p.min !== null && lo < p.min) lo = p.min;
    return { lo: lo, hi: hi };
  }

  /* 有沒有點落在允許範圍之外。只在固定範圍的屬性上有意義——
     其餘屬性的軸會自己放大，本來就不會有界外的東西。 */
  function outOfRangeCount(points, policy) {
    var p = policyDefaults(policy);
    if (!points || !p.fixedRange) return 0;
    return points.filter(function (q) {
      return (p.min !== null && q[1] < p.min) || (p.max !== null && q[1] > p.max);
    }).length;
  }

  /* ---------------- 顯示字串 ---------------- */
  function formatValue(v, policy) {
    var p = policyDefaults(policy);
    var d = p.toDisplay(v);
    var text = Math.abs(d) >= 1000 ? d.toFixed(0) : d.toFixed(p.decimals);
    /* 去掉尾巴的零：1.350 → 1.35、2.000 → 2 */
    if (text.indexOf('.') >= 0) text = text.replace(/0+$/, '').replace(/\.$/, '');
    return text + p.unit;
  }

  function formatTime(t) { return Math.round(t * 100) + '%'; }

  return {
    DEFAULT_MAX_POINTS: DEFAULT_MAX_POINTS,
    radToDeg: radToDeg, degToRad: degToRad,
    policyDefaults: policyDefaults,
    toPoints: toPoints, toCurve: toCurve,
    clampTime: clampTime, clampValue: clampValue,
    roundTime: roundTime, roundValue: roundValue,
    sortKeepingIndex: sortKeepingIndex,
    addPoint: addPoint, movePoint: movePoint, removePoint: removePoint,
    resetPoints: resetPoints,
    valueRange: valueRange, valueAt: valueAt,
    outOfRangeCount: outOfRangeCount,
    formatValue: formatValue, formatTime: formatTime
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXCurveModel;
}
