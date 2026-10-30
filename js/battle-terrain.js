/* 戰場地形：擺件位置清單與障礙判定（2026-10-22）
   ============================================================
   野外戰場的大型擺件（岩塊、石拱、巨骨…）不只是畫面：底座夠大的會擋路，近戰普攻也不能隔著它。
   規則（使用者 10-22 定調）：
     - 底座寬 ≥ 12 米（120 單位）才算障礙，小東西不算；門檻見 BattleTerrain.setMinWidth（模擬層從參數表帶入）。
     - 佔地是橢圓。移動被擋住時沿邊緣滑開；隔著障礙不能近戰普攻；技能、投射物、範圍不受影響。
     - 封魔塔（魔王祭壇）沒有野外地形，由呼叫端不啟用。

   為什麼獨立成一支檔案：
     擺件位置原本是 js/battle-decor.js 在主執行緒現場擺的，模擬層（Worker）看不到。
     要讓「看到的岩石」與「擋路的岩石」是同一顆，位置只能由一份純函式產生，兩邊各自呼叫、結果逐位相同。
     所以這支檔案不依賴 PIXI、document、G，也不依賴 battle-decor；模擬 Worker 與主執行緒都載入它。
     battle-decor.js 的 buildChunk 只負責把這裡給的清單變成精靈。

   座標：世界座標，與模擬層（BF_PLAYER、敵人 pos）同一套；畫面 y ＝ 世界 y × 0.5（地面平面壓扁）。
   擺件的腳點 (x, y) 就是地面接觸陰影的中心，佔地橢圓以它為圓心。

   ⚠️ 下面的 CATALOG 是 battle-decor.js KITS 各組 props／LANDMARKS 前四欄（種類、權重、寬、高）的抄本，
      兩邊要一致（tests/battle-terrain.test.cjs 比對）；改了擺件表就要同步這裡。 */
