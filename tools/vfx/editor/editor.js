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
  var DEFAULT_PRESET_ID = 'demo-basic';

  /* ?preset=<id> 決定開場載入哪一份 preset。
     原本只寫死 demo-basic，要看別的 preset 只能走檔案挑選對話框，
     開發時每次重整都要重挑一次。id 限制成 preset id 的合法字元
     （見 Core 的 preset.id 規則），順便擋掉 ../ 之類的路徑穿越。 */
  function presetIdFromQuery() {
    try {
      var q = new URLSearchParams(window.location.search).get('preset');
      if (q && VFXPresetIdPolicy.isWritablePresetId(q)) return q;
    } catch (e) { /* 不支援 URLSearchParams 就用預設值 */ }
    return DEFAULT_PRESET_ID;
  }

  function presetUrl(id) { return '/vfx/presets/' + id + '.json'; }

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
    stageRoot: null,
    /* 上次「與 repo 檔案一致」的 canonical 文字。
       null 代表這份 preset 從來沒有存回 repo 過（例如從本機檔案匯入的），
       此時一律視為 dirty——比起假裝乾淨，寧可讓人多按一次存檔。 */
    savedText: null,
    saving: false,
    /* 這份內容是「以哪個 id 載進來的」。存檔目標是 preset.id，兩者不一致時
       按下存檔會寫到另一個檔案上——開著 fire-tornado 卻改掉 black-hole.json。
       所以不一致就直接擋住存檔，而不是只顯示一行警告。
       之後做 Save As 時，就是由 Save As 明確地把這個值改成新 id。 */
    sourcePresetId: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- Inspector 欄位描述（schema 驅動） ---------------- */

  function num(key, label, step) { return { key: key, label: label, kind: 'number', step: step || 0.01 }; }
  function vec(key, label) { return { key: key, label: label, kind: 'vec2' }; }
  function json(key, label) { return { key: key, label: label, kind: 'json' }; }

  var COMMON_FIELDS = [
    { key: 'id', label: 'id', kind: 'text' },
    { key: 'enabled', label: 'enabled', kind: 'bool', default: true },
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
      json('rotationSpeed', 'rotationSpeed'),
      /* particle 專屬：只掛在 TYPE_FIELDS.particle 底下，
         sprite／procedural 的 Inspector 不會出現這兩欄。 */
      { key: 'alignToVelocity', label: 'alignToVelocity', kind: 'bool', default: false },
      num('velocityRotationOffset', 'velocityRotationOffset(rad)')
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
        /* 每個布林欄位的預設值不同：enabled 沒寫就是開，alignToVelocity 沒寫就是關。
           一律用「!== false」會讓沒設定的 alignToVelocity 顯示成已勾選。 */
        var boolDefault = f.default !== false;
        control.checked = layer[f.key] === undefined ? boolDefault : layer[f.key] !== false;
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
    /* 不管合不合法都要更新 dirty：改壞了也是「改過了」，
       這時候把它顯示成乾淨反而最危險。 */
    refreshDirty();
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

  /* 目前編輯內容的 canonical 文字。dirty 判斷與存檔送出的都是這一份，
     兩邊用同一個函式，才不會出現「顯示已存檔但送出的是別的東西」。 */
  function currentPresetText() {
    try {
      return VFXCore.serialisePreset(state.preset);
    } catch (e) {
      return null;                            // 序列化不出來就當作 dirty
    }
  }

  function isDirty() {
    if (state.savedText === null) return true;
    return currentPresetText() !== state.savedText;
  }

  function refreshDirty() {
    var el = $('dirty-flag');
    if (!el) return;
    var dirty = isDirty();
    el.textContent = dirty ? '● 未存檔' : '';
    el.className = dirty ? 'dirty on' : 'dirty';
    /* 一旦又動過，上一次的「已存檔」就不再成立，讓它繼續掛在旁邊會變成
       「已存檔」與「未存檔」同時亮著。失敗訊息則留著——那是還沒解決的問題。 */
    var st = $('save-status');
    if (dirty && st && st.className.indexOf('ok') >= 0) setSaveStatus('', '');
  }

  function setSaveStatus(text, cls) {
    var el = $('save-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'save-status' + (cls ? ' ' + cls : '');
  }

  /* 存檔（回寫與下載）共用的擋門條件。
     驗證必須在送出前做：存出去的檔案下次載入會被 Core 拒絕的話，Save/Load 就不一致了。
     伺服器端會再驗一次——這裡擋是為了讓人當場看到原因，不是為了取代伺服器的驗證。 */
  function presetSaveProblems() {
    var check = VFXCore.validatePreset(state.preset);
    if (!check.ok) return { title: 'preset 不合法', list: check.errors };
    var missing = state.preset.layers
      .filter(function (l) { return l.assetId && !state.resolver.has(l.assetId); })
      .map(function (l) { return l.id + ' → ' + l.assetId; });
    if (missing.length) return { title: '引用了不存在的 assetId', list: missing };
    /* 檔名規則用的是伺服器同一份 policy，這樣「Editor 說可以存、伺服器回 400」
       這種契約分歧就不會發生。 */
    var idProblem = VFXPresetIdPolicy.presetIdProblem(state.preset.id);
    if (idProblem) return { title: '無法作為檔名', list: [idProblem] };
    return null;
  }

  /* 存檔目標與載入來源必須是同一個 id，否則就是在改別人的檔案。 */
  function saveTargetProblem() {
    if (state.sourcePresetId === null) return null;      // 匯入的內容以自己的 id 為準
    if (state.preset.id === state.sourcePresetId) return null;
    return 'preset.id（' + state.preset.id + '）與載入來源（' + state.sourcePresetId +
      '）不一致。存下去會覆寫 ' + state.preset.id + '.json，而不是你打開的那一份。' +
      '請先修正檔案內的 preset.id。';
  }

  function showSaveError(title, list) {
    $('validation').className = 'hint err';
    $('validation').textContent = title + (list && list.length ? '：\n- ' + list.join('\n- ') : '');
  }

  /* Save：把目前的 Preset 回寫到 repo 的 vfx/presets/<preset.id>.json。
     目的地由 preset.id 決定而不是由「開場的 ?preset= 」決定，
     之後要做 Save As 時只要能改 preset.id 就成立，不必動這條路徑。 */
  function savePreset() {
    if (state.saving) return;                 // 連按兩下不該送出兩次 PUT
    var targetProblem = saveTargetProblem();
    if (targetProblem) {
      showSaveError('無法存檔', [targetProblem]);
      setSaveStatus('存檔失敗', 'err');
      return;
    }
    var problems = presetSaveProblems();
    if (problems) {
      showSaveError('無法存檔，' + problems.title, problems.list);
      setSaveStatus('存檔失敗', 'err');
      return;
    }
    var text = currentPresetText();
    if (text === null) {
      showSaveError('無法存檔，序列化失敗', []);
      setSaveStatus('存檔失敗', 'err');
      return;
    }

    state.saving = true;
    $('btn-save').disabled = true;
    setSaveStatus('存檔中…', '');
    fetch(presetUrl(state.preset.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: text
    }).then(function (r) {
      return r.json().catch(function () {
        throw new Error('伺服器回應不是 JSON（HTTP ' + r.status + '）');
      }).then(function (body) {
        if (!r.ok || !body.ok) {
          var detail = (body.problems && body.problems.length)
            ? body.error + '\n- ' + body.problems.join('\n- ')
            : body.error || ('HTTP ' + r.status);
          throw new Error(detail);
        }
        return body;
      });
    }).then(function (body) {
      /* 成功：只更新「已存檔基準」。不重新載入、不動 selection、不動 preset.id。 */
      state.savedText = text;
      setSaveStatus('已存檔 · ' + body.bytes + ' bytes', 'ok');
      $('validation').className = 'hint ok';
      $('validation').textContent = '✓ 已寫入 vfx/presets/' + body.presetId + '.json';
      refreshDirty();
    }).catch(function (e) {
      /* 失敗：Editor 狀態原封不動，dirty 維持 true，錯誤照伺服器講的原因顯示。 */
      setSaveStatus('存檔失敗', 'err');
      showSaveError('存檔失敗（repo 檔案未變動）', String(e && e.message || e).split('\n'));
      refreshDirty();
    }).then(function () {
      state.saving = false;
      $('btn-save').disabled = false;
    });
  }

  /* 下載一份複本。回寫上線之後這條路仍然留著：要把 Preset 交給別人、
     或想在不碰 repo 的情況下留個備份時還是需要它。 */
  function downloadPreset() {
    var problems = presetSaveProblems();
    if (problems) return showSaveError('無法下載，' + problems.title, problems.list);
    var text = currentPresetText();
    if (text === null) return showSaveError('無法下載，序列化失敗', []);
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
        /* 從本機檔案匯入的內容還沒進 repo，一律當成未存檔。
           匯入等於「這份就是它自己宣告的那個 preset」，所以來源 id 交給它自己，
           存檔會寫到 <preset.id>.json——這也是把外部改好的 preset 收回 repo 的路。 */
        state.savedText = null;
        state.sourcePresetId = null;
        setSaveStatus('', '');
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
    var bootPresetId = presetIdFromQuery();
    Promise.all([
      fetchJson(ASSET_INDEX_URL),
      fetchJson(ASSET_SEMANTICS_URL),
      fetchJson(presetUrl(bootPresetId))
    ]).then(function (res) {
      state.index = res[0];
      state.semantics = res[1];
      state.preset = res[2];
      state.selectedLayerId = state.preset.layers[0].id;
      /* 剛載入的內容就是 repo 上的內容 → 基準線，dirty = false。
         用 canonical 文字而不是原始 bytes：檔案若還沒 canonical 化，
         每次一開啟就會顯示未存檔，那個提示很快就會被無視。 */
      state.savedText = VFXCore.serialisePreset(state.preset);
      state.sourcePresetId = bootPresetId;
      if (state.preset.id !== bootPresetId) {
        setSaveStatus('preset.id 與檔名不一致，已停用存檔', 'err');
      }

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
        /* 存檔／dirty 這條路只有在真的瀏覽器裡才跑得起來（fetch ＋ DOM），
           把入口露出來，QA 與端對端驗證才能斷言結果而不是用看的。 */
        window.__vfxEditorApi = {
          isDirty: isDirty,
          savePreset: savePreset,
          currentPresetText: currentPresetText
        };

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
    $('btn-download').onclick = downloadPreset;
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
