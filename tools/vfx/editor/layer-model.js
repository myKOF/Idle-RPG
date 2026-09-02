'use strict';
/* ============================================================
   layer-model.js — Layer 面板的純資料運算

   這裡只處理「這個操作對資料做了什麼」，完全不碰 DOM。
   editor.js 負責畫面與事件，把每個操作轉成對本模組的一次呼叫。

   分開的理由是可測試性：多選範圍、deep clone、拖曳搬移這些是最容易寫錯、
   也最難用肉眼驗證的部分，埋在 IIFE 裡綁著 DOM 就只能靠手動點擊確認。
   抽出來之後可以在 Node 裡直接餵資料斷言結果。

   三種順序的分工（改錯任何一個都會變成「排個序畫面就變了」）：

     RENDER ORDER    layer.zIndex —— 本模組任何函式都不會寫它
     AUTHORING ORDER layout.order ＋ groups[].layerIds —— 只有 applyDrop 會改
     VIEW SORT       sortRows() —— 回傳新陣列，不動任何輸入

   **preset.layers 的陣列順序不屬於上面任何一種，本模組永遠不重排它。**
   Core 的粒子亂數種子綁在該陣列的索引上，相同 zIndex 的繪製順序又由
   child 加入順序決定，所以動了它就會改變畫面——即使 zIndex 一個都沒改。
   authoring order 因此全部放在 layout，讓「只整理不改畫面」成為結構上必然。
   ============================================================ */

