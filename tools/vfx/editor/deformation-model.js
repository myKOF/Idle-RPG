'use strict';
/* ============================================================
   deformation-model.js — 勾「啟用整體變形」時，替這一份特效量出一組會隨機變形的參數

   2026-10-21 使用者要求：勾下去就該是「每一道都長得不一樣」的設定，
   而不是一個一個欄位去調。舊的預設（x 軸、0～200、振幅 0、不鏡射）勾了等於沒勾：

     • 振幅 0、不鏡射：隨機相位與鏡射機率根本沒有東西可以作用
     • 範圍沒有對到素材：變形只在 start～end 之間有包絡（兩端為 0），
       素材落在範圍外的那一段完全不會彎（bolt-thunderstrike-bluewhite 的主幹
       從 -543 畫到 0，範圍卻是 -330～0，上面四成怎麼調都是直的）

   ---- 怎麼量 ----

   變形是整份特效座標上的**一個場**：同一個座標永遠位移一樣多，拼接的分段、
   貼在主幹上的分岔、光暈因此一起彎，不會脫開。所以建議值就以整份特效為準：

     圖層   Core 驗證會收的全部 sprite（與 validateDeformation 同一套條件，
            否則建議值一套上去就報錯）
     軸     這些圖層聯集外框較長的那一邊（落雷是 y、橫向的電弧是 x）
     範圍   聯集外框沿軸的兩端——包絡在兩端為 0，所以頂端的雲／球與地面的落點不會被甩開
     中心線 各圖層橫向中心，以「沿軸長度」加權平均。鏡射與寬度變化都繞著它做，
            沒對到主幹的話，鏡射會把整道閃電甩到旁邊去
     振幅   範圍長度的 AMPLITUDE_RATIO（Core 上限是 15%）

   不用「方框細長＝筆畫」去挑主幹：spark 系素材是正方形貼圖、墨線畫在中間，
   方框的長邊跟閃電的方向沒有關係（紫色落雷的分段方框都是橫的）。

   ---- 為什麼彎曲強度下限留在 1 ----

   強度 < 1 會依貼圖自己的墨線把圖「拉直」並往中心線收。單一筆畫的閃電很好看，
   但離中心線有一段距離的圖層（分岔、旁邊另一道）也會被一起收進中心線。
   預設要對每一種組法都安全，所以只用振幅＋隨機相位＋鏡射＋寬度變化，
   強度留給作者自己開（Inspector 的提示裡有寫建議值）。

   純計算，沒有 DOM、沒有 Pixi：素材尺寸與父層座標由呼叫端傳入，
   tests/vfx-editor-deformation.test.cjs 在 node 裡直接驗。
   ============================================================ */

var VFXDeformationModel = (function () {
  var G = typeof VFXGizmoModel !== 'undefined' ? VFXGizmoModel
    : (typeof require === 'function' ? require('./gizmo-model.js') : null);

  var AMPLITUDE_RATIO = 0.08;      // 彎曲振幅＝範圍長度 × 這個比例
  var WIDTH_JITTER = 0.08;         // 每道寬度隨機 ±8%（Core 上限 15%）
  var MIRROR_CHANCE = 0.5;         // 一半機率左右翻

  function round1(v) { return Math.round(v * 10) / 10; }

  /* 與 Core 的 validateDeformation 同一套：不符合的圖層放進 layers 會直接驗證失敗。 */
  function eligibleLayers(preset) {
    var layers = (preset && preset.layers) || [];
    var allFlat = layers.every(function (l) { return !l || l.type === 'empty' || l.perspective === false; });
    return layers.filter(function (l) {
      if (!l || l.type !== 'sprite' || l.enabled === false || l.radiusProfile) return false;
      if (l.followDirection === false) return false;
      if (!allFlat && (l.perspective === false || l.cameraDepth === false)) return false;
      return true;
    });
  }

  /* 一層在特效座標裡的軸對齊外框：四角先繞自己的 pivot 轉、再經過父層矩陣。
     不用 G.groupBounds：那是給 Gizmo 抓的框，太小的圖層會被撐到 MIN_BOX，
     地面閃光這種扁圖層會把範圍多算出一截。 */
  function boxOf(layer, sizeOf, spaceOf) {
    var b = G.baseBounds(layer, sizeOf(layer));
    if (!b) return null;
    var space = spaceOf ? spaceOf(layer) : undefined;
    var c = Math.cos(b.rotation || 0), s = Math.sin(b.rotation || 0);
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].forEach(function (q) {
      var dx = q[0] - b.pivot.x, dy = q[1] - b.pivot.y;
      var p = G.mapPoint(space, { x: b.pivot.x + dx * c - dy * s, y: b.pivot.y + dx * s + dy * c });
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /* 主入口。回傳一份可以直接寫進 preset.deformation 的物件；沒有可變形的圖層時回傳 null。
     sizeOf(layer) → { width, height }（與 Gizmo 同一個）；spaceOf(layer) → 父層矩陣或 undefined。 */
  function suggest(preset, sizeOf, spaceOf) {
    if (!G) throw new Error('deformation-model 需要 gizmo-model');
    var layers = eligibleLayers(preset);
    var boxes = layers.map(function (l) { return boxOf(l, sizeOf, spaceOf); });
    var picked = layers.filter(function (l, i) { return !!boxes[i]; });
    boxes = boxes.filter(Boolean);
    if (!picked.length) return null;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    boxes.forEach(function (b) {
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.w);
      minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y + b.h);
    });
    var axis = (maxY - minY) >= (maxX - minX) ? 'y' : 'x';
    var start = Math.floor(axis === 'y' ? minY : minX);
    var end = Math.ceil(axis === 'y' ? maxY : maxX);
    if (end - start < 1) end = start + 1;           // Core 要求 end > start
    var span = end - start;

    var across = 0, weight = 0;
    boxes.forEach(function (b) {
      var w = axis === 'y' ? b.h : b.w;
      across += (axis === 'y' ? b.x + b.w / 2 : b.y + b.h / 2) * w;
      weight += w;
    });

    return {
      axis: axis,
      start: start,
      end: end,
      pivot: round1(weight > 0 ? across / weight : 0),
      amplitude: round1(span * AMPLITUDE_RATIO),
      widthJitter: WIDTH_JITTER,
      mirror: true,
      mirrorChance: MIRROR_CHANCE,
      layers: picked.map(function (l) { return l.id; })
    };
  }

  return {
    AMPLITUDE_RATIO: AMPLITUDE_RATIO,
    WIDTH_JITTER: WIDTH_JITTER,
    MIRROR_CHANCE: MIRROR_CHANCE,
    eligibleLayers: eligibleLayers,
    suggest: suggest
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = VFXDeformationModel;
