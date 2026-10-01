'use strict';
/* ============================================================
   preset-cost.cjs — 單一特效（一份 Preset 的一個實例）的效能成本估算

   用途：編輯器在每個預覽視窗上方顯示一個參考值，讓做特效的人當場知道
   「這一份在實機上大概多重」，不必等到戰場上塞滿才發現。
   判讀方式與已知偏差見 docs/vfx/VFX_PRESET_COST.md。

   ---- 係數全部來自 2026-09-30 的實機量測（GTX 1050、畫布 670×643） ----

   那次調查的結論是 **成本 ≈ 節點數**：burst-icearrow-crystal 一次命中＝19 層／約 74 個
   節點，同屏 17,692 個節點時 Core 一幀 51ms、FPS 7。拆開來每個節點每幀約 3.9µs：
   Core 0.64（16%）＋ Pixi 後端寫入 1.1（28%）＋ Pixi 渲染 2.1（55%）。
   換容器（ParticleContainer）整體只快約 1.5 倍，**槓桿是減少節點數**。

   填色（GPU）是另一條：60 個大面積加色 preset 疊在同一處約 10ms，
   也就是「畫面被整片填滿一次」約 167µs。

   價格表（當時實測，每個 preset 實例的每幀成本）可以拿來對答案：
     中位數 ~0.03ms；ground-storm-dance 1.1ms（288 節點）、ground-blizzard 0.7、
     fire-tornado-* 0.64、ground／proj-icearrow-frost 0.45、proj-waterball-flow 0.37。

   ---- 這個值**不是**量測，是估算 ----

   它從 Preset 資料推算峰值節點數與填色面積，不跑 Core、不看畫面。好處是立刻算得出來、
   不受預覽播到第幾秒影響；代價是幾個地方必然偏保守（都寫在 notes 裡回報）：
     · scaleOverLife 把圖放大的部分沒有算進填色
     · 子發射器用「母層峰值 × count」當上界，實際會分散在時間上
     · 序列幀、遮罩、著色器的差異一律當成一般 sprite
   ============================================================ */

/* 每個節點每幀的 CPU＋GPU 成本（µs）。2026-09-30 實測拆解見檔頭。 */
var NODE_US = 3.9;
/* 變形圖層（deformation，閃電那種沿路徑彎折的）是 Mesh：頂點每幀重算，而且不進批次。
   沒有單獨量過，取 2.5 倍是保守估計——寧可把它標得重一點，也不要讓人以為一樣便宜。 */
var MESH_WEIGHT = 2.5;
/* 「整個畫面被填滿一次」的 GPU 成本（µs）：實測 60 份大面積加色 preset 疊在同處約 10ms，
   而那一類在本模型下每份覆蓋約 8 個畫面 → 10000µs ÷ 60 ÷ 8 ≈ 21µs。
   換算成填色率約 20 Gpx/s，與 GTX 1050 的量級相符。 */
var FILL_US_PER_SCREEN = 21;
/* 量測時的畫布像素數，填色覆蓋率的分母。 */
var SCREEN_PX = 670 * 643;
/* 單層粒子數的硬上限（js/vfx-core.js 的 HARD_LIMITS.maxParticlesPerLayer）。
   遊戲的 perEffectParticleLimit 就是這個數（js/vfx-runtime.js 的 FX_BUDGET），
   所以沒填 maxParticles 的圖層實際上只受這一條管。 */
var HARD_PARTICLE_CAP = 2000;
/* 沒有素材尺寸可查時的假設邊長（px）。素材庫裡最常見的是 256 與 1024，取小的那個：
   猜太大會讓一堆特效無謂地變橘色。 */
var FALLBACK_ASSET_PX = 256;

/* 橘色門檻（µs）。取自實機分佈：整個素材庫的中位數約 0.03ms，而出事的那一份
   （burst-icearrow-crystal，74 節點）約 0.29ms。門檻訂在 0.25ms＝約 64 個節點：
   同時出現 60 份就吃掉一整幀（16.7ms）的四成。 */
var WARN_US = 250;

function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/* [min, max] 或單一數字都收；回傳 {min, max}。lifetime／startScale 這些欄位兩種寫法都合法。 */
function range(v, d) {
  if (Array.isArray(v)) return { min: num(v[0], d), max: num(v[1], num(v[0], d)) };
  var n = num(v, d);
  return { min: n, max: n };
}

