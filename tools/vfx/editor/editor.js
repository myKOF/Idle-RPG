'use strict';
/* ============================================================
   editor.js — VFX Editor MVP（Editor 專屬的殼，不含任何繪圖邏輯）

   Editor 只做三件事：編輯 Preset、瀏覽 metadata、把 Preset 交給 VFX Core 播放。
   **預覽畫面完全由 js/vfx-core.js ＋ js/vfx-pixi-backend.js 產生**，
   Editor 沒有自己的 renderer，因此看到的就是 Runtime 之後會播的東西。

   Inspector 由「圖層型別的欄位描述」驅動，不是為每個特效寫一個 Inspector；
   未來新增 layer type 只要加一組欄位描述。
   ============================================================ */

(function () {

  var ASSET_INDEX_URL = '/vfx/asset-index.json';
  var ASSET_SEMANTICS_URL = '/vfx/asset-semantics.json';
  var DEMO_PRESET_URL = '/vfx/presets/demo-basic.json';

  var state = {
    index: null,
    semantics: null,
    semanticById: {},
    preset: null,
    selectedLayerId: null,
    selectedAssetId: null,
    playing: true,
    handle: null,
    runtime: null,
    backend: null,
    resolver: null,
    app: null,
    stageRoot: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- Inspector 欄位描述（schema 驅動） ---------------- */

  function num(key, label, step) { return { key: key, label: label, kind: 'number', step: step || 0.01 }; }
  function vec(key, label) { return { key: key, label: label, kind: 'vec2' }; }
  function json(key, label) { return { key: key, label: label, kind: 'json' }; }

  var COMMON_FIELDS = [
    { key: 'id', label: 'id', kind: 'text' },
    { key: 'enabled', label: 'enabled', kind: 'bool' },
    { key: 'assetId', label: 'assetId', kind: 'asset' },
    num('zIndex', 'zIndex', 1),
    vec('position', 'position'),
    num('rotation', 'rotation(rad)'),
    vec('scale', 'scale'),
    vec('anchor', 'anchor'),
    num('alpha', 'alpha'),
    { key: 'tint', label: 'tint', kind: 'color' },
    { key: 'blendMode', label: 'blendMode', kind: 'select', options: function () { return VFXCore.BLEND_MODES; } },
    num('delay', 'delay(s)'),
    num('duration', 'duration(s)')
  ];

  /* 與 vfx-core.js layerDefaults() 對齊的向量預設值 */
  var VEC_DEFAULTS = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    anchor: { x: 0.5, y: 0.5 },
    gravity: { x: 0, y: 0 },
    size: { x: 256, y: 256 },
    scrollSpeed: { x: 0, y: 0 }
  };

  var CURVE_FIELDS = [
    json('alphaOverLife', 'alphaOverLife'),
    json('scaleOverLife', 'scaleOverLife'),
    json('rotationOverLife', 'rotationOverLife')
  ];

  var TYPE_FIELDS = {
    sprite: [],
    particle: [
      json('emission', 'emission'),
      num('maxParticles', 'maxParticles', 1),
      json('lifetime', 'lifetime'),
      json('spawn', 'spawn'),
      json('speed', 'speed'),
      num('direction', 'direction(deg)', 1),
      num('spread', 'spread(deg)', 1),
      vec('gravity', 'gravity'),
      json('startScale', 'startScale'),
      json('rotationStart', 'rotationStart'),
      json('rotationSpeed', 'rotationSpeed')
    ],
    procedural: [
      { key: 'effect', label: 'effect', kind: 'select', options: function () { return VFXCore.PROCEDURAL_EFFECTS; } },
      vec('size', 'size(px)'),
      vec('scrollSpeed', 'scrollSpeed')
    ]
  };

  /* ---------------- 資料載入 ---------------- */

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  /* ---------------- Asset Browser ---------------- */

  /* 用 createElement + textContent，不用 innerHTML 拼字串：
     語意 metadata 是產生出來的資料，不應該有機會變成 Editor 的 DOM。 */
  function fillSelect(el, values, label) {
    el.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = label + '（全部）';
    el.appendChild(all);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      el.appendChild(o);
    });
  }

  function currentAssetFilters() {
    return {
      text: $('f-text').value.trim().toLowerCase(),
      usage: $('f-usage').value,
      shape: $('f-shape').value,
      element: $('f-element').value,
      tag: $('f-tag').value,
      high: $('f-high').checked
    };
  }

  function filterAssets() {
    var f = currentAssetFilters();
    var out = [];
    for (var i = 0; i < state.semantics.records.length; i++) {
      var rec = state.semantics.records[i];
      if (rec.kind !== 'vfx') continue;                  // 植物與宣傳圖不進選材清單
      if (f.high && rec.confidence !== 'high') continue;
      if (f.shape && rec.shape !== f.shape) continue;
      if (f.element && rec.element !== f.element) continue;
      if (f.usage && (!rec.usage || rec.usage.indexOf(f.usage) < 0)) continue;
      if (f.tag && (!rec.tags || rec.tags.indexOf(f.tag) < 0)) continue;
      if (f.text && rec.assetId.toLowerCase().indexOf(f.text) < 0) continue;
      out.push(rec);
      if (out.length >= 300) break;                      // 清單上限，避免一次塞 900 個 DOM
    }
    return out;
  }

  function renderAssetBrowser() {
    var rows = filterAssets();
    $('asset-count').textContent = '顯示 ' + rows.length + ' 筆' +
      (rows.length >= 300 ? '（已截斷，請再加條件）' : '');
    var host = $('asset-list');
    host.innerHTML = '';
    rows.forEach(function (rec) {
      var div = document.createElement('div');
      div.className = 'asset-row';
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.src = state.resolver.resolve(rec.assetId);
      var meta = document.createElement('div');
      meta.className = 'meta';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = rec.assetId.split('/').pop();
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = rec.shape + ' · ' + (rec.usage || []).join(',') + ' · ' + rec.element;
      meta.appendChild(name); meta.appendChild(sub);
      div.appendChild(img); div.appendChild(meta);
      div.title = rec.assetId;
      div.onclick = function () {
        state.selectedAssetId = rec.assetId;
        var layer = selectedLayer();
        if (layer) { layer.assetId = rec.assetId; onPresetChanged(); }
        renderInspector();
      };
      host.appendChild(div);
    });
  }

  /* ---------------- Layer list ---------------- */

  function selectedLayer() {
    if (!state.preset) return null;
    for (var i = 0; i < state.preset.layers.length; i++) {
      if (state.preset.layers[i].id === state.selectedLayerId) return state.preset.layers[i];
    }
    return null;
  }

  function renderLayerList() {
    var host = $('layer-list');
    host.innerHTML = '';
    state.preset.layers.forEach(function (layer) {
      var div = document.createElement('div');
      div.className = 'layer-row' + (layer.id === state.selectedLayerId ? ' sel' : '');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = layer.enabled !== false;
      cb.onclick = function (e) {
        e.stopPropagation();
        layer.enabled = cb.checked;
        onPresetChanged();
      };
      var name = document.createElement('span');
      name.textContent = layer.id;
      var type = document.createElement('span');
      type.className = 'type';
      type.textContent = layer.type;
      div.appendChild(cb); div.appendChild(name); div.appendChild(type);
      div.onclick = function () { state.selectedLayerId = layer.id; renderLayerList(); renderInspector(); };
      host.appendChild(div);
    });
  }

  /* ---------------- Inspector ---------------- */

  function makeField(label, control) {
    var wrap = document.createElement('div');
    wrap.className = 'field';
    var l = document.createElement('label');
    l.textContent = label;
    wrap.appendChild(l);
    wrap.appendChild(control);
    return wrap;
  }

  function renderInspector() {
    var host = $('inspector');
    host.innerHTML = '';
    var layer = selectedLayer();
    if (!layer) { host.innerHTML = '<div class="hint">未選取圖層</div>'; return; }

    var fields = COMMON_FIELDS
      .concat([{ kind: 'title', label: layer.type + ' 專屬' }])
      .concat(TYPE_FIELDS[layer.type] || [])
      .concat([{ kind: 'title', label: 'over-life 曲線' }])
      .concat(CURVE_FIELDS);

    fields.forEach(function (f) {
      if (f.kind === 'title') {
        var t = document.createElement('div');
        t.className = 'group-title';
        t.textContent = f.label;
        host.appendChild(t);
        return;
      }
      var control;
      if (f.kind === 'bool') {
        control = document.createElement('input');
        control.type = 'checkbox';
        control.checked = layer[f.key] !== false;
        control.onchange = function () { layer[f.key] = control.checked; onPresetChanged(); };
      } else if (f.kind === 'select') {
        control = document.createElement('select');
        f.options().forEach(function (v) {
          var o = document.createElement('option');
          o.value = v; o.textContent = v;
          control.appendChild(o);
        });
        control.value = layer[f.key] || f.options()[0];
        control.onchange = function () { layer[f.key] = control.value; onPresetChanged(); };
      } else if (f.kind === 'color') {
        control = document.createElement('input');
        control.type = 'color';
        control.value = layer[f.key] || '#ffffff';
        control.oninput = function () { layer[f.key] = control.value; onPresetChanged(); };
      } else if (f.kind === 'vec2') {
        control = document.createElement('div');
        control.style.display = 'flex';
        control.style.gap = '4px';
        // 缺省值必須與 Core 的 layerDefaults 一致：顯示 0 會讓人只改一軸就把另一軸歸零，
        // 例如 scale 變成 {x:2,y:0} → 預覽整個消失
        var fallback = VEC_DEFAULTS[f.key] || { x: 0, y: 0 };
        ['x', 'y'].forEach(function (axis) {
          var input = document.createElement('input');
          input.type = 'number';
          input.step = '0.01';
          input.value = (layer[f.key] && layer[f.key][axis] !== undefined)
            ? layer[f.key][axis] : fallback[axis];
          input.oninput = function () {
            if (!layer[f.key]) layer[f.key] = { x: fallback.x, y: fallback.y };
            layer[f.key][axis] = Number(input.value);
            onPresetChanged();
          };
          control.appendChild(input);
        });
      } else if (f.kind === 'json') {
        control = document.createElement('input');
        control.type = 'text';
        control.value = layer[f.key] === undefined ? '' : JSON.stringify(layer[f.key]);
        control.onchange = function () {
          var raw = control.value.trim();
          if (!raw) { delete layer[f.key]; onPresetChanged(); return; }
          try {
            layer[f.key] = JSON.parse(raw);
            control.classList.remove('err');
          } catch (e) {
            control.classList.add('err');
            return;                              // JSON 壞掉就不套用，不 silent 吃掉
          }
          onPresetChanged();
        };
      } else if (f.kind === 'asset') {
        control = document.createElement('input');
        control.type = 'text';
        control.value = layer[f.key] || '';
        control.placeholder = '從左側 Asset Browser 點選';
        control.onchange = function () { layer[f.key] = control.value; onPresetChanged(); };
      } else if (f.kind === 'text') {
        control = document.createElement('input');
        control.type = 'text';
        control.value = layer[f.key] || '';
        control.onchange = function () {
          var old = layer[f.key];
          layer[f.key] = control.value;
          if (state.selectedLayerId === old) state.selectedLayerId = control.value;
          onPresetChanged(); renderLayerList();
        };
      } else {
        control = document.createElement('input');
        control.type = 'number';
        control.step = String(f.step);
        control.value = layer[f.key] === undefined ? '' : layer[f.key];
        control.oninput = function () {
          if (control.value === '') delete layer[f.key];
          else layer[f.key] = Number(control.value);
          onPresetChanged();
        };
      }
      host.appendChild(makeField(f.label, control));
    });
  }

  /* ---------------- 預覽（使用 VFX Core） ---------------- */

  function onPresetChanged() {
    var result = VFXCore.validatePreset(state.preset);
    var box = $('validation');
    if (!result.ok) {
      box.className = 'hint err';
      box.textContent = '✗ ' + result.errors.length + ' 個問題：\n- ' + result.errors.join('\n- ');
      return;                                    // 不合法就不重建預覽，也不 silent fallback
    }
    box.className = 'hint ok';
    box.textContent = '✓ Preset 合法（schemaVersion ' + state.preset.schemaVersion + '）';
    rebuildPreview();
  }

  function rebuildPreview() {
    if (!state.runtime) return;
    state.runtime.stopAll();
    try {
      state.runtime.registerPreset(state.preset);
    } catch (e) {
      $('validation').className = 'hint err';
      $('validation').textContent = String(e.message || e);
      return;
    }
    state.handle = state.runtime.play(state.preset.id, {
      position: { x: 0, y: 0 },
      seed: 12345                                // 固定 seed：編輯時每次重播畫面一致
    });
  }

  function restart() { rebuildPreview(); }

  /* 預覽背景一律畫在 Pixi 內部，畫布本身保持不透明。
     為什麼不能用「透明畫布 ＋ CSS 背景」：加法混合（add）在透明畫布上會把
     alpha 也一起相加，而黑底素材的 RGB 是 0、alpha 是 1，結果就是
     「顏色沒加上去、透明度卻加滿」→ 合成到頁面上變成一塊不透明黑方塊。
     畫布不透明時目標 alpha 已經是 1，就不會有這個假象。 */
  function setBackground(value) {
    if (!state.app) return;
    var checker = value === 'checker';
    state.checker.visible = checker;
    state.bgSolid.visible = !checker;
    if (!checker) state.bgSolid.tint = parseInt(value.slice(1), 16);
  }

  /* 棋盤格背景：用小張貼圖平鋪，同樣走 Pixi，維持畫布不透明 */
  function makeCheckerTexture() {
    var size = 24;
    var cv = document.createElement('canvas');
    cv.width = cv.height = size;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#1b1b21'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#2a2a32';
    ctx.fillRect(0, 0, size / 2, size / 2);
    ctx.fillRect(size / 2, size / 2, size / 2, size / 2);
    return PIXI.Texture.from(cv);
  }

  /* ---------------- 存讀檔 ---------------- */

  function savePreset() {
    // 存檔前一定要驗證：否則存出去的檔案下次載入會被拒絕，Save/Load 不一致
    var check = VFXCore.validatePreset(state.preset);
    if (!check.ok) {
      $('validation').className = 'hint err';
      $('validation').textContent = '無法存檔，preset 不合法：\n- ' + check.errors.join('\n- ');
      return;
    }
    var missing = state.preset.layers
      .filter(function (l) { return l.assetId && !state.resolver.has(l.assetId); })
      .map(function (l) { return l.id + ' → ' + l.assetId; });
    if (missing.length) {
      $('validation').className = 'hint err';
      $('validation').textContent = '無法存檔，引用了不存在的 assetId：\n- ' + missing.join('\n- ');
      return;
    }
    var text = VFXCore.serialisePreset(state.preset);
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.preset.id + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function loadPresetFromFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(String(reader.result));
        var result = VFXCore.validatePreset(parsed);
        if (!result.ok) {
          $('validation').className = 'hint err';
          $('validation').textContent = '載入失敗：\n- ' + result.errors.join('\n- ');
          return;
        }
        state.preset = parsed;
        state.selectedLayerId = parsed.layers[0] ? parsed.layers[0].id : null;
        $('chk-loop').checked = !!parsed.loop;
        renderLayerList(); renderInspector(); onPresetChanged();
      } catch (e) {
        $('validation').className = 'hint err';
        $('validation').textContent = 'JSON 解析失敗：' + e.message;
      }
    };
    reader.readAsText(file);
  }

  /* 用「已存在的 id」決定編號，不要用陣列長度——刪掉中間的圖層後
     再新增同型別就會撞名，選取與存檔都會壞掉。 */
  function uniqueLayerId(type) {
    var used = {};
    state.preset.layers.forEach(function (l) { used[l.id] = true; });
    var n = state.preset.layers.length + 1;
    while (used[type + '-' + n]) n++;
    return type + '-' + n;
  }

  function addLayer(type) {
    var base = { id: uniqueLayerId(type), type: type, assetId: state.selectedAssetId || '' };
    if (type === 'particle') {
      base.emission = { mode: 'burst', count: 16 };
      base.lifetime = [0.4, 0.8];
      base.speed = [40, 90];
      base.spread = 90;
      base.startScale = 0.3;
    } else if (type === 'procedural') {
      base.effect = 'uvScroll';
      base.size = { x: 256, y: 256 };
      base.scrollSpeed = { x: 0, y: -0.2 };
    }
    state.preset.layers.push(base);
    state.selectedLayerId = base.id;
    renderLayerList(); renderInspector(); onPresetChanged();
  }

  function deleteLayer() {
    var layer = selectedLayer();
    if (!layer) return;
    state.preset.layers = state.preset.layers.filter(function (l) { return l !== layer; });
    state.selectedLayerId = state.preset.layers[0] ? state.preset.layers[0].id : null;
    renderLayerList(); renderInspector(); onPresetChanged();
  }

  /* ---------------- 啟動 ---------------- */

  function collectVocab() {
    var usage = {}, shape = {}, element = {}, tag = {};
    state.semantics.records.forEach(function (r) {
      if (r.kind !== 'vfx') return;
      shape[r.shape] = 1; element[r.element] = 1;
      (r.usage || []).forEach(function (u) { usage[u] = 1; });
      (r.tags || []).forEach(function (t) { tag[t] = 1; });
    });
    fillSelect($('f-usage'), Object.keys(usage).sort(), 'usage');
    fillSelect($('f-shape'), Object.keys(shape).sort(), 'shape');
    fillSelect($('f-element'), Object.keys(element).sort(), 'element');
    fillSelect($('f-tag'), Object.keys(tag).sort(), 'tag');
  }

  function boot() {
    Promise.all([
      fetchJson(ASSET_INDEX_URL),
      fetchJson(ASSET_SEMANTICS_URL),
      fetchJson(DEMO_PRESET_URL)
    ]).then(function (res) {
      state.index = res[0];
      state.semantics = res[1];
      state.preset = res[2];
      state.selectedLayerId = state.preset.layers[0].id;

      // Editor 端的 resolver：assetId → 本機資產伺服器 URL。
      // Runtime 之後換成打包後的 URL，Core 不需要任何改動。
      state.resolver = VFXCore.createIndexResolver(
        state.index, '/asset-library/' + state.index.libraryId);

      var app = new PIXI.Application();
      var host = $('preview-host');
      return app.init({
        background: '#101014',
        backgroundAlpha: 1,          // 不透明：加法混合才不會在透明畫布上疊出黑方塊
        antialias: true,
        // DPR 設上限：高 DPR 裝置上畫布像素成本會平方成長，預覽不值得付這個代價
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: host
      }).then(function () {
        state.app = app;
        host.appendChild(app.canvas);
        /* 背景一律畫在 Pixi 內（純色與棋盤格各一張），不倚賴 renderer.background，
           畫布保持不透明，加法混合才不會疊出黑方塊。 */
        var bgSolid = new PIXI.TilingSprite({
          texture: PIXI.Texture.WHITE, width: 8192, height: 8192
        });
        bgSolid.position.set(-4096, -4096);
        bgSolid.tint = 0x101014;
        app.stage.addChild(bgSolid);
        state.bgSolid = bgSolid;

        var checker = new PIXI.TilingSprite({
          texture: makeCheckerTexture(), width: 8192, height: 8192
        });
        checker.position.set(-4096, -4096);
        checker.visible = false;
        app.stage.addChild(checker);
        state.checker = checker;
        var root = new PIXI.Container();
        app.stage.addChild(root);
        state.stageRoot = root;
        var centre = function () {
          root.x = app.renderer.width / 2;
          root.y = app.renderer.height / 2;
        };
        centre();
        app.renderer.on('resize', centre);

        state.backend = VFXPixiBackend.createBackend({ PIXI: PIXI, container: root });
        state.runtime = VFXCore.createRuntime({
          backend: state.backend,
          resolver: state.resolver
        });

        app.ticker.add(function (ticker) {
          if (!state.playing) return;
          state.runtime.update(Math.min(ticker.deltaMS, 100) / 1000);
          var s = state.runtime.stats();
          $('stats').textContent = 'effects ' + s.activeEffects +
            ' · particles ' + s.activeParticles +
            ' · pooled ' + s.pooledNodes +
            ' · dropped ' + (s.droppedEffects + s.droppedParticles);
          var errs = state.backend.takeErrors();
          if (errs.length) {
            $('preview-msg').className = 'hint err';
            $('preview-msg').textContent = '貼圖載入失敗：' + errs[0].url;
          }
        });

        // 除錯用把手：Editor 是開發工具，讓瀏覽器主控台與人工 QA 能查看實際場景
        window.__vfxEditor = state;

        fillSelect($('new-layer-type'), VFXCore.LAYER_TYPES, 'layer type');
        $('new-layer-type').value = 'sprite';
        collectVocab();
        renderAssetBrowser();
        renderLayerList();
        renderInspector();
        onPresetChanged();
      });
    }).catch(function (e) {
      document.getElementById('preview-msg').className = 'hint err';
      document.getElementById('preview-msg').textContent =
        '啟動失敗：' + (e && e.message || e) +
        '\n請確認是用 node tools/vfx/editor-server.cjs 啟動，而不是直接開檔案。';
    });

    ['f-text', 'f-usage', 'f-shape', 'f-element', 'f-tag', 'f-high'].forEach(function (id) {
      $(id).addEventListener('input', renderAssetBrowser);
    });
    $('btn-play').onclick = function () { state.playing = true; };
    $('btn-pause').onclick = function () { state.playing = false; };
    $('btn-restart').onclick = restart;
    $('chk-loop').onchange = function () { state.preset.loop = $('chk-loop').checked; onPresetChanged(); };
    $('sel-bg').onchange = function () { setBackground($('sel-bg').value); };
    $('btn-save').onclick = savePreset;
    $('btn-load').onclick = function () { $('file-load').click(); };
    $('file-load').onchange = function (e) {
      if (e.target.files[0]) loadPresetFromFile(e.target.files[0]);
    };
    $('btn-add-layer').onclick = function () { addLayer($('new-layer-type').value); };
    $('btn-del-layer').onclick = deleteLayer;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