var BattleTerrain = (function () {
  'use strict';

  var CHUNK_W = 560;           // 區塊寬（世界單位）；與 battle-decor 相同
  var CHUNK_H = 560;
  var STAGE_BAND = 10;         // 每 10 階段換一帶，雙數帶是地下
  var VARIANTS = 3;            // 一般擺件的圖集變體數
  var LANDMARK_VARIANTS = 2;   // 地標的圖集變體數
  var LANDMARK_CHANCE = 0.14;  // 每區塊出現地標的機率
  var MAX_EXTENT = 160;        // 任一佔地橢圓離腳點的最遠距離（查鄰近區塊用）
  var DEFAULT_MIN_W = 120;     // 預設門檻：12 米 × 每米 10 單位

  /* ============ 小工具（與 battle-decor 同一組演算法，種子才對得上） ============ */
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(x, y, z) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function range(r, a, b) { return a + (b - a) * r(); }
  function weightedPick(r, list, weightOf) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) total += weightOf(list[i]);
    var t = r() * total;
    for (i = 0; i < list.length; i++) { t -= weightOf(list[i]); if (t <= 0) return i; }
    return list.length - 1;
  }

  /* ============ 擺件目錄 ============
     每列：[種類, 權重, 圖框寬, 圖框高]。s／d＝地表／地下的一般擺件；ls／ld＝地表／地下的地標。 */
  var CATALOG = {
    desert: {
      s: [['rock',3,92,70],['cactus',2,68,114],['dryGrass',3,78,49],['pillar',1.2,70,125],['urn',1.6,56,62],['deadTree',0.8,104,140],['rubble',1.7,80,52]],
      d: [['arch',1,140,132],['pillar',2,68,132],['urn',2.2,56,64],['rock',2,90,66],['dryGrass',1,68,43],['rubble',2,86,55],['brazier',1.2,58,80]],
      ls: [['giantBones',3,260,130],['rock',2,190,130],['arch',1.5,220,190]],
      ld: [['arch',3,220,200],['giantBones',1.5,260,130]]
    },
    Icefield: {
      s: [['pine',2.2,125,178],['crystals',2,83,118],['rock',3,100,72],['shrub',3,78,52],['stump',1,78,62],['spire',1.2,73,113]],
      d: [['crystals',3.4,90,128],['spire',2,70,118],['rock',2,90,67],['pillar',1.4,74,131],['shrub',2,76,48],['brazier',1,58,80]],
      ls: [['crystals',3,150,210],['rock',2,190,140],['giantBones',1,260,130]],
      ld: [['crystals',4,160,230],['arch',1,220,190]]
    },
    mist_forest: {
      s: [['mistTree',4,172,215],['fanFern',4,86,54],['rootGate',1,148,115]],
      d: [['rootGate',3,168,128],['fanFern',3,86,54],['mistTree',1,145,180]],
      ls: [['mistTree',1,230,280]],
      ld: [['rootGate',1,250,255]]
    },
    lava_mountain: {
      s: [['lavaOutcrop',1.3,125,158],['lavaVent',1.1,110,78],['obsidian',1.5,80,107],['basalt',1.2,62,48],['magmaPool',2,142,94],['burningLog',2,126,98],['slagBoulder',1.8,102,83],['burningLog',.8,88,58],['slagBoulder',1,72,54],['magmaPool',.7,90,60]],
      d: [['lavaOutcrop',1.5,145,178],['lavaVent',1.2,112,86],['obsidian',1.6,88,122],['basalt',1,68,50],['magmaPool',2.4,150,100],['burningLog',1.5,120,94],['slagBoulder',2,112,91],['burningLog',.8,88,58],['slagBoulder',1,72,54],['magmaPool',.7,90,60]],
      ls: [['lavaOutcrop',1,220,260],['lavaVent',.6,235,165],['slagBoulder',1,190,145]],
      ld: [['lavaVent',.7,260,185],['lavaOutcrop',1,220,265],['slagBoulder',1.2,205,158]]
    },
    thunder_peak: {
      s: [['stormSpire',3.8,120,156],['fulgurite',1.5,90,106],['windPine',2.3,158,145],['stormGrass',2,60,40]],
      d: [['fulgurite',4,105,128],['stormSpire',3,132,172],['basalt',2.5,115,130]],
      ls: [['stormSpire',1,205,265],['windPine',1,230,260]],
      ld: [['stormSpire',1,210,270]]
    },
    swamp: {
      s: [['willow',1.3,138,185],['reeds',3,76,94],['fern',3,88,56],['mushrooms',2,63,60],['stump',1.5,90,70],['rock',2.1,95,70],['grass',2,64,43],['log',1.5,130,65]],
      d: [['willow',1,118,156],['mushrooms',3.2,70,75],['rock',2,96,71],['ruinWall',1.2,112,78],['reeds',1.5,74,93],['fern',2,81,52],['log',1.2,130,65]],
      ls: [['deadTree',3,220,250],['rock',1.5,180,120]],
      ld: [['deadTree',2,220,250],['arch',1.5,220,190]]
    },
    undead_mountains: {
      s: [['grave',3.2,76,100],['deadTree',1.8,113,159],['skullPile',1.5,92,64],['rock',2,97,72],['ruinWall',1.1,130,90],['dryGrass',2.8,70,46],['rubble',1.2,87,55]],
      d: [['arch',1.2,145,142],['grave',2.5,72,96],['skullPile',2,96,70],['urn',1.2,53,62],['pillar',1.6,72,133],['dryGrass',1.4,70,46],['brazier',1.4,58,80]],
      ls: [['arch',2.5,220,200],['deadTree',2,220,260],['giantBones',1.5,260,130]],
      ld: [['arch',3,220,200],['giantBones',1.5,260,130]]
    },
    god_battlefield: {
      s: [['godBlade',0.5,100,174],['warCrown',0.35,133,166],['sunRelic',0.25,114,153],['chainShard',0.8,104,104],['warRampart',1.6,155,128],['titanHelm',1.7,115,105],['charredStandard',1.8,94,150],['siegeWreck',1.7,146,107],['emberCrater',2.8,156,58],['bladeGrave',2.7,108,56]],
      d: [['godBlade',0.6,107,187],['warCrown',0.4,141,181],['sunRelic',0.3,122,165],['chainShard',0.9,111,114],['warRampart',1.7,168,144],['titanHelm',1.8,126,116],['charredStandard',1.8,98,158],['siegeWreck',1.8,153,115],['emberCrater',3,165,60],['bladeGrave',2.5,117,59]],
      ls: [['warRampart',2.4,235,220],['siegeWreck',2,225,175],['godBlade',0.8,174,292],['titanHelm',1.5,205,180]],
      ld: [['warRampart',2.4,246,235],['godBlade',1,180,300],['titanHelm',1.8,218,190],['siegeWreck',2,237,183]]
    },
    god_chaos: {
      s: [['voidGyre',0.6,133,177],['voidPrism',0.8,126,161],['voidSpindle',0.6,81,164],['voidLens',0.4,125,154],['riftAnchor',1.8,150,178],['voidArch',1.5,130,181],['orbitCubes',2.1,114,126],['astralSpine',2.3,148,60],['nullBloom',1.7,112,142],['riftObelisk',1.9,94,151]],
      d: [['voidGyre',0.7,143,190],['voidPrism',0.9,134,172],['voidSpindle',0.6,87,176],['voidLens',0.5,134,168],['riftAnchor',1.8,164,195],['voidArch',1.6,144,199],['orbitCubes',2.1,126,140],['astralSpine',2.3,158,60],['nullBloom',1.8,122,154],['riftObelisk',2,105,167]],
      ls: [['riftAnchor',2,237,278],['voidArch',1.6,215,280],['voidGyre',0.7,225,292],['orbitCubes',1.2,215,237]],
      ld: [['riftAnchor',2,248,292],['voidArch',1.6,226,295],['riftObelisk',1.5,162,280],['voidSpindle',0.5,142,278]]
    },
    god_sanctuary: {
      s: [['seraphWing',0.7,137,188],['celestialHarp',0.4,121,171],['haloDais',0.5,113,166],['lightLotus',0.8,95,86],['celestialArch',1.8,155,192],['starDial',2,116,60],['crystalFountain',1.7,125,154],['sanctumStairs',1.8,165,98],['prismGarden',2.2,107,102],['fallenCapital',2,121,58]],
      d: [['seraphWing',0.7,145,198],['celestialHarp',0.4,129,183],['haloDais',0.6,123,181],['lightLotus',0.9,103,96],['celestialArch',1.9,168,208],['starDial',2,128,60],['crystalFountain',1.8,135,166],['sanctumStairs',1.8,179,106],['prismGarden',2.2,117,112],['fallenCapital',2,132,60]],
      ls: [['celestialArch',2.4,236,292],['crystalFountain',1.8,212,255],['sanctumStairs',1.5,247,165],['seraphWing',0.8,224,290]],
      ld: [['celestialArch',2.4,245,300],['crystalFountain',1.8,225,272],['sanctumStairs',1.5,256,180],['seraphWing',0.8,234,300]]
    }
  };
  CATALOG[''] = CATALOG.desert;

  /* ============ 底座 ============
     span：底座寬 ÷ 圖框寬（樹冠、尖塔頂比底座寬很多，所以比例小）；d：橢圓縱深 ÷ 橫寬；
     legs：有穿過去的空隙的擺件（石拱、根門）用兩條腿各算一個橢圓，[腿心偏移 ÷ 寬, 腿寬 ÷ 寬]；
     ground：地面坑洞之類，永遠可以走過去。
     沒列在這裡的種類（草、灌木、小碎石…）底座很小，一律不擋。 */
  var FOOT = {
    warRampart:{span:.9,d:.35},titanHelm:{span:.85,d:.65},charredStandard:{span:.3,d:.4},siegeWreck:{span:.8,d:.55},emberCrater:{ground:true},bladeGrave:{ground:true},
    riftAnchor:{ground:true},voidArch:{ground:true},orbitCubes:{ground:true},astralSpine:{ground:true},nullBloom:{ground:true},riftObelisk:{ground:true},
    celestialArch:{span:.9,d:.5,legs:[[-.34,.26],[.34,.26]]},starDial:{span:.85,d:.6},crystalFountain:{span:.85,d:.6},sanctumStairs:{span:.9,d:.7},prismGarden:{span:.65,d:.5},fallenCapital:{span:.8,d:.4},
    godBlade:{span:.8,d:.5},warCrown:{span:.8,d:.5},sunRelic:{span:.8,d:.5},chainShard:{span:.7,d:.4},
    voidGyre:{span:.72,d:.4},voidPrism:{ground:true},voidSpindle:{ground:true},voidLens:{span:.7,d:.4},
    seraphWing:{span:.8,d:.5},celestialHarp:{span:.8,d:.5},haloDais:{span:.8,d:.5},lightLotus:{ground:true},
    rock: { span: 0.9, d: 0.7 }, basalt: { span: 0.9, d: 0.7 }, obsidian: { span: 0.7, d: 0.7 },
    lavaOutcrop: { span: 1, d: 0.7 }, crystals: { span: 0.8, d: 0.7 }, stormSpire: { span: 0.8, d: 0.7 },
    ruinWall: { span: 1, d: 0.3 }, log: { span: 0.9, d: 0.3 }, giantBones: { span: 0.8, d: 0.4 },
    arch: { span: 0.9, d: 0.6, legs: [[-0.34, 0.26], [0.34, 0.26]] },
    rootGate: { span: 0.9, d: 0.6, legs: [[-0.34, 0.26], [0.34, 0.26]] },
    lavaVent: { ground: true },
    magmaPool: { ground: true }, burningLog: { span: 0.8, d: 0.35 }, slagBoulder: { span: 0.9, d: 0.7 },
    deadTree: { span: 0.2, d: 0.8 }, pine: { span: 0.2, d: 0.8 }, willow: { span: 0.2, d: 0.8 },
    mistTree: { span: 0.2, d: 0.8 }, windPine: { span: 0.2, d: 0.8 }
  };
  var minWidth = DEFAULT_MIN_W;
  var shapeCache = {};         // 區塊清單快取（門檻改了要清掉）

  /* 這個種類、這個圖框寬，算不算障礙。依目錄的值判定（不看每顆的隨機縮放），同一種擺件不會有的擋有的不擋。 */
  function isSolid(type, w) {
    var f = FOOT[type];
    return !!f && !f.ground && w * f.span >= minWidth;
  }
  function setMinWidth(units) {
    var v = Number(units);
    if (!(v > 0) || !isFinite(v)) v = DEFAULT_MIN_W;
    if (v === minWidth) return;
    minWidth = v;
    shapeCache = {}; cacheCount = 0; lastQ = null;
  }
  function getMinWidth() { return minWidth; }

  /* 擺件的佔地橢圓：[圓心 x, 圓心 y, 半寬, 半深]，回傳陣列（石拱有兩個）。k＝這一顆的縮放。 */
  function footShapes(type, x, y, w, k) {
    var f = FOOT[type];
    if (!f || f.ground) return [];
    var full = w * k, i, out = [];
    if (f.legs) {
      for (i = 0; i < f.legs.length; i++) {
        var rxl = full * f.legs[i][1] / 2;
        out.push([x + full * f.legs[i][0], y, rxl, rxl * f.d]);
      }
      return out;
    }
    var rx = full * f.span / 2;
    return [[x, y, rx, rx * f.d]];
  }

  /* ============ 場景（地圖＋階段帶） ============ */
  function kitOf(zoneKey) { return CATALOG[zoneKey] ? zoneKey : ''; }
  function bandOf(stageNum) { return Math.max(0, Math.floor((Math.max(1, Number(stageNum) || 1) - 1) / STAGE_BAND)); }
  /* 與 battle-decor 的 atlasKey＋applyTarget 同一個算式：key＝地圖（地下加 #deep），種子＝key:band。 */
  function sceneSeed(kitKey, deep, band) { return strHash(kitKey + (deep ? '#deep' : '') + ':' + band); }

  /* ============ 區塊擺放（純函式） ============
     回傳這一區塊的擺件清單，順序與內容只由 (地圖, 地下, 種子, 區塊座標) 決定。
     項目：{ src:'p'|'L', idx（目錄列號）, type, w, h, variant, x, y, k（縮放）, flip, phase, solid, shapes }
     棄用舊亂數流：位置改由專屬的一條亂數流決定，與地面貼片（decal）的亂數分開，
     才不會因為貼片數量或圖集建好與否而改變擺件位置。 */
  function layoutChunk(kitKey, deep, seedBase, cx, cy) {
    var cat = CATALOG[kitKey] || CATALOG[''];
    var props = deep ? cat.d : cat.s;
    var lms = deep ? cat.ld : cat.ls;
    var r = mulberry(hash3(cx, cy, seedBase ^ 0x3c6ef372));
    var x0 = cx * CHUNK_W, y0 = cy * CHUNK_H;
    var items = [];
    var divine=(kitKey||'').indexOf('god_')===0,usedTypes={};
    var nProp = divine?2+Math.floor(r()*2.8):r()<.12?0:1+Math.floor(r()*2.6);
    var nSmall = divine ? 1 : 1 + Math.floor(r() * 2);
    var smallList = [];
    props.forEach(function (p, i) { if (p[3] <= 60) smallList.push(i); });
    var placed = [];   // [x, y, 橫向避讓, 縱向避讓]
    function add(src, idx, row, x, y, k, variants) {
      var shapes = isSolid(row[0], row[2]) ? footShapes(row[0], x, y, row[2], k) : null;
      usedTypes[row[0]]=true;
      items.push({
        src: src, idx: idx, type: row[0], w: row[2], h: row[3],
        variant: Math.floor(r() * variants), x: x, y: y, k: k,
        flip: r() < 0.5 ? -1 : 1, phase: r() * 10,
        solid: !!shapes, shapes: shapes || []
      });
    }
    // 地標先放（佔地大），其他擺件避開它
    if (lms.length && r() < LANDMARK_CHANCE) {
      var li = weightedPick(r, lms, function (p) { return p[1]; });
      var lx = x0 + range(r, 0.15, 0.85) * CHUNK_W, ly = y0 + range(r, 0.15, 0.85) * CHUNK_H;
      add('L', li, lms[li], lx, ly, range(r, 0.95, 1.1), LANDMARK_VARIANTS);
      placed.push([lx, ly, lms[li][2] * 0.55 + 60, 200]);
    }
    for (var j = 0; j < nProp + nSmall; j++) {
      var small = j >= nProp;
      if (small && !smallList.length) break;
      var pi = small
        ? smallList[weightedPick(r, smallList, function (i) { return props[i][1]; })]
        : weightedPick(r, props, function (p) { return p[1] * (divine && usedTypes[p[0]] ? .12 : 1); });
      var px = x0 + range(r, 0.06, 0.94) * CHUNK_W, py = y0 + range(r, 0.06, 0.94) * CHUNK_H;
      var gapX = small ? 70 : divine?112:150, gapY = small ? 80 : divine?148:180;
      var clash = placed.some(function (q) { return Math.abs(q[0] - px) < Math.max(gapX, q[2] || 0) && Math.abs(q[1] - py) < Math.max(gapY, q[3] || 0); });
      if (clash) continue;
      placed.push([px, py]);
      add('p', pi, props[pi], px, py, range(r, 0.85, 1.15), VARIANTS);
    }
    return items;
  }

  /* ============ 障礙查詢（模擬層用） ============ */
  var scene = { zone: null, stage: 0, kitKey: '', deep: false, band: -1, seed: 0 };
  var cacheCount = 0;
  var lastQ = null;            // 上一次的查詢範圍與結果；同一批區塊直接重用

  /* 切到某張地圖的某一階段。同一帶重複呼叫是一次比較，可以每個 tick 呼叫。 */
  function setScene(zoneKey, stageNum) {
    var band = bandOf(stageNum);
    if (scene.zone === zoneKey && scene.band === band) return;
    var kitKey = kitOf(zoneKey);
    scene.zone = zoneKey; scene.kitKey = kitKey; scene.band = band; scene.deep = band % 2 === 1;
    scene.seed = sceneSeed(kitKey, scene.deep, band);
    shapeCache = {}; cacheCount = 0; lastQ = null;
  }
  function sceneInfo() { return { zone: scene.zone, kitKey: scene.kitKey, band: scene.band, deep: scene.deep, seed: scene.seed }; }

  function chunkKey(cx, cy) { return (cx + 32768) * 65536 + (cy + 32768); }
  function chunkShapes(cx, cy) {
    var key = chunkKey(cx, cy);
    var hit = shapeCache[key];
    if (hit) return hit;
    var list = [], items = layoutChunk(scene.kitKey, scene.deep, scene.seed, cx, cy);
    for (var i = 0; i < items.length; i++) {
      for (var s = 0; s < items[i].shapes.length; s++) list.push(items[i].shapes[s]);
    }
    if (cacheCount > 400) { shapeCache = {}; cacheCount = 0; lastQ = null; }
    shapeCache[key] = list; cacheCount++;
    return list;
  }

  var NONE = [];
  /* (x, y) 附近 reach 以內可能碰到的佔地橢圓（粗篩：整個區塊的橢圓都回傳）。 */
  function shapesNear(x, y, reach) {
    if (scene.band < 0) return NONE;
    var m = reach + MAX_EXTENT;
    var cx0 = Math.floor((x - m) / CHUNK_W), cx1 = Math.floor((x + m) / CHUNK_W);
    var cy0 = Math.floor((y - m) / CHUNK_H), cy1 = Math.floor((y + m) / CHUNK_H);
    var q = lastQ;
    if (q && q.cx0 === cx0 && q.cx1 === cx1 && q.cy0 === cy0 && q.cy1 === cy1) return q.list;
    var list = [];
    for (var cy = cy0; cy <= cy1; cy++) {
      for (var cx = cx0; cx <= cx1; cx++) {
        var part = chunkShapes(cx, cy);
        for (var i = 0; i < part.length; i++) list.push(part[i]);
      }
    }
    if (!list.length) list = NONE;
    lastQ = { cx0: cx0, cx1: cx1, cy0: cy0, cy1: cy1, list: list };
    return list;
  }

  /* 兩點連線有沒有穿過任何障礙（近戰普攻判定用）。 */
  function segmentBlocked(ax, ay, bx, by) {
    var list = shapesNear((ax + bx) / 2, (ay + by) / 2, Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay)) / 2);
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var x0 = (ax - e[0]) / e[2], y0 = (ay - e[1]) / e[3];
      var dx = (bx - e[0]) / e[2] - x0, dy = (by - e[1]) / e[3] - y0;
      var dd = dx * dx + dy * dy, t = dd > 1e-12 ? -(x0 * dx + y0 * dy) / dd : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var qx = x0 + dx * t, qy = y0 + dy * t;
      if (qx * qx + qy * qy < 1) return true;
    }
    return false;
  }

  /* 把半徑 r 的圓身體（中心 pos）從障礙裡推出來；回傳是否被推動。
     推出之後再沿邊緣繞一小段（繞的距離約等於侵入深度）：筆直朝目標走的人撞上橢圓不會停住，而是滑過去，
     速度大致不損失。繞哪一側由 state 記住（同一顆障礙固定一側，不會左右來回）：
     state＝{ id, side }（呼叫端放在實體上；每個實體一份），第一次碰到時取「目標在哪一側」，
     正對圓心（無法分左右）時取 +1，所以結果完全可重現，不用亂數。goalX／goalY 是這個人想去的點。 */
  function pushOut(pos, r, goalX, goalY, state) {
    var list = shapesNear(pos.x, pos.y, r);
    if (list === NONE) { if (state && state.id) state.id = 0; return false; }
    var moved = false;
    for (var pass = 0; pass < 2; pass++) {
      var again = false;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var a = e[2] + r, b = e[3] + r;
        var dx = pos.x - e[0];
        if (dx >= a || -dx >= a) continue;
        var dy = pos.y - e[1];
        if (dy >= b || -dy >= b) continue;
        var u = dx / a, v = dy / b, d2 = u * u + v * v;
        if (d2 >= 1) continue;
        var dist = Math.sqrt(d2);
        if (dist < 1e-6) { u = 1; v = 0; dist = 1e-6; }
        var nu = u / dist, nv = v / dist;
        var mean = (a + b) / 2;
        var pen = (1 - dist) * mean;                    // 侵入深度（世界單位的近似值）
        var side = 1;
        if (state) {
          var id = (e[0] * 31 + e[1]) | 0;
          if (state.id !== id) {
            state.id = id;
            var cross = dx * (goalY - pos.y) - dy * (goalX - pos.x);
            state.side = cross < 0 ? -1 : 1;
          }
          side = state.side || 1;
        }
        var ang = Math.min(0.5, pen / mean) * side;
        var ca = Math.cos(ang), sa = Math.sin(ang);
        var ru = nu * ca - nv * sa, rv = nu * sa + nv * ca;
        pos.x = e[0] + ru * a;
        pos.y = e[1] + rv * b;
        moved = true; again = true;
      }
      if (!again) break;
    }
    if (!moved && state && state.id) state.id = 0;
    return moved;
  }

  return {
    CHUNK_W: CHUNK_W, CHUNK_H: CHUNK_H, STAGE_BAND: STAGE_BAND, VARIANTS: VARIANTS, LANDMARK_VARIANTS: LANDMARK_VARIANTS,
    CATALOG: CATALOG, FOOT: FOOT,
    mulberry: mulberry, hash3: hash3, strHash: strHash,
    sceneSeed: sceneSeed, kitOf: kitOf, bandOf: bandOf,
    isSolid: isSolid, footShapes: footShapes, setMinWidth: setMinWidth, getMinWidth: getMinWidth, DEFAULT_MIN_W: DEFAULT_MIN_W,
    layoutChunk: layoutChunk,
    setScene: setScene, sceneInfo: sceneInfo,
    shapesNear: shapesNear, segmentBlocked: segmentBlocked, pushOut: pushOut
  };
})();
