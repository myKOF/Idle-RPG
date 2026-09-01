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
  var EMISSION_MODES = ['burst', 'rate'];
  var PROCEDURAL_EFFECTS = ['uvScroll'];

  /* 硬上限：超過就是 preset 寫錯，不是效能調校問題，直接擋在驗證階段。 */
  var HARD_LIMITS = {
    maxLayers: 32,
    maxParticlesPerLayer: 2000,
    maxEmissionRate: 2000,
    maxDuration: 60,
    maxCurvePoints: 16,

    /* budget 三個欄位的硬上限（見 createRuntime 的 budgetValue）。
       budget 是呼叫端可調的效能旋鈕，但不能被調成「等於沒有上限」：
       perEffectParticleLimit 一旦大到浮點數減 1 不再改變數值（Number.MAX_VALUE
       就是這樣），發射迴圈的 emitAccumulator -= 1 便永遠遞減不完。
       擋在驗證入口，不在每幀迴圈裡加容錯——迴圈的正確性應該由前置條件保證。 */
    budget: {
      // 同時存在的特效數。256 遠高於任何合理用途，純粹是為了讓「上限」仍然是個上限。
      maxActiveEffects: 256,
      // 全域粒子數上限＝單層硬上限 × 最大層數，也就是一個特效在硬上限下的理論最大值。
      maxParticles: 2000 * 32,
      // 單層粒子數不可能超過 maxParticlesPerLayer，設得比它大沒有任何效果，是寫錯。
      perEffectParticleLimit: 2000
    }
  };

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

  /* 範圍值：數字表示固定，[min,max] 表示在區間內取決定性亂數 */
  function sampleRange(value, rng) {
    if (Array.isArray(value)) return value[0] + (value[1] - value[0]) * rng();
    return value;
  }

  /* ---------- 顏色 ---------- */
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  function colorToInt(hex) { return parseInt(hex.slice(1), 16); }

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
    validateCurve(layer.scaleOverLife, where + '.scaleOverLife', errors, { nonNegative: true });
    validateCurve(layer.rotationOverLife, where + '.rotationOverLife', errors);
  }

  function validateParticleLayer(layer, where, errors) {
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
    if (layer.direction !== undefined && !isFiniteNumber(layer.direction)) {
      errors.push(where + '.direction 必須是有限數（角度）');
    }
    if (layer.spread !== undefined && (!isFiniteNumber(layer.spread) || layer.spread < 0)) {
      errors.push(where + '.spread 必須是非負有限數（角度）');
    }
    validateVec2(layer.gravity, where + '.gravity', errors);
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

  var PRESET_FIELDS = ['schemaVersion', 'id', 'duration', 'loop', 'layers'];
  var COMMON_LAYER_FIELDS = ['id', 'type', 'enabled', 'assetId', 'zIndex', 'position',
    'rotation', 'scale', 'anchor', 'alpha', 'tint', 'blendMode', 'delay', 'duration',
    'alphaOverLife', 'scaleOverLife', 'rotationOverLife'];
  var TYPE_ONLY_FIELDS = {
    sprite: [],
    particle: ['emission', 'maxParticles', 'lifetime', 'spawn', 'speed', 'direction',
      'spread', 'gravity', 'startScale', 'rotationStart', 'rotationSpeed'],
    procedural: ['effect', 'size', 'scrollSpeed']
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
    spawn: ['shape', 'radius', 'width', 'height']
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

    return { ok: errors.length === 0, errors: errors };
  }

  /* 決定性序列化：欄位順序固定，Editor 存檔→載入→再存檔必須位元相同。 */
  var PRESET_KEY_ORDER = ['schemaVersion', 'id', 'duration', 'loop', 'layers'];
  var LAYER_KEY_ORDER = ['id', 'type', 'enabled', 'assetId', 'effect', 'zIndex',
    'position', 'rotation', 'scale', 'anchor', 'size', 'alpha', 'tint', 'blendMode',
    'delay', 'duration', 'scrollSpeed',
    'emission', 'maxParticles', 'lifetime', 'spawn', 'speed', 'direction', 'spread',
    'gravity', 'startScale', 'rotationStart', 'rotationSpeed',
    'alphaOverLife', 'scaleOverLife', 'rotationOverLife'];

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
      zIndex: layer.zIndex || 0,
      position: layer.position || { x: 0, y: 0 },
      rotation: layer.rotation || 0,
      scale: layer.scale || { x: 1, y: 1 },
      anchor: layer.anchor || { x: 0.5, y: 0.5 },
      size: layer.size,
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
      startScale: layer.startScale === undefined ? 1 : layer.startScale,
      rotationStart: layer.rotationStart === undefined ? 0 : layer.rotationStart,
      rotationSpeed: layer.rotationSpeed === undefined ? 0 : layer.rotationSpeed,
      alphaOverLife: layer.alphaOverLife,
      scaleOverLife: layer.scaleOverLife,
      rotationOverLife: layer.rotationOverLife
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
    var nextEffectId = 1;
    var totalParticles = 0;
    var droppedEffects = 0;
    var droppedParticles = 0;

    /* 節點池：粒子生滅頻繁，每顆都 new 會讓 GC 在戰鬥中尖峰。
       依 (assetUrl, blendMode, kind) 分池回收。 */
    var pools = {};
    var particlePool = [];      // 粒子狀態物件的 free-list
    function poolKey(spec) { return spec.kind + '|' + spec.assetUrl + '|' + spec.blendMode; }
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
      var effect = {
        handle: nextEffectId++,
        presetId: presetId,
        preset: preset,
        time: 0,
        done: false,
        origin: { x: (p.position && p.position.x) || 0, y: (p.position && p.position.y) || 0 },
        rotation: p.rotation || 0,
        scale: p.scale === undefined ? 1 : p.scale,
        seed: (p.seed === undefined ? (nextEffectId * 2654435761) : p.seed) >>> 0,
        layers: []
      };
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
          scrollX: 0,
          scrollY: 0
        };
        effect.layers.push(state);
      });
      effects.push(effect);
      return effect.handle;
    }

    /* 共用結果物件：每層每幀都 new 一個，在 24 特效 × 32 層下同樣是可觀的配置量。
       呼叫端必須立即讀取，不得保存。 */
    var lifeResult = { active: false, progress: 0 };
    function layerLife(effect, layer) {
      var duration = layer.def.duration === undefined ? effect.preset.duration : layer.def.duration;
      var t = effect.time - layer.def.delay;
      if (t < 0) { lifeResult.active = false; lifeResult.progress = 0; return lifeResult; }
      if (duration <= 0) { lifeResult.active = false; lifeResult.progress = 1; return lifeResult; }
      if (t >= duration) { lifeResult.active = false; lifeResult.progress = 1; return lifeResult; }
      lifeResult.active = true;
      lifeResult.progress = t / duration;
      return lifeResult;
    }

    function nodeSpecFor(layer) {
      return {
        kind: layer.def.type === 'procedural' ? 'tiled' : 'sprite',
        assetUrl: resolver.resolve(layer.def.assetId),
        blendMode: layer.def.blendMode
      };
    }

    /* 世界座標：特效本身的 rotation/scale 套用到圖層的區域座標上。
       Editor 與 Runtime 共用這段，因此「Editor 裡拖出來的位置」與
       「遊戲裡播出來的位置」是同一套算式。 */
    var scratchWorld = { x: 0, y: 0 };
    function toWorld(effect, x, y) {
      var s = effect.scale;
      var c = Math.cos(effect.rotation), sn = Math.sin(effect.rotation);
      scratchWorld.x = effect.origin.x + (x * c - y * sn) * s;
      scratchWorld.y = effect.origin.y + (x * sn + y * c) * s;
      return scratchWorld;
    }

    /* 共用的 transform 物件：每幀每顆粒子都 new 一個 literal，在 1200 顆預算下
       等於每秒七萬個短命物件，GC 尖峰會直接變成掉幀。
       後端契約：updateNode 收到的 transform 只在該次呼叫內有效，不得保存引用。 */
    var scratchTransform = {
      visible: true, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      alpha: 1, tint: 0xffffff, anchorX: 0.5, anchorY: 0.5, zIndex: 0,
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
      var world = toWorld(effect, d.position.x, d.position.y);
      var t = scratchTransform;
      t.visible = true;
      t.x = world.x;
      t.y = world.y;
      t.rotation = effect.rotation + d.rotation + (rotK === null ? 0 : rotK);
      t.scaleX = d.scale.x * effect.scale * (scaleK === null ? 1 : scaleK);
      t.scaleY = d.scale.y * effect.scale * (scaleK === null ? 1 : scaleK);
      t.alpha = d.alpha * (alphaK === null ? 1 : alphaK);
      t.tint = colorToInt(d.tint);
      t.anchorX = d.anchor.x;
      t.anchorY = d.anchor.y;
      t.zIndex = d.zIndex;
      t.width = undefined; t.height = undefined; t.tileX = undefined; t.tileY = undefined;
      if (d.type === 'procedural') {
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

    function spawnParticle(effect, layer) {
      var d = layer.def;
      var perLayer = layerParticleCap(d);
      if (layer.particles.length >= perLayer || totalParticles >= budget.maxParticles) {
        droppedParticles++;
        return;
      }
      var rng = layer.rng;
      var angle = (d.direction + (rng() - 0.5) * d.spread) * Math.PI / 180;
      var speed = sampleRange(d.speed, rng);
      var px = d.position.x, py = d.position.y;
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
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.life = 0;
      p.maxLife = sampleRange(d.lifetime, rng);
      p.rotation = sampleRange(d.rotationStart, rng);
      p.rotationSpeed = sampleRange(d.rotationSpeed, rng);
      p.baseScale = sampleRange(d.startScale, rng);
      p.node = acquireNode(spec);
      layer.particles.push(p);
      totalParticles++;
    }

    function updateParticleLayer(effect, layer, dt) {
      var d = layer.def;
      var life = layerLife(effect, layer);
      if (life.active) {
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
      var write = 0;
      for (var j = 0; j < layer.particles.length; j++) {
        var p = layer.particles[j];
        p.life += dt;
        if (p.life >= p.maxLife) {
          releaseNode(layer.nodeSpec, p.node);
          p.node = null;
          if (particlePool.length < 512) particlePool.push(p);
          totalParticles--;
          continue;
        }
        p.vx += d.gravity.x * dt;
        p.vy += d.gravity.y * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.rotationSpeed * dt;
        var k = p.life / p.maxLife;
        var alphaK = sampleCurve(d.alphaOverLife, k);
        var scaleK = sampleCurve(d.scaleOverLife, k);
        var rotK = sampleCurve(d.rotationOverLife, k);
        var world = toWorld(effect, p.x, p.y);
        var t = scratchTransform;
        t.visible = true;
        t.x = world.x;
        t.y = world.y;
        // 粒子朝向要跟著整個特效與圖層一起轉，否則旋轉特效時只有位置轉、圖沒轉
        t.rotation = effect.rotation + d.rotation + p.rotation + (rotK === null ? 0 : rotK);
        t.scaleX = p.baseScale * effect.scale * (scaleK === null ? 1 : scaleK);
        t.scaleY = t.scaleX;
        t.alpha = d.alpha * (alphaK === null ? 1 : alphaK);
        t.tint = tint;
        t.anchorX = d.anchor.x;
        t.anchorY = d.anchor.y;
        t.zIndex = d.zIndex;
        t.width = undefined; t.height = undefined; t.tileX = undefined; t.tileY = undefined;
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
      var keep = 0;                       // write-index：原地壓縮，不每幀配置新陣列
      for (var i = 0; i < effects.length; i++) {
        var effect = effects[i];
        effect.lastDt = dt;
        effect.time += dt;
        var preset = effect.preset;
        if (preset.loop && effect.time > preset.duration) {
          effect.time = effect.time % preset.duration;
          effect.layers.forEach(function (l) { l.burstDone = false; });
        }
        for (var j = 0; j < effect.layers.length; j++) {
          var layer = effect.layers[j];
          if (layer.def.type === 'particle') updateParticleLayer(effect, layer, dt);
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
      // 後端可能持有貼圖等 GPU 資源，Runtime 收攤時要一併通知
      if (typeof backend.destroy === 'function') backend.destroy();
    }

    return {
      registerPreset: registerPreset,
      play: play,
      update: update,
      stop: stop,
      stopAll: stopAll,
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
          scaleX: t.scaleX, scaleY: t.scaleY, alpha: t.alpha, tint: t.tint,
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
    var byId = {};
    (assetIndex && assetIndex.assets ? assetIndex.assets : []).forEach(function (a) {
      byId[a.assetId] = a.relativePath;
    });
    var prefix = String(baseUrl || '').replace(/\/+$/, '');
    return {
      has: function (assetId) { return !!byId[assetId]; },
      resolve: function (assetId) {
        var rel = byId[assetId];
        if (!rel) throw new Error('未知的 assetId：' + assetId);
        return prefix + '/' + rel.split('/').map(encodeURIComponent).join('/');
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
    validatePreset: validatePreset,
    serialisePreset: serialisePreset,
    createRuntime: createRuntime,
    createNullBackend: createNullBackend,
    createIndexResolver: createIndexResolver,
    makeRng: makeRng,
    sampleCurve: sampleCurve
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXCore;
}