/* 這一層在特效的生命週期裡「開著」多久（秒）。loop 的當成無限長：
   場域類特效由遊戲決定什麼時候收，成本是持續付的。 */
function windowOf(layer, preset) {
  if (preset.loop || layer.loop) return Infinity;
  var total = num(layer.duration, num(preset.duration, 1));
  return Math.max(0, total - num(layer.delay, 0));
}

/* 這一層的粒子上限（沒填 maxParticles 時由遊戲的 perEffectParticleLimit 管）。 */
function particleCap(layer) {
  return Math.min(num(layer.maxParticles, HARD_PARTICLE_CAP), HARD_PARTICLE_CAP);
}

/* 這一層在第 t 秒**同時活著**幾個節點。

   為什麼要逐秒取樣而不是把各層的峰值加起來：各層的峰值不在同一個時刻。
   burst-fire 的 6 張圖各有自己的 delay 與 duration，18 顆火舌死掉才生出 18 顆餘燼——
   把峰值相加會算出 42，實際同時最多只有 23 個（×1.83）。 */
function aliveAt(layer, t, preset, bySubSource) {
  var delay = num(layer.delay, 0);
  var a = t - delay;
  if (a < 0) return 0;
  var looping = !!(preset.loop || layer.loop);
  var dur = num(layer.duration, num(preset.duration, 1));
  if (layer.type !== 'particle') {
    /* 圖片與程序圖形：delay 到 delay+duration 之間各佔一個節點（loop 的一直都在）。 */
    return (looping || a < dur - delay) ? 1 : 0;
  }
  var e = layer.emission || {};
  var life = range(layer.lifetime, 1);
  var spread = Math.max(1e-6, life.max - life.min);
  var cap = particleCap(layer);
  var alive = 0;
  if (e.mode === 'burst') {
    /* 一次噴 count 顆，之後各自到期。壽命在 [min, max] 間均勻取樣，
       所以第 a 秒還活著的比例＝(max − a) / (max − min)，夾在 0 與 1 之間。 */
    var left = (life.max - a) / spread;
    alive = num(e.count, 0) * Math.max(0, Math.min(1, left));
  } else if (e.mode === 'rate') {
    var rate = num(e.rate, 0);
    var meanLife = (life.min + life.max) / 2;
    var emitFor = looping ? Infinity : Math.max(0, dur - delay);
    /* 發射中：生出來的減掉已經死掉的，穩態是 rate × 平均壽命；
       停止發射之後再過 meanLife 才清空。 */
    var emitted = rate * Math.min(a, emitFor);
    var died = rate * Math.max(0, Math.min(a, emitFor + meanLife) - meanLife);
    alive = Math.max(0, emitted - died);
  } else if (e.mode === 'sub') {
    /* 由母層的粒子在出生／死亡時丟進來。死亡那一種要等母層開始凋零才出現，
       所以用「母層在 t−自己的平均壽命 到 t 之間死了幾顆」× count。 */
    var src = bySubSource[layer.id];
    if (src) {
      var subMean = (life.min + life.max) / 2;
      var fresh = src.spawnedBy(t) - src.spawnedBy(t - subMean);
      alive = Math.max(0, fresh) * src.count;
    }
  }
  /* 顆數是整數：穩態平均 1.6 顆的那一層，實際會在 1 與 2 之間跳，峰值是 2。
     無條件進位之後小特效才對得上（rate 8、壽命 0.2 秒的那一類原本會少算一顆）。 */
  /* 減 1e-9 是為了浮點數：穩態剛好 50 顆時 emitted − died 會算出 50.000000000000014，
     直接進位就變 51，整份特效的節點數跟著差一顆。 */
  return Math.min(alive > 0 ? Math.ceil(alive - 1e-9) : 0, cap);
}

/* 這一層每一個節點大概蓋住多少像素。sprite／procedural 用素材尺寸 × scale；
   粒子用素材尺寸 × startScale 的平均（逐顆的縮放是隨機取樣，不是全部都最大）。
   序列幀要先除掉格數——整張圖集是 2560×7680、畫出來的是其中一格 320×320，
   拿整張算會把一份特效高估兩個數量級（earthguard 的六芒星就是這樣被算成 36 個畫面）。 */
