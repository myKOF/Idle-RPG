'use strict';
/* ============================================================
   gizmo-model.js — Preview 上直接變形的純資料運算

   為什麼要獨立成模組：拖曳變形真正容易錯的地方全在數學，而不是畫面——
   螢幕座標換到特效座標、旋轉之後的縮放要沿著圖層自己的軸、
   縮放係數要用「起點到滑鼠」的比值而不是絕對位置、以及重疊時誰在上面。
   這些在畫面上都「看起來差不多」，只有比對數值才驗得出來。
   editor.js 只負責畫框與收 pointer 事件。

   ---- 兩個必須分清楚的東西 ----

     base transform      layer.position / layer.scale / layer.rotation
     evaluated transform base ＋ over-life 曲線在當下時間的取樣值

   Gizmo 一律操作 **base**。播到 50% 時 scaleOverLife 是 1.5，
   若把畫面上看到的 1.5 倍寫回 base，放開滑鼠的瞬間就會再乘一次變成 2.25，
   而且每拖一次就複利一次。所以這個模組完全不碰曲線，也不讀當下時間。

   ---- 座標系 ----

   所有輸入輸出都在 **effect-local**（特效原點為 0,0）。
   螢幕座標的換算留在 editor.js，因為它需要 canvas 的實際尺寸。
   ============================================================ */

