'use strict';
/* ============================================================
   hierarchy-model.js — 父子層級（layer.parent）的純資料運算

   Core 負責播（js/vfx-core.js 的 hierarchyState）；這裡回答 Editor 操作層級時
   要問的問題，全部不碰 DOM：

     treeRows          圖層面板畫哪些列、每列縮排幾層（收合的父物件不展開子物件）
     eligibleParents   選取的圖層能掛到誰底下
     reparent／attach  掛上、卸下、換父物件。數值換算成新父物件底下的區域值，
                       畫面上的位置、角度、大小與出現時間都不動
     applyDrop         拖曳落點在層級上的意義（成為子物件、成為兄弟、回到根層級）
     withDescendants   複製、刪除時把子物件一起帶上

   換算用的矩陣是 Core 公開的那一份（layerMatrix／multiplyMatrix／invertMatrix），
   這裡不另寫：Runtime 與 Editor 各算各的，掛上去之後差一點點的那種錯肉眼看不出來。

   ---- 換算以基本數值為準 ----
   與 gizmo 相同，只看 position／rotation／scale／outerScale／delay，不取樣曲線。
   曲線疊在基本數值上，掛上之後子物件的曲線仍在自己的座標裡播；
   父物件的曲線動畫本來就會帶著子物件動，那正是掛上去的目的。

   ---- 換不過去的情況（回傳在 notes，由畫面告訴使用者） ----
     skew           圖層的欄位只存得下「位置 · 外層縮放 · 旋轉 · 縮放」。
                    父物件的非等比縮放遇上子物件自己的外層縮放與旋轉，
                    會變成斜切，存不下來，只能取最接近的值
     particle       粒子層只換算發射點位置；父物件的旋轉與縮放會套到整群粒子上
     delay          新父物件比圖層還晚出現，delay 不能是負的，圖層會跟著晚出現
     clipped        圖層的結束時間晚於新父物件，超過的那段不會顯示
     degenerate     新父物件的縮放是 0，換算不了，數值維持原樣
   ============================================================ */