function nodeArea(layer, size) {
  if (!size) return 0;
  var w = num(size.width, 0), h = num(size.height, 0);
  if (!(w > 0 && h > 0)) return 0;
  var sheet = layer.sheet;
  if (sheet) {
    w /= Math.max(1, num(sheet.columns, 1));
    h /= Math.max(1, num(sheet.rows, 1));
  }
  if (layer.type === 'particle') {
    var s = range(layer.startScale, 1);
    var mid = (s.min + s.max) / 2;
    return w * h * mid * mid;
  }
  var sc = layer.scale || {};
  return w * h * Math.abs(num(sc.x, 1)) * Math.abs(num(sc.y, 1));
}

/* 繪製批次會在 blendMode 改變的地方斷掉（實測：hit-gale-burst 60 份 ＝ 181 次 draw）。
   照 zIndex 排過之後數「連續同 blend」的段數，就是這一份大概要畫幾批。 */
function blendRuns(layers) {
  var drawable = layers.filter(function (l) { return l.type !== 'empty' && l.enabled !== false; });
  var sorted = drawable.slice().sort(function (a, b) {
    return num(a.zIndex, 0) - num(b.zIndex, 0);
  });
  var runs = 0, prev = null;
  sorted.forEach(function (l) {
    var mode = l.blendMode || 'normal';
    if (mode !== prev) { runs++; prev = mode; }
  });
  return runs;
}

/* 一份 Preset 的成本估算。
   opts.assetSize(assetId) → { width, height }｜null：素材尺寸的來源
   （編輯器給 asset-index 的 facts.dimensions；CLI 直接讀 vfx/asset-index.json）。 */