var VFXGizmoModel = (function () {

  /* 角度換算沿用 curve-model 的規則，不在這裡再寫一份 180/PI。
     兩種載入方式都試，因為同一個檔案要同時給瀏覽器與 Node 測試用。 */
  var CM = (function () {
    if (typeof VFXCurveModel !== 'undefined' && VFXCurveModel) return VFXCurveModel;
    if (typeof require === 'function') {
      try { return require('./curve-model.js'); } catch (e) { /* 瀏覽器端沒有 */ }
    }
    return null;
  })();

  /* 點狀發射器沒有面積，但還是要有東西可以點、可以拖。 */
  var MIN_BOX = 48;
  /* 縮放下限。允許縮到 0 的話框會塌成一條線，之後就再也抓不到把手。 */
  var MIN_SCALE = 0.01;

  var SNAP = { move: 10, rotateDeg: 15, scale: 0.1 };

  /* ---------------- 能力 ----------------

     只列「Runtime 真的會用到」的欄位。依據是 Core 的兩條更新路徑：

       updateSpriteLayer   t.scaleX = d.scale.x * … ，兩軸都吃 layer.scale
       updateParticleLayer t.scaleX = p.baseScale * … ，**完全不看 layer.scale**

     所以粒子層沒有縮放把手。硬做一個出來，拖了畫面不動，那比沒有更糟。
     粒子的大小是 startScale（每顆粒子出生時的取樣），不是圖層縮放。

     粒子的 rotation 是有效的，但語意要說清楚：它加在每顆粒子的自轉上
     （t.rotation = effect.rotation + d.rotation + p.rotation + …），
     轉的是每一張粒子圖，不是發射方向——發射方向是 direction。 */
  function capabilities(layer) {
    var isParticle = layer && layer.type === 'particle';
    return {
      move: true,
      scaleX: !isParticle,
      scaleY: !isParticle,
      rotate: true,
      /* 給 UI 顯示用的說明，讓「為什麼沒有縮放把手」有地方講 */
      note: isParticle
        ? '粒子層：拖曳移動的是發射器位置，旋轉轉的是每顆粒子的圖（發射方向請改 direction）。' +
          '粒子大小由 startScale 決定，不吃圖層縮放，所以沒有縮放把手。'
        : null
    };
  }

  /* ---------------- 基準框 ----------------

     只用 base transform 與素材尺寸算，不看曲線、不看粒子當下位置。
     這樣框才不會跟著動畫抖——盯著一個每幀跳動的框是沒辦法拖曳的。

     回傳的是**未旋轉**的框（rotation 另外給），因為旋轉是繞著 position 轉，
     把它留給畫面層與命中測試各自套用比較清楚。 */
  function baseBounds(layer, assetSize) {
    if (!layer) return null;
    var pos = layer.position || { x: 0, y: 0 };
    var scale = layer.scale || { x: 1, y: 1 };
    var w, h, ax, ay;

    if (layer.type === 'particle') {
      /* 發射區域，不是粒子群。用設定值而不是當下可見粒子的聯集，
         框才會穩定；粒子飛出去也不會讓框忽大忽小。 */
      var sp = layer.spawn || { shape: 'point' };
      if (sp.shape === 'circle') { w = h = (sp.radius || 0) * 2; }
      else if (sp.shape === 'box') { w = sp.width || 0; h = sp.height || 0; }
      else { w = h = 0; }
      w = Math.max(w, MIN_BOX); h = Math.max(h, MIN_BOX);
      ax = 0.5; ay = 0.5;                    // 兩種形狀都以 position 為中心
    } else if (layer.type === 'procedural') {
      var size = layer.size || { x: 256, y: 256 };
      w = size.x * scale.x; h = size.y * scale.y;
      var an = layer.anchor || { x: 0.5, y: 0.5 };
      ax = an.x; ay = an.y;
    } else {
      /* sprite：Pixi 是把整張貼圖用 scale 放大，所以顯示尺寸＝貼圖尺寸 × scale。
         素材尺寸取自 asset-index 的事實層，不必等貼圖載完也不必問 renderer。 */
      var tex = assetSize || { width: 256, height: 256 };
      w = tex.width * scale.x; h = tex.height * scale.y;
      var a2 = layer.anchor || { x: 0.5, y: 0.5 };
      ax = a2.x; ay = a2.y;
    }

    return {
      /* 左上角。anchor 決定 position 落在框的哪個位置 */
      x: pos.x - ax * w,
      y: pos.y - ay * h,
      w: w, h: h,
      pivot: { x: pos.x, y: pos.y },
      rotation: layer.rotation || 0
    };
  }

  /* ---------------- 把手 ----------------

     四角等比、四邊分軸、上方一個旋轉。全部先在未旋轉的框上算，
     再繞 pivot 轉 rotation——與 Pixi 對 sprite 的作法一致（繞 anchor 轉）。 */
  var CORNERS = [
    { id: 'nw', fx: 0, fy: 0 }, { id: 'ne', fx: 1, fy: 0 },
    { id: 'se', fx: 1, fy: 1 }, { id: 'sw', fx: 0, fy: 1 }
  ];
  var EDGES = [
    { id: 'w', fx: 0, fy: 0.5, axis: 'x' }, { id: 'e', fx: 1, fy: 0.5, axis: 'x' },
    { id: 'n', fx: 0.5, fy: 0, axis: 'y' }, { id: 's', fx: 0.5, fy: 1, axis: 'y' }
  ];
  var ROTATE_OFFSET = 28;                    // 旋轉把手離框上緣多遠（effect 單位）

  function rotateAround(pt, pivot, angle) {
    if (!angle) return { x: pt.x, y: pt.y };
    var c = Math.cos(angle), s = Math.sin(angle);
    var dx = pt.x - pivot.x, dy = pt.y - pivot.y;
    return { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c };
  }

  function handles(bounds, caps) {
    if (!bounds) return [];
    var out = [];
    function add(id, fx, fy, kind, axis) {
      var raw = { x: bounds.x + fx * bounds.w, y: bounds.y + fy * bounds.h };
      var p = rotateAround(raw, bounds.pivot, bounds.rotation);
      out.push({ id: id, kind: kind, axis: axis, x: p.x, y: p.y });
    }
    if (caps.scaleX && caps.scaleY) {
      CORNERS.forEach(function (c) { add(c.id, c.fx, c.fy, 'scale', 'both'); });
    }
    EDGES.forEach(function (e) {
      if (e.axis === 'x' && !caps.scaleX) return;
      if (e.axis === 'y' && !caps.scaleY) return;
      add(e.id, e.fx, e.fy, 'scale', e.axis);
    });
    if (caps.rotate) {
      var raw = { x: bounds.x + bounds.w / 2, y: bounds.y - ROTATE_OFFSET };
      var p = rotateAround(raw, bounds.pivot, bounds.rotation);
      out.push({ id: 'rotate', kind: 'rotate', x: p.x, y: p.y });
    }
    return out;
  }

  /* 命中把手。半徑由呼叫端給，因為它要換算成 effect 單位
     （螢幕上想要固定 8px，縮放之後的 effect 距離就不是 8）。 */
  function hitHandle(point, handleList, radius) {
    var best = null, bestD = radius * radius;
    handleList.forEach(function (h) {
      var dx = h.x - point.x, dy = h.y - point.y;
      var d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = h; }
    });
    return best;
  }

  /* 點是否落在（可能已旋轉的）框內。先把點轉回框的未旋轉座標再比，
     不需要多邊形測試。 */
  function insideBounds(point, bounds) {
    if (!bounds) return false;
    var p = rotateAround(point, bounds.pivot, -bounds.rotation);
    return p.x >= bounds.x && p.x <= bounds.x + bounds.w &&
      p.y >= bounds.y && p.y <= bounds.y + bounds.h;
  }

  /* ---------------- 命中圖層 ----------------

     VFX 幾乎都是層層疊疊，所以「點下去選到哪一個」必須有明確規則：
     照實際繪製順序，**最上面的優先**。後端是 sortableChildren + zIndex，
     zIndex 相同時由加入順序決定，也就是 preset.layers 的陣列順序。
     這裡用同一套規則排序，選取結果才會和眼睛看到的一致。 */
  function hitLayer(point, layers, boundsOf) {
    var candidates = [];
    layers.forEach(function (l, i) {
      if (l.enabled === false) return;
      var b = boundsOf(l);
      if (b && insideBounds(point, b)) {
        candidates.push({ layer: l, z: l.zIndex || 0, i: i });
      }
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      if (a.z !== b.z) return b.z - a.z;      // zIndex 高的在上
      return b.i - a.i;                       // 同 zIndex 時後加入的在上
    });
    return candidates[0].layer;
  }

  /* ---------------- 拖曳 ----------------

     全部是「起點 → 現在」的函式，不累積狀態：每次 pointermove 都從
     pointerdown 當下的快照重算。累加 delta 會讓浮點誤差隨移動次數累積，
     而且 Escape 取消時沒有乾淨的還原點。 */

  function snapTo(v, step) { return Math.round(v / step) * step; }

  /* 位置。回傳新的 {x,y}，不就地修改。 */
  function applyMove(startPos, startPoint, point, opts) {
    var o = opts || {};
    var x = startPos.x + (point.x - startPoint.x);
    var y = startPos.y + (point.y - startPoint.y);
    if (o.snap) { x = snapTo(x, SNAP.move); y = snapTo(y, SNAP.move); }
    return { x: round4(x), y: round4(y) };
  }

  /* 縮放。係數取「現在的局部座標 ÷ 起點的局部座標」，而不是絕對距離：
     這樣抓住哪一角就從哪一角長，方向也不會反。
     局部座標是把點轉回圖層自己的軸——圖層轉了 30 度時，
     拖右邊中點要沿著它自己的橫軸縮，不是沿著螢幕的橫軸。 */
  function applyScale(startScale, handle, pivot, rotation, startPoint, point, opts) {
    var o = opts || {};
    var a = toLocal(startPoint, pivot, rotation);
    var b = toLocal(point, pivot, rotation);
    var EPS = 1e-6;
    var fx = Math.abs(a.x) > EPS ? b.x / a.x : 1;
    var fy = Math.abs(a.y) > EPS ? b.y / a.y : 1;

    var sx = startScale.x, sy = startScale.y;
    if (handle.axis === 'x') { sx = startScale.x * fx; }
    else if (handle.axis === 'y') { sy = startScale.y * fy; }
    else {
      /* 四角＝等比。兩軸的比值取平均，斜著拖才不會忽大忽小。 */
      var f = (fx + fy) / 2;
      sx = startScale.x * f; sy = startScale.y * f;
    }
    if (o.snap) { sx = snapTo(sx, SNAP.scale); sy = snapTo(sy, SNAP.scale); }
    return { x: round4(clampScale(sx)), y: round4(clampScale(sy)) };
  }

  function clampScale(v) {
    if (!isFinite(v)) return MIN_SCALE;
    return Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v;
  }

  /* 旋轉。角度由 pivot → 滑鼠算，取「現在 − 起點」的差再加回起始角度。
     回傳弧度（schema 的單位）；度數換算由 curve-model 的 helper 負責，
     這裡不再寫第二份。 */
  function applyRotate(startRotation, pivot, startPoint, point, opts) {
    var o = opts || {};
    var a0 = Math.atan2(startPoint.y - pivot.y, startPoint.x - pivot.x);
    var a1 = Math.atan2(point.y - pivot.y, point.x - pivot.x);
    var r = startRotation + (a1 - a0);
    if (o.snap) {
      var step = SNAP.rotateDeg * Math.PI / 180;
      r = snapTo(r, step);
    }
    return round6(r);
  }

  function toLocal(point, pivot, rotation) {
    var c = Math.cos(-rotation), s = Math.sin(-rotation);
    var dx = point.x - pivot.x, dy = point.y - pivot.y;
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  /* 拖曳算出來的 0.30000000000000004 不該進 preset：同樣的操作要得到同樣的 bytes */
  function round4(v) { return Math.round(v * 10000) / 10000; }
  function round6(v) { return Math.round(v * 1000000) / 1000000; }

  /* ---------------- 快照 ----------------
     pointerdown 當下記起來，Escape 就是把它寫回去。
     只存這三個欄位，不整份深拷貝——拖曳期間本來就只有它們會變。 */
  function snapshot(layer) {
    return {
      position: layer.position ? { x: layer.position.x, y: layer.position.y } : undefined,
      scale: layer.scale ? { x: layer.scale.x, y: layer.scale.y } : undefined,
      rotation: layer.rotation
    };
  }

  function restore(layer, snap) {
    if (snap.position === undefined) delete layer.position;
    else layer.position = { x: snap.position.x, y: snap.position.y };
    if (snap.scale === undefined) delete layer.scale;
    else layer.scale = { x: snap.scale.x, y: snap.scale.y };
    if (snap.rotation === undefined) delete layer.rotation;
    else layer.rotation = snap.rotation;
  }


  /* ============================================================
     群組變形

     群組是 **authoring 上的父物件**，但 preset 裡沒有父子結構——
     `preset.layers[]` 是一張平的表，Runtime 只認得它。
     群組存在 `vfx/layouts/<id>.json`，那是 editor-only 而且不具權威性的檔案：
     Runtime 不讀它、shipped assets 不帶它、它壞掉時會自癒成一層平的清單。

     所以群組變形**不能只存在群組上**。存在那裡的話，遊戲裡跑出來的畫面
     會和編輯器看到的不一樣——那是最難查的一種 bug。

     作法：把變形量當場攤到每個子圖層的 base transform 上。
     使用者得到的行為和真的父子繼承一樣（縮放父物件＝子物件等比縮放，
     而且是繞著群組中心），但存出去仍然是一張平的表，
     Runtime 與 Editor 看到的完全是同一份東西。

     ---- 什麼叫「等比縮放整個群組」----

     不是只把每個子圖層的 scale 乘一乘。凡是「長度」語意的欄位都要跟著縮，
     否則縮小群組之後粒子仍用原本的速度飛出去，看起來就不是同一個特效變小了：

       所有型別   position 相對群組中心的偏移
       sprite     scale
       procedural scale
       particle   startScale（粒子大小）、spawn 的 radius/width/height（發射區域）、
                  speed（飛行距離）、gravity（加速度也是長度／時間平方）

     lifetime 不縮——時間不是長度。

     ---- 旋轉 ----

       所有型別   position 繞群組中心旋轉、rotation 累加
       particle   direction（發射方向，單位是度）與 gravity 向量也要轉，
                  否則轉了群組之後粒子會往錯的方向飛
     ============================================================ */

  /* 群組的框＝所有子圖層基準框的聯集。pivot 取框的中心，
     這樣縮放與旋轉都以視覺重心為準，符合直覺。 */
  function groupBounds(layers, sizeOf) {
    var pts = [];
    layers.forEach(function (l) {
      var b = baseBounds(l, sizeOf(l));
      if (!b) return;
      /* 子圖層自己可能已經轉過，取它四角轉完之後的軸對齊外框 */
      [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }]
        .forEach(function (p) { pts.push(rotateAround(p, b.pivot, b.rotation)); });
    });
    if (!pts.length) return null;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(function (p) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });
    var w = round4(Math.max(maxX - minX, MIN_BOX));
    var h = round4(Math.max(maxY - minY, MIN_BOX));
    /* 收掉浮點噪音：兩個對稱的子圖層算出來的中心會是 1.42e-14 而不是 0，
       那個誤差會一路傳進每個子圖層的新位置。 */
    var cx = round4((minX + maxX) / 2), cy = round4((minY + maxY) / 2);
    return {
      x: round4(cx - w / 2), y: round4(cy - h / 2), w: w, h: h,
      pivot: { x: cx, y: cy },
      /* 群組框永遠是軸對齊的：子圖層各有各的角度，硬給群組一個角度
         只會讓框和內容對不上。旋轉照樣可以做，框在放開滑鼠後重算。 */
      rotation: 0
    };
  }

  /* 群組能力：有子圖層就四種都支援。縮放對粒子子層一樣有意義——
     它縮的是發射區域、粒子大小與飛行速度，那是真的會改變畫面的。 */
  function groupCapabilities(layers) {
    var any = layers.length > 0;
    return { move: any, scaleX: any, scaleY: any, rotate: any, note: null };
  }

  /* 把一次群組變形攤到子圖層上。回傳每個子圖層要覆寫的欄位（不就地修改）。

       delta.dx, delta.dy   平移
       delta.sx, delta.sy   縮放倍率（1 = 不變）
       delta.rot            旋轉弧度（0 = 不變）

     一律從「拖曳開始時的快照」算起，不累加：連續拖曳每次都重算，
     浮點誤差不會越滾越大，Escape 也有乾淨的還原點。 */
  function applyGroupTransform(snapshots, pivot, delta) {
    var dx = delta.dx || 0, dy = delta.dy || 0;
    var sx = delta.sx === undefined ? 1 : delta.sx;
    var sy = delta.sy === undefined ? 1 : delta.sy;
    var rot = delta.rot || 0;
    var cos = Math.cos(rot), sin = Math.sin(rot);

    return snapshots.map(function (snap) {
      var out = { id: snap.id };
      /* 位置：先相對 pivot 縮放，再旋轉，最後平移。
         順序不能換——先旋轉再縮放會在非等比時把圖形拉歪。 */
      var p = snap.position || { x: 0, y: 0 };
      var ox = (p.x - pivot.x) * sx, oy = (p.y - pivot.y) * sy;
      out.position = {
        x: round4(pivot.x + ox * cos - oy * sin + dx),
        y: round4(pivot.y + ox * sin + oy * cos + dy)
      };

      if (rot) out.rotation = round6((snap.rotation || 0) + rot);

      if (snap.type === 'particle') {
        /* 粒子不吃 layer.scale，要縮的是這幾個長度欄位 */
        if (sx !== 1 || sy !== 1) {
          var f = (Math.abs(sx) + Math.abs(sy)) / 2;   // 粒子是等比的，取兩軸平均
          if (snap.startScale !== undefined) out.startScale = scaleRange(snap.startScale, f);
          if (snap.speed !== undefined) out.speed = scaleRange(snap.speed, f);
          if (snap.spawn) {
            var sp = { shape: snap.spawn.shape };
            if (snap.spawn.radius !== undefined) sp.radius = round4(snap.spawn.radius * f);
            if (snap.spawn.width !== undefined) sp.width = round4(snap.spawn.width * f);
            if (snap.spawn.height !== undefined) sp.height = round4(snap.spawn.height * f);
            out.spawn = sp;
          }
        }
        if (snap.gravity && (rot || sx !== 1 || sy !== 1)) {
          var gx = snap.gravity.x * sx, gy = snap.gravity.y * sy;
          out.gravity = {
            x: round4(gx * cos - gy * sin),
            y: round4(gx * sin + gy * cos)
          };
        }
        /* direction 的單位是度（Core 的 spawnParticle 自己乘 PI/180），
           所以這裡也用度加減，不做弧度換算。 */
        if (rot && snap.direction !== undefined) {
          out.direction = round4(snap.direction + CM.radToDeg(rot));
        }
      } else if (sx !== 1 || sy !== 1) {
        var s0 = snap.scale || { x: 1, y: 1 };
        out.scale = { x: round4(clampScale(s0.x * sx)), y: round4(clampScale(s0.y * sy)) };
      }
      return out;
    });
  }

  /* speed 與 startScale 可能是數字或 [min,max]（Core 的 sampleRange） */
  function scaleRange(v, f) {
    if (Array.isArray(v)) return v.map(function (x) { return round4(x * f); });
    return round4(v * f);
  }

  var GROUP_FIELDS = ['position', 'scale', 'rotation', 'startScale', 'speed',
    'direction', 'spawn', 'gravity'];

  /* 群組拖曳的快照。比單層多存幾個欄位，因為縮放與旋轉會動到它們。 */
  function groupSnapshot(layers) {
    return layers.map(function (l) {
      var o = { id: l.id, type: l.type };
      GROUP_FIELDS.forEach(function (k) {
        o[k] = (l[k] && typeof l[k] === 'object') ? JSON.parse(JSON.stringify(l[k])) : l[k];
      });
      if (!o.position) o.position = { x: 0, y: 0 };
      return o;
    });
  }

  /* 把 applyGroupTransform 的結果寫回圖層 */
  function writeGroupTransform(layers, patches) {
    var byId = {};
    patches.forEach(function (pch) { byId[pch.id] = pch; });
    layers.forEach(function (l) {
      var pch = byId[l.id];
      if (!pch) return;
      Object.keys(pch).forEach(function (k) {
        if (k === 'id') return;
        l[k] = pch[k];
      });
    });
  }

  /* Escape：把快照原樣寫回去。undefined 的欄位要 delete 而不是寫 undefined，
     否則 canonical 序列化與未知欄位檢查會看到不同的東西。 */
  function restoreGroup(layers, snapshots) {
    var byId = {};
    snapshots.forEach(function (s) { byId[s.id] = s; });
    layers.forEach(function (l) {
      var s = byId[l.id];
      if (!s) return;
      GROUP_FIELDS.forEach(function (k) {
        if (s[k] === undefined) delete l[k];
        else l[k] = (s[k] && typeof s[k] === 'object') ? JSON.parse(JSON.stringify(s[k])) : s[k];
      });
    });
  }

  return {
    MIN_BOX: MIN_BOX, MIN_SCALE: MIN_SCALE, SNAP: SNAP, ROTATE_OFFSET: ROTATE_OFFSET,
    capabilities: capabilities,
    baseBounds: baseBounds,
    handles: handles, hitHandle: hitHandle,
    insideBounds: insideBounds, hitLayer: hitLayer,
    rotateAround: rotateAround, toLocal: toLocal,
    applyMove: applyMove, applyScale: applyScale, applyRotate: applyRotate,
    snapshot: snapshot, restore: restore,
    groupBounds: groupBounds, groupCapabilities: groupCapabilities,
    applyGroupTransform: applyGroupTransform, writeGroupTransform: writeGroupTransform,
    groupSnapshot: groupSnapshot, restoreGroup: restoreGroup
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXGizmoModel;
}
