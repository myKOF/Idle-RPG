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
    vocab: null,             // 篩選下拉的字彙，Asset Browser 與 Picker 共用
    preset: null,
    /* ---- Layer 面板的狀態 ----
       selectedKeys 是「被選取的」，activeKey 是「有焦點的那一個」。
       兩者必須分開：多選時 Inspector 只能顯示一個，顯示哪一個由 activeKey 決定。
       key 的形式是 'layer:<id>' 或 'group:<id>'，讓兩種列可以放在同一個集合裡。 */
    selectedKeys: [],
    activeKey: null,
    anchorKey: null,          // Shift 範圍選取的起點
    sortMode: 'creation',     // 'creation' | 'name'，純顯示排序
    layout: null,             // vfx/layouts/<id>.json 的內容（Editor 專用）
    collapsed: {},            // groupId -> true，只存 localStorage
    clipboard: null,          // Editor 內部剪貼簿，不碰 OS clipboard
    dragKeys: null,           // 拖曳中的 key 陣列
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
  /* 角度欄位：畫面上是度，檔案裡是弧度。
     Schema 不動——Core 把 rotation 直接交給 Pixi 的 node.rotation，那就是弧度。
     但整個編輯器（以及遊戲的其他參數表）都以度為單位，Inspector 裡混著
     1.5708 這種數字只會逼人拿計算機。換算集中在這個 kind，不散落各處。 */
  function deg(key, label, step) {
    return { key: key, label: label, kind: 'angle', step: step || 1 };
  }
  /* 角度範圍：值可能是單一數字或 [min, max]（Core 的 sampleRange）。
     兩種形式都要換算，所以不能沿用純 JSON 欄位。 */
  function degRange(key, label) { return { key: key, label: label, kind: 'angleRange' }; }
  function vec(key, label) { return { key: key, label: label, kind: 'vec2' }; }
  function json(key, label) { return { key: key, label: label, kind: 'json' }; }

  var COMMON_FIELDS = [
    { key: 'id', label: 'id', kind: 'text' },
    { key: 'enabled', label: 'enabled', kind: 'bool', default: true },
    { key: 'assetId', label: 'assetId', kind: 'asset' },
    num('zIndex', 'zIndex', 1),
    vec('position', 'position'),
    deg('rotation', 'rotation(°)'),
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

  /* ---------------- Over-Life 曲線區塊 ----------------

     每個屬性的 policy 決定值的上下限、單位與顯示換算；curve-editor 本身
     不認識 alpha／scale／rotation，換一個屬性只要換一份 policy。

     透明度**不夾到 1**。alphaOverLife 是乘在 layer.alpha 上的係數，不是
     絕對不透明度：現有 preset（lightning-orb-field-b 的 field-glow、orb-*-glow…）
     大量使用 1.09～1.26 讓亮部過曝。夾到 1 會靜靜改掉這些既有數值，
     那正是規格禁止的行為。所以只夾下限 0（與 Core 的 nonNegative 一致），
     Y 軸基準顯示 0..1，超過就自動放大。 */
  var CURVE_POLICY = {
    alpha: {
      min: 0, max: null, baseline: [0, 1], defaultValue: 1, decimals: 3, unit: ''
    },
    scale: {
      min: 0, max: null, baseline: [0, 1.5], defaultValue: 1, decimals: 3, unit: ''
    },
    /* 旋轉在檔案裡是弧度，在畫面上是度。
       上下限釘死在 ±360°（＝一整圈），而且**軸不隨資料放大**：
       會跟著拖曳一直長高的軸，永遠拉不到盡頭，也就看不出自己轉了幾分之幾圈。

       min／max／baseline 都是拿來跟**儲存值**比的，所以一律寫成弧度。
       寫 [-360, 360] 會被當成 360 弧度（兩萬多度）——見測試 CURVE-20。 */
    rotation: {
      min: -Math.PI * 2, max: Math.PI * 2, fixedRange: true,
      baseline: [-Math.PI * 2, Math.PI * 2], defaultValue: 0, decimals: 1,
      unit: '°', toDisplay: VFXCurveModel.radToDeg, fromDisplay: VFXCurveModel.degToRad
    }
  };

  /* 哪些型別支援分軸縮放。與 Core 的 TYPE_ONLY_FIELDS 對齊：
     這兩型走 updateSpriteLayer（兩軸各自取樣），粒子層的兩軸永遠相等。 */
  function supportsPerAxisScale(layer) {
    return layer.type === 'sprite' || layer.type === 'procedural';
  }

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
      degRange('rotationStart', 'rotationStart(°)'),
      degRange('rotationSpeed', 'rotationSpeed(°/s)'),
      /* particle 專屬：只掛在 TYPE_FIELDS.particle 底下，
         sprite／procedural 的 Inspector 不會出現這兩欄。 */
      { key: 'alignToVelocity', label: 'alignToVelocity', kind: 'bool', default: false },
      deg('velocityRotationOffset', 'velocityRotationOffset(°)')
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
  /* group 是詞彙表的分組名（shape／usage／element／tag）。
     option 的 value 一律維持英文原值——它會直接拿去和 semantics 檔比對，
     改成中文就等於把顯示問題變成資料問題。只有 textContent 換成中文。 */
  function fillSelect(el, values, group) {
    el.textContent = '';
    var all = document.createElement('option');
    all.value = '';
    /* 沒登記在詞彙表裡的分組（例如圖層型別）就用原字串當標題。
       少了這個 fallback，第一個選項會顯示成「undefined（全部）」。 */
    all.textContent = (VFXSemanticVocab.LABELS.field[group] || group) + '（全部）';
    el.appendChild(all);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = VFXSemanticVocab.labelOf(group, v);
      el.appendChild(o);
    });
  }

  /* prefix 決定讀哪一組控制項：'f-' 是左側 Asset Browser，'pf-' 是 Asset Picker
     對話框。兩邊欄位一模一樣，共用同一個 filterAssets()，不做第二套搜尋。 */
  function currentAssetFilters(prefix) {
    var p = prefix || 'f-';
    return {
      text: $(p + 'text').value.trim().toLowerCase(),
      usage: $(p + 'usage').value,
      shape: $(p + 'shape').value,
      element: $(p + 'element').value,
      tag: $(p + 'tag').value,
      high: $(p + 'high').checked
    };
  }

  function filterAssets(prefix, limit) {
    var cap = limit || 300;
    var f = currentAssetFilters(prefix);
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
      if (out.length >= cap) break;                      // 清單上限，避免一次塞上千個 DOM
    }
    return out;
  }

  function renderAssetBrowser() {
    var rows = filterAssets('f-');
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

  /* ---------------- Asset Picker ----------------

     選的是 Asset Library Index 裡的 assetId，不是檔案系統路徑。刻意不用作業
     系統的檔案選擇器：那會選到本機絕對路徑，一旦寫進 Preset 就不可攜，
     換一台電腦或別人 clone 下來就壞。

     搜尋與篩選直接重用 Asset Browser 的 filterAssets()，沒有第二套實作。 */

  var picker = { layer: null, field: 'assetId', selected: null };

  function wirePicker() {
    ['pf-text', 'pf-usage', 'pf-shape', 'pf-element', 'pf-tag', 'pf-high']
      .forEach(function (id) { $(id).addEventListener('input', renderPickerList); });
    $('picker-close').onclick = closePicker;
    $('picker-apply').onclick = applyPicker;
    $('picker').addEventListener('mousedown', function (e) {
      if (e.target === $('picker')) closePicker();          // 點外框關閉
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('picker').hidden) { closePicker(); e.preventDefault(); }
    });
  }

  function openPicker(layer, field) {
    picker.layer = layer;
    picker.field = field;
    picker.selected = layer[field] || null;
    $('picker-target').textContent = '圖層 ' + layer.id;
    $('picker').hidden = false;
    renderPickerList();
    renderPickerDetail();
    $('pf-text').focus();
  }

  function closePicker() {
    $('picker').hidden = true;
    picker.layer = null;
    picker.selected = null;
  }

  function applyPicker() {
    if (!picker.layer || !picker.selected) return;
    picker.layer[picker.field] = picker.selected;
    closePicker();
    onPresetChanged();
    renderInspector();
  }

  function renderPickerList() {
    var rows = filterAssets('pf-', 400);
    $('picker-count').textContent = rows.length + ' 筆' + (rows.length >= 400 ? '（已截斷）' : '');
    var host = $('picker-list');
    host.textContent = '';
    rows.forEach(function (rec) {
      var cell = document.createElement('div');
      cell.className = 'pick' + (rec.assetId === picker.selected ? ' sel' : '');
      cell.title = rec.assetId;
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.src = state.resolver.resolve(rec.assetId);
      var name = document.createElement('span');
      name.textContent = rec.assetId.split('/').pop();
      cell.appendChild(img); cell.appendChild(name);
      cell.onclick = function () {
        picker.selected = rec.assetId;
        renderPickerList();
        renderPickerDetail();
      };
      cell.ondblclick = applyPicker;
      host.appendChild(cell);
    });
    $('picker-apply').disabled = !picker.selected;
  }

  function findById(list, id) {
    for (var i = 0; i < list.length; i++) { if (list[i].assetId === id) return list[i]; }
    return null;
  }

  function renderPickerDetail() {
    var host = $('picker-preview');
    var meta = $('picker-meta');
    host.textContent = ''; meta.textContent = '';
    if (!picker.selected) return;

    var img = document.createElement('img');
    img.src = state.resolver.resolve(picker.selected);
    host.appendChild(img);

    function row(k, v) {
      if (v === undefined || v === null || v === '') return;
      var line = document.createElement('div'); line.className = 'row2';
      var a = document.createElement('span'); a.className = 'k'; a.textContent = k;
      var b = document.createElement('span'); b.className = 'v'; b.textContent = String(v);
      line.appendChild(a); line.appendChild(b); meta.appendChild(line);
    }

    var sem = findById(state.semantics.records, picker.selected);
    var fact = findById(state.index.assets, picker.selected);
    var L = VFXSemanticVocab.labelOf;
    row('assetId', picker.selected);
    if (fact && fact.facts && fact.facts.dimensions) {
      row('尺寸', fact.facts.dimensions.width + ' × ' + fact.facts.dimensions.height);
    }
    if (sem) {
      /* 這裡跟著下拉選單一起中文化，但保留括號裡的英文原值：
         使用者用中文找素材，看到的資訊要對得上他剛才選的那一項。 */
      row('形狀', L('shape', sem.shape));
      row('用途', (sem.usage || []).map(function (u) { return L('usage', u); }).join('、'));
      row('元素', L('element', sem.element));
      row('標籤', (sem.tags || []).map(function (t) { return L('tag', t); }).join('、'));
      row('信心', L('confidence', sem.confidence) + (sem.needsReview ? ' 需人工確認' : ''));
    }
    /* blendMode 與 tintable 是**推導**出來的，不是存下來的欄位。規則只有一份，
       在 vfx-semantic-vocab.cjs，這裡直接呼叫，不在 Editor 裡抄第二份。 */
    if (fact && fact.facts) {
      row('背景', fact.facts.backgroundVariant);
      var bm = VFXSemanticVocab.blendModeFromFacts(fact.facts);
      row('建議 blend', bm === 'additive' ? 'add' : (bm === 'alphaBlend' ? 'normal' : bm));
      var tint = VFXSemanticVocab.tintableFromFacts(fact.facts);
      row('可染色', tint === null ? '未知' : (tint ? '是（灰階，可用 tint 換色）' : '否（已上色）'));
    }
  }

  /* ---------------- Layer list ---------------- */

  /* ============================================================
     Layer 面板：Group / 多選 / 排序 / Copy-Paste / Drag

     三個必須分清楚的順序，混在一起就會出現「排個序畫面就變了」這種災難：

       RENDER ORDER   由 layer.zIndex 決定（Pixi container.sortableChildren）。
                      本面板的任何操作都不會動它。
       AUTHORING ORDER preset.layers 的陣列順序。拖曳改的是這個。
                      它不影響畫面，只影響人看到的排列與檔案 diff。
       VIEW SORT      「建立順序 / 名稱」下拉選單。純顯示，什麼都不改。
     ============================================================ */

  /* 所有「這個操作對資料做了什麼」的邏輯都在 layer-model.js，
     這裡只負責畫面與事件。兩邊各寫一份的話遲早會分家，
     而分家的症狀是「測試都過、實際點下去行為不一樣」。 */
  var M = VFXLayerModel;

  function keyOf(kind, id) { return M.keyOf(kind, id); }
  function keyKind(key) { return M.keyKind(key); }
  function keyId(key) { return M.keyId(key); }
  function layerById(id) { return M.layerById(state.preset, id); }

  /* Inspector 顯示的是 active，不是「選取的第一個」——多選時這兩者常常不同。 */
  function selectedLayer() {
    if (keyKind(state.activeKey) !== "layer") return null;
    return layerById(keyId(state.activeKey));
  }

  function activeGroup() {
    if (keyKind(state.activeKey) !== "group") return null;
    return groupById(keyId(state.activeKey));
  }

  function groupById(id) { return M.groupById(state.layout, id); }
  function groupOfLayer(id) { return M.groupOfLayer(state.layout, id); }

  /* ---------------- 列的組成 ---------------- */

  /* 先用 layout-schema 的 reconcile 把分組疊到實際圖層上（它負責自癒），
     再套用純顯示的排序。排序只重排「要畫哪幾列、順序如何」，
     preset.layers 與 layout.groups 一個 byte 都不會動。 */
  function buildRows() {
    var rec = VFXLayoutSchema.reconcile(state.preset.layers, state.layout);
    var rows = rec.rows.map(function (r) {
      if (r.kind === "group") {
        return { kind: "group", id: r.id, name: r.name, layerIds: r.layerIds.slice() };
      }
      return { kind: "layer", id: r.id, groupId: null };
    });
    return M.sortRows(rows, state.sortMode);
  }

  /* 目前「畫面上看得到的列」，收合的群組不展開子項。
     Shift 範圍選取必須以這個為準——選到看不見的東西是最經典的多選 bug。 */
  function visibleKeys() { return M.visibleKeys(buildRows(), state.collapsed); }

  /* ---------------- 選取 ---------------- */

  function isSelected(key) { return state.selectedKeys.indexOf(key) >= 0; }

  function setSelection(keys, active) {
    state.selectedKeys = keys.slice();
    state.activeKey = active !== undefined ? active : (keys.length ? keys[keys.length - 1] : null);
    /* 舊程式（Inspector、addLayer…）還在讀 selectedLayerId，保持同步 */
    state.selectedLayerId = keyKind(state.activeKey) === "layer" ? keyId(state.activeKey) : null;
  }

  function handleRowMouseDown(key, e) {
    var next = M.applyClick(
      { selected: state.selectedKeys, active: state.activeKey, anchor: state.anchorKey },
      visibleKeys(), key,
      { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey });
    setSelection(next.selected, next.active);
    state.anchorKey = next.anchor;
    renderLayerList();
    renderInspector();
  }

  /* ---------------- 畫面 ---------------- */

  function renderLayerList() {
    var host = $("layer-list");
    host.textContent = "";
    var rows = buildRows();

    rows.forEach(function (r) {
      if (r.kind === "group") {
        host.appendChild(groupRow(r));
        if (state.collapsed[r.id]) return;
        r.layerIds.forEach(function (id) {
          var l = layerById(id);
          if (l) host.appendChild(layerRow(l, true));
        });
        return;
      }
      var layer = layerById(r.id);
      if (layer) host.appendChild(layerRow(layer, false));
    });

    updateLayerPanelStatus();
  }

  function updateLayerPanelStatus() {
    var el = $("layer-status");
    if (!el) return;
    var nSel = state.selectedKeys.length;
    el.textContent = nSel > 1 ? ("已選取 " + nSel + " 項") : "";
  }

  function groupRow(r) {
    var div = document.createElement("div");
    var key = keyOf("group", r.id);
    div.className = "layer-row group-row" + (isSelected(key) ? " sel" : "") +
      (state.activeKey === key ? " active" : "");
    div.dataset.key = key;

    var tw = document.createElement("button");
    tw.className = "twisty";
    tw.type = "button";
    tw.textContent = state.collapsed[r.id] ? "\u25B6" : "\u25BC";
    tw.title = state.collapsed[r.id] ? "展開" : "收合";
    tw.onmousedown = function (e) { e.stopPropagation(); };
    tw.onclick = function (e) {
      e.stopPropagation();
      state.collapsed[r.id] = !state.collapsed[r.id];
      saveCollapsed();
      renderLayerList();
    };

    var cb = document.createElement("input");
    cb.type = "checkbox";
    /* 群組的勾選狀態＝底下所有圖層的聯集。全開才勾，全關才不勾，混合狀態用 indeterminate。 */
    var members = r.layerIds.map(layerById).filter(Boolean);
    var on = members.filter(function (l) { return l.enabled !== false; }).length;
    cb.checked = members.length > 0 && on === members.length;
    cb.indeterminate = on > 0 && on < members.length;
    cb.title = "整組啟用／停用";
    cb.onmousedown = function (e) { e.stopPropagation(); };
    cb.onclick = function (e) {
      e.stopPropagation();
      var turnOn = cb.checked;
      members.forEach(function (l) { l.enabled = turnOn; });
      onPresetChanged();
      renderLayerList();
    };

    var name = document.createElement("span");
    name.className = "gname";
    name.textContent = r.name;
    name.title = "雙擊重新命名";
    name.ondblclick = function (e) { e.stopPropagation(); renameGroup(r.id); };

    var count = document.createElement("span");
    count.className = "type";
    count.textContent = r.layerIds.length + " 層";

    div.appendChild(tw); div.appendChild(cb); div.appendChild(name); div.appendChild(count);
    wireRow(div, key);
    return div;
  }

  function layerRow(layer, inGroup) {
    var div = document.createElement("div");
    var key = keyOf("layer", layer.id);
    div.className = "layer-row" + (inGroup ? " child" : "") +
      (isSelected(key) ? " sel" : "") + (state.activeKey === key ? " active" : "");
    div.dataset.key = key;

    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = layer.enabled !== false;
    /* mousedown 也要擋：否則按住勾選框拖動會變成拖曳圖層 */
    cb.onmousedown = function (e) { e.stopPropagation(); };
    cb.onclick = function (e) {
      e.stopPropagation();
      layer.enabled = cb.checked;
      onPresetChanged();
    };

    var name = document.createElement("span");
    name.textContent = layer.id;

    var type = document.createElement("span");
    type.className = "type";
    type.textContent = layer.type;

    div.appendChild(cb); div.appendChild(name); div.appendChild(type);
    wireRow(div, key);
    return div;
  }

  /* ---------------- 拖曳 ----------------
     拖曳改的是 AUTHORING ORDER（preset.layers 的順序）與分組歸屬，
     絕不碰 zIndex。畫面長什麼樣由 zIndex 決定，拖完必須一模一樣。 */

  function wireRow(div, key) {
    div.onmousedown = function (e) {
      if (e.button !== 0) return;
      handleRowMouseDown(key, e);
    };
    /* 名稱排序時不開放拖曳：畫面順序與 authoring order 不一致，
       拖到「B 的下面」會落在完全不同的位置，那是最容易失去信任的互動。 */
    div.draggable = state.sortMode === "creation";
    div.ondragstart = function (e) {
      if (state.sortMode !== "creation") { e.preventDefault(); return; }
      /* 拖曳整個選取集合；拖到沒被選的列上則只拖那一列 */
      state.dragKeys = isSelected(key) ? state.selectedKeys.slice() : [key];
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", key); } catch (err) { }
      div.classList.add("dragging");
    };
    div.ondragend = function () {
      state.dragKeys = null;
      clearDropMarks();
      renderLayerList();
    };
    div.ondragover = function (e) {
      if (!state.dragKeys) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearDropMarks();
      var mode = dropModeFor(div, key, e);
      div.classList.add(mode === "into" ? "drop-into" :
        (mode === "before" ? "drop-before" : "drop-after"));
    };
    div.ondragleave = function () { div.classList.remove("drop-into", "drop-before", "drop-after"); };
    div.ondrop = function (e) {
      if (!state.dragKeys) return;
      e.preventDefault();
      e.stopPropagation();
      performDrop(key, dropModeFor(div, key, e));
      state.dragKeys = null;
      clearDropMarks();
    };
  }

  function clearDropMarks() {
    var rows = $("layer-list").querySelectorAll(".layer-row");
    [].forEach.call(rows, function (r) {
      r.classList.remove("drop-into", "drop-before", "drop-after", "dragging");
    });
  }

  /* 群組列的中間三分之一 = 丟進群組；上下緣 = 排在群組前／後。
     圖層列只有前／後。 */
  function dropModeFor(div, key, e) {
    var r = div.getBoundingClientRect();
    var y = e.clientY - r.top;
    if (keyKind(key) === "group") {
      if (y < r.height * 0.28) return "before";
      if (y > r.height * 0.72) return "after";
      /* 中段本來是 into，但目標不允許 into 時（例如拖的是群組，而這一版
         不支援巢狀群組）就不能顯示 into——指示線是操作契約不是裝飾，
         顯示 into 卻做成 before 等於騙使用者。改成依落點就近取前／後。 */
      if (!M.dropModeAllowed(state.dragKeys || [], key, "into")) {
        return y < r.height / 2 ? "before" : "after";
      }
      return "into";
    }
    return y < r.height / 2 ? "before" : "after";
  }

  function performDrop(targetKey, mode) {
    ensureLayout();
    if (!M.applyDrop(state.preset, state.layout, state.dragKeys.slice(), targetKey, mode)) return;
    /* 這裡刻意**不呼叫** onPresetChanged()：拖曳只改 layout，preset 一個 byte
       都沒動，重建 runtime 等於白白丟掉目前的粒子狀態、重抓貼圖、製造 GC 壓力，
       而且畫面會突然重播。只有真正改到 VFX 資料時才需要重建預覽。 */
    markLayoutDirty();
    renderLayerList();
  }


  /* 拖空的群組留著沒有意義，而且會在列表尾巴堆積 */
  function dropEmptyGroups() { M.dropEmptyGroups(state.layout); }

  /* ---------------- Copy / Paste ----------------
     Editor 內部剪貼簿，不碰 OS clipboard——那需要權限提示，而這裡只需要
     在同一個 Editor 內複製圖層。 */

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  function uniqueIdFrom(base, taken) { return M.uniqueIdFrom(base, taken); }

  function copySelection() {
    if (!state.selectedKeys.length) return;
    state.clipboard = M.copySelection(state.preset, state.layout, state.selectedKeys);
    updateClipboardStatus();
  }


  function pasteClipboard() {
    if (!state.clipboard || !state.clipboard.items.length) return;
    ensureLayout();
    /* 以目前 active 當插入錨點，貼在它後面，而不是丟到整個列表最下面 */
    var newKeys = M.pasteClipboard(state.preset, state.layout, state.clipboard, state.activeKey);
    setSelection(newKeys, newKeys[newKeys.length - 1]);
    state.anchorKey = state.activeKey;
    markLayoutDirty();
    onPresetChanged();
    renderLayerList();
    renderInspector();
  }


  function updateClipboardStatus() {
    var el = $("clipboard-status");
    if (!el) return;
    var c = state.clipboard;
    el.textContent = c ? ("剪貼簿：" + c.items.length + " 項") : "";
  }

  /* ---------------- 群組操作 ---------------- */

  function ensureLayout() {
    if (!state.layout) state.layout = VFXLayoutSchema.emptyLayout(state.preset.id);
    if (!Array.isArray(state.layout.groups)) state.layout.groups = [];
    /* order 缺席時用目前 reconcile 出來的樣子補齊。舊的 layout 檔沒有這個欄位，
       補上之後拖曳才有東西可改。 */
    if (!Array.isArray(state.layout.order)) {
      var rec = VFXLayoutSchema.reconcile(state.preset.layers, state.layout);
      state.layout.order = VFXLayoutSchema.orderFromRows(rec.rows);
    }
  }

  function groupSelection() {
    var ids = state.selectedKeys.filter(function (k) { return keyKind(k) === "layer"; })
      .map(keyId);
    if (!ids.length) return;
    ensureLayout();
    var gid = M.groupLayers(state.layout, ids, "新群組");
    if (!gid) return;
    setSelection([keyOf("group", gid)], keyOf("group", gid));
    state.anchorKey = state.activeKey;
    markLayoutDirty();
    renderLayerList();
    renderInspector();
  }

  function ungroupSelection() {
    var gids = state.selectedKeys.filter(function (k) { return keyKind(k) === "group"; }).map(keyId);
    if (!gids.length || !state.layout) return;
    M.ungroup(state.layout, gids);
    setSelection([], null);
    markLayoutDirty();
    renderLayerList();
    renderInspector();
  }

  function renameGroup(gid) {
    var g = groupById(gid);
    if (!g) return;
    var name = window.prompt("群組名稱", g.name);
    if (name === null) return;
    name = String(name).trim();
    if (!name) return;
    if (name.length > VFXLayoutSchema.LIMITS.maxNameLength) {
      name = name.slice(0, VFXLayoutSchema.LIMITS.maxNameLength);
    }
    g.name = name;
    markLayoutDirty();
    renderLayerList();
  }

  /* ---------------- layout 的載入與存檔 ---------------- */

  function layoutUrl(id) { return "/vfx/layouts/" + id + ".json"; }

  /* 載入分組。任何問題都退回「沒有分組」的 deterministic 狀態，
     但**一定要說出來**——安靜地變成空白會讓人以為所有群組被刪了。
     退回時不覆寫壞掉的檔案：那份檔案是使用者的資料，要留著給人修。 */
  function loadLayout(presetId) {
    return fetch(layoutUrl(presetId)).then(function (r) {
      if (r.status === 404) return { layout: VFXLayoutSchema.emptyLayout(presetId) };
      if (!r.ok) throw new Error("layout HTTP " + r.status);
      return r.json().then(function (raw) { return { raw: raw }; });
    }).then(function (res) {
      if (res.layout) return res;
      var raw = res.raw;
      /* 與 Preset 的 sourcePresetId 守門同一個安全原則：內容宣稱自己屬於
         哪一份 preset，就只能套用在那一份上。id 剛好重疊時會產生錯誤分組。 */
      if (!raw || raw.presetId !== presetId) {
        return {
          layout: VFXLayoutSchema.emptyLayout(presetId),
          error: "分組檔宣稱屬於 " + (raw && raw.presetId) + "，與目前的 " +
            presetId + " 不符，已忽略（檔案未被覆寫）"
        };
      }
      var check = VFXLayoutSchema.validateLayout(raw);
      if (!check.ok) {
        return {
          layout: VFXLayoutSchema.emptyLayout(presetId),
          error: "分組檔不合法，已忽略（檔案未被覆寫）：\n- " + check.errors.join("\n- ")
        };
      }
      return { layout: raw };
    }).catch(function (e) {
      return {
        layout: VFXLayoutSchema.emptyLayout(presetId),
        error: "分組檔讀取失敗，已忽略：" + (e && e.message || e)
      };
    });
  }

  /* 每次改動 layout 就 +1。存檔成功時只有「revision 沒變」才敢清 dirty——
     否則使用者在 request 飛在半空中時改的東西會被當成已存檔，重整後靜默消失。 */
  function markLayoutDirty() {
    state.layoutRevision = (state.layoutRevision || 0) + 1;
    state.layoutDirty = true;
    refreshDirty();
  }

  function saveLayout() {
    ensureLayout();
    state.layout.presetId = state.preset.id;
    dropEmptyGroups();
    var check = VFXLayoutSchema.validateLayout(state.layout);
    if (!check.ok) return Promise.reject(new Error("分組資料不合法：\n- " + check.errors.join("\n- ")));
    /* 送出當下的版本號。使用者不會被擋著不能編輯——只是這次存檔不能
       替後來的改動背書。 */
    var sentAt = state.layoutRevision || 0;
    return fetch(layoutUrl(state.preset.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: VFXLayoutSchema.serialiseLayout(state.layout)
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok || !body.ok) throw new Error(body.error || ("HTTP " + r.status));
        if ((state.layoutRevision || 0) === sentAt) state.layoutDirty = false;
        refreshDirty();
        return body;
      });
    });
  }

  /* ---------------- 收合狀態（只存 localStorage） ---------------- */

  function collapsedKey() { return "vfx-editor.collapsed." + (state.preset ? state.preset.id : ""); }

  function saveCollapsed() {
    try { window.localStorage.setItem(collapsedKey(), JSON.stringify(state.collapsed)); } catch (e) { }
  }

  function loadCollapsed() {
    state.collapsed = {};
    try {
      var raw = window.localStorage.getItem(collapsedKey());
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") state.collapsed = o;
      }
    } catch (e) { }
  }

  /* ---------------- 鍵盤 ----------------
     只在 Layer 操作語境生效。焦點在任何可輸入的欄位裡時一律不攔截，
     否則在 JSON 參數框裡按 Ctrl+C 會變成複製圖層。 */

  function isTextEntry(el) { return M.isTextEntry(el); }

  /* 焦點是否落在某個曲線編輯器裡。用 closest 而不是逐一問每個元件，
     這樣即使元件已經被換掉，判斷仍然只看目前的 DOM。 */
  function inCurveEditor(el) {
    return !!(el && el.closest && el.closest('.curve'));
  }

  function onKeyDown(e) {
    if (!state.preset) return;
    if (!$('picker').hidden) return;                      // Picker 開著時鍵盤歸它
    /* 焦點在任何可輸入的欄位裡就完全不攔截：在 JSON 參數框或搜尋框按 Delete
       要刪字元，不是刪圖層；按 Ctrl+C 要複製文字，不是複製圖層。 */
    if (isTextEntry(document.activeElement)) return;
    /* 焦點在曲線編輯器裡時，Delete 屬於曲線的控制點。
       曲線元件自己會 stopPropagation，這裡是第二道防線：即使事件因為
       某個路徑繞過了它，也不能把整個圖層刪掉——刪錯的代價差太多。 */
    if (inCurveEditor(document.activeElement)) return;

    var k = (e.key || '').toLowerCase();
    if (k === 'delete') {
      if (!state.selectedKeys.length) return;
      deleteSelection();
      e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    if (k === 'c') { copySelection(); e.preventDefault(); return; }
    if (k === 'v') { pasteClipboard(); e.preventDefault(); }
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

  /* 換算後的小數尾巴（0.5235987755982988 → 30）不該出現在輸入框裡 */
  function round4(v) { return Math.round(v * 10000) / 10000; }

  var INVALID = {};

  function angleRangeToText(v) {
    if (v === undefined || v === null) return '';
    if (Array.isArray(v)) {
      return '[' + v.map(function (x) { return round4(VFXCurveModel.radToDeg(x)); }).join(', ') + ']';
    }
    return String(round4(VFXCurveModel.radToDeg(v)));
  }

  /* 空字串＝這個欄位不存在。格式錯誤回傳 INVALID，讓呼叫端把輸入框標紅，
     而不是靜靜吃掉——寫錯了卻沒有反應是最難查的那種。 */
  function angleRangeFromText(text) {
    var t = String(text).trim();
    if (!t) return undefined;
    var parsed;
    try { parsed = JSON.parse(t); } catch (e) { return INVALID; }
    if (typeof parsed === 'number' && isFinite(parsed)) return VFXCurveModel.degToRad(parsed);
    if (Array.isArray(parsed) && parsed.length === 2 &&
        parsed.every(function (x) { return typeof x === 'number' && isFinite(x); })) {
      return parsed.map(VFXCurveModel.degToRad);
    }
    return INVALID;
  }

  function renderInspector() {
    var host = $('inspector');
    /* 舊的曲線元件在 window 上掛了 mousemove／mouseup，不收掉會越積越多，
       而且已被移除的 canvas 仍會在每次滑鼠移動時做命中測試。 */
    destroyCurveEditors();
    host.innerHTML = '';
    var layer = selectedLayer();
    if (!layer) {
      /* 選到群組時 Inspector 沒有東西可編（這一版的 Group 是純組織用的，
         沒有 transform），但要說清楚選中的是什麼，而不是顯示「未選取」。 */
      var g = activeGroup();
      var hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = g
        ? ('群組「' + g.name + '」（' + g.layerIds.length + ' 層）\n' +
           '群組只用來整理圖層，本身沒有可調參數。\n' +
           '選取單一圖層才會顯示參數。')
        : '未選取圖層';
      host.appendChild(hint);
      return;
    }

    var fields = COMMON_FIELDS
      .concat([{ kind: 'title', label: layer.type + ' 專屬' }])
      .concat(TYPE_FIELDS[layer.type] || []);

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
        /* 文字框留著（看得到目前是哪一個 assetId，也能貼上），但正常流程
           不該需要手打 package/path/file.png。 */
        control = document.createElement('div');
        control.className = 'asset-field';
        var textIn = document.createElement('input');
        textIn.type = 'text';
        textIn.value = layer[f.key] || '';
        textIn.title = layer[f.key] || '';
        textIn.placeholder = '按「選擇素材」';
        textIn.onchange = function () { layer[f.key] = textIn.value; onPresetChanged(); };
        var pickBtn = document.createElement('button');
        pickBtn.type = 'button';
        pickBtn.className = 'pick-btn';
        pickBtn.textContent = '選擇素材';
        pickBtn.onclick = function () { openPicker(layer, f.key); };
        control.appendChild(textIn);
        control.appendChild(pickBtn);
      } else if (f.kind === 'text') {
        control = document.createElement('input');
        control.type = 'text';
        control.value = layer[f.key] || '';
        control.onchange = function () {
          var old = layer[f.key];
          if (f.key === 'id') {
            /* 改 id 必須連 layout 裡的參照一起改，否則那一層會從群組裡
               「消失」變成 root——實測過，Orb A 會從 4 層掉到 3 層。 */
            var next = String(control.value);
            if (!next || next === old) { control.value = old; return; }
            if (M.layerById(state.preset, next)) {
              showSaveError('圖層 id 重複', [next + ' 已經有人用了']);
              control.value = old;
              return;
            }
            ensureLayout();
            M.renameLayer(state.preset, state.layout, old, next);
            var oldKey = keyOf('layer', old), newKey = keyOf('layer', next);
            state.selectedKeys = state.selectedKeys.map(function (k) {
              return k === oldKey ? newKey : k;
            });
            if (state.activeKey === oldKey) state.activeKey = newKey;
            if (state.anchorKey === oldKey) state.anchorKey = newKey;
            state.selectedLayerId = next;
            markLayoutDirty();
            onPresetChanged(); renderLayerList(); renderInspector();
            return;
          }
          layer[f.key] = control.value;
          onPresetChanged(); renderLayerList();
        };
      } else if (f.kind === 'angle') {
        control = document.createElement('input');
        control.type = 'number';
        control.step = String(f.step);
        control.value = layer[f.key] === undefined
          ? '' : round4(VFXCurveModel.radToDeg(layer[f.key]));
        control.oninput = function () {
          if (control.value === '') delete layer[f.key];
          else layer[f.key] = VFXCurveModel.degToRad(Number(control.value));
          onPresetChanged();
        };
      } else if (f.kind === 'angleRange') {
        control = document.createElement('input');
        control.type = 'text';
        control.placeholder = '30 或 [0, 360]';
        control.value = angleRangeToText(layer[f.key]);
        control.onchange = function () {
          var next = angleRangeFromText(control.value);
          if (next === INVALID) { control.classList.add('err'); return; }
          control.classList.remove('err');
          if (next === undefined) delete layer[f.key];
          else layer[f.key] = next;
          onPresetChanged();
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

    renderOverLife(host, layer);
    /* Canvas 要量得到自己的寬高才畫得對，而元素剛 append 時版面還沒定案。
       等下一幀再統一重繪一次——這比依賴 ResizeObserver 可靠，
       它在某些嵌入式瀏覽器裡根本不會觸發。 */
    requestAnimationFrame(function () {
      liveEditors.forEach(function (c) { c.redraw(); });
    });
  }

  /* ---------------- Over-Life 區塊 ----------------

     Inspector 很窄，七張圖同時展開會變成幾千像素的長條。所以分成三個
     可收合群組，預設只開 Opacity——多數調整從它開始。
     收合狀態存在 state 而不是 localStorage：它跟著「目前在編哪一層」，
     不是使用者的長期偏好。 */

  var overLifeOpen = { opacity: true, scale: false, rotation: false };
  var liveEditors = [];                      // 目前掛在畫面上的曲線元件，換層時要收掉
  /* 'sections' 分區收合（省空間）／'compare' 全部攤開對照（共用時間軸）。
     存在 state 而不是 localStorage：它是當下的工作方式，不是長期偏好。 */
  var overLifeMode = 'sections';

  /* 把時間游標同步到所有圖上。這是「對照」的核心：滑鼠停在 42% 的位置，
     每一張圖都畫上同一條線並顯示自己在那個時間的值，一眼就能讀出
     「這一刻透明度 0.8、縮放 1.5、轉了 90 度」。 */
  function broadcastCursor(t) {
    liveEditors.forEach(function (c) { c.setCursor(t); });
  }

  function destroyCurveEditors() {
    liveEditors.forEach(function (c) { c.destroy(); });
    liveEditors = [];
  }

  function curveSection(host, key, title, build) {
    var wrap = document.createElement('div');
    wrap.className = 'ol-section';
    var head = document.createElement('button');
    head.type = 'button';
    head.className = 'ol-head';
    /* 對照模式一律攤開：那個模式的重點就是同時看到全部，
       留一個能把它收起來的按鈕只會讓人不小心破壞對照。 */
    var open = overLifeMode === 'compare' || overLifeOpen[key];
    head.textContent = (overLifeMode === 'compare' ? '' : (open ? '▾ ' : '▸ ')) + title;
    head.disabled = overLifeMode === 'compare';
    head.onclick = function () { overLifeOpen[key] = !overLifeOpen[key]; renderInspector(); };
    wrap.appendChild(head);
    if (open) {
      var body = document.createElement('div');
      body.className = 'ol-body';
      build(body);
      wrap.appendChild(body);
    }
    host.appendChild(wrap);
  }

  /* 一張圖 ＋ 它的兩顆按鈕。curve-editor 只管畫與拖，
     「寫回哪個欄位」「什麼時候算改過」留在這裡。 */
  function curveBlock(host, layer, field, policy, label, opts) {
    var row = document.createElement('div');
    row.className = 'ol-row';
    if (label) {
      var tag = document.createElement('span');
      tag.className = 'ol-axis';
      tag.textContent = label;
      row.appendChild(tag);
    }
    var editor = VFXCurveEditor.create({
      curve: layer[field],
      policy: policy,
      height: opts && opts.height,
      /* onLive 在拖曳途中一直呼叫：只更新預覽，不重畫 Inspector
         （重畫會把正在拖的 canvas 換掉，拖曳就斷了）。 */
      onLive: function (curve) { writeCurve(layer, field, curve); previewSoon(); },
      onChange: function (curve) { writeCurve(layer, field, curve); onPresetChanged(); },
      onCursor: broadcastCursor
    });
    liveEditors.push(editor);
    row.appendChild(editor.el);

    var tools = document.createElement('div');
    tools.className = 'ol-tools';
    var reset = document.createElement('button');
    reset.type = 'button'; reset.textContent = 'Reset';
    reset.title = '回到單一常數點';
    reset.onclick = function () { editor.reset(); renderInspector(); };
    var off = document.createElement('button');
    off.type = 'button';
    off.textContent = layer[field] === undefined ? '啟用' : '停用';
    off.title = '停用＝移除這條曲線，該屬性整段生命週期維持基礎值';
    off.onclick = function () {
      if (layer[field] === undefined) editor.reset();
      else editor.clear();
      renderInspector();
    };
    tools.appendChild(reset); tools.appendChild(off);
    row.appendChild(tools);
    host.appendChild(row);
  }

  /* undefined 代表「沒有這條曲線」，要 delete 而不是寫 undefined 進去——
     JSON.stringify 會把 undefined 的鍵丟掉，但 canonical 比對與未知欄位
     檢查是看實際的鍵，留著會讓兩邊看到的東西不一樣。 */
  function writeCurve(layer, field, curve) {
    if (curve === undefined) delete layer[field];
    else layer[field] = curve;
  }

  function renderOverLife(host, layer) {
    var title = document.createElement('div');
    title.className = 'group-title ol-title';
    title.textContent = 'OVER-LIFE 曲線';

    /* 分區／對照切換。分區省空間，對照則把所有曲線攤在同一條時間軸上，
       滑鼠移到任何一張圖，每張圖都會畫上同一條時間線並顯示自己在那一刻的值。
       調整互相牽動的屬性（縮到最大時透明度剩多少）非得這樣看不可。 */
    var modes = document.createElement('div');
    modes.className = 'ol-modes';
    [['sections', '分區'], ['compare', '對照']].forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = m[1];
      b.className = overLifeMode === m[0] ? 'on' : '';
      b.onclick = function () { overLifeMode = m[0]; renderInspector(); };
      modes.appendChild(b);
    });
    title.appendChild(modes);
    host.appendChild(title);

    if (overLifeMode === 'compare') {
      var tip = document.createElement('div');
      tip.className = 'ol-hint';
      tip.textContent = '滑鼠移到任一張圖上，所有曲線會顯示同一個時間點的數值。';
      host.appendChild(tip);
    }

    curveSection(host, 'opacity', 'Opacity', function (body) {
      curveBlock(body, layer, 'alphaOverLife', CURVE_POLICY.alpha, null);
      hintLine(body, 'alphaOverLife 是乘在 alpha 上的係數，可以大於 1（過曝）。');
    });

    curveSection(host, 'scale', 'Scale', function (body) {
      if (!supportsPerAxisScale(layer)) {
        curveBlock(body, layer, 'scaleOverLife', CURVE_POLICY.scale, 'XY');
        hintLine(body, 'particle 的兩軸永遠等比，沒有分軸縮放。');
        return;
      }
      var linked = !(layer.scaleXOverLife !== undefined || layer.scaleYOverLife !== undefined);
      var link = document.createElement('label');
      link.className = 'ol-link';
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = linked;
      cb.onchange = function () { setScaleLink(layer, cb.checked); renderInspector(); };
      link.appendChild(cb);
      link.appendChild(document.createTextNode(' Link X/Y'));
      body.appendChild(link);

      if (linked) {
        curveBlock(body, layer, 'scaleOverLife', CURVE_POLICY.scale, 'XY');
      } else {
        curveBlock(body, layer, 'scaleXOverLife', CURVE_POLICY.scale, 'X');
        curveBlock(body, layer, 'scaleYOverLife', CURVE_POLICY.scale, 'Y');
      }
    });

    curveSection(host, 'rotation', 'Rotation', function (body) {
      curveBlock(body, layer, 'rotationOverLife', CURVE_POLICY.rotation, 'Z', { height: 170 });
      if (!supportsPerAxisScale(layer)) {
        hintLine(body, '以度顯示、以弧度儲存。particle 只有平面旋轉。');
        return;
      }
      curveBlock(body, layer, 'rotationXOverLife', CURVE_POLICY.rotation, 'X', { height: 170 });
      curveBlock(body, layer, 'rotationYOverLife', CURVE_POLICY.rotation, 'Y', { height: 170 });
      hintLine(body,
        'Z＝平面旋轉。X／Y 是正交投影的翻轉：繞 X 轉會壓縮高度、繞 Y 轉會壓縮寬度，' +
        '180° 時變成鏡像（翻到背面）。沒有透視，背面看到的仍是同一張圖。');
      hintLine(body, '以度顯示、以弧度儲存。');
    });
  }

  function hintLine(host, text) {
    var d = document.createElement('div');
    d.className = 'ol-hint';
    d.textContent = text;
    host.appendChild(d);
  }

  /* Link 開↔關的資料轉換。關鍵是不能在切換的當下改變畫面：
     解除連動時把目前的等比曲線複製到兩軸，接回去時把 X 的曲線收回等比欄位。
     使用者只是想「分開調」，不是想讓特效在按下核取方塊的瞬間變樣。 */
  function setScaleLink(layer, linked) {
    if (linked) {
      /* 收回等比：以 X 為準（畫面上 X 在上面，是使用者主要在調的那一條）。
         Y 與 X 不同時會遺失 Y——這是解除連動的必然代價，所以先問。 */
      var x = layer.scaleXOverLife, y = layer.scaleYOverLife;
      var differs = JSON.stringify(x) !== JSON.stringify(y);
      if (differs && !window.confirm('X 與 Y 目前不同，接回等比會以 X 為準並捨棄 Y。要繼續嗎？')) {
        return;
      }
      if (x !== undefined) layer.scaleOverLife = x;
      delete layer.scaleXOverLife;
      delete layer.scaleYOverLife;
    } else {
      var base = layer.scaleOverLife;
      if (base !== undefined) {
        layer.scaleXOverLife = JSON.parse(JSON.stringify(base));
        layer.scaleYOverLife = JSON.parse(JSON.stringify(base));
      } else {
        /* 沒有等比曲線可複製時，兩軸都給常數 1：那與「沒有曲線」等價，
           畫面同樣不變，但使用者拿到兩個可以直接拖的點。 */
        layer.scaleXOverLife = 1;
        layer.scaleYOverLife = 1;
      }
    }
    onPresetChanged();
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

  /* 改任何參數都要重建預覽（註冊過的 preset 是凍結深拷貝，不能就地改）。
     重建會重播，所以先把播放頭記下來再帶回去——否則調一條 50% 位置的曲線時，
     畫面永遠停在第 0 秒，等於看不到自己改的那一段。 */
  function rebuildPreview() {
    if (!state.runtime) return;
    var resumeAt = state.handle === null || state.handle === undefined
      ? 0 : (state.runtime.timeOf(state.handle) || 0);
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
      seed: 12345,                               // 固定 seed：編輯時每次重播畫面一致
      startTime: resumeAt
    });
  }

  /* 拖曳曲線時每次 mousemove 都要更新預覽，但一幀之內做兩次沒有意義
     （畫面只畫一次），所以用 rAF 合併。註冊素材走的是 resolver 的雜湊查表，
     貼圖由後端依 URL 快取，重建不會重新載圖。 */
  var previewPending = false;
  function previewSoon() {
    if (previewPending) return;
    previewPending = true;
    requestAnimationFrame(function () {
      previewPending = false;
      refreshDirty();
      var result = VFXCore.validatePreset(state.preset);
      if (!result.ok) return;                    // 中途不合法就先不重建，放開滑鼠時會報錯
      rebuildPreview();
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

  /* ---------------- 背景色列 ----------------
     特效在遊戲裡不會永遠站在同一種背景前。同一顆雷球放在夜空、洞窟土牆、
     雪地上，可讀性差很多——尤其這套素材大量使用加法混合，在淺色背景上
     幾乎會整個消失。所以背景切換必須就在預覽區旁邊，一下就能點過一輪。 */

  var BG_PRESETS = [
    { value: '#101014', label: '預設深色' },
    { value: '#000000', label: '純黑' },
    { value: '#16233a', label: '夜空藍' },
    { value: '#2a211b', label: '洞窟土色' },
    { value: '#1b2a1e', label: '森林綠' },
    { value: '#5a5a62', label: '中灰' },
    { value: '#9aa3ad', label: '雪地灰藍' },
    { value: '#e8e8e8', label: '淺色' },
    { value: 'checker', label: '棋盤格（看透明度）' }
  ];

  var BG_STORAGE_KEY = 'vfx-editor.background';

  /* 棋盤格沒有單一顏色可以填，色票用一張小的 CSS 漸層拼出同樣的圖案 */
  var CHECKER_SWATCH_CSS =
    'repeating-conic-gradient(#2a2a32 0% 25%, #1b1b21 0% 50%) 50% / 10px 10px';

  function applyBackground(value, opts) {
    state.background = value;
    setBackground(value);
    var picker = $('bg-picker');
    if (picker && value !== 'checker') picker.value = value;
    var cur = $('bg-current');
    if (cur) cur.textContent = value === 'checker' ? '棋盤格' : value;
    /* 選中標記走 DOM class，不重建整列——重建會讓 <input type="color">
       在使用者還開著取色器時被抽掉。 */
    var host = $('bg-swatches');
    if (host) {
      [].forEach.call(host.children, function (b) {
        b.classList.toggle('sel', b.dataset.value === value);
      });
    }
    if (!opts || opts.remember !== false) {
      /* 背景是每個人自己的檢視偏好，不屬於 Preset，所以放 localStorage：
         寫進 preset 只會讓「換個背景看看」變成一筆 git diff。 */
      try { window.localStorage.setItem(BG_STORAGE_KEY, value); } catch (e) { }
    }
  }

  function buildBackgroundBar() {
    var host = $('bg-swatches');
    if (!host) return;
    host.textContent = '';
    BG_PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'bg-swatch';
      b.type = 'button';
      b.dataset.value = p.value;
      b.title = p.label;
      if (p.value === 'checker') b.style.background = CHECKER_SWATCH_CSS;
      else b.style.background = p.value;
      b.onclick = function () { applyBackground(p.value); };
      host.appendChild(b);
    });

    var picker = $('bg-picker');
    if (picker) {
      /* input 而不是 change：拖曳取色器時預覽就跟著變，才看得出臨界點 */
      picker.oninput = function () { applyBackground(picker.value); };
    }

    var saved = null;
    try { saved = window.localStorage.getItem(BG_STORAGE_KEY); } catch (e) { }
    var valid = saved === 'checker' || (typeof saved === 'string' && /^#[0-9a-f]{6}$/i.test(saved));
    applyBackground(valid ? saved : BG_PRESETS[0].value, { remember: false });
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
    if (state.layoutDirty) return true;
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
      /* 分組另存一個檔。它失敗不影響 Preset 已經存好這件事——
         layout 是可有可無的附加資料，見 layout-schema.js 的自癒設計。 */
      saveLayout().catch(function (e) {
        setSaveStatus('Preset 已存檔，但分組沒存成功', 'err');
        showSaveError('分組儲存失敗（Preset 本身已存好）', [String(e && e.message || e)]);
      });
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
        state.layout = VFXLayoutSchema.emptyLayout(parsed.id);
        var first = parsed.layers[0] ? keyOf('layer', parsed.layers[0].id) : null;
        setSelection(first ? [first] : [], first);
        state.anchorKey = first;
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
    ensureLayout();
    if (Array.isArray(state.layout.order)) state.layout.order.push(keyOf('layer', base.id));
    setSelection([keyOf("layer", base.id)], keyOf("layer", base.id));
    state.anchorKey = state.activeKey;
    renderLayerList(); renderInspector(); onPresetChanged();
  }

  /* 刪除整個選取集合。選到群組時連同它的成員一起刪——列表上看到的就是
     一個物件，只刪掉標題列卻留下散落的子圖層會很難理解。 */
  function deleteSelection() {
    if (!state.selectedKeys.length) return;
    /* 先算出「刪完之後焦點該落在哪」：整個清空會讓人失去位置感，連按兩次
       Delete 還得重新找位置。取被刪範圍在可見列表中的前一列。 */
    var vis = visibleKeys();
    var doomed = {};
    state.selectedKeys.forEach(function (k) { doomed[k] = true; });
    var firstAt = vis.length;
    vis.forEach(function (k, i) { if (doomed[k] && i < firstAt) firstAt = i; });
    var survivor = null;
    for (var i = firstAt - 1; i >= 0 && !survivor; i--) { if (!doomed[vis[i]]) survivor = vis[i]; }
    for (var j = firstAt; j < vis.length && !survivor; j++) { if (!doomed[vis[j]]) survivor = vis[j]; }

    M.deleteSelection(state.preset, state.layout, state.selectedKeys);

    /* survivor 有可能自己就是被刪群組的成員，確認它還在才選它 */
    var alive = survivor && (M.keyKind(survivor) === 'group'
      ? !!M.groupById(state.layout, M.keyId(survivor))
      : !!M.layerById(state.preset, M.keyId(survivor)));
    if (alive) { setSelection([survivor], survivor); state.anchorKey = survivor; }
    else { setSelection([], null); state.anchorKey = null; }
    markLayoutDirty();
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
    state.vocab = {
      usage: Object.keys(usage).sort(), shape: Object.keys(shape).sort(),
      element: Object.keys(element).sort(), tag: Object.keys(tag).sort()
    };
    ['f-', 'pf-'].forEach(function (p) {
      fillSelect($(p + 'usage'), state.vocab.usage, 'usage');
      fillSelect($(p + 'shape'), state.vocab.shape, 'shape');
      fillSelect($(p + 'element'), state.vocab.element, 'element');
      fillSelect($(p + 'tag'), state.vocab.tag, 'tag');
    });
  }

  /* 頁面靠 <script> 全域載入這些模組，任何一個沒載進來，錯誤都會在很後面
     才以 "X is not defined" 的形式炸出來，訊息完全指不到真正的原因。
     所以在動任何東西之前先點名一次，缺了就講清楚是哪一個、以及最可能的成因。 */
  function checkModules() {
    var need = [
      ['PIXI', 'js/vendor/pixi.min.js'],
      ['VFXCore', 'js/vfx-core.js'],
      ['VFXPixiBackend', 'js/vfx-pixi-backend.js'],
      ['VFXPresetIdPolicy', 'tools/vfx/editor/preset-id-policy.js'],
      ['VFXLayoutSchema', 'tools/vfx/editor/layout-schema.js'],
      ['VFXLayerModel', 'tools/vfx/editor/layer-model.js'],
      ['VFXCurveModel', 'tools/vfx/editor/curve-model.js'],
      ['VFXCurveEditor', 'tools/vfx/editor/curve-editor.js'],
      ['VFXSemanticVocab', 'tools/vfx/vfx-semantic-vocab.cjs']
    ];
    var missing = need.filter(function (m) {
      return typeof window[m[0]] === 'undefined';
    });
    if (!missing.length) return null;
    return [
      '這幾個模組沒有載入：' + missing.map(function (m) { return m[1]; }).join('、'),
      '最常見的原因是連到了一個舊的 editor-server 行程——它啟動時還沒有開放這些檔案，',
      '所以會回 403。把那個伺服器視窗關掉、重新執行「啟動VFX編輯器.bat」即可。'
    ].join('\n');
  }

  function boot() {
    var moduleError = checkModules();
    if (moduleError) {
      document.getElementById('preview-msg').className = 'hint err';
      document.getElementById('preview-msg').textContent = '啟動失敗\n' + moduleError;
      return;
    }
    var bootPresetId = presetIdFromQuery();
    Promise.all([
      fetchJson(ASSET_INDEX_URL),
      fetchJson(ASSET_SEMANTICS_URL),
      fetchJson(presetUrl(bootPresetId)),
      /* 分組是 Editor 專用的附加資料，載不到就當作沒有分組——
         它絕不能擋住 Preset 本身的編輯。 */
      loadLayout(bootPresetId)
    ]).then(function (res) {
      state.index = res[0];
      state.semantics = res[1];
      state.preset = res[2];
      setSelection([keyOf('layer', state.preset.layers[0].id)],
        keyOf('layer', state.preset.layers[0].id));
      state.anchorKey = state.activeKey;
      /* 剛載入的內容就是 repo 上的內容 → 基準線，dirty = false。
         用 canonical 文字而不是原始 bytes：檔案若還沒 canonical 化，
         每次一開啟就會顯示未存檔，那個提示很快就會被無視。 */
      state.savedText = VFXCore.serialisePreset(state.preset);
      state.sourcePresetId = bootPresetId;
      state.layout = res[3].layout;
      state.layoutRevision = 0;
      if (res[3].error) {
        /* 明確告訴使用者「分組沒載進來」，而不是讓他以為群組被刪光了 */
        setSaveStatus('分組載入失敗', 'err');
        window.setTimeout(function () { showSaveError('分組未套用', [res[3].error]); }, 0);
      }
      loadCollapsed();
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

        /* 畫布尺寸必須跟著「這個元素」，不是跟著視窗。
           Pixi 的 resizeTo 只掛在 window 的 resize 上，量的是啟動當下的 host 尺寸；
           但這一欄會在「視窗沒變、版面自己重算」時改變寬度（整頁捲軸出現、
           頂端工具列換行、側欄收縮），那時畫布就停在舊尺寸。
           CSS 的 overflow:hidden 已經保證它畫不出欄位外，但畫布本身仍然是錯的，
           預覽會被裁掉一塊。

           兩條路都走，因為它們各自會在不同情況下失效：
             ResizeObserver — 真實瀏覽器裡反應最即時，但實測在某些嵌入式
                              瀏覽器面板裡完全不觸發（連初次觀察都沒有）。
             ticker 檢查    — 每幀兩次整數比較，rAF 有在跑就一定會校正。
           兩者都呼叫同一個函式，不會互相打架。 */
        state.syncCanvasSize = function () {
          var w = Math.max(1, Math.floor(host.clientWidth));
          var h = Math.max(1, Math.floor(host.clientHeight));
          if (w === app.renderer.width && h === app.renderer.height) return false;
          app.renderer.resize(w, h);
          centre();
          return true;
        };
        state.syncCanvasSize();
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(function () { state.syncCanvasSize(); }).observe(host);
        }

        state.backend = VFXPixiBackend.createBackend({ PIXI: PIXI, container: root });
        state.runtime = VFXCore.createRuntime({
          backend: state.backend,
          resolver: state.resolver
        });

        app.ticker.add(function (ticker) {
          /* 在 playing 判斷之前：暫停時改變視窗大小，畫布一樣要跟上 */
          state.syncCanvasSize();
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

        /* 順序有意義：先把圖層樹與 Inspector 畫出來，再處理素材瀏覽器。
           左邊那一組要用到素材詞彙表，一旦它出問題，至少不會連圖層分組
           一起消失——那會讓人以為群組被刪掉了，實際上只是沒渲染。 */
        renderLayerList();
        renderInspector();
        onPresetChanged();

        fillSelect($('new-layer-type'), VFXCore.LAYER_TYPES, '型別');
        $('new-layer-type').value = 'sprite';
        /* 必須在 app／bgSolid／checker 都建好之後才能套用背景 */
        buildBackgroundBar();
        collectVocab();
        wirePicker();
        renderAssetBrowser();
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
    /* 背景控制項已從左上角工具列移到預覽區正上方（見 buildBackgroundBar）。
       兩處都留的話，兩個控制項的顯示狀態會分家。 */
    $('btn-save').onclick = savePreset;
    $('btn-download').onclick = downloadPreset;
    $('btn-load').onclick = function () { $('file-load').click(); };
    $('file-load').onchange = function (e) {
      if (e.target.files[0]) loadPresetFromFile(e.target.files[0]);
    };
    $('btn-add-layer').onclick = function () { addLayer($('new-layer-type').value); };
    $('btn-group').onclick = groupSelection;
    $('btn-ungroup').onclick = ungroupSelection;
    $('sel-sort').onchange = function () {
      /* 只換顯示順序。preset 與 layout 一個 byte 都不會動，所以不呼叫 onPresetChanged。 */
      state.sortMode = $('sel-sort').value;
      renderLayerList();
    };
    document.addEventListener('keydown', onKeyDown);
    $('btn-del-layer').onclick = deleteSelection;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