(function (root, factory) {
  /* layout-schema 提供 reconcile：本模組的拖曳需要「目前完整的 order」當基準，
     而那份自癒邏輯只有一份實作。 */
  var schema = (typeof module !== 'undefined' && module.exports)
    ? require('./layout-schema.js')
    : root.VFXLayoutSchema;
  var api = factory(schema);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VFXLayerModel = api;
})(typeof self !== 'undefined' ? self : this, function (schema) {

  function reconcileFn(layers, layout) { return schema.reconcile(layers, layout); }

  /* ---------------- key ---------------- */

  function keyOf(kind, id) { return kind + ':' + id; }
  function keyKind(key) {
    if (typeof key !== 'string') return null;
    var at = key.indexOf(':');
    return at < 0 ? null : key.slice(0, at);
  }
  function keyId(key) {
    if (typeof key !== 'string') return null;
    var at = key.indexOf(':');
    return at < 0 ? null : key.slice(at + 1);
  }

  /* ---------------- 查找 ---------------- */

  function layerById(preset, id) {
    var ls = (preset && preset.layers) || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].id === id) return ls[i];
    return null;
  }

  function groupById(layout, id) {
    var gs = (layout && layout.groups) || [];
    for (var i = 0; i < gs.length; i++) if (gs[i].id === id) return gs[i];
    return null;
  }

  function groupOfLayer(layout, id) {
    var gs = (layout && layout.groups) || [];
    for (var i = 0; i < gs.length; i++) {
      if (gs[i].layerIds.indexOf(id) >= 0) return gs[i];
    }
    return null;
  }

  /* ---------------- 顯示排序（不動任何輸入） ---------------- */

  function sortRows(rows, mode) {
    if (mode !== 'name') return rows.slice();
    var out = rows.map(function (r) {
      var c = { kind: r.kind, id: r.id };
      if (r.kind === 'group') { c.name = r.name; c.layerIds = r.layerIds.slice().sort(); }
      return c;
    });
    out.sort(function (a, b) {
      var an = a.kind === 'group' ? a.name : a.id;
      var bn = b.kind === 'group' ? b.name : b.id;
      if (an === bn) return 0;
      return an < bn ? -1 : 1;
    });
    return out;
  }

  /* ---------------- 目前看得見的列 ----------------
     Shift 範圍選取必須以這個為準：選到收合起來、看不見的東西，
     是多選功能最典型也最讓人不信任的 bug。 */

  function visibleKeys(rows, collapsed) {
    var out = [];
    var c = collapsed || {};
    rows.forEach(function (r) {
      if (r.kind === 'layer') { out.push(keyOf('layer', r.id)); return; }
      out.push(keyOf('group', r.id));
      if (c[r.id]) return;
      r.layerIds.forEach(function (id) { out.push(keyOf('layer', id)); });
    });
    return out;
  }

  /* ---------------- 選取 ---------------- */

  /* 標準桌面式三種行為。回傳 { selected, active, anchor }，不改輸入。 */
  function applyClick(sel, visible, key, mods) {
    var selected = (sel.selected || []).slice();
    var anchor = sel.anchor;
    if (mods && mods.shift) {
      var from = visible.indexOf(anchor);
      var to = visible.indexOf(key);
      if (to < 0) return { selected: selected, active: sel.active, anchor: anchor };
      if (from < 0) from = to;
      var lo = Math.min(from, to), hi = Math.max(from, to);
      /* anchor 刻意不動：連續按 Shift 應該以同一個起點延伸／收縮，
         每次都重設 anchor 的話就沒辦法把範圍改小。 */
      return { selected: visible.slice(lo, hi + 1), active: key, anchor: anchor };
    }
    if (mods && mods.ctrl) {
      var at = selected.indexOf(key);
      if (at >= 0) selected.splice(at, 1); else selected.push(key);
      return { selected: selected, active: key, anchor: key };
    }
    /* 點一個「已經是唯一選取且有焦點」的項目＝取消選取。
       多選狀態下的普通點擊仍然收斂成單選（那是慣例，也是把選取範圍縮小的
       唯一辦法），只有在它本來就是唯一選取時才切換成空。 */
    if (selected.length === 1 && selected[0] === key && sel.active === key) {
      return { selected: [], active: null, anchor: null };
    }
    return { selected: [key], active: key, anchor: key };
  }

  /* ---------------- id 產生 ---------------- */

  /* 「複製出來的」id：一定帶 -copy。已經是 -copy 的再複製不會疊成
     a-copy-copy-copy，而是 a-copy-2、a-copy-3。 */
  function uniqueIdFrom(base, taken, maxLen) {
    var max = maxLen || 0;
    var stem = String(base).replace(/-copy(-\d+)?$/, '');
    /* id 也有長度上限（群組 id 是 64 字元）。只截 name 不截 id 的話，
       長名稱的副本會產生一個超長的 id，layout 照樣存不進去——
       Codex 只指出了 name，但兩者是同一個問題。 */
    function build(sfx) {
      if (!max) return stem + sfx;
      var room = max - sfx.length;
      return (stem.length > room ? stem.slice(0, room) : stem) + sfx;
    }
    var candidate = build('-copy');
    var i = 2;
    while (taken[candidate]) { candidate = build('-copy-' + i); i++; }
    taken[candidate] = true;
    return candidate;
  }

  /* 「新建的」id：先用 base 本身，撞名才加序號。
     新群組叫 orb-a 才對，一律加 -copy 會變成 orb-a-copy 這種莫名其妙的名字。 */
  function uniqueId(base, taken) {
    var stem = String(base);
    var candidate = stem;
    var i = 2;
    while (taken[candidate]) { candidate = stem + '-' + i; i++; }
    taken[candidate] = true;
    return candidate;
  }

  /* 群組副本名稱。schema 的 name 上限是 64 字元，直接接 " Copy" 會爆掉——
     實測 60 字的名稱複製後變 65 字，layout 就存不進去了（Preset 卻已經先存好，
     重新載入後副本的成員會變成未分組的散層）。
     規則：先剝掉既有的 " Copy"／" Copy N" 後綴，再依剩餘空間截斷 base，
     最後補上後綴。撞名才加序號，所以不會出現 Copy Copy Copy。 */
  var COPY_SUFFIX = ' Copy';
  function copyName(name, takenNames) {
    var max = (schema && schema.LIMITS ? schema.LIMITS.maxNameLength : 64);
    var base = String(name).replace(/ Copy( \d+)?$/, '');
    function build(suffix) {
      var room = max - suffix.length;
      var head = base.length > room ? base.slice(0, room) : base;
      return head + suffix;
    }
    var candidate = build(COPY_SUFFIX);
    var i = 2;
    while (takenNames && takenNames[candidate]) {
      candidate = build(COPY_SUFFIX + ' ' + i);
      i++;
    }
    if (takenNames) takenNames[candidate] = true;
    return candidate;
  }

  function slugify(name, fallback) {
    var s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return s || (fallback || 'group');
  }

  /* ---------------- Copy / Paste ---------------- */

  function deepClone(v) { return JSON.parse(JSON.stringify(v)); }

  /* 產生剪貼簿內容。已被選取的群組會連同成員一起複製，
     所以成員即使也被選取也不再單獨收一份，避免同一層複製兩次。 */
  function copySelection(preset, layout, selectedKeys) {
    var items = [];
    (selectedKeys || []).forEach(function (k) {
      if (keyKind(k) === 'group') {
        var g = groupById(layout, keyId(k));
        if (!g) return;
        items.push({
          kind: 'group',
          name: g.name,
          layers: g.layerIds.map(function (id) { return layerById(preset, id); })
            .filter(Boolean).map(deepClone)
        });
        return;
      }
      var owner = groupOfLayer(layout, keyId(k));
      if (owner && selectedKeys.indexOf(keyOf('group', owner.id)) >= 0) return;
      var l = layerById(preset, keyId(k));
      if (l) items.push({ kind: 'layer', layer: deepClone(l) });
    });
    return items.length ? { items: items } : null;
  }

  /* 貼上。preset 與 layout 會被就地修改，回傳新產生的 key。
     每一份都是 deep clone，兩份資料不共用任何可變引用。

     anchorKey = 目前的 active 項目，貼上的東西插在它「後面」。
     沒有 anchor 才追加到最後。以整個列表最下面當落點是最不直覺的行為：
     複製一顆球，結果副本出現在三十層之外，還得自己拖回來。

     preset.layers 一律 push 到尾端——那是「新增」不是「重排」，
     不會位移既有索引，所以粒子種子與繪製順序都不受影響。
     看得見的位置由 layout.order 與 groups[].layerIds 決定。 */
  function pasteClipboard(preset, layout, clipboard, anchorKey) {
    if (!clipboard || !clipboard.items || !clipboard.items.length) return [];
    var takenLayer = Object.create(null);
    preset.layers.forEach(function (l) { takenLayer[l.id] = true; });
    var takenGroup = Object.create(null);
    var takenName = Object.create(null);
    (layout.groups || []).forEach(function (g) {
      takenGroup[g.id] = true; takenName[g.name] = true;
    });

    var newKeys = [];
    /* anchor 若是群組內的某一層，圖層副本就貼在同一個群組裡；
       否則貼在頂層 anchor 之後。 */
    var anchorGroup = (anchorKey && keyKind(anchorKey) === 'layer')
      ? groupOfLayer(layout, keyId(anchorKey)) : null;
    if (!Array.isArray(layout.order)) layout.order = [];

    /* 每插入一個就往後推，多選貼上才會保持原本的相對順序 */
    var topAt = anchorTopIndex(layout, anchorKey);
    var groupAt = anchorGroup ? anchorGroup.layerIds.indexOf(keyId(anchorKey)) + 1 : -1;

    clipboard.items.forEach(function (item) {
      if (item.kind === 'layer') {
        var l = deepClone(item.layer);
        l.id = uniqueIdFrom(l.id, takenLayer);
        preset.layers.push(l);
        if (anchorGroup) {
          anchorGroup.layerIds.splice(groupAt, 0, l.id);
          groupAt++;
        } else if (topAt >= 0) {
          layout.order.splice(topAt, 0, keyOf('layer', l.id));
          topAt++;
        } else {
          layout.order.push(keyOf('layer', l.id));
        }
        newKeys.push(keyOf('layer', l.id));
        return;
      }
      var gid = uniqueIdFrom(slugify(item.name), takenGroup,
        (schema && schema.LIMITS ? schema.LIMITS.maxGroupIdLength : 64));
      var ids = [];
      item.layers.forEach(function (raw) {
        var l2 = deepClone(raw);
        l2.id = uniqueIdFrom(l2.id, takenLayer);
        preset.layers.push(l2);
        ids.push(l2.id);
      });
      layout.groups.push({ id: gid, name: copyName(item.name, takenName), layerIds: ids });
      /* 群組副本一律插在頂層——這一版不支援巢狀群組，
         所以即使 anchor 在某個群組裡，群組副本也只能落在 root。 */
      if (topAt >= 0) { layout.order.splice(topAt, 0, keyOf('group', gid)); topAt++; }
      else layout.order.push(keyOf('group', gid));
      newKeys.push(keyOf('group', gid));
    });
    return newKeys;
  }

  /* anchor 在頂層 order 裡的「插入位置」（也就是它的下一格）。
     anchor 若是群組內的圖層，插入點取那個群組的下一格——群組副本不能
     插進群組裡。回傳 -1 代表沒有 anchor，追加到最後。 */
  function anchorTopIndex(layout, anchorKey) {
    if (!anchorKey || !Array.isArray(layout.order)) return -1;
    var key = anchorKey;
    if (keyKind(anchorKey) === 'layer') {
      var g = groupOfLayer(layout, keyId(anchorKey));
      if (g) key = keyOf('group', g.id);
    }
    var at = layout.order.indexOf(key);
    return at < 0 ? -1 : at + 1;
  }

  /* ---------------- 群組 ---------------- */

  function groupLayers(layout, layerIds, name) {
    if (!layerIds || !layerIds.length) return null;
    var taken = Object.create(null);
    (layout.groups || []).forEach(function (g) { taken[g.id] = true; });
    var gid = uniqueId(slugify(name, 'group'), taken);
    /* 先從舊群組拔掉，一個 layer 只能屬於一個群組 */
    layout.groups.forEach(function (g) {
      g.layerIds = g.layerIds.filter(function (id) { return layerIds.indexOf(id) < 0; });
    });
    layout.groups.push({ id: gid, name: name, layerIds: layerIds.slice() });
    dropEmptyGroups(layout);
    /* 新群組要插進 order，位置取它第一個成員原本所在之處，
       這樣「把幾層收成一組」不會讓它跳到列表最後。 */
    if (Array.isArray(layout.order)) {
      var firstKey = keyOf('layer', layerIds[0]);
      var at = layout.order.indexOf(firstKey);
      layout.order = layout.order.filter(function (k) {
        return !(keyKind(k) === 'layer' && layerIds.indexOf(keyId(k)) >= 0);
      });
      if (at < 0 || at > layout.order.length) at = layout.order.length;
      layout.order.splice(at, 0, keyOf('group', gid));
    }
    return gid;
  }

  function dropEmptyGroups(layout) {
    if (!layout || !Array.isArray(layout.groups)) return;
    layout.groups = layout.groups.filter(function (g) { return g.layerIds.length > 0; });
  }

  /* 解散群組：只刪群組本身，圖層原封不動留在 root */
  function ungroup(layout, groupIds) {
    if (!layout) return;
    layout.groups = layout.groups.filter(function (g) { return groupIds.indexOf(g.id) < 0; });
  }

  /* 刪除選取集合。選到群組時連同成員一起刪——列表上看到的是一個物件，
     只刪標題列卻留下散落的子圖層很難理解。 */
  function deleteSelection(preset, layout, selectedKeys) {
    var doomed = Object.create(null);
    var gids = [];
    (selectedKeys || []).forEach(function (k) {
      if (keyKind(k) === 'layer') { doomed[keyId(k)] = true; return; }
      gids.push(keyId(k));
      var g = groupById(layout, keyId(k));
      if (g) g.layerIds.forEach(function (id) { doomed[id] = true; });
    });
    preset.layers = preset.layers.filter(function (l) { return !doomed[l.id]; });
    if (layout && Array.isArray(layout.groups)) {
      layout.groups = layout.groups.filter(function (g) { return gids.indexOf(g.id) < 0; });
      layout.groups.forEach(function (g) {
        g.layerIds = g.layerIds.filter(function (id) { return !doomed[id]; });
      });
      dropEmptyGroups(layout);
      if (Array.isArray(layout.order)) {
        var live = Object.create(null);
        layout.groups.forEach(function (g) { live[g.id] = true; });
        layout.order = layout.order.filter(function (k) {
          if (keyKind(k) === 'group') return live[keyId(k)];
          return !doomed[keyId(k)];
        });
      }
    }
    return Object.keys(doomed);
  }

  /* ---------------- 拖曳 ----------------
     改的是分組歸屬與 AUTHORING ORDER。zIndex 在本函式裡完全沒有出現，
     所以拖曳前後畫面必然一致。 */

  /* ---------------- 拖曳 ----------------

     **本函式絕不修改 preset.layers。** 這是整個 Editor 最重要的一條不變量：
     Core 的粒子亂數種子綁在 preset.layers 的陣列索引上，相同 zIndex 的繪製
     順序又由 child 加入順序決定，所以只要動到那個陣列的順序，就算 zIndex
     一個都沒改，實際畫面仍然會變（實測 transform 指紋不同）。

     於是 authoring order 全部放在 layout：
       頂層順序  → layout.order（layer:<id> / group:<id> 混合）
       群組內順序 → groups[].layerIds 的順序
     拖曳只改這兩個地方，畫面必然不變。 */

  /* 某個 target 允不允許 into。UI 的落點指示線與 model 的實際行為必須
     用同一個函式判斷——指示線顯示 into 卻靜默做成 before，是在騙使用者。 */
  function dropModeAllowed(movingKeys, targetKey, mode) {
    if (mode !== 'into') return true;
    if (keyKind(targetKey) !== 'group') return false;          // 只有群組能被丟進去
    /* 這一版不支援巢狀群組，所以群組不能丟進群組 */
    return !(movingKeys || []).some(function (k) { return keyKind(k) === 'group'; });
  }

  /* 把 key 陣列裡的項目搬到 target 的前／後。回傳新陣列，不改輸入。 */
  function spliceOrder(order, movingKeys, targetKey, after) {
    var rest = order.filter(function (k) { return movingKeys.indexOf(k) < 0; });
    var at = rest.indexOf(targetKey);
    if (at < 0) at = rest.length;
    else if (after) at += 1;
    return rest.slice(0, at).concat(movingKeys).concat(rest.slice(at));
  }

  function applyDrop(preset, layout, movingKeys, targetKey, mode) {
    if (movingKeys.indexOf(targetKey) >= 0 && mode !== 'into') return false;
    if (!dropModeAllowed(movingKeys, targetKey, mode)) return false;

    /* 先用目前的 reconcile 結果當基準，確保 order 一定是完整且乾淨的。
        沒有 order 的舊 layout 在這裡會自動補上一份。 */
    var rec = reconcileFn(preset.layers, layout);
    var order = rec.rows.map(function (r) { return keyOf(r.kind, r.id); });

    var movingGroupIds = movingKeys.filter(function (k) { return keyKind(k) === 'group'; })
      .map(keyId);
    var carried = Object.create(null);
    movingGroupIds.forEach(function (gid) {
      var g = groupById(layout, gid);
      if (g) g.layerIds.forEach(function (id) { carried[id] = true; });
    });
    var looseLayerIds = movingKeys.filter(function (k) { return keyKind(k) === 'layer'; })
      .map(keyId)
      .filter(function (id) { return !carried[id]; });

    var targetGroupId = null;
    if (mode === 'into' && keyKind(targetKey) === 'group') targetGroupId = keyId(targetKey);
    else if (keyKind(targetKey) === 'layer') {
      var tg = groupOfLayer(layout, keyId(targetKey));
      targetGroupId = tg ? tg.id : null;
    }

    /* --- 群組歸屬：只有單獨被拖的圖層會改變 --- */
    if (looseLayerIds.length) {
      (layout.groups || []).forEach(function (g) {
        g.layerIds = g.layerIds.filter(function (id) { return looseLayerIds.indexOf(id) < 0; });
      });
      if (targetGroupId) {
        var g2 = groupById(layout, targetGroupId);
        if (g2) {
          if (mode === 'into') {
            looseLayerIds.forEach(function (id) { g2.layerIds.push(id); });
          } else {
            var at = g2.layerIds.indexOf(keyId(targetKey));
            if (at < 0) at = g2.layerIds.length;
            if (mode === 'after') at += 1;
            looseLayerIds.forEach(function (id, i) { g2.layerIds.splice(at + i, 0, id); });
          }
        }
      }
    }

    /* --- 頂層順序 --- */
    if (targetGroupId && mode !== 'into') {
      /* 丟到群組內的某一列旁邊：頂層順序不變，剛才已經處理過群組內順序。
         被拖進來的圖層要從頂層 order 移除（它現在屬於群組了）。 */
      order = order.filter(function (k) {
        return !(keyKind(k) === 'layer' && looseLayerIds.indexOf(keyId(k)) >= 0);
      });
    } else if (mode === 'into') {
      order = order.filter(function (k) {
        return !(keyKind(k) === 'layer' && looseLayerIds.indexOf(keyId(k)) >= 0);
      });
    } else {
      /* 一般的前／後移動。被拖的群組與「脫離群組回到頂層」的圖層都要放進 order。 */
      var keys = movingKeys.filter(function (k) {
        return keyKind(k) === 'group' || looseLayerIds.indexOf(keyId(k)) >= 0;
      });
      keys.forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
      order = spliceOrder(order, keys, targetKey, mode === 'after');
    }

    layout.order = order;
    dropEmptyGroups(layout);
    /* 群組被清掉之後，order 裡指向它的項目也要拿掉，否則存檔會帶著幽靈 key */
    var liveGroups = Object.create(null);
    (layout.groups || []).forEach(function (g) { liveGroups[g.id] = true; });
    layout.order = layout.order.filter(function (k) {
      return keyKind(k) !== 'group' || liveGroups[keyId(k)];
    });
    return true;
  }

  /* 改 layer 的 id 時，layout 裡所有指向它的參照都要跟著改，
     否則那一層會從群組裡「消失」變成 root——實測過，Orb A 會從 4 層掉到 3 層。 */
  function renameLayer(preset, layout, oldId, newId) {
    var l = layerById(preset, oldId);
    if (!l) return false;
    l.id = newId;
    if (layout && Array.isArray(layout.groups)) {
      layout.groups.forEach(function (g) {
        g.layerIds = g.layerIds.map(function (id) { return id === oldId ? newId : id; });
      });
    }
    if (layout && Array.isArray(layout.order)) {
      layout.order = layout.order.map(function (k) {
        return k === keyOf('layer', oldId) ? keyOf('layer', newId) : k;
      });
    }
    return true;
  }

  /* ---------------- 鍵盤安全 ----------------
     焦點在可輸入欄位裡時一律不攔截，否則在 JSON 參數框裡按 Ctrl+C
     會變成複製圖層。checkbox / color / range 這些不是文字輸入，可以攔。 */

  var NON_TEXT_INPUT_TYPES = ['checkbox', 'radio', 'color', 'range', 'button', 'file',
    'submit', 'reset', 'image'];

  function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    var t = String(el.type || 'text').toLowerCase();
    return NON_TEXT_INPUT_TYPES.indexOf(t) < 0;
  }

  return {
    keyOf: keyOf, keyKind: keyKind, keyId: keyId,
    layerById: layerById, groupById: groupById, groupOfLayer: groupOfLayer,
    sortRows: sortRows, visibleKeys: visibleKeys, applyClick: applyClick,
    uniqueIdFrom: uniqueIdFrom, uniqueId: uniqueId, slugify: slugify, deepClone: deepClone,
    copySelection: copySelection, pasteClipboard: pasteClipboard,
    groupLayers: groupLayers, ungroup: ungroup, dropEmptyGroups: dropEmptyGroups,
    deleteSelection: deleteSelection, applyDrop: applyDrop,
    dropModeAllowed: dropModeAllowed, renameLayer: renameLayer, copyName: copyName,
    anchorTopIndex: anchorTopIndex,
    isTextEntry: isTextEntry
  };
});