(function (root, factory) {
  var node = typeof module !== 'undefined' && module.exports;
  var api = factory(
    node ? require('../../../js/vfx-core.js') : root.VFXCore,
    node ? require('./layer-model.js') : root.VFXLayerModel,
    node ? require('./layout-schema.js') : root.VFXLayoutSchema);
  if (node) module.exports = api;
  else root.VFXHierarchyModel = api;
})(typeof self !== 'undefined' ? self : this, function (Core, M, LS) {

  /* ---------------- 查找 ---------------- */

  function parentIdOf(layer) {
    return layer && typeof layer.parent === 'string' && layer.parent ? layer.parent : null;
  }

  function indexById(preset) {
    var byId = Object.create(null);
    ((preset && preset.layers) || []).forEach(function (l) {
      if (l && typeof l.id === 'string') byId[l.id] = l;
    });
    return byId;
  }

  /* 由近到遠的祖先。parent 指向不存在的圖層就停在那裡；遇到環也停——
     那是 Core 驗證要報的錯，這裡只負責不當掉。 */
  function ancestorIds(preset, id, byId) {
    var map = byId || indexById(preset);
    var out = [];
    var seen = Object.create(null);
    seen[id] = true;
    var cur = map[id];
    while (cur) {
      var p = parentIdOf(cur);
      if (!p || seen[p] || !map[p]) break;
      seen[p] = true;
      out.push(p);
      cur = map[p];
    }
    return out;
  }

  function isDescendantOf(preset, id, ancestorId, byId) {
    return ancestorIds(preset, id, byId).indexOf(ancestorId) >= 0;
  }

  /* 圖層在 Layers 面板上的排列（群組展開成成員）。子物件之間的先後照這個排，
     拖曳、複製時帶著走的子物件才不會換了順序。 */
  function authoringOrder(preset, layout) {
    var out = [];
    LS.reconcile((preset && preset.layers) || [], layout).rows.forEach(function (r) {
      if (r.kind === 'group') r.layerIds.forEach(function (id) { out.push(id); });
      else out.push(r.id);
    });
    return out;
  }

  /* 全部子孫，深度優先；同一層的兄弟照 order（沒給就照 preset.layers）。不含自己。 */
  function descendantIds(preset, id, order) {
    var rank = Object.create(null);
    (order || []).forEach(function (lid, i) { rank[lid] = i; });
    var layers = (preset && preset.layers) || [];
    var kids = Object.create(null);
    layers.forEach(function (l, i) {
      var p = parentIdOf(l);
      if (!p || p === l.id) return;
      /* order 裡沒有的（沒給 order，或 layout 還沒收到它）排在最後，彼此照陣列順序 */
      var at = rank[l.id] !== undefined ? rank[l.id] : layers.length + i;
      (kids[p] = kids[p] || []).push({ id: l.id, at: at });
    });
    var out = [];
    var seen = Object.create(null);
    seen[id] = true;
    (function walk(pid) {
      (kids[pid] || []).slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (k) {
        if (seen[k.id]) return;
        seen[k.id] = true;
        out.push(k.id);
        walk(k.id);
      });
    })(id);
    return out;
  }

  /* 最深的子孫在自己底下第幾層（沒有子物件＝0） */
  function subtreeHeight(preset, id, byId) {
    var map = byId || indexById(preset);
    var base = ancestorIds(preset, id, map).length;
    var h = 0;
    descendantIds(preset, id).forEach(function (d) {
      h = Math.max(h, ancestorIds(preset, d, map).length - base);
    });
    return h;
  }

  /* ---------------- 矩陣與時間 ---------------- */

  /* 圖層在特效座標裡的矩陣（基本數值，不含曲線）：從最遠的祖先一路乘到自己，
     與 Runtime 的 hierarchyState 同一個順序。 */
  function worldMatrix(preset, id, byId) {
    var map = byId || indexById(preset);
    var m = Core.identityMatrix({});
    if (!map[id]) return m;
    var chain = ancestorIds(preset, id, map).reverse();
    chain.push(id);
    chain.forEach(function (cid) { m = Core.multiplyMatrix(m, Core.layerMatrix(map[cid]), {}); });
    return m;
  }

  function parentMatrixOf(preset, parentId, byId) {
    var map = byId || indexById(preset);
    return parentId && map[parentId] ? worldMatrix(preset, parentId, map) : Core.identityMatrix({});
  }

  function durationOf(preset, layer) {
    return typeof layer.duration === 'number' ? layer.duration : preset.duration;
  }

  /* 出現時間：自己與所有祖先的 delay 加總（子物件的 delay 從父物件出現那一刻算起） */
  function startTime(preset, id, byId) {
    var map = byId || indexById(preset);
    if (!map[id]) return 0;
    var t = map[id].delay || 0;
    ancestorIds(preset, id, map).forEach(function (aid) { t += map[aid].delay || 0; });
    return t;
  }

  /* 實際看得到的最後時刻：自己與每一個祖先的結束時間取最早的 */
  function visibleEnd(preset, id, byId) {
    var map = byId || indexById(preset);
    if (!map[id]) return 0;
    var end = Infinity;
    [id].concat(ancestorIds(preset, id, map)).forEach(function (cid) {
      end = Math.min(end, startTime(preset, cid, map) + durationOf(preset, map[cid]));
    });
    return end;
  }

  /* ---------------- 驗證（與 Core 的 validateHierarchy 同一套規則） ---------------- */

  /* next：換完之後每一層的 parent。只檢查這次動到的圖層與它們的子孫——
     檔案裡本來就有的問題（例如手改出來的環）不該擋住不相干的操作。 */
  function hierarchyProblem(preset, next, movedIds) {
    var layers = preset.layers;
    var byId = indexById(preset);
    var moved = Object.create(null);
    movedIds.forEach(function (id) { moved[id] = true; });

    var check = [];
    var queued = Object.create(null);
    function queue(id) { if (!queued[id]) { queued[id] = true; check.push(id); } }
    movedIds.forEach(function (id) {
      queue(id);
      /* 子孫要照「換完之後」的關係找 */
      layers.forEach(function (l) {
        var cur = l.id, hops = 0;
        while (cur && hops++ <= layers.length) {
          if (cur === id) { queue(l.id); break; }
          cur = next[cur];
        }
      });
    });

    for (var i = 0; i < check.length; i++) {
      var seen = Object.create(null);
      var depth = 0;
      var cur = check[i];
      while (next[cur]) {
        if (seen[cur]) return '父子關係會形成環：' + cur + ' 會變成自己的祖先';
        seen[cur] = true;
        if (!byId[next[cur]]) break;
        if (++depth > Core.MAX_PARENT_DEPTH) {
          return check[i] + ' 的父子層級會超過 ' + Core.MAX_PARENT_DEPTH + ' 層';
        }
        cur = next[cur];
      }
    }

    for (var j = 0; j < layers.length; j++) {
      var se = layers[j].subEmitter;
      if (!se || typeof se.layer !== 'string' || !byId[se.layer]) continue;
      if (!moved[layers[j].id] && !moved[se.layer]) continue;
      if ((next[layers[j].id] || null) !== (next[se.layer] || null)) {
        return '子發射器的來源 ' + layers[j].id + ' 與目標 ' + se.layer +
          ' 必須掛在同一個父物件底下（子發射器用來源粒子的座標當出生點）。請兩層一起選取再掛。';
      }
    }
    return null;
  }

  /* ---------------- 換算 ---------------- */

  var EPS = 1e-9;

  /* 換算出來的值要收位數：29.999999999999996 寫進檔案只會讓 diff 難讀。
     取「誤差在容許範圍內、位數最少」的寫法，而不是固定位數——固定四位的話，掛上再卸下
     會留下 0.0001 這種殘差（中間那一步被截過位數），原本沒寫的 position 就多出一個欄位。
     容許範圍在畫面上看不出差別：位置 0.0002 px、角度與倍率百萬分之一、時間百萬分之一秒。 */
  function tidy(v, tolerance, maxDigits) {
    var r = Number(v.toFixed(maxDigits));
    for (var d = 0; d < maxDigits; d++) {
      var shorter = Number(v.toFixed(d));
      if (Math.abs(shorter - v) <= tolerance) { r = shorter; break; }
    }
    return r === 0 ? 0 : r;                     // -0 → 0
  }
  var POSITION_TIDY = [2e-4, 4];  // px
  var LINEAR_TIDY = [1e-6, 6];    // 弧度、倍率
  var TIME_TIDY = [1e-6, 6];      // 秒
  var TIME_EPS = 5e-7;

  function wrapPi(a) {
    var r = a % (Math.PI * 2);
    if (r > Math.PI) r -= Math.PI * 2;
    if (r <= -Math.PI) r += Math.PI * 2;
    return r;
  }

  function isIdentity(m) {
    return Math.abs(m.a - 1) < EPS && Math.abs(m.b) < EPS && Math.abs(m.c) < EPS &&
      Math.abs(m.d - 1) < EPS && Math.abs(m.tx) < EPS && Math.abs(m.ty) < EPS;
  }

  function isTranslation(m) {
    return Math.abs(m.a - 1) < EPS && Math.abs(m.b) < EPS && Math.abs(m.c) < EPS &&
      Math.abs(m.d - 1) < EPS;
  }

  /* 線性部分 m 除掉外層縮放 o 之後，拆成 旋轉 · 縮放。
     兩個欄（(a,b) 與 (c,d)）互相垂直時是精確解；不垂直就是有斜切，取最接近的：
     角度看第一欄，Y 縮放取第二欄垂直於第一欄的分量（面積不變）。
     正負號（翻轉）盡量沿用原本的寫法：數學上等價的寫法有好幾種，挑跟原本最像的，
     存檔的差異才看得懂。 */
  function splitRotationScale(m, o, oldScale) {
    var pa = m.a / o.x, pb = m.b / o.y, pc = m.c / o.x, pd = m.d / o.y;
    var n1 = Math.sqrt(pa * pa + pb * pb), n2 = Math.sqrt(pc * pc + pd * pd);
    var det = pa * pd - pb * pc;
    var sx = 1, sy = 1;
    if (det < 0) {
      if (oldScale.y < 0 && !(oldScale.x < 0)) sy = -1; else sx = -1;
    } else if (oldScale.x < 0 && oldScale.y < 0) {
      sx = -1; sy = -1;
    }
    var theta, qx, qy;
    if (n1 > EPS) {
      theta = Math.atan2(sx * pb, sx * pa);
      qx = sx * n1;
      qy = Math.cos(theta) * pd - Math.sin(theta) * pc;
    } else if (n2 > EPS) {
      theta = Math.atan2(-sy * pc, sy * pd);
      qy = sy * n2;
      qx = Math.cos(theta) * pa + Math.sin(theta) * pb;
    } else {
      return null;
    }
    var dot = pa * pc + pb * pd;
    return {
      rotation: theta, scale: { x: qx, y: qy },
      exact: Math.abs(dot) <= 1e-9 * Math.max(1, n1 * n2)
    };
  }

  /* 找一組外層縮放讓兩欄垂直：(a·c)/ox² + (b·d)/oy² = 0。
     兩項異號才有解；整體倍率分給外層縮放與縮放時，讓縮放維持原本的大小——
     使用者認得的是「這張圖的 scale」，換算把差異吸收在外層縮放裡最不突兀。 */
  function solveOuterScale(m, oldScale) {
    var ac = m.a * m.c, bd = m.b * m.d;
    if (!(ac * bd < 0)) return null;
    var o = { x: 1, y: Math.sqrt(-bd / ac) };
    var split = splitRotationScale(m, o, oldScale);
    return split ? balance(o, split.scale, oldScale).o : null;
  }

  /* S(o)·R·S(q) ＝ S(k·o)·R·S(q/k)：整體倍率放哪邊都一樣。放到縮放維持原本大小的那一邊。 */
  function balance(o, q, oldScale) {
    var want = Math.sqrt(Math.abs(oldScale.x * oldScale.y));
    var have = Math.sqrt(Math.abs(q.x * q.y));
    if (!(want > EPS && have > EPS)) return { o: o, q: q };
    var k = have / want;
    return { o: { x: o.x * k, y: o.y * k }, q: { x: q.x / k, y: q.y / k } };
  }

  /* 斜切存不下時，找「外層縮放 · 旋轉 · 縮放」裡最接近的一組。
     外層縮放的整體倍率可以跟縮放互換，真正的自由度只有角度 θ 與比例 r＝oy/ox；
     給定這兩個，縮放有最小平方的公式解。所以先對 (θ, log r) 撒網格，再在最好的一格附近細修。
     誤差量的是矩陣四個元素的平方和，也就是圖片四個角偏離的程度。 */
  function closestRepresentable(m, oldScale) {
    function fit(theta, logR) {
      var oy = Math.exp(logR);
      var c = Math.cos(theta), s = Math.sin(theta);
      var qx = (m.a * c + m.b * oy * s) / (c * c + oy * oy * s * s);
      var qy = (m.d * oy * c - m.c * s) / (s * s + oy * oy * c * c);
      var ea = m.a - c * qx, eb = m.b - oy * s * qx, ec = m.c + s * qy, ed = m.d - oy * c * qy;
      return { err: ea * ea + eb * eb + ec * ec + ed * ed, theta: theta, logR: logR, oy: oy, qx: qx, qy: qy };
    }
    var best = null;
    for (var i = 0; i < 180; i++) {
      for (var j = -30; j <= 30; j++) {
        var f = fit(-Math.PI + i * Math.PI / 90, j / 10);
        if (!best || f.err < best.err) best = f;
      }
    }
    var dt = Math.PI / 90, dr = 0.1;
    for (var step = 0; step < 60; step++) {
      var improved = false;
      [[dt, 0], [-dt, 0], [0, dr], [0, -dr]].forEach(function (d) {
        var g = fit(best.theta + d[0], best.logR + d[1]);
        if (g.err < best.err) { best = g; improved = true; }
      });
      if (!improved) { dt /= 2; dr /= 2; }
    }
    var theta = best.theta, q = { x: best.qx, y: best.qy };
    /* 兩軸都是負的＝轉半圈，原本不是這樣寫的就換回轉半圈的寫法 */
    if (q.x < 0 && q.y < 0 && !(oldScale.x < 0 && oldScale.y < 0)) {
      theta += Math.PI; q = { x: -q.x, y: -q.y };
    }
    var b = balance({ x: 1, y: best.oy }, q, oldScale);
    return { o: b.o, rotation: theta, scale: b.q };
  }

  /* layer 從父矩陣 from 搬到父矩陣 to 底下，世界變換不變。回傳要寫回的欄位，不改 layer。 */
  function convertTransform(layer, from, to) {
    var inv = Core.invertMatrix(to, {});
    if (!inv) return { fields: null, notes: ['degenerate'] };
    var rel = Core.multiplyMatrix(inv, from, {});
    if (isIdentity(rel)) return { fields: null, notes: [] };

    var pos = layer.position || { x: 0, y: 0 };
    if (layer.type === 'particle' || isTranslation(rel)) {
      return {
        fields: {
          position: {
            x: rel.a * pos.x + rel.c * pos.y + rel.tx,
            y: rel.b * pos.x + rel.d * pos.y + rel.ty
          }
        },
        notes: layer.type === 'particle' && !isTranslation(rel) ? ['particle'] : []
      };
    }

    var target = Core.multiplyMatrix(rel, Core.layerMatrix(layer), {});
    var position = { x: target.tx, y: target.ty };
    /* 圖層自己縮放是 0：本來就看不到，角度與縮放怎麼寫都一樣，只搬位置 */
    if (Math.abs(target.a) < EPS && Math.abs(target.b) < EPS && Math.abs(target.c) < EPS &&
      Math.abs(target.d) < EPS) {
      return { fields: { position: position }, notes: [] };
    }
    var oldScale = layer.scale || { x: 1, y: 1 };
    var o = layer.outerScale ? { x: layer.outerScale.x, y: layer.outerScale.y } : { x: 1, y: 1 };
    var notes = [];
    /* 依序：原本的外層縮放就解得開 → 換一組外層縮放解得開 → 都不行才取最接近的 */
    var split = Math.abs(o.x) > EPS && Math.abs(o.y) > EPS ? splitRotationScale(target, o, oldScale) : null;
    if (!split || !split.exact) {
      var solved = solveOuterScale(target, oldScale);
      var retry = solved && splitRotationScale(target, solved, oldScale);
      if (retry && retry.exact) { o = solved; split = retry; }
    }
    if (!split || !split.exact) {
      var near = closestRepresentable(target, oldScale);
      o = near.o;
      split = { rotation: near.rotation, scale: near.scale };
      notes.push('skew');
    }
    var oldRot = layer.rotation || 0;
    return {
      fields: {
        position: position,
        rotation: oldRot + wrapPi(split.rotation - oldRot),
        scale: split.scale,
        outerScale: o
      },
      notes: notes
    };
  }

  function writeVec(layer, key, v, dflt, rule) {
    var x = tidy(v.x, rule[0], rule[1]), y = tidy(v.y, rule[0], rule[1]);
    if (layer[key] === undefined && x === dflt.x && y === dflt.y) return;
    layer[key] = { x: x, y: y };
  }

  function writeNum(layer, key, v, dflt, rule) {
    var n = tidy(v, rule[0], rule[1]);
    if (layer[key] === undefined && n === dflt) return;
    layer[key] = n;
  }

  /* ---------------- 掛上／卸下 ---------------- */

  /* moves：[{ id, parent }]，parent 為 null＝回到根層級。
     先驗證（環、深度、子發射器），有問題就什麼都不改。

     換算一律從「換之前」的關係算：每一層換完之後的世界變換都等於換之前的，
     所以新父物件就算自己也在這一批裡，它換之前的世界矩陣仍然是對的。

     回傳 { ok, error, changed: [id], notes: [{ id, kind }] }。 */
  function reparent(preset, moves) {
    var byId = indexById(preset);
    var next = Object.create(null);
    preset.layers.forEach(function (l) { next[l.id] = parentIdOf(l); });

    var real = [];
    for (var i = 0; i < (moves || []).length; i++) {
      var mv = moves[i];
      var layer = byId[mv.id];
      if (!layer) return { ok: false, error: '找不到圖層：' + mv.id };
      var to = mv.parent || null;
      if (to !== null && !byId[to]) return { ok: false, error: '找不到父物件：' + to };
      if (to === mv.id) return { ok: false, error: mv.id + ' 不能掛在自己底下' };
      if (parentIdOf(layer) === to) continue;
      next[mv.id] = to;
      real.push({ id: mv.id, from: parentIdOf(layer), to: to });
    }
    if (!real.length) return { ok: true, changed: [], notes: [] };
    var problem = hierarchyProblem(preset, next, real.map(function (r) { return r.id; }));
    if (problem) return { ok: false, error: problem };

    var notes = [];
    var plans = real.map(function (r) {
      var layer = byId[r.id];
      var conv = convertTransform(layer,
        parentMatrixOf(preset, r.from, byId), parentMatrixOf(preset, r.to, byId));
      conv.notes.forEach(function (kind) { notes.push({ id: r.id, kind: kind }); });

      var parentStart = r.to ? startTime(preset, r.to, byId) : 0;
      var delay = startTime(preset, r.id, byId) - parentStart;
      if (delay < -TIME_EPS) { notes.push({ id: r.id, kind: 'delay' }); delay = 0; }
      /* 看得到的最後時刻變早了才講。根層級的圖層本來就會在特效結束（或循環繞回）時被切掉，
         所以兩邊都先跟 preset.duration 取小——否則子物件只要有 delay 就會被誤報。 */
      var oldEnd = Math.min(visibleEnd(preset, r.id, byId), preset.duration);
      var newEnd = Math.min(parentStart + Math.max(0, delay) + durationOf(preset, layer),
        r.to ? visibleEnd(preset, r.to, byId) : Infinity, preset.duration);
      if (newEnd < oldEnd - TIME_EPS) notes.push({ id: r.id, kind: 'clipped' });
      return { layer: layer, to: r.to, fields: conv.fields, delay: delay };
    });

    plans.forEach(function (p) {
      var l = p.layer;
      if (p.to) l.parent = p.to; else delete l.parent;
      if (p.fields) {
        if (p.fields.position) writeVec(l, 'position', p.fields.position, { x: 0, y: 0 }, POSITION_TIDY);
        if (p.fields.rotation !== undefined) writeNum(l, 'rotation', p.fields.rotation, 0, LINEAR_TIDY);
        if (p.fields.scale) writeVec(l, 'scale', p.fields.scale, { x: 1, y: 1 }, LINEAR_TIDY);
        if (p.fields.outerScale) writeVec(l, 'outerScale', p.fields.outerScale, { x: 1, y: 1 }, LINEAR_TIDY);
      }
      if (Math.abs(p.delay - (l.delay || 0)) > TIME_EPS) writeNum(l, 'delay', p.delay, 0, TIME_TIDY);
    });
    return { ok: true, changed: real.map(function (r) { return r.id; }), notes: notes };
  }

  /* ids 全部掛到 parentId 底下（null＝卸下）。Inspector 的「父物件」欄位用：
     欄位寫入的語意是每一個選到的圖層都變成這個值，所以父子同時被選時會一起變成兄弟。 */
  function attach(preset, ids, parentId) {
    return reparent(preset, (ids || []).map(function (id) {
      return { id: id, parent: parentId || null };
    }));
  }

  /* ---------------- 可選的父物件 ---------------- */

  /* 排除自己、自己的子孫、掛上去會超過深度上限的。
     子發射器的限制不在這裡排除——要看整組怎麼搬才知道，選了之後講原因，
     比下拉上默默少一個選項好懂。 */
  function eligibleParents(preset, ids) {
    var byId = indexById(preset);
    var banned = Object.create(null);
    var height = 0;
    (ids || []).forEach(function (id) {
      banned[id] = true;
      descendantIds(preset, id).forEach(function (d) { banned[d] = true; });
      height = Math.max(height, subtreeHeight(preset, id, byId));
    });
    return preset.layers.filter(function (l) {
      if (banned[l.id]) return false;
      return ancestorIds(preset, l.id, byId).length + 1 + height <= Core.MAX_PARENT_DEPTH;
    }).map(function (l) { return l.id; });
  }

  /* ---------------- Layers 面板的樹 ---------------- */

  function collapsedKeyOf(id) { return M.keyOf('layer', id); }

  /* rows：Editor buildRows() 的結果（群組列帶 layerIds、未分組的圖層列，已套用顯示排序）。
     回傳畫面上看得到的列，順序就是畫面順序：
       { kind: 'group', id, name, layerIds }
       { kind: 'layer', id, depth, groupId, hasChildren, collapsed, parentElsewhere, parentOff }

     子物件縮排在父物件底下的條件是兩者在同一個容器（同一個群組，或都在根層級）。
     不在同一個容器（手改的檔案、舊的分組）就留在自己的位置，parentElsewhere 標出父物件，
     面板上看得到它掛在誰底下，不會因為父物件在別組就整列消失。
     parentOff：有祖先被停用——Runtime 不會畫它，面板上淡化。 */
  function treeRows(preset, rows, collapsed) {
    var c = collapsed || {};
    var byId = indexById(preset);
    var out = [];

    function ancestorOff(id) {
      return ancestorIds(preset, id, byId).some(function (aid) { return byId[aid].enabled === false; });
    }

    function forest(ids) {
      var inSet = Object.create(null);
      ids.forEach(function (id) { if (byId[id]) inSet[id] = true; });
      var kids = Object.create(null);
      var isRoot = Object.create(null);
      ids.forEach(function (id) {
        if (!inSet[id]) return;
        var p = parentIdOf(byId[id]);
        if (p && p !== id && inSet[p]) (kids[p] = kids[p] || []).push(id);
        else isRoot[id] = true;
      });
      /* 環（手改的檔案才會有）：整圈都不是根，沿著 parent 走回自己的那幾層改當根，
         否則它們永遠不會被畫出來。 */
      ids.forEach(function (id) {
        if (!inSet[id] || isRoot[id]) return;
        var seen = Object.create(null), cur = id;
        while (cur && inSet[cur] && !isRoot[cur]) {
          if (seen[cur]) { isRoot[id] = true; break; }
          seen[cur] = true;
          cur = parentIdOf(byId[cur]);
        }
      });
      return { kids: kids, isRoot: isRoot, inSet: inSet };
    }

    function emit(f, id, depth, groupId, emitted) {
      if (emitted[id]) return;
      emitted[id] = true;
      var children = (f.kids[id] || []).filter(function (k) { return !emitted[k]; });
      var p = parentIdOf(byId[id]);
      var isCollapsed = !!c[collapsedKeyOf(id)];
      out.push({
        kind: 'layer', id: id, depth: depth, groupId: groupId,
        hasChildren: children.length > 0,
        collapsed: isCollapsed && children.length > 0,
        parentElsewhere: p && !f.inSet[p] ? p : null,
        parentOff: ancestorOff(id)
      });
      if (isCollapsed) {
        /* 收起來的子孫不畫，但要記成已處理，否則環的保險會把它們當根再畫一次 */
        (function hide(pid) {
          (f.kids[pid] || []).forEach(function (k) { if (!emitted[k]) { emitted[k] = true; hide(k); } });
        })(id);
        return;
      }
      children.forEach(function (k) { emit(f, k, depth + 1, groupId, emitted); });
    }

    var looseIds = rows.filter(function (r) { return r.kind === 'layer'; }).map(function (r) { return r.id; });
    var loose = forest(looseIds);
    var looseEmitted = Object.create(null);

    rows.forEach(function (r) {
      if (r.kind === 'group') {
        out.push({ kind: 'group', id: r.id, name: r.name, layerIds: r.layerIds.slice() });
        if (c[r.id]) return;
        var f = forest(r.layerIds);
        var emitted = Object.create(null);
        r.layerIds.forEach(function (id) { if (f.isRoot[id]) emit(f, id, 0, r.id, emitted); });
        return;
      }
      if (loose.isRoot[r.id]) emit(loose, r.id, 0, null, looseEmitted);
    });
    return out;
  }

  function visibleKeys(tree) {
    return tree.map(function (r) { return M.keyOf(r.kind, r.id); });
  }

  /* ---------------- 選取展開 ---------------- */

  /* 複製、刪除用：選取的 key 後面補上子孫的圖層 key（照面板順序、不重複）。
     群組 key 保持原樣——群組本來就帶著成員走，這裡只補成員在群組外的子孫。 */
  function withDescendants(preset, layout, keys) {
    var order = authoringOrder(preset, layout);
    var out = [];
    var has = Object.create(null);
    function push(k) { if (!has[k]) { has[k] = true; out.push(k); } }
    (keys || []).forEach(function (k) {
      push(k);
      var ids = M.keyKind(k) === 'group'
        ? ((M.groupById(layout, M.keyId(k)) || { layerIds: [] }).layerIds)
        : [M.keyId(k)];
      ids.forEach(function (id) {
        descendantIds(preset, id, order).forEach(function (d) {
          var g = M.groupOfLayer(layout, d);
          if (M.keyKind(k) === 'group' && g && g.id === M.keyId(k)) return;
          push(M.keyOf('layer', d));
        });
      });
    });
    return out;
  }

  /* ---------------- 拖曳 ---------------- */

  function sameContainer(layout, a, b) {
    var ga = M.groupOfLayer(layout, a), gb = M.groupOfLayer(layout, b);
    return (ga ? ga.id : null) === (gb ? gb.id : null);
  }

  /* 拖曳在層級上的意義：
       圖層列  into          成為它的最後一個子物件
               before／after 成為它的兄弟（同一個父物件），排在它前／後
       群組列  任何落點      回到根層級（parent 清掉），分組照原本的規則

     拖的是「選取裡的最上層」：父物件與它的子物件一起被選時，子物件跟著父物件走，
     不會被攤平成兄弟。沒被選到的子孫也跟著父物件搬到同一個群組，面板上才會縮排在一起。

     回傳 { plan } 或 { error }，完全不改輸入。 */
  function planDrop(preset, layout, movingKeys, targetKey, mode) {
    var byId = indexById(preset);
    var order = authoringOrder(preset, layout);
    var keys = movingKeys || [];

    var carried = Object.create(null);
    keys.forEach(function (k) {
      if (M.keyKind(k) !== 'group') return;
      var g = M.groupById(layout, M.keyId(k));
      if (g) g.layerIds.forEach(function (id) { carried[id] = true; });
    });
    var loose = keys.filter(function (k) { return M.keyKind(k) === 'layer'; })
      .map(M.keyId).filter(function (id) { return byId[id] && !carried[id]; });
    var looseSet = Object.create(null);
    loose.forEach(function (id) { looseSet[id] = true; });
    var roots = loose.filter(function (id) {
      return !ancestorIds(preset, id, byId).some(function (a) { return looseSet[a]; });
    });
    var rootSet = Object.create(null);
    roots.forEach(function (id) { rootSet[id] = true; });

    var moving = Object.create(null);
    var expanded = [];
    var pushed = Object.create(null);
    function push(k) { if (!pushed[k]) { pushed[k] = true; expanded.push(k); } }
    keys.forEach(function (k) {
      if (M.keyKind(k) === 'group') { push(k); return; }
      var id = M.keyId(k);
      if (!rootSet[id]) return;
      push(k);
      moving[id] = true;
      descendantIds(preset, id, order).forEach(function (d) {
        moving[d] = true;
        if (!carried[d]) push(M.keyOf('layer', d));
      });
    });

    var kind = M.keyKind(targetKey), targetId = M.keyId(targetKey);
    var newParent = null;
    var anchorKey = targetKey, anchorMode = mode;
    if (kind === 'layer') {
      var target = byId[targetId];
      if (!target) return { error: '找不到目標圖層：' + targetId };
      if (moving[targetId] || carried[targetId]) return { error: '不能拖到自己或自己的子物件上' };
      if (mode === 'into' && keys.some(function (k) { return M.keyKind(k) === 'group'; })) {
        return { error: '群組不能掛到圖層底下' };
      }
      newParent = mode === 'into' ? targetId : parentIdOf(target);
      if (mode !== 'before') {
        /* 排在目標整棵子樹的最後面（同一個容器裡、不在這次搬動的） */
        var last = targetId;
        descendantIds(preset, targetId, order).forEach(function (d) {
          if (!moving[d] && !carried[d] && sameContainer(layout, d, targetId) &&
            order.indexOf(d) > order.indexOf(last)) last = d;
        });
        anchorKey = M.keyOf('layer', last);
        anchorMode = 'after';
      }
    }

    var moves = roots.filter(function (id) { return parentIdOf(byId[id]) !== newParent; })
      .map(function (id) { return { id: id, parent: newParent }; });
    if (moves.length) {
      var next = Object.create(null);
      preset.layers.forEach(function (l) { next[l.id] = parentIdOf(l); });
      moves.forEach(function (mv) { next[mv.id] = mv.parent; });
      var problem = hierarchyProblem(preset, next, moves.map(function (mv) { return mv.id; }));
      if (problem) return { error: problem };
    }
    if (!M.dropModeAllowed(expanded, anchorKey, anchorMode)) return { error: '這個位置不能放' };
    if (expanded.indexOf(anchorKey) >= 0 && anchorMode !== 'into') return { error: '不能拖到自己上' };
    return { plan: { keys: expanded, anchorKey: anchorKey, anchorMode: anchorMode, moves: moves } };
  }

  function dropProblem(preset, layout, movingKeys, targetKey, mode) {
    var r = planDrop(preset, layout, movingKeys, targetKey, mode);
    return r.error || null;
  }

  /* 真的搬。先改分組與順序（layer-model 的 applyDrop），再換父物件。
     回傳 { ok, error, parentChanged, notes }。 */
  function applyDrop(preset, layout, movingKeys, targetKey, mode) {
    var r = planDrop(preset, layout, movingKeys, targetKey, mode);
    if (r.error) return { ok: false, error: r.error };
    var p = r.plan;
    if (!M.applyDrop(preset, layout, p.keys, p.anchorKey, p.anchorMode)) {
      return { ok: false, error: '這個位置不能放' };
    }
    var result = reparent(preset, p.moves);
    return {
      ok: result.ok, error: result.error,
      parentChanged: !!(result.changed && result.changed.length),
      notes: result.notes || []
    };
  }

  /* ---------------- 給畫面的說明文字 ---------------- */

  var NOTE_TEXT = {
    skew: '父物件的非等比縮放讓它變成斜切，存不下來，已取最接近的角度與縮放',
    particle: '粒子層只換算了發射點位置；父物件的旋轉與縮放會套到整群粒子上',
    delay: '新父物件比它晚出現，delay 不能是負的，它會跟著晚出現',
    clipped: '它的結束時間晚於新父物件，超過的那段不會顯示',
    degenerate: '父物件的縮放是 0，換算不了，數值維持原樣'
  };

  function describeNotes(notes) {
    return (notes || []).map(function (n) { return n.id + '：' + (NOTE_TEXT[n.kind] || n.kind); });
  }

  return {
    parentIdOf: parentIdOf,
    ancestorIds: ancestorIds,
    isDescendantOf: isDescendantOf,
    descendantIds: descendantIds,
    authoringOrder: authoringOrder,
    worldMatrix: worldMatrix,
    parentMatrixOf: parentMatrixOf,
    startTime: startTime,
    visibleEnd: visibleEnd,
    reparent: reparent,
    attach: attach,
    eligibleParents: eligibleParents,
    treeRows: treeRows,
    visibleKeys: visibleKeys,
    collapsedKeyOf: collapsedKeyOf,
    withDescendants: withDescendants,
    planDrop: planDrop,
    dropProblem: dropProblem,
    applyDrop: applyDrop,
    describeNotes: describeNotes
  };
});
