'use strict';
/* ============================================================
   layout-schema.js — Editor 的 Layer 分組資料（authoring metadata）

   這份資料**不進 Preset、不進 Runtime、不進 shipped build**。
   存放位置是 vfx/layouts/<presetId>.json，刻意跟 vfx/presets/ 分開：
   export-assets.cjs 只掃 vfx/presets/*.json，放在那裡會被當成一份 Preset。

   為什麼不放進 Preset Schema：
     Runtime（createRuntime）只讀 preset 的 layers / duration / loop / id，
     分組純粹是「人在 Editor 裡怎麼整理圖層」，讓 Core 為它增加驗證邏輯、
     讓每個出貨的 preset 都帶著這段資料，是替 UX 需求向 Runtime 收費。

   為什麼兩個檔案不會走鐘 —— 這是本檔最重要的設計：
     **preset.layers 永遠是「有哪些圖層」的唯一真相，本檔只是疊在上面的可選分組。**
     所以：
       - 指到不存在的 layerId → 忽略（不是錯誤）
       - 沒被任何 group 收的 layer → 自動視為 root 層級
       - 同一個 layer 出現在多個 group → 第一個有效，其餘忽略
       - 本檔寫入失敗 → 失去分組，不會失去正確性
     於是不需要跨檔案交易，刪圖層時也不必同步維護第二個檔案。

   收合狀態刻意不存在這裡，放瀏覽器 localStorage：
   那是每個人自己的檢視偏好，寫進檔案只會讓「收合一下」變成一筆 git diff。
   ============================================================ */

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VFXLayoutSchema = api;
})(typeof self !== 'undefined' ? self : this, function () {

  var SCHEMA_VERSION = 1;
  /* order = 頂層的 authoring 排列（'layer:<id>' 與 'group:<id>' 混合）。
     群組內部的排列則是 groups[].layerIds 的順序。

     為什麼 authoring order 一定要放這裡，而不是靠 preset.layers 的陣列順序：
     Core 的粒子亂數種子綁在 layers 的**陣列索引**上
     （rng: makeRng(effect.seed + i * 0x9E3779B9)），而相同 zIndex 的繪製順序
     又由 child 加入順序決定。所以只要拖曳動到 preset.layers 的順序，
     就算 zIndex 一個都沒改，實際畫面仍然會變——這是實測出來的，不是理論。
     把 order 移進來之後，「只整理不改畫面」才是結構上必然，而不是靠測試去追。 */
  var LAYOUT_FIELDS = ['schemaVersion', 'presetId', 'groups', 'order'];
  var GROUP_FIELDS = ['id', 'name', 'layerIds'];
  var LAYOUT_KEY_ORDER = ['schemaVersion', 'presetId', 'groups', 'order'];
  var GROUP_KEY_ORDER = ['id', 'name', 'layerIds'];
  var ORDER_KEY_RE = /^(layer|group):.+$/;

  var GROUP_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
  var LIMITS = {
    maxGroups: 64,
    maxLayerIdsPerGroup: 64,
    maxGroupIdLength: 64,
    maxNameLength: 64
  };

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function checkUnknownFields(obj, allowed, where, errors) {
    Object.keys(obj).forEach(function (key) {
      if (allowed.indexOf(key) < 0) errors.push(where + ' 有不支援的欄位：' + key);
    });
  }

  /* 嚴格驗證，與 Core 的 validatePreset 同樣不做 silent fallback：
     檔案本身壞掉必須報錯。至於「內容與 preset 對不上」則不算壞掉——
     那由 reconcile() 依上面的自癒規則處理。 */
  function validateLayout(layout) {
    var errors = [];
    if (!isPlainObject(layout)) return { ok: false, errors: ['layout 不是物件'] };

    if (layout.schemaVersion !== SCHEMA_VERSION) {
      errors.push('未知的 schemaVersion：' + layout.schemaVersion +
        '（本工具支援 ' + SCHEMA_VERSION + '）');
    }
    if (typeof layout.presetId !== 'string' || !layout.presetId) {
      errors.push('layout.presetId 必填');
    }
    checkUnknownFields(layout, LAYOUT_FIELDS, 'layout', errors);

    if (layout.order !== undefined) {
      if (!Array.isArray(layout.order)) {
        errors.push('layout.order 必須是陣列');
      } else {
        var seenOrder = Object.create(null);
        layout.order.forEach(function (k, i) {
          if (typeof k !== 'string' || !ORDER_KEY_RE.test(k)) {
            errors.push('order[' + i + '] 必須是 layer:<id> 或 group:<id>：' + k);
            return;
          }
          if (seenOrder[k]) errors.push('order 有重複項目：' + k);
          else seenOrder[k] = true;
        });
      }
    }

    if (!Array.isArray(layout.groups)) {
      errors.push('layout.groups 必須是陣列');
      return { ok: errors.length === 0, errors: errors };
    }
    if (layout.groups.length > LIMITS.maxGroups) {
      errors.push('群組數超過上限 ' + LIMITS.maxGroups);
    }

    var seenGroupIds = Object.create(null);
    var seenLayerIds = Object.create(null);
    layout.groups.forEach(function (g, i) {
      var where = 'groups[' + i + ']';
      if (!isPlainObject(g)) { errors.push(where + ' 不是物件'); return; }
      checkUnknownFields(g, GROUP_FIELDS, where, errors);

      if (typeof g.id !== 'string' || !GROUP_ID_RE.test(g.id)) {
        errors.push(where + '.id 必須是小寫英數與連字號，且以英數開頭');
      } else if (g.id.length > LIMITS.maxGroupIdLength) {
        errors.push(where + '.id 超過 ' + LIMITS.maxGroupIdLength + ' 字元');
      } else if (seenGroupIds[g.id]) {
        errors.push('群組 id 重複：' + g.id);
      } else {
        seenGroupIds[g.id] = true;
      }

      if (typeof g.name !== 'string' || !g.name.trim()) {
        errors.push(where + '.name 必填');
      } else if (g.name.length > LIMITS.maxNameLength) {
        errors.push(where + '.name 超過 ' + LIMITS.maxNameLength + ' 字元');
      }

      if (!Array.isArray(g.layerIds)) {
        errors.push(where + '.layerIds 必須是陣列');
        return;
      }
      if (g.layerIds.length > LIMITS.maxLayerIdsPerGroup) {
        errors.push(where + '.layerIds 超過上限 ' + LIMITS.maxLayerIdsPerGroup);
      }
      g.layerIds.forEach(function (id, j) {
        if (typeof id !== 'string' || !id) {
          errors.push(where + '.layerIds[' + j + '] 必須是非空字串');
          return;
        }
        /* 同一個 layer 被兩個 group 收下是資料錯誤，不是「對不上 preset」，
           所以這裡就要擋——它代表寫出這份檔案的程式有 bug。 */
        if (seenLayerIds[id]) errors.push('layerId 被重複收進多個群組：' + id);
        else seenLayerIds[id] = true;
      });
    });

    return { ok: errors.length === 0, errors: errors };
  }

  /* 決定性序列化，理由與 Preset 相同：同樣語意必須產生同樣的 bytes，
     否則每次存檔都會冒出無意義的 git diff。 */
  function canonical(value, order) {
    if (Array.isArray(value)) return value.map(function (v) { return canonical(v); });
    if (!isPlainObject(value)) return value;
    var out = {};
    (order || []).forEach(function (k) {
      if (value[k] !== undefined) out[k] = canonical(value[k]);
    });
    Object.keys(value).sort().forEach(function (k) {
      if (out[k] === undefined && value[k] !== undefined) out[k] = canonical(value[k]);
    });
    return out;
  }

  function serialiseLayout(layout) {
    var normalised = canonical(layout, LAYOUT_KEY_ORDER);
    normalised.groups = (layout.groups || []).map(function (g) {
      return canonical(g, GROUP_KEY_ORDER);
    });
    return JSON.stringify(normalised, null, 2) + '\n';
  }

  function emptyLayout(presetId) {
    return { schemaVersion: SCHEMA_VERSION, presetId: presetId, groups: [] };
  }

  /* ---------------- 自癒：把 layout 疊到實際的 layers 上 ----------------

     回傳一棵給 Editor 顯示用的樹，並保證：
       - 每個實際存在的 layer 剛好出現一次
       - 分組與排序資料裡的雜訊（不存在的 id、重複收錄、重複排序項）安靜丟掉
       - layout.order 沒提到的東西，依 preset.layers 的順序補在後面

     **preset.layers 在這裡只用來回答「有哪些 layer」，不決定顯示順序。**
     顯示順序來自 layout.order（頂層）與 groups[].layerIds（群組內）。
     這正是 authoring order 與 runtime 隔離的地方：拖曳只改 layout，
     preset.layers 的陣列順序完全不動，於是粒子種子與相同 zIndex 的
     繪製順序都不會被整理動作改到。

     rows 的順序就是「目前可見列表順序」，Shift 範圍選取以它為準。 */
  function reconcile(layers, layout) {
    var byId = Object.create(null);
    (layers || []).forEach(function (l) { if (l && l.id) byId[l.id] = l; });

    /* 1. 先整理群組：丟掉指向不存在 layer 的成員，一個 layer 只能屬於一個群組 */
    var claimed = Object.create(null);
    var groups = [];
    var groupById = Object.create(null);
    ((layout && layout.groups) || []).forEach(function (g) {
      if (!isPlainObject(g) || typeof g.id !== 'string') return;
      if (groupById[g.id]) return;                 // 重複的群組 id：第一個有效
      var members = [];
      (Array.isArray(g.layerIds) ? g.layerIds : []).forEach(function (id) {
        if (!byId[id]) return;                     // 指到不存在的 layer：忽略
        if (claimed[id]) return;                   // 已被前一個群組收走：忽略
        claimed[id] = g.id;
        members.push(id);
      });
      var entry = { id: g.id, name: typeof g.name === 'string' ? g.name : g.id, layerIds: members };
      groups.push(entry);
      groupById[g.id] = entry;
    });

    /* 2. 依 layout.order 排出頂層。認不得或重複的項目直接跳過。 */
    var rows = [];
    var emittedGroup = Object.create(null);
    var emittedLayer = Object.create(null);

    function pushGroup(g) {
      if (emittedGroup[g.id]) return;
      emittedGroup[g.id] = true;
      g.layerIds.forEach(function (id) { emittedLayer[id] = true; });
      rows.push({ kind: 'group', id: g.id, name: g.name, layerIds: g.layerIds.slice() });
    }
    function pushLayer(id) {
      if (emittedLayer[id] || claimed[id] || !byId[id]) return;
      emittedLayer[id] = true;
      rows.push({ kind: 'layer', id: id, groupId: null });
    }

    ((layout && layout.order) || []).forEach(function (key) {
      if (typeof key !== 'string') return;
      var at = key.indexOf(':');
      if (at < 0) return;
      var kind = key.slice(0, at), id = key.slice(at + 1);
      if (kind === 'group') { var g = groupById[id]; if (g) pushGroup(g); return; }
      if (kind === 'layer') pushLayer(id);
    });

    /* 3. order 沒提到的，依 preset.layers 的順序補上——這是唯一用到陣列順序的
          地方，而且只在「還沒有 authoring order」時才會發生（例如剛匯入、
          或使用者新增了一層）。它是後備值，不是資料來源。 */
    (layers || []).forEach(function (l) {
      if (!l || !l.id) return;
      var owner = claimed[l.id];
      if (owner) { var g2 = groupById[owner]; if (g2) pushGroup(g2); return; }
      pushLayer(l.id);
    });

    /* 4. 完全沒有成員的群組排在最後，才不會因為沒成員而跳到最前面 */
    groups.forEach(function (g) {
      if (g.layerIds.length) return;
      pushGroup(g);
    });

    return { rows: rows, groups: groups, claimed: claimed };
  }

  /* 把目前的 rows 收斂回一份可存檔的 order。
     Editor 每次改動 hierarchy 後呼叫，確保存檔內容與畫面一致。 */
  function orderFromRows(rows) {
    return (rows || []).map(function (r) { return r.kind + ':' + r.id; });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    LIMITS: LIMITS,
    GROUP_ID_RE: GROUP_ID_RE,
    validateLayout: validateLayout,
    serialiseLayout: serialiseLayout,
    emptyLayout: emptyLayout,
    reconcile: reconcile,
    orderFromRows: orderFromRows
  };
});