function estimate(preset, opts) {
  opts = opts || {};
  var sizeOf = typeof opts.assetSize === 'function' ? opts.assetSize : function () { return null; };
  var layers = (preset && preset.layers) || [];
  var deformed = {};
  if (preset && preset.deformation && Array.isArray(preset.deformation.layers)) {
    preset.deformation.layers.forEach(function (id) { deformed[id] = true; });
  }

  /* 先找出「誰餵誰」：subEmitter 寫在母層上，指向目標層的 id。
     子層要知道母層「到第 t 秒為止生了／死了幾顆」，才算得出它自己什麼時候出現。 */
  var bySubSource = {};
  layers.forEach(function (l) {
    var sub = l.subEmitter;
    if (!sub || !sub.layer || l.type !== 'particle') return;
    var e = l.emission || {};
    var life = range(l.lifetime, 1);
    var spread = Math.max(1e-6, life.max - life.min);
    var meanLife = (life.min + life.max) / 2;
    var delay = num(l.delay, 0);
    var cap = particleCap(l);
    var onBirth = sub.on === 'birth';
    bySubSource[sub.layer] = {
      from: l.id,
      count: Math.max(1, num(sub.count, 1)),
      /* 到第 t 秒為止，母層總共丟出去幾顆（出生觸發看出生數、死亡觸發看死亡數）。 */
      spawnedBy: function (t) {
        var a = t - delay;
        if (a <= 0) return 0;
        if (e.mode === 'burst') {
          var total = Math.min(num(e.count, 0), cap);
          return onBirth ? total : total * Math.max(0, Math.min(1, (a - life.min) / spread));
        }
        if (e.mode === 'rate') {
          var rate = num(e.rate, 0);
          var born = rate * a;
          return onBirth ? born : rate * Math.max(0, a - meanLife);
        }
        return 0;
      }
    };
  });

  var notes = [];
  var enabledLayers = layers.filter(function (l) { return l.enabled !== false; });
  /* 取樣到「最後一顆粒子也死透」為止；loop 的跑兩輪，足夠到穩態。 */
  var tail = 0;
  layers.forEach(function (l) {
    if (l.type === 'particle') tail = Math.max(tail, range(l.lifetime, 1).max);
  });
  var baseDur = Math.max(0.1, num(preset && preset.duration, 1));
  var horizon = preset && preset.loop ? baseDur * 2 : baseDur + tail + 1 / 30;
  var STEP = 1 / 60;

  var missingSize = [];
  var perLayerPeak = {};
  var peakNodes = 0, peakWeighted = 0, peakCoverage = 0, peakParticleNodes = 0;
  var areaOf = {};
  layers.forEach(function (l) {
    var size = l.assetId ? sizeOf(l.assetId) : null;
    if (l.assetId && !size) missingSize.push(l.id);
    areaOf[l.id] = nodeArea(l, size || { width: FALLBACK_ASSET_PX, height: FALLBACK_ASSET_PX });
  });
  var grew = layers.filter(function (l) { return l.scaleOverLife; }).map(function (l) { return l.id; });
  if (grew.length) {
    notes.push((grew.length > 2 ? grew.slice(0, 2).join('、') + ' 等 ' + grew.length + ' 層' : grew.join('、')) +
      ' 有 scaleOverLife，放大之後多出來的填色沒有算進去');
  }

  for (var t = 0; t <= horizon + 1e-9; t += STEP) {
    var nodesNow = 0, weightedNow = 0, coverNow = 0, particlesNow = 0;
    for (var i = 0; i < enabledLayers.length; i++) {
      var l2 = enabledLayers[i];
      var n = aliveAt(l2, t, preset, bySubSource);
      if (!(n > 0)) continue;
      nodesNow += n;
      weightedNow += n * (deformed[l2.id] ? MESH_WEIGHT : 1);
      coverNow += (areaOf[l2.id] * n) / SCREEN_PX;
      if (l2.type === 'particle') particlesNow += n;
      if (!(perLayerPeak[l2.id] >= n)) perLayerPeak[l2.id] = n;
    }
    if (nodesNow > peakNodes) peakNodes = nodesNow;
    if (weightedNow > peakWeighted) { peakWeighted = weightedNow; }
    if (coverNow > peakCoverage) peakCoverage = coverNow;
    if (particlesNow > peakParticleNodes) peakParticleNodes = particlesNow;
  }

  var byType = { sprite: 0, particle: 0, procedural: 0, empty: 0 };
  layers.forEach(function (l) {
    if (byType[l.type] === undefined) byType[l.type] = 0;
    byType[l.type]++;
  });

  var out = { layers: [] };
  layers.forEach(function (l) {
    out.layers.push({
      id: l.id, type: l.type, nodes: Math.round(perLayerPeak[l.id] || 0),
      enabled: l.enabled !== false, mesh: !!deformed[l.id],
      coverage: (areaOf[l.id] * (perLayerPeak[l.id] || 0)) / SCREEN_PX,
      blendMode: l.blendMode || 'normal'
    });
  });

  if (missingSize.length) {
    notes.push('查不到 ' + missingSize.length + ' 層的素材尺寸，填色用 ' + FALLBACK_ASSET_PX + 'px 估');
  }

  var cpuUs = peakWeighted * NODE_US;
  var fillUs = peakCoverage * FILL_US_PER_SCREEN;
  var score = cpuUs + fillUs;
  return {
    score: score,
    ms: score / 1000,
    cpuUs: cpuUs,
    fillUs: fillUs,
    nodes: Math.round(peakNodes),
    weightedNodes: peakWeighted,
    particles: Math.round(peakParticleNodes),
    coverage: peakCoverage,
    layerCount: layers.length,
    byType: byType,
    drawableCount: out.layers.filter(function (l) { return l.type !== 'empty'; }).length,
    batches: blendRuns(layers),
    loop: !!(preset && preset.loop),
    duration: num(preset && preset.duration, 0),
    layers: out.layers,
    notes: notes,
    level: score >= WARN_US ? 'warn' : 'ok'
  };
}

/* 編輯器與 CLI 共用的素材尺寸查法：把 asset-index 的 assets 陣列轉成查詢函式。 */
function sizeLookup(assets) {
  var map = Object.create(null);
  (assets || []).forEach(function (a) {
    var d = a && a.facts && a.facts.dimensions;
    if (a && a.assetId && d) map[a.assetId] = { width: d.width, height: d.height };
  });
  return function (id) { return map[id] || null; };
}

var VFXPresetCost = {
  NODE_US: NODE_US,
  MESH_WEIGHT: MESH_WEIGHT,
  FILL_US_PER_SCREEN: FILL_US_PER_SCREEN,
  SCREEN_PX: SCREEN_PX,
  WARN_US: WARN_US,
  HARD_PARTICLE_CAP: HARD_PARTICLE_CAP,
  estimate: estimate,
  aliveAt: aliveAt,
  blendRuns: blendRuns,
  sizeLookup: sizeLookup
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXPresetCost;
}
