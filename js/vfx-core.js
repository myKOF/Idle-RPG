'use strict';
/* ============================================================
   vfx-core.js — VFX Core（可移植，不依賴 Idle-RPG、不依賴 PixiJS、不碰 DOM）

   Editor 與 Game Runtime 共用這一支。畫面上看到的所有數值——位置、縮放、
   旋轉、透明度、粒子軌跡——全部在這裡算完；繪圖後端只負責把算好的
   transform 套到實際節點上。Editor 與 Runtime 因此不可能長出兩套動態行為。

       VFX Core（本檔：模擬＋驗證＋生命週期）
              │
     ┌────────┴────────┐
     │                 │
  VFX Editor       Game Runtime      ← 兩者都注入同一個 backend 與 resolver
     └──── VFX Preset ─┘

   與 gameplay 的界線：本檔不認得 player／enemy／skill／damage，
   只接受泛用輸入（position／rotation／scale／duration／seed／params）。
   Idle-RPG 之後用一層薄 Adapter 呼叫即可，本檔可移植到其他 Web 遊戲。

   後端介面（backend，由呼叫端注入）：
     createNode(spec)            spec: { kind:'sprite'|'tiled', assetUrl, blendMode }
     updateNode(node, t)         t: { x,y,rotation,scaleX,scaleY,alpha,tint,visible,
                                      anchorX,anchorY,width,height,tileX,tileY }
     destroyNode(node)
   ⚠️ updateNode 收到的 transform 是共用物件（每幀重用，避免大量配置），
      只在該次呼叫內有效；後端若要留存必須自行複製。
   測試用的 NullBackend 見本檔結尾。

   解析器介面（resolver）：
     resolve(assetId) -> string（URL 或路徑）；未知 assetId 必須丟出錯誤
   ============================================================ */

var VFXCore = (function () {

  var SCHEMA_VERSION = 1;

  /* ---------- 常數與硬限制 ---------- */

  var LAYER_TYPES = ['sprite', 'particle', 'procedural'];
  var BLEND_MODES = ['normal', 'add', 'multiply', 'screen'];
  var SPAWN_SHAPES = ['point', 'circle', 'box'];
  /* burst：一次噴完　rate：每秒 N 顆　sub：自己完全不發射，只由子發射器觸發
     （sub 是為了讓「這一層只在別人死掉時出現」講得出來——用 burst count 1
     再想辦法壓掉自發的那一次，是那種讀者永遠看不懂的寫法）。 */
  var EMISSION_MODES = ['burst', 'rate', 'sub'];
  var PROCEDURAL_EFFECTS = ['uvScroll', 'waterTornado'];
  var waterGenerator = typeof VFXWaterTornado !== 'undefined' ? VFXWaterTornado :
    (typeof require === 'function' ? require('./vfx-water-tornado.js') : null);
  /* 序列幀的播放方式。
       life：整份序列攤在圖層（或粒子）的生命週期上播完一次——爆炸、火花這類
             「一生只演一次」的用法，也是 Unity Texture Sheet Animation 的預設。
       fps ：固定張數／秒，與生命長短無關——火焰、水流這類循環動畫。 */
  var SHEET_MODES = ['life', 'fps'];
  /* 子發射器的觸發時機。刻意只有這兩個：碰撞與觸發器需要碰撞系統，本 Core 沒有。 */
  var SUB_EVENTS = ['death', 'birth'];

  /* 硬上限：超過就是 preset 寫錯，不是效能調校問題，直接擋在驗證階段。 */
  var HARD_LIMITS = {
    maxLayers: 32,
    maxParticlesPerLayer: 2000,
    maxEmissionRate: 2000,
    maxDuration: 60,
    maxCurvePoints: 16,
    /* 格線邊長上限。64×64＝4096 格已經遠超任何合理的序列幀圖集，
       而且後端要為每一格建立一個 Texture，沒有上限等於讓一個打錯的
       columns 值配置出幾十萬個物件。 */
    maxSheetSide: 64,
    /* 一顆粒子最多能生幾顆。子發射是會相乘的：母層 50 顆 × 每顆 32 顆＝1600，
       再串一層就是五萬。上限擋在這裡，而不是等 maxParticles 去救——
       那時候迴圈已經跑過幾萬次了。 */
    maxSubCount: 32,

    /* budget 三個欄位的硬上限（見 createRuntime 的 budgetValue）。
       budget 是呼叫端可調的效能旋鈕，但不能被調成「等於沒有上限」：
       perEffectParticleLimit 一旦大到浮點數減 1 不再改變數值（Number.MAX_VALUE
       就是這樣），發射迴圈的 emitAccumulator -= 1 便永遠遞減不完。
       擋在驗證入口，不在每幀迴圈裡加容錯——迴圈的正確性應該由前置條件保證。 */
    budget: {
      /* 同時存在的特效數。這一條與下面兩條不同——它沒有任何正確性理由，
         純粹是為了讓「上限」仍然是個有限值（極大值會讓呼叫端誤以為關得掉上限）。
         使用者決策 2026-09-06：效能上的節流先整個拿掉，等實機體感再決定數字，
         因此這裡放寬到不會綁住任何合理用途的量級。真正不能放寬的是
         perEffectParticleLimit（見上面的終止性說明）。 */
      maxActiveEffects: 65536,
      // 全域粒子數上限＝單層硬上限 × 最大層數，也就是一個特效在硬上限下的理論最大值。
      maxParticles: 2000 * 32,
      // 單層粒子數不可能超過 maxParticlesPerLayer，設得比它大沒有任何效果，是寫錯。
      perEffectParticleLimit: 2000
    }
  };

  /* alignToVelocity 的「有效速度」門檻（px/s）。
     速率必須「嚴格大於」這個值才算有方向；恰好等於時視為無效。
     低於門檻就當作沒有方向可言——直接用 atan2(0, 0) 會回傳 0，
     粒子的朝向會在減速到靜止的那一刻突然彈回 0 弧度。 */
  var VELOCITY_EPSILON = 0.001;

  /* 預設預算。呼叫端可覆寫；用途是讓「幾十個特效同時存在」有單一控制點。 */
  var DEFAULT_BUDGET = {
    maxActiveEffects: 24,
    maxParticles: 1200,
    perEffectParticleLimit: 300
  };

  /* ---------- 決定性亂數 ----------
     同一個 seed ＋ 同一段 dt 序列，必須產生位元相同的畫面。
     用 mulberry32：小、快、不依賴 Math.random。 */
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 曲線 ----------
     over-life 參數統一用 [[t, value], ...]（t 為 0..1 的生命進度），線性內插。
     刻意不做貝茲／緩動曲線：MVP 用不到，加了就是替未來想像付成本。 */
  function sampleCurve(curve, t) {
    if (curve === undefined || curve === null) return null;
    if (typeof curve === 'number') return curve;
    if (!curve.length) return null;
    if (t <= curve[0][0]) return curve[0][1];
    var last = curve[curve.length - 1];
    if (t >= last[0]) return last[1];
    for (var i = 1; i < curve.length; i++) {
      if (t <= curve[i][0]) {
        var a = curve[i - 1], b = curve[i];
        var span = b[0] - a[0];
        var k = span > 0 ? (t - a[0]) / span : 0;
        return a[1] + (b[1] - a[1]) * k;
      }
    }
    return last[1];
  }

  /* ---------- 噪聲場 ----------
     粒子的湍流。與 makeRng 的分工不同：亂數是「每顆粒子出生時抽一次」，
     噪聲是「同一個位置在同一個時刻永遠得到同一個值」——相鄰的粒子因此會
     一起被推向同一邊，看起來才像被氣流帶著走，而不是各抖各的。

     用整數格點的 value noise（hash → smoothstep 內插）而不是 Perlin：
     少一組梯度表、少一次查表，而在「拿來當位移擾動」這個用途上，
     兩者的視覺差別小到看不出來。

     hash 用 Math.imul：粒子座標乘上大質數會超過 2^31，普通乘法會掉精度，
     於是噪聲場在畫面某些區域整片變成同一個值（看起來像整塊在平移）。 */
  function noiseHash(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  /* 回傳 -1..1。 */
  function valueNoise2(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx);           // smoothstep：格點邊界不會有折角
    var uy = fy * fy * (3 - 2 * fy);
    var a = noiseHash(ix, iy, seed);
    var b = noiseHash(ix + 1, iy, seed);
    var c = noiseHash(ix, iy + 1, seed);
    var d = noiseHash(ix + 1, iy + 1, seed);
    var top = a + (b - a) * ux;
    var bottom = c + (d - c) * ux;
    return (top + (bottom - top) * uy) * 2 - 1;
  }

  /* 序列幀的幀索引。

     life：把整份序列攤在 0..1 的生命進度上。用 floor 而不是 round——
           round 會讓第一格與最後一格各只出現半格的時間，等速播放的序列
           因此在頭尾各閃一下。
     fps ：與生命長短無關的固定張數／秒。

     不循環時夾在最後一格（演完停住），循環時取餘數。
     offset 是每顆粒子自己的起始格（randomStart），讓同一層的粒子不同步——
     否則二十顆火花會像同一個動畫被複製二十份，非常假。 */
  function sheetFrame(sheet, progress, ageSec, offset) {
    var n = sheet.count;
    if (n <= 1) return 0;
    var raw = sheet.mode === 'fps' ? ageSec * sheet.fps : progress * n;
    /* +ε 再取整。時間是逐幀累加出來的浮點數，0.1 加八次是 0.7999999999999999，
       乘上 10 fps 取整會得到 7 而不是 8——序列因此會在格子邊界重播或跳過一格
       （實測 fps 模式跑出 [1,2,3,0,1,2,3,3,1]，第 8 格卡住了）。
       1e-6 格約等於一微秒的動畫時間，遠低於看得出來的程度，
       也遠高於累加誤差的量級（跑幾百格也只有 1e-13）。 */
    var i = Math.floor(raw + 1e-6) + (offset || 0);
    if (sheet.loop) {
      i %= n;
      return i < 0 ? i + n : i;
    }
    /* 不循環時 offset 仍然有效，但不能讓它把序列推到超出尾端。 */
    return i < 0 ? 0 : (i >= n ? n - 1 : i);
  }

  /* 範圍值：數字表示固定，[min,max] 表示在區間內取決定性亂數 */
  function sampleRange(value, rng) {
    if (Array.isArray(value)) return value[0] + (value[1] - value[0]) * rng();
    return value;
  }

  /* ---------- 顏色 ---------- */
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  function colorToInt(hex) { return parseInt(hex.slice(1), 16); }

  /* 顏色曲線：[[t, '#rrggbb'], …]，在 sRGB 分量上線性內插。

     為什麼與 sampleCurve 分成兩支而不是共用：值不是數字，內插必須逐分量做。
     混在同一支裡只會讓兩邊都長出型別判斷，而熱路徑（逐幀逐粒子）最不需要的
     就是每次取樣都先問一次「這是數字還是顏色」。 */
  function lerpColorInt(a, b, k) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    var r = (ar + (br - ar) * k) | 0;
    var g = (ag + (bg - ag) * k) | 0;
    var bl = (ab + (bb - ab) * k) | 0;
    return (r << 16) | (g << 8) | bl;
  }

  /* 曲線在 layerDefaults（也就是 play 的時候）就先轉成 [[t, int]]。
     逐幀逐粒子取樣時再 parseInt 一次十六進位字串，是這一層最容易長出來的
     隱形成本——一個 500 顆粒子的特效每秒就是三萬次字串解析。 */
  function toColorCurve(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') return [[0, colorToInt(value)]];
    var out = [];
    for (var i = 0; i < value.length; i++) out.push([value[i][0], colorToInt(String(value[i][1]))]);
    return out;
  }

  function sampleColorCurve(curve, t) {
    if (!curve) return null;
    if (t <= curve[0][0]) return curve[0][1];
    var last = curve[curve.length - 1];
    if (t >= last[0]) return last[1];
    for (var i = 1; i < curve.length; i++) {
      if (t <= curve[i][0]) {
        var a = curve[i - 1], b = curve[i];
        var span = b[0] - a[0];
        return span > 0 ? lerpColorInt(a[1], b[1], (t - a[0]) / span) : a[1];
      }
    }
    return last[1];
  }

  /* 逐分量相乘。與 alphaOverLife 乘在 alpha 上是同一個道理：曲線是「在基底色上
     再乘一層」，不是取代它——因此 tint 永遠有作用，不會出現「填了卻沒效果」。
     這也與 Unity 的 startColor × colorOverLifetime 同語意，日後要機器轉換
     Unity 的粒子設定時是 1:1 對應，不必在轉換器裡另外想一套折衷。 */
  function mulColorInt(a, b) {
    var r = (((a >> 16) & 255) * ((b >> 16) & 255) / 255) | 0;
    var g = (((a >> 8) & 255) * ((b >> 8) & 255) / 255) | 0;
    var bl = ((a & 255) * (b & 255) / 255) | 0;
    return (r << 16) | (g << 8) | bl;
  }

  /* ---------- 驗證 ----------
     嚴格、不做 silent fallback：任何不合法的 preset 一律回傳錯誤而不是「盡量播」。
     播出一個悄悄變形的特效，比明確報錯難查太多。 */

  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  function validateCurve(value, where, errors, opts) {
    if (value === undefined) return;
    if (isFiniteNumber(value)) {
      // 純數字分支同樣要檢查，否則 alphaOverLife: -1 會漏過去
      if (opts && opts.nonNegative && value < 0) errors.push(where + ' 不得為負');
      return;
    }
    if (!Array.isArray(value) || !value.length) {
      errors.push(where + ' 必須是數字或 [[t,value],…] 曲線');
      return;
    }
    if (value.length > HARD_LIMITS.maxCurvePoints) {
      errors.push(where + ' 曲線點數超過上限 ' + HARD_LIMITS.maxCurvePoints);
    }
    var prevT = -Infinity;
    for (var i = 0; i < value.length; i++) {
      var p = value[i];
      if (!Array.isArray(p) || p.length !== 2 || !isFiniteNumber(p[0]) || !isFiniteNumber(p[1])) {
        errors.push(where + '[' + i + '] 必須是 [t, value] 且皆為有限數');
        continue;
      }
      if (p[0] < 0 || p[0] > 1) errors.push(where + '[' + i + '] 的 t 必須在 0..1');
      if (p[0] < prevT) errors.push(where + '[' + i + '] 的 t 必須遞增');
      prevT = p[0];
      if (opts && opts.nonNegative && p[1] < 0) errors.push(where + '[' + i + '] 不得為負');
    }
  }

  /* 序列幀（sprite sheet）。格線切法由 preset 宣告，不從素材推——
     一張 512×512 的圖，Core 沒有任何辦法知道它是 8×8 還是 4×4。 */
  function validateSheet(value, where, errors) {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(where + ' 必須是 { columns, rows, … }');
      return;
    }
    ['columns', 'rows'].forEach(function (k) {
      var v = value[k];
      if (!isFiniteNumber(v) || v < 1 || Math.floor(v) !== v) {
        errors.push(where + '.' + k + ' 必須是正整數');
      } else if (v > HARD_LIMITS.maxSheetSide) {
        errors.push(where + '.' + k + ' 超過硬上限 ' + HARD_LIMITS.maxSheetSide);
      }
    });
    if (value.count !== undefined) {
      var total = (value.columns || 0) * (value.rows || 0);
      if (!isFiniteNumber(value.count) || value.count < 1 || Math.floor(value.count) !== value.count) {
        errors.push(where + '.count 必須是正整數');
      } else if (total && value.count > total) {
        errors.push(where + '.count（' + value.count + '）超過格數 ' + total);
      }
    }
    if (value.mode !== undefined && SHEET_MODES.indexOf(value.mode) < 0) {
      errors.push(where + '.mode 非法值：' + value.mode + '（支援 ' + SHEET_MODES.join('、') + '）');
    }
    if (value.fps !== undefined && (!isFiniteNumber(value.fps) || value.fps <= 0)) {
      errors.push(where + '.fps 必須是正數');
    }
    if (value.mode === 'fps' && value.fps === undefined) {
      errors.push(where + '.mode 是 fps 時必須給 fps');
    }
    if (value.randomStart !== undefined && typeof value.randomStart !== 'boolean') {
      errors.push(where + '.randomStart 必須是布林值');
    }
    if (value.loop !== undefined && typeof value.loop !== 'boolean') {
      errors.push(where + '.loop 必須是布林值');
    }
  }

  function validateColorCurve(value, where, errors) {
    if (value === undefined) return;
    if (typeof value === 'string') {
      if (!COLOR_RE.test(value)) errors.push(where + ' 必須是 #rrggbb');
      return;
    }
    if (!Array.isArray(value) || !value.length) {
      errors.push(where + " 必須是 #rrggbb 或 [[t,'#rrggbb'],…] 曲線");
      return;
    }
    if (value.length > HARD_LIMITS.maxCurvePoints) {
      errors.push(where + ' 曲線點數超過上限 ' + HARD_LIMITS.maxCurvePoints);
    }
    var prevT = -Infinity;
    for (var i = 0; i < value.length; i++) {
      var p = value[i];
      if (!Array.isArray(p) || p.length !== 2 || !isFiniteNumber(p[0]) ||
          !COLOR_RE.test(String(p[1]))) {
        errors.push(where + '[' + i + "] 必須是 [t, '#rrggbb']");
        continue;
      }
      if (p[0] < 0 || p[0] > 1) errors.push(where + '[' + i + '] 的 t 必須在 0..1');
      if (p[0] < prevT) errors.push(where + '[' + i + '] 的 t 必須遞增');
      prevT = p[0];
    }
  }

  function validateRange(value, where, errors, opts) {
    if (value === undefined) return;
    if (isFiniteNumber(value)) {
      if (opts && opts.nonNegative && value < 0) errors.push(where + ' 不得為負');
      return;
    }
    if (!Array.isArray(value) || value.length !== 2 ||
        !isFiniteNumber(value[0]) || !isFiniteNumber(value[1])) {
      errors.push(where + ' 必須是數字或 [min,max]');
      return;
    }
    if (value[0] > value[1]) errors.push(where + ' 的 min 不得大於 max');
    if (opts && opts.nonNegative && value[0] < 0) errors.push(where + ' 不得為負');
  }

  function validateVec2(value, where, errors) {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' ||
        !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
      errors.push(where + ' 必須是 {x,y} 且皆為有限數');
    }
  }

  /* 路徑外洩防線：preset 只能用 assetId，不得夾帶任何本機路徑。 */
  function looksLikePath(value) {
    return /^[A-Za-z]:[\\/]/.test(value) || value.indexOf('\\') >= 0 ||
      value.indexOf('://') >= 0 || value.charAt(0) === '/';
  }

  function validateCommonLayer(layer, where, errors) {
    if (layer.enabled !== undefined && typeof layer.enabled !== 'boolean') {
      errors.push(where + '.enabled 必須是布林值');
    }
    ['delay', 'duration'].forEach(function (key) {
      if (layer[key] === undefined) return;
      if (!isFiniteNumber(layer[key])) errors.push(where + '.' + key + ' 必須是有限數');
      else if (layer[key] < 0) errors.push(where + '.' + key + ' 不得為負');
    });
    validateVec2(layer.position, where + '.position', errors);
    validateVec2(layer.scale, where + '.scale', errors);
    validateVec2(layer.anchor, where + '.anchor', errors);
    if (layer.rotation !== undefined && !isFiniteNumber(layer.rotation)) {
      errors.push(where + '.rotation 必須是有限數');
    }
    if (layer.alpha !== undefined && (!isFiniteNumber(layer.alpha) || layer.alpha < 0 || layer.alpha > 1)) {
      errors.push(where + '.alpha 必須在 0..1');
    }
    if (layer.zIndex !== undefined && !isFiniteNumber(layer.zIndex)) {
      errors.push(where + '.zIndex 必須是有限數');
    }
    if (layer.tint !== undefined && !COLOR_RE.test(String(layer.tint))) {
      errors.push(where + '.tint 必須是 #rrggbb');
    }
    if (layer.blendMode !== undefined && BLEND_MODES.indexOf(layer.blendMode) < 0) {
      errors.push(where + '.blendMode 非法值：' + layer.blendMode);
    }
    if (layer.assetId !== undefined) {
      if (typeof layer.assetId !== 'string' || !layer.assetId) {
        errors.push(where + '.assetId 必須是非空字串');
      } else if (looksLikePath(layer.assetId)) {
        errors.push(where + '.assetId 看起來像路徑或 URL，只能放 assetId：' + layer.assetId);
      }
    }
    validateCurve(layer.alphaOverLife, where + '.alphaOverLife', errors, { nonNegative: true });
    validateColorCurve(layer.tintOverLife, where + '.tintOverLife', errors);
    validateSheet(layer.sheet, where + '.sheet', errors);
    if (layer.radiusProfile !== undefined) {
      var rp = layer.radiusProfile;
      if (!rp || typeof rp !== 'object' || Array.isArray(rp)) {
        errors.push(where + '.radiusProfile 必須是物件');
      } else {
        ['centerScale', 'topRatio', 'bottomRatio', 'sourceTopRatio', 'sourceBottomRatio'].forEach(function (key) {
          if (rp[key] !== undefined && (!isFiniteNumber(rp[key]) || rp[key] < 0.1 || rp[key] > 8)) {
            errors.push(where + '.radiusProfile.' + key + ' 必須在 0.1..8');
          }
        });
        var top = rp.topY === undefined ? 0 : rp.topY;
        var mid = rp.centerY === undefined ? 0.5 : rp.centerY;
        var bottom = rp.bottomY === undefined ? 1 : rp.bottomY;
        if (![top, mid, bottom].every(isFiniteNumber) || top < 0 || bottom > 1 || !(top < mid && mid < bottom)) {
          errors.push(where + '.radiusProfile 必須符合 0 ≤ topY < centerY < bottomY ≤ 1');
        }
      }
    }
    validateCurve(layer.scaleOverLife, where + '.scaleOverLife', errors, { nonNegative: true });
    /* 分軸縮放曲線。只有走 updateSpriteLayer 的 sprite／procedural 支援，
       粒子層的兩軸永遠相等（見 updateParticleLayer），所以那裡不收這兩個欄位——
       由 TYPE_ONLY_FIELDS 擋下並報錯，而不是收下來再靜靜忽略。 */
    validateCurve(layer.scaleXOverLife, where + '.scaleXOverLife', errors, { nonNegative: true });
    validateCurve(layer.scaleYOverLife, where + '.scaleYOverLife', errors, { nonNegative: true });
    validateCurve(layer.rotationOverLife, where + '.rotationOverLife', errors);
    /* 繞 X／Y 軸的翻轉。與 scaleX／scaleYOverLife 同一組限制（只有 sprite 與
       procedural 支援），因為它們最終就是套用在 scaleY／scaleX 上。 */
    validateCurve(layer.rotationXOverLife, where + '.rotationXOverLife', errors);
    validateCurve(layer.rotationYOverLife, where + '.rotationYOverLife', errors);
    /* 位移曲線。與上面每一條都不同：它是**加**在 position 上的，不是乘。
       乘沒有意義——position 常常是 0，乘多少都還是 0。

       單位是 px，而且落在特效自己的座標系（與 position 同一組數字，所以會跟著
       特效一起旋轉與縮放）。不夾上下限：位移本來就可以是負的，範圍也沒有
       天然的上界。 */
    validateCurve(layer.offsetXOverLife, where + '.offsetXOverLife', errors);
    validateCurve(layer.offsetYOverLife, where + '.offsetYOverLife', errors);
  }

  /* 子發射器：這一層的粒子在出生或死亡時，往另一層丟幾顆。
     典型用途是「爆炸碎片飛完之後化成一小團煙」——那需要兩組完全不同的
     壽命、重力與貼圖，塞在同一層做不到。 */
  function validateSubEmitter(value, where, errors) {
    if (value === undefined) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push(where + ' 必須是 { layer, on?, count?, inheritVelocity? }');
      return;
    }
    if (typeof value.layer !== 'string' || !value.layer) {
      errors.push(where + '.layer 必填（目標圖層的 id）');
    }
    if (value.on !== undefined && SUB_EVENTS.indexOf(value.on) < 0) {
      errors.push(where + '.on 非法值：' + value.on + '（支援 ' + SUB_EVENTS.join('、') + '）');
    }
    if (value.count !== undefined) {
      if (!isFiniteNumber(value.count) || value.count < 1 || Math.floor(value.count) !== value.count) {
        errors.push(where + '.count 必須是正整數');
      } else if (value.count > HARD_LIMITS.maxSubCount) {
        errors.push(where + '.count 超過硬上限 ' + HARD_LIMITS.maxSubCount);
      }
    }
    if (value.inheritVelocity !== undefined &&
        (!isFiniteNumber(value.inheritVelocity) || value.inheritVelocity < 0 || value.inheritVelocity > 1)) {
      errors.push(where + '.inheritVelocity 必須介於 0 與 1');
    }
  }

  function validateParticleLayer(layer, where, errors) {
    validateSubEmitter(layer.subEmitter, where + '.subEmitter', errors);
    var e = layer.emission;
    if (!e || typeof e !== 'object') {
      errors.push(where + '.emission 必填');
    } else {
      if (EMISSION_MODES.indexOf(e.mode) < 0) errors.push(where + '.emission.mode 非法值：' + e.mode);
      if (e.mode === 'burst') {
        if (!isFiniteNumber(e.count) || e.count <= 0 || Math.floor(e.count) !== e.count) {
          errors.push(where + '.emission.count 必須是正整數');
        }
        else if (e.count > HARD_LIMITS.maxParticlesPerLayer) {
          errors.push(where + '.emission.count 超過硬上限 ' + HARD_LIMITS.maxParticlesPerLayer);
        }
      } else if (e.mode === 'rate') {
        if (!isFiniteNumber(e.rate) || e.rate <= 0) errors.push(where + '.emission.rate 必須是正數');
        else if (e.rate > HARD_LIMITS.maxEmissionRate) {
          // 無上限的 rate 乘上 dt 會讓發射迴圈跑上百萬次，直接凍住主執行緒
          errors.push(where + '.emission.rate 超過硬上限 ' + HARD_LIMITS.maxEmissionRate);
        }
      }
    }
    if (layer.maxParticles !== undefined) {
      if (!isFiniteNumber(layer.maxParticles) || layer.maxParticles <= 0 ||
          Math.floor(layer.maxParticles) !== layer.maxParticles) {
        errors.push(where + '.maxParticles 必須是正整數');
      } else if (layer.maxParticles > HARD_LIMITS.maxParticlesPerLayer) {
        errors.push(where + '.maxParticles 超過硬上限 ' + HARD_LIMITS.maxParticlesPerLayer);
      }
    }
    validateRange(layer.lifetime, where + '.lifetime', errors, { nonNegative: true });
    if (layer.lifetime === undefined) errors.push(where + '.lifetime 必填');
    validateRange(layer.speed, where + '.speed', errors);
    validateRange(layer.rotationStart, where + '.rotationStart', errors);
    validateRange(layer.rotationSpeed, where + '.rotationSpeed', errors);
    validateRange(layer.startScale, where + '.startScale', errors, { nonNegative: true });
    if (layer.alignToVelocity !== undefined && typeof layer.alignToVelocity !== 'boolean') {
      errors.push(where + '.alignToVelocity 必須是布林值');
    }
    if (layer.worldSpace !== undefined && typeof layer.worldSpace !== 'boolean') errors.push(where + '.worldSpace 必須是布林值');
    /* 刻意不強制「有 velocityRotationOffset 就必須 alignToVelocity」：
       Editor 的勾選框關掉時 offset 仍留在資料裡，強制檢查會讓純粹的開關動作
       產生不合法的 preset。offset 單獨存在時沒有作用，這一點寫在 Schema 文件。 */
    if (layer.velocityRotationOffset !== undefined &&
        !isFiniteNumber(layer.velocityRotationOffset)) {
      errors.push(where + '.velocityRotationOffset 必須是有限數（弧度）');
    }
    if (layer.direction !== undefined && !isFiniteNumber(layer.direction)) {
      errors.push(where + '.direction 必須是有限數（角度）');
    }
    if (layer.spread !== undefined && (!isFiniteNumber(layer.spread) || layer.spread < 0)) {
      errors.push(where + '.spread 必須是非負有限數（角度）');
    }
    validateVec2(layer.gravity, where + '.gravity', errors);
    /* 運動的三個補充項。全部可以省略，省略時的行為與加入它們之前完全相同。 */
    if (layer.drag !== undefined && (!isFiniteNumber(layer.drag) || layer.drag < 0)) {
      errors.push(where + '.drag 必須是非負有限數（每秒衰減率）');
    }
    if (layer.radialSpeed !== undefined && !isFiniteNumber(layer.radialSpeed)) {
      errors.push(where + '.radialSpeed 必須是有限數（px／秒，負值＝向心）');
    }
    if (layer.orbitalSpeed !== undefined && !isFiniteNumber(layer.orbitalSpeed)) {
      errors.push(where + '.orbitalSpeed 必須是有限數（弧度／秒）');
    }
    if (layer.noise !== undefined) {
      var n = layer.noise;
      if (!n || typeof n !== 'object' || Array.isArray(n)) {
        errors.push(where + '.noise 必須是 { strength, frequency, scrollSpeed }');
      } else {
        if (!isFiniteNumber(n.strength) || n.strength < 0) {
          errors.push(where + '.noise.strength 必須是非負有限數（像素）');
        }
        if (n.frequency !== undefined && (!isFiniteNumber(n.frequency) || n.frequency <= 0)) {
          errors.push(where + '.noise.frequency 必須是正的有限數');
        }
        if (n.scrollSpeed !== undefined && !isFiniteNumber(n.scrollSpeed)) {
          errors.push(where + '.noise.scrollSpeed 必須是有限數');
        }
      }
    }
    var spawn = layer.spawn;
    if (spawn !== undefined) {
      if (!spawn || SPAWN_SHAPES.indexOf(spawn.shape) < 0) {
        errors.push(where + '.spawn.shape 非法值：' + (spawn && spawn.shape));
      } else if (spawn.shape === 'circle' && (!isFiniteNumber(spawn.radius) || spawn.radius < 0)) {
        errors.push(where + '.spawn.radius 必須是非負有限數');
      } else if (spawn.shape === 'box') {
        if (!isFiniteNumber(spawn.width) || !isFiniteNumber(spawn.height) ||
            spawn.width < 0 || spawn.height < 0) {
          errors.push(where + '.spawn 的 width/height 必須是非負有限數');
        }
      }
    }
    if (!layer.assetId) errors.push(where + '.assetId 必填');
  }

  function validateProceduralLayer(layer, where, errors) {
    if (layer.effect === 'waterTornado') {
      var w = layer.water;
      if (w && w.palette !== undefined && ['water', 'fire'].indexOf(w.palette) < 0) errors.push(where + '.water.palette 必須為 water 或 fire');
      if (!w || !waterGenerator || waterGenerator.PARTS.indexOf(w.part) < 0) errors.push(where + '.water.part 非法');
      if (w) ['speed', 'density'].forEach(function (k) {
        if (w[k] !== undefined && (!isFiniteNumber(w[k]) || w[k] < 0 || w[k] > 4)) errors.push(where + '.water.' + k + ' 必須在 0..4');
      });
      if (layer.assetId || layer.sheet || layer.size || layer.scrollSpeed) errors.push(where + ' waterTornado 不接受 assetId/sheet/size/scrollSpeed');
      return;
    }
    if (layer.water || layer.radiusProfile) errors.push(where + ' uvScroll 不接受 water/radiusProfile');
    if (PROCEDURAL_EFFECTS.indexOf(layer.effect) < 0) {
      errors.push(where + '.effect 非法值：' + layer.effect +
        '（目前只支援 ' + PROCEDURAL_EFFECTS.join('、') + '）');
    }
    if (!layer.assetId) errors.push(where + '.assetId 必填');
    validateVec2(layer.size, where + '.size', errors);
    if (layer.size !== undefined && layer.size &&
        (layer.size.x <= 0 || layer.size.y <= 0)) {
      errors.push(where + '.size 必須為正');
    }
    validateVec2(layer.scrollSpeed, where + '.scrollSpeed', errors);
  }

  var PRESET_FIELDS = ['schemaVersion', 'id', 'duration', 'loop', 'layers', 'sizing'];
  var COMMON_LAYER_FIELDS = ['id', 'type', 'enabled', 'assetId', 'zIndex', 'position',
    'rotation', 'scale', 'anchor', 'alpha', 'tint', 'blendMode', 'delay', 'duration',
    'alphaOverLife', 'tintOverLife', 'scaleOverLife', 'rotationOverLife', 'sheet'];
  /* 這四個欄位掛在 sprite 與 procedural，不掛 particle：
     這兩型走 updateSpriteLayer，兩軸各自取樣；粒子走 updateParticleLayer，
     那裡 scaleY 直接等於 scaleX。允許粒子層寫了卻不生效，正是規格禁止的
     silent fallback，所以寧可讓它報「不支援的欄位」。

     rotationX／rotationYOverLife 也在這一組，因為它們最終是乘在
     scaleY／scaleX 上——粒子層那邊沒有分軸縮放可以承載它們。 */
  var PER_AXIS_SCALE_FIELDS = ['scaleXOverLife', 'scaleYOverLife',
    'rotationXOverLife', 'rotationYOverLife'];
  /* 位移曲線同樣只掛 sprite 與 procedural，理由與上面那一組一樣：它們在
     updateSpriteLayer 裡加在 d.position 上，而粒子的位置是由 speed／gravity／
     spawn 那一整套運動算出來的，沒有一個「圖層位置」可以加。
     粒子要飄要偏，用的是那一套，不是這兩條曲線。 */
  var OFFSET_FIELDS = ['offsetXOverLife', 'offsetYOverLife'];
  var TYPE_ONLY_FIELDS = {
    sprite: PER_AXIS_SCALE_FIELDS.concat(OFFSET_FIELDS).concat(['radiusProfile']),
    particle: ['emission', 'maxParticles', 'lifetime', 'spawn', 'speed', 'direction',
      'spread', 'gravity', 'drag', 'radialSpeed', 'orbitalSpeed', 'noise',
      'startScale', 'rotationStart', 'rotationSpeed',
      'alignToVelocity', 'velocityRotationOffset', 'worldSpace', 'subEmitter'],
    procedural: ['effect', 'size', 'scrollSpeed', 'water', 'radiusProfile']
      .concat(PER_AXIS_SCALE_FIELDS).concat(OFFSET_FIELDS)
  };

  /* 未知欄位必須報錯：拼錯的 alpah 若被靜靜忽略，使用者會看到「設定沒有效果」
     卻查不出原因，這正是規格禁止的 silent fallback。 */
  function checkUnknownFields(obj, allowed, where, errors) {
    Object.keys(obj).forEach(function (key) {
      if (allowed.indexOf(key) < 0) errors.push(where + ' 有不支援的欄位：' + key);
    });
  }

  /* 巢狀結構同樣要擋未知欄位，否則 spawn.raduis、emission.counnt 這類拼錯
     仍會被靜靜忽略——「無 silent fallback」必須連巢狀一起守。 */
  var NESTED_FIELDS = {
    position: ['x', 'y'], scale: ['x', 'y'], anchor: ['x', 'y'],
    gravity: ['x', 'y'], size: ['x', 'y'], scrollSpeed: ['x', 'y'],
    emission: ['mode', 'count', 'rate'],
    spawn: ['shape', 'radius', 'width', 'height'],
    noise: ['strength', 'frequency', 'scrollSpeed'],
    sheet: ['columns', 'rows', 'count', 'mode', 'fps', 'randomStart', 'loop'],
    water: ['part', 'speed', 'density', 'palette'],
    radiusProfile: ['centerScale', 'topRatio', 'bottomRatio', 'sourceTopRatio', 'sourceBottomRatio', 'topY', 'centerY', 'bottomY'],
    subEmitter: ['layer', 'on', 'count', 'inheritVelocity']
  };

  function checkNestedFields(layer, where, errors) {
    Object.keys(NESTED_FIELDS).forEach(function (key) {
      var value = layer[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        checkUnknownFields(value, NESTED_FIELDS[key], where + '.' + key, errors);
      }
    });
  }

  function validatePreset(preset) {
    var errors = [];
    if (!preset || typeof preset !== 'object') return { ok: false, errors: ['preset 不是物件'] };

    if (preset.schemaVersion !== SCHEMA_VERSION) {
      errors.push('未知的 schemaVersion：' + preset.schemaVersion +
        '（本 Core 支援 ' + SCHEMA_VERSION + '）');
    }
    if (typeof preset.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(preset.id)) {
      errors.push('preset.id 必須是小寫英數與連字號，且以英數開頭');
    }
    if (!isFiniteNumber(preset.duration) || preset.duration <= 0) {
      errors.push('preset.duration 必須是正的有限數');
    } else if (preset.duration > HARD_LIMITS.maxDuration) {
      errors.push('preset.duration 超過硬上限 ' + HARD_LIMITS.maxDuration + ' 秒');
    }
    if (preset.loop !== undefined && typeof preset.loop !== 'boolean') {
      errors.push('preset.loop 必須是布林值');
    }
    if (!Array.isArray(preset.layers) || !preset.layers.length) {
      errors.push('preset.layers 不得為空');
      return { ok: errors.length === 0, errors: errors };
    }
    if (preset.layers.length > HARD_LIMITS.maxLayers) {
      errors.push('圖層數超過硬上限 ' + HARD_LIMITS.maxLayers);
    }

    checkUnknownFields(preset, PRESET_FIELDS, 'preset', errors);
    if (preset.sizing !== undefined) validateSizing(preset.sizing, errors);

    var seenIds = Object.create(null);
    preset.layers.forEach(function (layer, i) {
      var where = 'layers[' + i + ']';
      if (!layer || typeof layer !== 'object') { errors.push(where + ' 不是物件'); return; }
      if (typeof layer.id !== 'string' || !layer.id) errors.push(where + '.id 必填');
      else if (seenIds[layer.id]) errors.push('圖層 id 重複：' + layer.id);
      else seenIds[layer.id] = true;
      if (LAYER_TYPES.indexOf(layer.type) < 0) {
        errors.push(where + '.type 非法值：' + layer.type +
          '（支援 ' + LAYER_TYPES.join('、') + '）');
        return;
      }
      checkUnknownFields(layer, COMMON_LAYER_FIELDS.concat(TYPE_ONLY_FIELDS[layer.type]),
        where, errors);
      checkNestedFields(layer, where, errors);
      validateCommonLayer(layer, where, errors);
      if (layer.type === 'particle') validateParticleLayer(layer, where, errors);
      else if (layer.type === 'procedural') validateProceduralLayer(layer, where, errors);
      else if (!layer.assetId) errors.push(where + '.assetId 必填');
    });

    validateSubEmitterGraph(preset, errors);

    return { ok: errors.length === 0, errors: errors };
  }

  /* 子發射器要跨圖層看才驗得出來：指到不存在的層、指到不是 sub 模式的層、
     沒有人觸發的 sub 層（那是一層永遠不會出現的死圖層），以及環。

     環為什麼非擋不可：A 死了生 B、B 死了生 A，只要 B 的壽命不是 0，
     粒子數就會每一輪翻倍——不是無窮迴圈，是「跑幾秒之後整個分頁凍住」，
     而且在 Editor 裡看起來只是「怎麼越來越卡」。 */
  function validateSubEmitterGraph(preset, errors) {
    if (!preset || !Array.isArray(preset.layers)) return;
    var byId = Object.create(null);
    preset.layers.forEach(function (l) { if (l && typeof l.id === 'string') byId[l.id] = l; });

    var referenced = Object.create(null);
    var edges = Object.create(null);
    preset.layers.forEach(function (l, i) {
      var se = l && l.subEmitter;
      if (!se || typeof se !== 'object' || typeof se.layer !== 'string') return;
      var where = 'layers[' + i + '].subEmitter';
      var target = byId[se.layer];
      if (!target) {
        errors.push(where + '.layer 指向不存在的圖層：' + se.layer);
        return;
      }
      if (target.type !== 'particle') {
        errors.push(where + '.layer 必須指向 particle 圖層：' + se.layer);
        return;
      }
      if (!target.emission || target.emission.mode !== 'sub') {
        errors.push(where + '.layer 指向的 ' + se.layer +
          ' 必須是 emission.mode = "sub"（否則它會自己發射一次，變成兩份）');
        return;
      }
      referenced[se.layer] = true;
      (edges[l.id] = edges[l.id] || []).push(se.layer);
    });

    preset.layers.forEach(function (l, i) {
      if (l && l.emission && l.emission.mode === 'sub' && !referenced[l.id]) {
        errors.push('layers[' + i + '] 的 emission.mode 是 "sub" 卻沒有任何圖層觸發它' +
          '——這一層永遠不會出現');
      }
    });

    /* 深度優先找環。層數上限 32，遞迴深度不會有問題。 */
    var state = Object.create(null);            // 1=造訪中 2=已完成
    var cycle = null;
    function walk(id) {
      if (cycle) return;
      if (state[id] === 1) { cycle = id; return; }
      if (state[id] === 2) return;
      state[id] = 1;
      (edges[id] || []).forEach(walk);
      state[id] = 2;
    }
    Object.keys(edges).forEach(walk);
    if (cycle) errors.push('子發射器形成環：' + cycle + ' 會間接觸發自己（粒子數會每一輪翻倍）');
  }

  /* 決定性序列化：欄位順序固定，Editor 存檔→載入→再存檔必須位元相同。 */
  function validateSizing(s, errors) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push('sizing 必須是物件'); return; }
    checkUnknownFields(s, ['shape', 'radiusM', 'widthM', 'heightM', 'authored'], 'sizing', errors);
    if (['circle', 'square', 'rectangle', 'projectile-circle', 'projectile-square', 'custom'].indexOf(s.shape) < 0) {
      errors.push('sizing.shape 非法');
    }
    ['radiusM', 'widthM', 'heightM'].forEach(function (key) {
      if (s[key] !== undefined && (!isFiniteNumber(s[key]) || s[key] <= 0)) errors.push('sizing.' + key + ' 必須是正數');
    });
    var a = s.authored;
    if (!a || typeof a !== 'object' || Array.isArray(a)) { errors.push('sizing.authored 必填'); return; }
    checkUnknownFields(a, ['radius', 'width', 'height'], 'sizing.authored', errors);
    Object.keys(a).forEach(function (key) {
      if (!isFiniteNumber(a[key]) || a[key] <= 0) errors.push('sizing.authored.' + key + ' 必須是正數');
    });
    if (!(a.radius > 0) && !(a.width > 0 && a.height > 0)) errors.push('sizing.authored 缺少半徑或長寬');
    if (s.shape === 'custom' && !(s.radiusM > 0) && !(s.widthM > 0 && s.heightM > 0)) {
      errors.push('custom sizing 必須單獨定義米制尺寸');
    }
  }
  var PRESET_KEY_ORDER = ['schemaVersion', 'id', 'duration', 'loop', 'layers'];
  var LAYER_KEY_ORDER = ['id', 'type', 'enabled', 'assetId', 'effect', 'zIndex',
    'position', 'rotation', 'scale', 'anchor', 'size', 'alpha', 'tint', 'blendMode',
    'delay', 'duration', 'scrollSpeed',
    'emission', 'maxParticles', 'lifetime', 'spawn', 'speed', 'direction', 'spread',
    'gravity', 'drag', 'radialSpeed', 'orbitalSpeed', 'noise',
    'startScale', 'rotationStart', 'rotationSpeed',
    'alignToVelocity', 'velocityRotationOffset', 'worldSpace', 'subEmitter',
    'alphaOverLife', 'tintOverLife', 'scaleOverLife', 'scaleXOverLife', 'scaleYOverLife',
    'rotationOverLife', 'rotationXOverLife', 'rotationYOverLife',
    'offsetXOverLife', 'offsetYOverLife', 'sheet', 'radiusProfile', 'water'];

  // 每個水平截面的目標半徑／來源半徑；後端只套用 Core 算出的比例。
  function radiusProfileScale(profile, y) {
    var p = profile || {};
    var mid = p.centerY === undefined ? 0.5 : p.centerY;
    var top = p.topY === undefined ? 0 : p.topY;
    var bottom = p.bottomY === undefined ? 1 : p.bottomY;
    var upper = y < mid;
    var k = Math.min(1, Math.abs(y - mid) / (upper ? mid - top : bottom - mid));
    var target = upper ? p.topRatio : p.bottomRatio;
    var source = upper ? p.sourceTopRatio : p.sourceBottomRatio;
    target = target === undefined ? 2 : target;
    source = source === undefined ? 2 : source;
    return (p.centerScale === undefined ? 1 : p.centerScale) *
      (1 + (target - 1) * k * k) / (1 + (source - 1) * k * k);
  }

  /* 巢狀物件（position、spawn、emission…）也要遞迴排序，否則同樣語意的 preset
     只因為插入順序不同就產生不同 bytes，「位元穩定」的承諾會落空。 */
  function canonical(value, order) {
    if (Array.isArray(value)) return value.map(function (v) { return canonical(v); });
    if (!value || typeof value !== 'object') return value;
    var out = {};
    (order || []).forEach(function (k) {
      if (value[k] !== undefined) out[k] = canonical(value[k]);
    });
    Object.keys(value).sort().forEach(function (k) {
      if (out[k] === undefined && value[k] !== undefined) out[k] = canonical(value[k]);
    });
    return out;
  }

  function serialisePreset(preset) {
    var normalised = canonical(preset, PRESET_KEY_ORDER);
    normalised.layers = preset.layers.map(function (layer) {
      return canonical(layer, LAYER_KEY_ORDER);
    });
    return JSON.stringify(normalised, null, 2) + '\n';
  }

  /* ---------- 圖層預設值 ---------- */
  function layerDefaults(layer) {
    return {
      id: layer.id,
      type: layer.type,
      enabled: layer.enabled !== false,
      assetId: layer.assetId,
      effect: layer.effect,
      water: layer.water,
      zIndex: layer.zIndex || 0,
      position: layer.position || { x: 0, y: 0 },
      rotation: layer.rotation || 0,
      scale: layer.scale || { x: 1, y: 1 },
      anchor: layer.anchor || { x: 0.5, y: 0.5 },
      size: layer.size,
      profileScales: layer.radiusProfile ? Array.from({ length: 64 }, function (_, i) {
        return radiusProfileScale(layer.radiusProfile, (i + 0.5) / 64);
      }) : null,
      alpha: layer.alpha === undefined ? 1 : layer.alpha,
      tint: layer.tint || '#ffffff',
      blendMode: layer.blendMode || 'normal',
      delay: layer.delay || 0,
      duration: layer.duration,
      scrollSpeed: layer.scrollSpeed || { x: 0, y: 0 },
      emission: layer.emission,
      maxParticles: layer.maxParticles,
      lifetime: layer.lifetime,
      spawn: layer.spawn || { shape: 'point' },
      speed: layer.speed === undefined ? 0 : layer.speed,
      direction: layer.direction === undefined ? -90 : layer.direction,
      spread: layer.spread === undefined ? 0 : layer.spread,
      gravity: layer.gravity || { x: 0, y: 0 },
      drag: layer.drag === undefined ? 0 : layer.drag,
      radialSpeed: layer.radialSpeed === undefined ? 0 : layer.radialSpeed,
      orbitalSpeed: layer.orbitalSpeed === undefined ? 0 : layer.orbitalSpeed,
      /* null 而不是補一個 strength:0 的物件：更新迴圈用它一次判斷就整段跳過。 */
      noise: layer.noise ? {
        strength: layer.noise.strength,
        frequency: layer.noise.frequency === undefined ? 0.01 : layer.noise.frequency,
        scrollSpeed: layer.noise.scrollSpeed === undefined ? 0 : layer.noise.scrollSpeed
      } : null,
      startScale: layer.startScale === undefined ? 1 : layer.startScale,
      rotationStart: layer.rotationStart === undefined ? 0 : layer.rotationStart,
      rotationSpeed: layer.rotationSpeed === undefined ? 0 : layer.rotationSpeed,
      alignToVelocity: layer.alignToVelocity === true,
      worldSpace: layer.worldSpace === true,
      subEmitter: layer.subEmitter ? {
        layer: layer.subEmitter.layer,
        on: layer.subEmitter.on || 'death',
        count: layer.subEmitter.count === undefined ? 1 : layer.subEmitter.count,
        inheritVelocity: layer.subEmitter.inheritVelocity === undefined
          ? 0 : layer.subEmitter.inheritVelocity
      } : null,
      velocityRotationOffset: layer.velocityRotationOffset === undefined
        ? 0 : layer.velocityRotationOffset,
      alphaOverLife: layer.alphaOverLife,
      tintOverLife: layer.tintOverLife,
      /* 派生欄位（不進 preset、不參與序列化）：熱路徑只讀這一份已解析好的
         [[t,int]]，逐幀逐粒子不再解析十六進位字串。沒有曲線時是 null，
         更新迴圈可以整段跳過，行為與加入本功能之前完全相同。 */
      tintCurve: toColorCurve(layer.tintOverLife),
      /* 正規化成「一定有 count／mode／loop」的形狀，更新迴圈就不必逐幀補預設值。
         沒有 sheet 就是 null，整段跳過。 */
      sheet: layer.sheet ? {
        columns: layer.sheet.columns,
        rows: layer.sheet.rows,
        count: layer.sheet.count === undefined
          ? layer.sheet.columns * layer.sheet.rows : layer.sheet.count,
        mode: layer.sheet.mode || 'life',
        fps: layer.sheet.fps === undefined ? 0 : layer.sheet.fps,
        randomStart: layer.sheet.randomStart === true,
        /* life 模式預設不循環（演完停在最後一格），fps 模式預設循環。
           這兩個預設分別對應它們最常見的用途，寫反了會很明顯。 */
        loop: layer.sheet.loop === undefined
          ? (layer.sheet.mode === 'fps') : layer.sheet.loop
      } : null,
      scaleOverLife: layer.scaleOverLife,
      /* 刻意保留 undefined 而不填預設值：updateSpriteLayer 要靠
         「有沒有給」來決定該軸是走自己的曲線還是沿用 scaleOverLife。 */
      scaleXOverLife: layer.scaleXOverLife,
      scaleYOverLife: layer.scaleYOverLife,
      rotationOverLife: layer.rotationOverLife,
      rotationXOverLife: layer.rotationXOverLife,
      rotationYOverLife: layer.rotationYOverLife,
      offsetXOverLife: layer.offsetXOverLife,
      offsetYOverLife: layer.offsetYOverLife
    };
  }

  /* ---------- Runtime ---------- */

  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (k) { deepFreeze(value[k]); });
      Object.freeze(value);
    }
    return value;
  }

  function createRuntime(options) {
    var opts = options || {};
    var backend = opts.backend;
    var resolver = opts.resolver;
    if (!backend) throw new Error('VFXCore.createRuntime 需要 backend');
    if (!resolver || typeof resolver.resolve !== 'function') {
      throw new Error('VFXCore.createRuntime 需要具備 resolve(assetId) 的 resolver');
    }
    /* 用 || 會把 0 當成「沒設定」而悄悄換回預設值——maxParticles:0 是合法的
       「完全關閉粒子」意圖，不能被吃掉。這裡改成明確的 undefined 判斷＋驗證。 */
    function budgetValue(name) {
      var raw = opts.budget ? opts.budget[name] : undefined;
      if (raw === undefined) return DEFAULT_BUDGET[name];   // 只有「沒給」才用預設，null 視為錯誤
      if (!isFiniteNumber(raw) || raw < 0 || Math.floor(raw) !== raw) {
        throw new Error('budget.' + name + ' 必須是非負整數，收到：' + raw);
      }
      // 有限整數還不夠：極大值等於把上限關掉，也會讓發射迴圈失去終止保證。
      if (raw > HARD_LIMITS.budget[name]) {
        throw new Error('budget.' + name + ' 不得超過 HARD_LIMITS.budget.' + name +
          '（' + HARD_LIMITS.budget[name] + '），收到：' + raw);
      }
      return raw;
    }
    var budget = {
      maxActiveEffects: budgetValue('maxActiveEffects'),
      maxParticles: budgetValue('maxParticles'),
      perEffectParticleLimit: budgetValue('perEffectParticleLimit')
    };
    var maxPooledPerKey = 256;
    if (opts.maxPooledPerKey !== undefined) {
      if (!isFiniteNumber(opts.maxPooledPerKey) || opts.maxPooledPerKey < 0 ||
          Math.floor(opts.maxPooledPerKey) !== opts.maxPooledPerKey) {
        throw new Error('maxPooledPerKey 必須是非負整數');
      }
      maxPooledPerKey = opts.maxPooledPerKey;
    }

    var presets = Object.create(null);
    var effects = [];
    var proceduralClock = 0;
    var nextEffectId = 1;
    var totalParticles = 0;
    var droppedEffects = 0;
    var droppedParticles = 0;

    /* 節點池：粒子生滅頻繁，每顆都 new 會讓 GC 在戰鬥中尖峰。
       依 (assetUrl, blendMode, kind) 分池回收。 */
    var pools = {};
    var particlePool = [];      // 粒子狀態物件的 free-list
    function poolKey(spec) {
      return spec.kind + '|' + spec.assetUrl + '|' + spec.blendMode +
        (spec.sheet ? '|' + spec.sheet.columns + 'x' + spec.sheet.rows : '') +
        (spec.profileScales ? '|profile:' + spec.profileScales.join(',') : '') +
        (spec.generated ? '|generated:' + spec.generated : '');
    }
    function acquireNode(spec) {
      var key = poolKey(spec);
      var pool = pools[key];
      if (pool && pool.length) return pool.pop();
      return backend.createNode(spec);
    }
    var hideTransform = { visible: false };
    function releaseNode(spec, node) {
      var key = poolKey(spec);
      if (!pools[key]) pools[key] = [];
      backend.updateNode(node, hideTransform);
      // 池有上限：長時間編輯、不斷換素材時，冷門節點不該無限堆積
      if (pools[key].length >= maxPooledPerKey) backend.destroyNode(node);
      else pools[key].push(node);
    }

    function registerPreset(preset) {
      assertLive('registerPreset');
      var result = validatePreset(preset);
      if (!result.ok) {
        throw new Error('preset「' + (preset && preset.id) + '」不合法：\n  - ' +
          result.errors.join('\n  - '));
      }
      // 註冊時就解析素材，未知 assetId 立刻失敗，而不是播放時才靜靜不顯示
      preset.layers.forEach(function (layer) {
        if (layer.assetId) resolver.resolve(layer.assetId);
      });
      /* 存入自己的深拷貝並凍結：否則呼叫端註冊後仍可把 type／assetId 改成非法值，
         等於繞過驗證，而且 Editor 與 Runtime 會拿到不同內容。 */
      var frozen = deepFreeze(JSON.parse(JSON.stringify(preset)));
      presets[frozen.id] = frozen;
      return frozen.id;
    }

    function play(presetId, params) {
      assertLive('play');
      var preset = presets[presetId];
      if (!preset) throw new Error('未註冊的 preset：' + presetId);
      if (effects.length >= budget.maxActiveEffects) {
        droppedEffects++;
        return null;                       // 超出預算就不播，寧可少一個特效也不要掉幀
      }
      var p = params || {};
      /* startTime：從生命週期的第幾秒開始播，預設 0（與擴充前完全相同）。
         給 Editor 用的：改一個參數就重播，播放頭若總是歸零，正在調 50% 位置的
         曲線就永遠看不到自己改的那一段。Sprite 的 transform 是 progress 的
         純函數，所以直接跳到該時間是精確的；粒子則是從沒有歷史的狀態開始，
         與原本的重播行為一致。 */
      var startTime = p.startTime === undefined ? 0 : p.startTime;
      if (!isFiniteNumber(startTime) || startTime < 0) {
        throw new Error('play(startTime) 需要非負的有限數');
      }
      var effect = {
        handle: nextEffectId++,
        presetId: presetId,
        preset: preset,
        time: startTime,
        timeScale: isFiniteNumber(p.timeScale) && p.timeScale > 0 ? p.timeScale : 1,
        done: false,
        origin: { x: 0, y: 0 },
        rotation: 0,
        scale: 1, scaleX: 1, scaleY: 1, opacity: 1,
        seed: (p.seed === undefined ? (nextEffectId * 2654435761) : p.seed) >>> 0,
        layers: [],
        /* 圖層 id → 圖層狀態。子發射器要靠 id 找到目標層；
           每次都線性搜尋的話，一顆粒子死掉就掃一次整個圖層陣列。 */
        byId: Object.create(null)
      };
      applyTransformParams(effect, p);
      preset.layers.forEach(function (raw, i) {
        var layer = layerDefaults(raw);
        if (!layer.enabled) return;
        var state = {
          def: layer,
          rng: makeRng((effect.seed + i * 0x9E3779B9) >>> 0),
          node: null,
          nodeSpec: null,
          particles: [],
          emitAccumulator: 0,
          burstDone: false,
          noiseSeed: (effect.seed + i * 0x85EBCA6B) | 0,

          scrollX: 0,
          scrollY: 0
        };
        effect.layers.push(state);
        effect.byId[layer.id] = state;
      });
      effects.push(effect);
      return effect.handle;
    }

    /* ---- 特效層級的 transform（play 與 setTransform 共用同一套解讀） ----
       position / rotation / scale 是 play 原本就有的欄位；scaleX / scaleY 是分軸縮放，
       給光束、劍氣這類「沿著一個方向拉長」的特效用：preset 以名目長度作畫，
       Runtime 再依實際距離只拉 X 軸。

       三個縮放值的關係：
         scale            等比縮放，也是**粒子貼圖尺寸**用的那一個
         scaleX / scaleY  圖層座標（position）與 sprite 尺寸各走各的軸
       沒給 scaleX／scaleY 時兩軸都等於 scale（與擴充前完全相同）。
       只給分軸、沒給 scale 時，粒子尺寸取兩軸絕對值的**較小者**：
       把光束拉長三倍不該讓沿線的火花也胖三倍——拉長是幾何，不是放大。

       play 對 position 沿用原本的寬鬆解讀（缺欄位＝0）；縮放與旋轉一旦有給就必須是
       有限數——NaN 進到 transform 會讓整個特效消失卻查不到原因，屬規格禁止的 silent fallback。 */
    function transformNumber(value, name) {
      if (!isFiniteNumber(value)) throw new Error(name + ' 必須是有限數，收到：' + value);
      return value;
    }
    function applyTransformParams(effect, p) {
      if (p.position !== undefined && p.position !== null) {
        if (p.position.x !== undefined) effect.origin.x = transformNumber(p.position.x, 'position.x');
        if (p.position.y !== undefined) effect.origin.y = transformNumber(p.position.y, 'position.y');
      }
      if (p.opacity !== undefined) effect.opacity = Math.max(0, Math.min(1, transformNumber(p.opacity, 'opacity')));
      if (p.rotation !== undefined) effect.rotation = transformNumber(p.rotation, 'rotation');
      var hasScale = p.scale !== undefined;
      var hasAxis = p.scaleX !== undefined || p.scaleY !== undefined;
      if (hasScale) {
        var s = transformNumber(p.scale, 'scale');
        effect.scale = s;
        effect.scaleX = s;
        effect.scaleY = s;
      }
      if (hasAxis) {
        if (p.scaleX !== undefined) effect.scaleX = transformNumber(p.scaleX, 'scaleX');
        if (p.scaleY !== undefined) effect.scaleY = transformNumber(p.scaleY, 'scaleY');
        if (!hasScale) effect.scale = Math.min(Math.abs(effect.scaleX), Math.abs(effect.scaleY));
      }
    }

    function findEffect(handle) {
      for (var i = 0; i < effects.length; i++) {
        if (effects[i].handle === handle) return effects[i];
      }
      return null;
    }

    /* 播放中途改變特效的位置／旋轉／縮放。Runtime Adapter 靠這支讓飛行物逐幀前進、
       讓場域跟著玩家走、讓環繞體轉圈——Core 本身不認得「目標」與「玩家」，
       只提供這個泛用的旋鈕。只更新有給的欄位；未知 handle 回 false。
       Sprite 圖層的 transform 是 (origin, progress) 的純函數，下一幀就會在新位置；
       已經出生的粒子留在它出生時的世界座標上（拖尾因此自然形成），新粒子從新原點出生。 */
    function setTransform(handle, params) {
      assertLive('setTransform');
      var effect = findEffect(handle);
      if (!effect) return false;
      applyTransformParams(effect, params || {});
      return true;
    }

    /* 共用結果物件：每層每幀都 new 一個，在 24 特效 × 32 層下同樣是可觀的配置量。
       呼叫端必須立即讀取，不得保存。 */
    var lifeResult = { active: false, progress: 0, elapsed: 0 };
    function layerLife(effect, layer) {
      var duration = layer.def.duration === undefined ? effect.preset.duration : layer.def.duration;
      var t = effect.time - layer.def.delay;
      if (t < 0) { lifeResult.active = false; lifeResult.progress = 0; return lifeResult; }
      if (duration <= 0) { lifeResult.active = false; lifeResult.progress = 1; return lifeResult; }
      if (t >= duration) { lifeResult.active = false; lifeResult.progress = 1; return lifeResult; }
      lifeResult.active = true;
      lifeResult.progress = t / duration;
      /* fps 模式的序列幀要的是「這一層已經播了幾秒」，不是 0..1 的進度。 */
      lifeResult.elapsed = t;
      return lifeResult;
    }

    function nodeSpecFor(layer) {
      var spec = {
        kind: layer.def.profileScales ? 'profiled' : (layer.def.type === 'procedural' ? 'tiled' : 'sprite'),
        assetUrl: layer.def.effect === 'waterTornado' ? null : resolver.resolve(layer.def.assetId),
        blendMode: layer.def.blendMode
      };
      /* 後端要靠這個把整張圖切成每一格的貼圖。同一張圖切成不同格線就是
         不同的節點規格，所以 poolKey 也要帶上——否則 8×8 的節點會被
         重用成 4×4 的，畫面上是「動畫突然變成別的東西」。 */
      if (layer.def.sheet) {
        spec.sheet = { columns: layer.def.sheet.columns, rows: layer.def.sheet.rows };
      }
      if (layer.def.profileScales) spec.profileScales = layer.def.profileScales;
      if (layer.def.effect === 'waterTornado') { spec.kind = 'generated'; spec.generated = layer.def.water.part; }
      return spec;
    }

    /* 世界座標：特效本身的 rotation/scale 套用到圖層的區域座標上。
       Editor 與 Runtime 共用這段，因此「Editor 裡拖出來的位置」與
       「遊戲裡播出來的位置」是同一套算式。 */
    var scratchWorld = { x: 0, y: 0 };
    function toWorld(effect, x, y) {
      /* 先在特效自己的座標系分軸縮放，再旋轉、再平移——
         等比縮放時與擴充前（(x*c - y*sn) * s）逐位元相同。 */
      var lx = x * effect.scaleX, ly = y * effect.scaleY;
      var c = Math.cos(effect.rotation), sn = Math.sin(effect.rotation);
      scratchWorld.x = effect.origin.x + (lx * c - ly * sn);
      scratchWorld.y = effect.origin.y + (lx * sn + ly * c);
      return scratchWorld;
    }

    /* 共用的 transform 物件：每幀每顆粒子都 new 一個 literal，在 1200 顆預算下
       等於每秒七萬個短命物件，GC 尖峰會直接變成掉幀。
       後端契約：updateNode 收到的 transform 只在該次呼叫內有效，不得保存引用。 */
    var scratchTransform = {
      visible: true, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      alpha: 1, tint: 0xffffff, frame: undefined, anchorX: 0.5, anchorY: 0.5, zIndex: 0,
      width: undefined, height: undefined, tileX: undefined, tileY: undefined
    };

    function updateSpriteLayer(effect, layer) {
      var life = layerLife(effect, layer);
      if (!life.active) {
        if (layer.node) { releaseNode(layer.nodeSpec, layer.node); layer.node = null; }
        return;
      }
      if (!layer.node) {
        layer.nodeSpec = nodeSpecFor(layer);
        layer.node = acquireNode(layer.nodeSpec);
      }
      var d = layer.def;
      var alphaK = sampleCurve(d.alphaOverLife, life.progress);
      var scaleK = sampleCurve(d.scaleOverLife, life.progress);
      var rotK = sampleCurve(d.rotationOverLife, life.progress);
      /* 分軸縮放的相容規則：沒給就沿用等比的 scaleOverLife。
         舊 preset 一個欄位都沒有 → 兩軸都拿 scaleK → 輸出與擴充前完全相同。 */
      var scaleKX = d.scaleXOverLife === undefined
        ? scaleK : sampleCurve(d.scaleXOverLife, life.progress);
      var scaleKY = d.scaleYOverLife === undefined
        ? scaleK : sampleCurve(d.scaleYOverLife, life.progress);

      /* 繞 X／Y 軸翻轉。2D 貼圖沒有厚度，也沒有相機，所以這裡做的是
         **正交投影**：一張平面繞著自己的水平軸轉 θ，投影到螢幕上的高度
         就是原本的 cos θ 倍。這不是近似值，是沒有透視時的正確結果。

           0°   → cos = 1     正面
           90°  → cos = 0     側面，看不見
           180° → cos = -1    翻到背面（負縮放＝鏡像），正是翻牌要的

         與真 3D 的差別是沒有近大遠小，而且背面看到的是同一張圖的鏡像，
         不會露出另一面。做翻牌、風車葉片、旋轉光環這類都夠用；
         需要透視的話得換一個帶投影矩陣的後端，那是另一個層級的改動。 */
      var flipY = d.rotationXOverLife === undefined
        ? 1 : Math.cos(sampleCurve(d.rotationXOverLife, life.progress) || 0);
      var flipX = d.rotationYOverLife === undefined
        ? 1 : Math.cos(sampleCurve(d.rotationYOverLife, life.progress) || 0);
      /* 位移曲線是**加**在 position 上的（見驗證處的說明），而且加在進入
         toWorld 之前——也就是在特效自己的座標系裡。這樣它會跟著特效一起
         旋轉與縮放，與 position 的行為一致；加在世界座標上的話，特效轉了
         90 度之後「往上飄」會變成「往右飄」。 */
      var offX = sampleCurve(d.offsetXOverLife, life.progress);
      var offY = sampleCurve(d.offsetYOverLife, life.progress);
      var world = toWorld(effect,
        d.position.x + (offX === null ? 0 : offX),
        d.position.y + (offY === null ? 0 : offY));
      var t = scratchTransform;
      t.visible = true;
      t.x = world.x;
      t.y = world.y;
      t.rotation = effect.rotation + d.rotation + (rotK === null ? 0 : rotK);
      /* 繞 Y 軸轉會壓縮水平方向，繞 X 軸轉會壓縮垂直方向——軸與被壓的方向是交叉的 */
      t.scaleX = d.scale.x * effect.scaleX * (scaleKX === null ? 1 : scaleKX) * flipX;
      t.scaleY = d.scale.y * effect.scaleY * (scaleKY === null ? 1 : scaleKY) * flipY;
      t.skewX = 0;
      if (effect.preset.sizing && effect.scaleX !== effect.scaleY) {
        // 尺寸屬於整個特效的座標軸，必須在圖層旋轉之後縮放。
        var localAngle = d.rotation + (rotK === null ? 0 : rotK);
        var ca = Math.cos(localAngle), sa = Math.sin(localAngle);
        var qx = d.scale.x * (scaleKX === null ? 1 : scaleKX) * flipX;
        var qy = d.scale.y * (scaleKY === null ? 1 : scaleKY) * flipY;
        var ax = effect.scaleX * ca * qx, ay = effect.scaleY * sa * qx;
        var bx = -effect.scaleX * sa * qy, by = effect.scaleY * ca * qy;
        var angleX = Math.atan2(ay, ax);
        var angleY = Math.atan2(-bx, by);
        t.rotation = effect.rotation + angleX;
        t.scaleX = Math.sqrt(ax * ax + ay * ay);
        t.scaleY = Math.sqrt(bx * bx + by * by);
        t.skewX = angleX - angleY;
      }
      t.alpha = effect.opacity * d.alpha * (alphaK === null ? 1 : alphaK);
      var tintK = sampleColorCurve(d.tintCurve, life.progress);
      t.tint = tintK === null ? colorToInt(d.tint) : mulColorInt(colorToInt(d.tint), tintK);
      /* 序列幀：sprite 的年紀就是它自己這一段的經過時間。 */
      t.frame = d.sheet ? sheetFrame(d.sheet, life.progress, life.elapsed, 0) : undefined;
      t.anchorX = d.anchor.x;
      t.anchorY = d.anchor.y;
      t.zIndex = d.zIndex;
      t.sortGroup = effect.handle; t.sortY = effect.origin.y;
      t.width = undefined; t.height = undefined; t.tileX = undefined; t.tileY = undefined;
      t.generated = undefined;
      if (d.effect === 'waterTornado') {
        var phaseTime = d.water.palette === 'fire' ? proceduralClock * effect.timeScale : life.elapsed;
        t.generated = waterGenerator.sample(d.water.part, phaseTime * (d.water.speed === undefined ? 1 : d.water.speed), d.water.density, d.water.palette);
      } else if (d.type === 'procedural') {
        layer.scrollX += d.scrollSpeed.x * effect.lastDt;
        layer.scrollY += d.scrollSpeed.y * effect.lastDt;
        t.width = d.size ? d.size.x : 256;
        t.height = d.size ? d.size.y : 256;
        t.tileX = layer.scrollX;
        t.tileY = layer.scrollY;
      }
      backend.updateNode(layer.node, t);
    }

    /* 單層上限只能比每特效上限更嚴格，不能拿來繞過它——
       否則 preset 寫 maxParticles:2000 就能吃掉整個全域預算。 */
    function layerParticleCap(d) {
      var layerLimit = (d.maxParticles === undefined || d.maxParticles === null)
        ? budget.perEffectParticleLimit : d.maxParticles;
      return Math.min(layerLimit, budget.perEffectParticleLimit);
    }

    /* 子發射：把 count 顆粒子丟進目標圖層，出生點是母粒子當下的位置。

       目標層可能在這一幀已經更新過了（圖層是照順序跑的），那些粒子就會晚一幀
       才被畫出來。這不是問題：節點從池子拿出來時是隱藏的（releaseNode 會先送
       一次 hideTransform），所以那一幀它不會以上一次使用時的樣子出現。
       為了少一幀而重排圖層順序，代價是 zIndex 與更新順序糾纏在一起，不划算。 */
    var subOrigin = { x: 0, y: 0, vx: 0, vy: 0 };
    function emitSub(effect, se, parent) {
      var target = effect.byId[se.layer];
      if (!target) return;                       // 被 enabled:false 關掉的層
      subOrigin.x = parent.x;
      subOrigin.y = parent.y;
      subOrigin.vx = parent.vx * se.inheritVelocity;
      subOrigin.vy = parent.vy * se.inheritVelocity;
      for (var i = 0; i < se.count; i++) spawnParticle(effect, target, subOrigin);
    }

    /* at：由子發射器指定的出生點與繼承速度（{ x, y, vx, vy }）。
       省略時就是圖層自己的 position，也就是加入子發射器之前的行為。 */
    function spawnParticle(effect, layer, at) {
      var d = layer.def;
      var perLayer = layerParticleCap(d);
      if (layer.particles.length >= perLayer || totalParticles >= budget.maxParticles) {
        droppedParticles++;
        return;
      }
      var rng = layer.rng;
      var angle = (d.direction + (rng() - 0.5) * d.spread) * Math.PI / 180;
      var speed = sampleRange(d.speed, rng);
      var px = at ? at.x : d.position.x, py = at ? at.y : d.position.y;
      if (d.spawn.shape === 'circle') {
        var a = rng() * Math.PI * 2;
        var r = Math.sqrt(rng()) * d.spawn.radius;
        px += Math.cos(a) * r; py += Math.sin(a) * r;
      } else if (d.spawn.shape === 'box') {
        px += (rng() - 0.5) * d.spawn.width;
        py += (rng() - 0.5) * d.spawn.height;
      }
      var spec = layer.nodeSpec || (layer.nodeSpec = nodeSpecFor(layer));
      // 粒子狀態物件也重用（free-list），避免每次發射都配置新物件
      var p = particlePool.length ? particlePool.pop() : {};
      p.x = px; p.y = py;
      p.spawnFrame = d.worldSpace ? { origin: { x: effect.origin.x, y: effect.origin.y }, rotation: effect.rotation, scaleX: effect.scaleX, scaleY: effect.scaleY } : null;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      /* 繼承母粒子的速度：煙要跟著碎片的去向飄一段，而不是原地冒出來。
         是「加上去」不是「取代」——子層自己的 speed／direction 仍然有效。 */
      if (at) { p.vx += at.vx; p.vy += at.vy; }
      p.life = 0;
      p.maxLife = sampleRange(d.lifetime, rng);
      p.rotation = sampleRange(d.rotationStart, rng);
      p.rotationSpeed = sampleRange(d.rotationSpeed, rng);
      p.baseScale = sampleRange(d.startScale, rng);
      /* 速度朝向的記憶。粒子是從 free-list 重用的，這兩個欄位一定要重設，
         否則新粒子會繼承上一顆的朝向。 */
      p.velAngle = 0;
      p.hasVelAngle = false;
      /* 序列幀的起始格。用圖層自己的 rng（決定性），不用 Math.random。
         沒開 randomStart 就一律從第 0 格開始，與加入本功能之前一致。 */
      p.frameOffset = (d.sheet && d.sheet.randomStart)
        ? Math.floor(rng() * d.sheet.count) : 0;
      p.node = acquireNode(spec);
      layer.particles.push(p);
      /* 出生觸發。放在最後（粒子已經完全初始化）才讀得到它的位置與速度。
         子發射器不准成環，所以這裡不會無限遞迴——由 validateSubEmitterGraph 擋。 */
      if (d.subEmitter && d.subEmitter.on === 'birth') emitSub(effect, d.subEmitter, p);
      totalParticles++;
    }

    function updateParticleLayer(effect, layer, dt) {
      var d = layer.def;
      var life = layerLife(effect, layer);
      /* sub 模式完全不自發射：這一層的粒子只由別人的子發射器丟進來。 */
      if (life.active && d.emission.mode !== 'sub') {
        if (d.emission.mode === 'burst') {
          if (!layer.burstDone) {
            var cap = layerParticleCap(d);
            for (var i = 0; i < d.emission.count; i++) {
              // 容量滿了就停，不要為了跑完 count 而做上萬次無效呼叫
              if (layer.particles.length >= cap || totalParticles >= budget.maxParticles) {
                droppedParticles++;
                break;
              }
              spawnParticle(effect, layer);
            }
            layer.burstDone = true;
          }
        } else {
          var perLayerCap = layerParticleCap(d);
          // accumulator 夾在單層容量內：即使 dt 異常大也不會累積出天文數字的迴圈次數
          layer.emitAccumulator = Math.min(layer.emitAccumulator + d.emission.rate * dt, perLayerCap);
          while (layer.emitAccumulator >= 1) {
            // 容量滿了就停止本幀發射，不要空轉磨掉 accumulator
            if (layer.particles.length >= perLayerCap || totalParticles >= budget.maxParticles) {
              droppedParticles++;
              layer.emitAccumulator = 0;
              break;
            }
            layer.emitAccumulator -= 1;
            spawnParticle(effect, layer);
          }
        }
      }
      /* 原地壓縮（swap-free 的 write-index 作法）：每幀 new 一個 alive 陣列，
         在 1200 顆粒子的預算下等於每秒配置六十個陣列＋大量短命 transform，
         GC 尖峰會直接變成掉幀。這裡改成就地覆寫並截短。 */
      var tint = colorToInt(d.tint);
      /* 沒有曲線時 tint 仍然是整層一個常數（提到迴圈外算一次）；
         有曲線才逐顆粒子取樣——粒子的生命進度各自不同，不能共用。 */
      var tintCurve = d.tintCurve;
      /* 噪聲的取樣種子固定在圖層上（不是每顆粒子）：同一片場才會讓相鄰的
         粒子一起被推向同一邊。seed 由特效的 seed 派生，因此重播同一份 preset
         得到逐位元相同的結果（Core 的決定性承諾）。 */
      var noise = (d.noise && d.noise.strength > 0) ? d.noise : null;
      var noiseSeed = layer.noiseSeed;
      var swirl = d.radialSpeed !== 0 || d.orbitalSpeed !== 0;
      var sheet = d.sheet;
      var subOn = d.subEmitter ? d.subEmitter.on : '';
      var write = 0;
      for (var j = 0; j < layer.particles.length; j++) {
        var p = layer.particles[j];
        p.life += dt;
        if (p.life >= p.maxLife) {
          /* 先觸發子發射再回收：p.x／p.vx 要在還沒被清掉之前讀。 */
          if (subOn === 'death') emitSub(effect, d.subEmitter, p);
          releaseNode(layer.nodeSpec, p.node);
          p.node = null;
          if (particlePool.length < 512) particlePool.push(p);
          totalParticles--;
          continue;
        }
        /* ---- 運動 ----
           分成四步，順序不能重排：

           1. 重力是**加速度**，累積進速度。
           2. 阻力作用在累積速度上，用 1/(1+drag*dt) 而不是 (1-drag*dt)：
              後者在 drag*dt > 1 時會讓速度反向（掉幀的那一幀粒子往回飛），
              前者對任何 dt 都單調趨近 0，不必為此夾限 dt。
           3. 線性位移積分。
           4. 徑向與環繞**直接作用在位置上**，不進速度、不累積。

           第 4 步為什麼不做成「加一個切線速度再積分」：那是顯式 Euler，
           半徑會指數發散——ω=1 轉/秒、dt=1/60 跑 6 秒，起始半徑 100 會變成 712。
           改成把位移向量**精確旋轉** ω·dt，半徑就守恆到浮點精度，
           一顆純環繞的粒子永遠繞在同一個圈上。徑向則是沿半徑方向的直線位移，
           本來就沒有積分誤差可言。 */
        p.vx += d.gravity.x * dt;
        p.vy += d.gravity.y * dt;
        if (d.drag > 0) {
          var damp = 1 / (1 + d.drag * dt);
          p.vx *= damp;
          p.vy *= damp;
        }
        var prevX = p.x, prevY = p.y;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (swirl) {
          /* 圓心取圖層自己的 position（發射器所在），不是特效原點：
             一個掛在偏移位置的漩渦，該繞的是它自己的中心。 */
          var ox = p.x - d.position.x, oy = p.y - d.position.y;
          var r2 = ox * ox + oy * oy;
          if (r2 > 1e-9) {
            if (d.radialSpeed !== 0) {
              var inv = 1 / Math.sqrt(r2);
              ox += d.radialSpeed * ox * inv * dt;
              oy += d.radialSpeed * oy * inv * dt;
            }
            if (d.orbitalSpeed !== 0) {
              /* 螢幕座標 y 向下，所以正的 ω 在畫面上是**順時針**——
                 與技能表「順時針繞行 {rps} 圈」的說法一致。 */
              var ang = d.orbitalSpeed * dt;
              var ca = Math.cos(ang), sa = Math.sin(ang);
              var rx = ox * ca - oy * sa;
              oy = ox * sa + oy * ca;
              ox = rx;
            }
            p.x = d.position.x + ox;
            p.y = d.position.y + oy;
          }
        }
        p.rotation += p.rotationSpeed * dt;
        /* 速度朝向在積分之後才更新，這樣 gravity 造成的轉向當幀就會反映出來。
           低於門檻時保留上一次的有效角度，而不是歸零；從出生到現在都沒動過的
           粒子則完全不加這一項，維持原本的固定旋轉行為。 */
        if (d.alignToVelocity) {
          /* 沒有漩渦時看速度、有漩渦時看**實際位移**：環繞是直接改位置的，
             p.v 完全不知道它的存在，只看速度會讓拖尾指錯邊。
             不無條件改用位移，是為了讓既有 preset 的輸出逐位元不變——
             純線性運動下位移就是 v*dt，atan2 對正倍率不變，但浮點的最後一位
             不保證相同，而「既有 preset 完全不變」是這個 Core 的承諾。 */
          var avx = p.vx, avy = p.vy;
          if (swirl) { avx = p.x - prevX; avy = p.y - prevY; }
          var sp2 = avx * avx + avy * avy;
          if (sp2 > VELOCITY_EPSILON * VELOCITY_EPSILON) {
            p.velAngle = Math.atan2(avy, avx);
            p.hasVelAngle = true;
          }
        }
        var k = p.life / p.maxLife;
        var alphaK = sampleCurve(d.alphaOverLife, k);
        var scaleK = sampleCurve(d.scaleOverLife, k);
        var rotK = sampleCurve(d.rotationOverLife, k);
        var nx = p.x, ny = p.y;
        if (noise) {
          /* 兩個分量各取一次噪聲，而且是**平移取樣域**而不是換 seed：
             同一片場的兩個切面，相鄰粒子的擾動因此仍然相關（一起被帶走），
             換 seed 會變成兩片完全無關的場，看起來就是各抖各的。
             時間也走平移：整片場隨時間漂過去，就是氣流的樣子。 */
          var fx2 = nx * noise.frequency;
          var fy2 = ny * noise.frequency;
          var ft = effect.time * noise.scrollSpeed;
          nx += valueNoise2(fx2 + ft, fy2, noiseSeed) * noise.strength;
          ny += valueNoise2(fx2, fy2 + ft + 31.4, noiseSeed) * noise.strength;
        }
        var particleFrame = p.spawnFrame || effect;
        var world = toWorld(particleFrame, nx, ny);
        var t = scratchTransform;
        t.visible = true;
        t.x = world.x;
        t.y = world.y;
        /* 粒子朝向要跟著整個特效與圖層一起轉，否則旋轉特效時只有位置轉、圖沒轉。
           alignToVelocity 是「再加上去」的一項，不是取代：rotationStart 仍是初始
           偏移、rotationSpeed 仍是相對自轉、rotationOverLife 仍是疊加曲線。
           關閉時這一行與加入本功能之前完全相同。 */
        t.rotation = particleFrame.rotation + d.rotation + p.rotation + (rotK === null ? 0 : rotK);
        t.skewX = 0;
        if (d.alignToVelocity && p.hasVelAngle) {
          t.rotation += p.velAngle + d.velocityRotationOffset;
        }
        t.scaleX = p.baseScale * effect.scale * (scaleK === null ? 1 : scaleK);
        t.scaleY = t.scaleX;
        t.alpha = effect.opacity * d.alpha * (alphaK === null ? 1 : alphaK);
        t.tint = tintCurve === null ? tint : mulColorInt(tint, sampleColorCurve(tintCurve, k));
        t.frame = sheet ? sheetFrame(sheet, k, p.life, p.frameOffset) : undefined;
        t.anchorX = d.anchor.x;
        t.anchorY = d.anchor.y;
        t.zIndex = d.zIndex;
        t.sortGroup = effect.handle; t.sortY = effect.origin.y;
        t.width = undefined; t.height = undefined; t.tileX = undefined; t.tileY = undefined; t.generated = undefined;
        backend.updateNode(p.node, t);
        layer.particles[write++] = p;
      }
      layer.particles.length = write;
    }

    function releaseEffect(effect) {
      effect.layers.forEach(function (layer) {
        if (layer.node) { releaseNode(layer.nodeSpec, layer.node); layer.node = null; }
        layer.particles.forEach(function (p) {
          releaseNode(layer.nodeSpec, p.node);
          p.node = null;
          if (particlePool.length < 512) particlePool.push(p);
          totalParticles--;
        });
        layer.particles.length = 0;
      });
    }

    function update(dt) {
      assertLive('update');
      if (!isFiniteNumber(dt) || dt < 0) throw new Error('update(dt) 需要非負的有限數');
      proceduralClock += dt;
      var keep = 0;                       // write-index：原地壓縮，不每幀配置新陣列
      for (var i = 0; i < effects.length; i++) {
        var effect = effects[i];
        effect.lastDt = dt * effect.timeScale;
        effect.time += effect.lastDt;
        var preset = effect.preset;
        if (preset.loop && effect.time > preset.duration) {
          effect.time = effect.time % preset.duration;
          effect.layers.forEach(function (l) { l.burstDone = false; });
        }
        for (var j = 0; j < effect.layers.length; j++) {
          var layer = effect.layers[j];
          if (layer.def.type === 'particle') updateParticleLayer(effect, layer, effect.lastDt);
          else updateSpriteLayer(effect, layer);
        }
        var over = !preset.loop && effect.time >= preset.duration;
        var particlesLeft = effect.layers.some(function (l) { return l.particles.length > 0; });
        if (over && !particlesLeft) {
          releaseEffect(effect);
          effect.done = true;
        } else {
          effects[keep++] = effect;
        }
      }
      effects.length = keep;
    }

    function stop(handle) {
      for (var i = 0; i < effects.length; i++) {
        if (effects[i].handle === handle) {
          releaseEffect(effects[i]);
          effects.splice(i, 1);
          return true;
        }
      }
      return false;
    }

    function stopAll() {
      effects.forEach(releaseEffect);
      effects = [];
    }

    var disposed = false;
    function assertLive(what) {
      if (disposed) throw new Error('runtime 已 destroy，不能再呼叫 ' + what);
    }

    function destroy() {
      if (disposed) return;                     // 可重複呼叫，但只作用一次
      disposed = true;
      stopAll();
      Object.keys(pools).forEach(function (key) {
        pools[key].forEach(function (node) { backend.destroyNode(node); });
        pools[key] = [];
      });
      pools = {};
      // 粒子狀態的 free-list 也要清掉：destroy 是終態，留著等於白佔記憶體
      particlePool.length = 0;
      // 後端可能持有貼圖等 GPU 資源，Runtime 收攤時要一併通知
      if (typeof backend.destroy === 'function') backend.destroy();
    }

    return {
      registerPreset: registerPreset,
      play: play,
      setTransform: setTransform,
      update: update,
      stop: stop,
      stopAll: stopAll,
      /* 播放頭查詢。與 play(startTime) 成對：Editor 重建預覽時先讀出目前時間，
         再用它重播，畫面就不會每改一個參數就跳回開頭。
         回傳 null 代表這個 handle 已經結束或不存在。 */
      timeOf: function (handle) {
        var effect = findEffect(handle);
        return effect ? effect.time : null;
      },
      destroy: destroy,
      getPreset: function (id) { return presets[id]; },
      stats: function () {
        var pooled = 0;
        Object.keys(pools).forEach(function (k) { pooled += pools[k].length; });
        return {
          activeEffects: effects.length,
          activeParticles: totalParticles,
          pooledNodes: pooled,
          droppedEffects: droppedEffects,
          droppedParticles: droppedParticles,
          // 回傳複本並凍結：直接給內部物件的話，外部一行
          // stats().budget.maxParticles = Infinity 就能廢掉所有上限
          budget: Object.freeze({
            maxActiveEffects: budget.maxActiveEffects,
            maxParticles: budget.maxParticles,
            perEffectParticleLimit: budget.perEffectParticleLimit
          })
        };
      }
    };
  }

  /* ---------- 測試／無畫面環境用的後端 ---------- */
  function createNullBackend() {
    var created = 0, destroyed = 0, live = 0, destroyedBackend = false;
    return {
      createNode: function (spec) {
        created++; live++;
        return { spec: spec, transform: null, alive: true };
      },
      /* Core 傳進來的 transform 是共用物件（每幀重用以避免配置），
         後端若要留存就必須自己複製。Pixi 後端是立即讀取後就丟，不受影響。 */
      updateNode: function (node, t) {
        if (!t) return;
        node.transform = {
          visible: t.visible, x: t.x, y: t.y, rotation: t.rotation,
          scaleX: t.scaleX, scaleY: t.scaleY, alpha: t.alpha, tint: t.tint, frame: t.frame,
          anchorX: t.anchorX, anchorY: t.anchorY, zIndex: t.zIndex,
          width: t.width, height: t.height, tileX: t.tileX, tileY: t.tileY
        };
      },
      destroyNode: function (node) { node.alive = false; destroyed++; live--; },
      destroy: function () { destroyedBackend = true; },
      counts: function () {
        return { created: created, destroyed: destroyed, live: live, backendDestroyed: destroyedBackend };
      }
    };
  }

  /* ---------- Asset Resolver ----------
     介面只有 resolve(assetId) → URL。Editor 用本機資產伺服器的 URL，
     Runtime 未來可換成打包後的 URL，Core 不需要知道差別，
     更不需要知道任何 Asset Library Root。 */
  function createIndexResolver(assetIndex, baseUrl) {
    var byId = {}, revisions = {};
    (assetIndex && assetIndex.assets ? assetIndex.assets : []).forEach(function (a) {
      byId[a.assetId] = a.relativePath;
      revisions[a.assetId] = a.contentHash;
    });
    var prefix = String(baseUrl || '').replace(/\/+$/, '');
    return {
      has: function (assetId) { return !!byId[assetId]; },
      resolve: function (assetId) {
        var rel = byId[assetId];
        if (!rel) throw new Error('未知的 assetId：' + assetId);
        return prefix + '/' + rel.split('/').map(encodeURIComponent).join('/') +
          (revisions[assetId] ? '?v=' + encodeURIComponent(revisions[assetId]) : '');
      }
    };
  }

  /* 匯出的常數一律凍結：外部改動 HARD_LIMITS 等於把驗證關掉。
     用 deepFreeze 而不是 Object.freeze——HARD_LIMITS.budget 是巢狀物件，
     淺凍結擋不住 HARD_LIMITS.budget.maxParticles = Infinity。 */
  [LAYER_TYPES, BLEND_MODES, SPAWN_SHAPES, EMISSION_MODES, PROCEDURAL_EFFECTS,
    HARD_LIMITS, DEFAULT_BUDGET].forEach(function (o) { deepFreeze(o); });

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    LAYER_TYPES: LAYER_TYPES,
    BLEND_MODES: BLEND_MODES,
    SPAWN_SHAPES: SPAWN_SHAPES,
    EMISSION_MODES: EMISSION_MODES,
    PROCEDURAL_EFFECTS: PROCEDURAL_EFFECTS,
    HARD_LIMITS: HARD_LIMITS,
    DEFAULT_BUDGET: DEFAULT_BUDGET,
    VELOCITY_EPSILON: VELOCITY_EPSILON,
    validatePreset: validatePreset,
    serialisePreset: serialisePreset,
    radiusProfileScale: radiusProfileScale,
    createRuntime: createRuntime,
    createNullBackend: createNullBackend,
    createIndexResolver: createIndexResolver,
    makeRng: makeRng,
    sampleCurve: sampleCurve,
    /* 顏色曲線的取樣與 sampleCurve 對稱地公開：Editor 的色帶必須與遊戲實際
       播出來的顏色逐位元相同，唯一可靠的保證方式是兩邊呼叫同一支函式，
       而不是各寫一份再用測試比對。 */
    toColorCurve: toColorCurve,
    sampleColorCurve: sampleColorCurve
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXCore;
}
