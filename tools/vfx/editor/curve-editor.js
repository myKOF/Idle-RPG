'use strict';
/* ============================================================
   curve-editor.js — 泛用的 2D 曲線編輯元件

   它不知道自己在編什麼屬性。所有跟屬性有關的事（值的上下限、單位、
   顯示換算、預設值）都由呼叫端用 policy 注入，所以同一份程式碼可以編
   透明度、縮放、旋轉，之後粒子的任何數值曲線也能直接拿去用。

   一行資料運算都不做，全部委派給 curve-model.js——
   排序、夾限、單位換算那些是用眼睛看不出對錯的，必須留在可測試的純函式裡。

   繪製用 Canvas 而不是 SVG：一條曲線最多 16 個點，
   但拖曳時每幀重畫，Canvas 沒有 DOM 節點的建立與樣式計算成本。
   ============================================================ */

var VFXCurveEditor = (function () {
  var M = VFXCurveModel;

  var PAD = { l: 34, r: 8, t: 8, b: 16 };      // 給刻度文字留的邊
  var HIT_RADIUS = 7;                          // 點擊判定半徑（像素）

  /* 建立一個曲線編輯器。

       opts.curve      目前的曲線（undefined／number／[[t,v],…]）
       opts.policy     見 curve-model 的 policyDefaults
       opts.onChange   fn(curve)，值已是可直接寫進 preset 的 canonical 形式
       opts.onBegin    fn(what)，一次操作開始時呼叫一次（拖曳按下、按刪除鍵）。
                       呼叫端用它開啟一筆歷史交易；中間的 onLive 不進歷史。
       opts.onLive     fn()，拖曳過程中每次變動都會呼叫（可省略）
       opts.height     畫布高度，預設 120

     回傳 { el, setCurve, destroy, hasFocus }。 */
  function create(opts) {
    var policy = M.policyDefaults(opts.policy);
    var points = M.toPoints(opts.curve);
    var selected = -1;
    var dragging = false;
    var hover = -1;
    /* 對照模式的共用時間游標：由容器廣播同一個 t 給每張圖，
       這樣一眼就能讀出「生命週期 42% 時，透明度多少、縮放多少、轉了幾度」。
       null 代表沒有游標。 */
    var cursorT = null;

    var el = document.createElement('div');
    el.className = 'curve';
    el.tabIndex = 0;                           // 要能拿到焦點，Delete 才知道該刪誰

    var canvas = document.createElement('canvas');
    canvas.className = 'curve-canvas';
    var readout = document.createElement('div');
    readout.className = 'curve-readout';
    el.appendChild(canvas);
    el.appendChild(readout);

    var height = opts.height || 120;
    var ctx = canvas.getContext('2d');

    /* ---------------- 座標換算 ---------------- */
    /* 用 clientHeight 而不是設定值：canvas 有 1px 邊框且是 border-box，
       backing store 若照設定值配置，畫出來的東西會比可視區高 2px 而被壓扁。 */
    function boxHeight() { return canvas.clientHeight || height; }
    function plotBox() {
      return {
        x: PAD.l, y: PAD.t,
        w: Math.max(1, canvas.clientWidth - PAD.l - PAD.r),
        h: Math.max(1, boxHeight() - PAD.t - PAD.b)
      };
    }
    function range() { return M.valueRange(points, policy); }

    function toPx(t, v) {
      var b = plotBox(), r = range();
      return {
        x: b.x + t * b.w,
        y: b.y + b.h - ((v - r.lo) / (r.hi - r.lo)) * b.h
      };
    }
    function fromPx(px, py) {
      var b = plotBox(), r = range();
      return {
        t: (px - b.x) / b.w,
        v: r.lo + ((b.y + b.h - py) / b.h) * (r.hi - r.lo)
      };
    }

    /* ---------------- 繪製 ---------------- */
    function draw() {
      var dpr = window.devicePixelRatio || 1;
      canvas.style.height = height + 'px';
      var cssW = canvas.clientWidth || 200;
      var cssH = boxHeight();
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      var b = plotBox(), r = range();

      ctx.fillStyle = '#15151a';
      ctx.fillRect(b.x, b.y, b.w, b.h);

      /* 直向格線＝生命週期 0/25/50/75/100% */
      ctx.strokeStyle = '#26262e';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#6a6a78';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      for (var i = 0; i <= 4; i++) {
        var x = Math.round(b.x + (i / 4) * b.w) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, b.y); ctx.lineTo(x, b.y + b.h); ctx.stroke();
        ctx.fillText((i * 25) + '%', x, cssH - 4);
      }

      /* 橫向格線＝值刻度。挑一個「好看的」間距，不要出現 0.3333 這種刻度 */
      var step = niceStep(r.hi - r.lo);
      ctx.textAlign = 'right';
      for (var v = Math.ceil(r.lo / step) * step; v <= r.hi + 1e-9; v += step) {
        var y = Math.round(toPx(0, v).y) + 0.5;
        if (y < b.y - 1 || y > b.y + b.h + 1) continue;
        ctx.strokeStyle = Math.abs(v) < 1e-9 ? '#3a3a46' : '#22222a';
        ctx.beginPath(); ctx.moveTo(b.x, y); ctx.lineTo(b.x + b.w, y); ctx.stroke();
        ctx.fillStyle = '#6a6a78';
        ctx.fillText(M.formatValue(v, policy), b.x - 4, y + 3);
      }

      if (!points || !points.length) {
        ctx.fillStyle = '#55555f';
        ctx.textAlign = 'center';
        ctx.fillText('沒有曲線（點一下新增）', b.x + b.w / 2, b.y + b.h / 2);
        return;
      }

      /* 曲線本體。第一點之前與最後一點之後是水平延伸——
         那不是畫面上的裝飾，而是 Core sampleCurve 的實際行為（超出範圍取端點值），
         畫出來才不會讓人以為端點一定要落在 0 與 1。 */
      ctx.strokeStyle = '#7fb2ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      var first = toPx(0, points[0][1]);
      ctx.moveTo(b.x, first.y);
      points.forEach(function (p) {
        var q = toPx(p[0], p[1]);
        ctx.lineTo(q.x, q.y);
      });
      var lastP = points[points.length - 1];
      ctx.lineTo(b.x + b.w, toPx(1, lastP[1]).y);
      ctx.stroke();

      /* 共用時間游標畫在曲線底下、控制點上面：它是輔助線，不該蓋住要拖的點 */
      if (cursorT !== null) {
        var cx = Math.round(toPx(cursorT, 0).x) + 0.5;
        ctx.strokeStyle = '#ffb454';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, b.y); ctx.lineTo(cx, b.y + b.h); ctx.stroke();
        var cv = M.valueAt(points, cursorT);
        if (cv !== null) {
          var cy = toPx(cursorT, cv).y;
          ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#ffb454'; ctx.fill();
        }
      }

      points.forEach(function (p, i) {
        var q = toPx(p[0], p[1]);
        ctx.beginPath();
        ctx.arc(q.x, q.y, i === selected ? 5 : (i === hover ? 4.5 : 3.5), 0, Math.PI * 2);
        ctx.fillStyle = i === selected ? '#ffffff' : '#7fb2ff';
        ctx.fill();
        if (i === selected) {
          ctx.strokeStyle = '#7fb2ff'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      });
    }

    /* 1／2／2.5／5 × 10^n 裡挑一個，讓刻度落在 4~8 條之間 */
    function niceStep(span) {
      var raw = span / 5;
      var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
      var norm = raw / mag;
      var mult = norm < 1.5 ? 1 : (norm < 3 ? 2 : (norm < 7 ? 5 : 10));
      return mult * mag;
    }

    /* ---------------- 命中測試 ---------------- */
    function hitTest(px, py) {
      if (!points) return -1;
      for (var i = 0; i < points.length; i++) {
        var q = toPx(points[i][0], points[i][1]);
        if (Math.abs(q.x - px) <= HIT_RADIUS && Math.abs(q.y - py) <= HIT_RADIUS) return i;
      }
      return -1;
    }
    function localPos(e) {
      var box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    }

    /* ---------------- 變更回報 ----------------
       commit：寫回 preset（會讓檔案變 dirty）
       live  ：拖曳中途，讓預覽跟著動 */
    function commit() {
      if (opts.onChange) opts.onChange(M.toCurve(points));
    }
    function live() {
      if (opts.onLive) opts.onLive(M.toCurve(points));
    }

    function updateReadout() {
      /* 固定範圍的屬性可能載到界外的舊值。不自動改寫檔案，但要講出來——
         畫面上看不到的點，使用者只會覺得「這條曲線怎麼怪怪的」。 */
      var out = M.outOfRangeCount(points, policy);
      if (out) {
        readout.textContent = '有 ' + out + ' 個點超出上下限，拖動它就會落回範圍內';
        readout.classList.add('warn');
        readout.classList.remove('cursor');
        return;
      }
      readout.classList.remove('warn');
      /* 游標優先：對照模式下，使用者想看的是「這個時間點各屬性各是多少」，
         不是「我剛剛選了哪個控制點」。 */
      if (cursorT !== null && points && points.length) {
        var cv = M.valueAt(points, cursorT);
        readout.textContent = M.formatTime(cursorT) + '　' + M.formatValue(cv, policy);
        readout.classList.add('cursor');
        return;
      }
      readout.classList.remove('cursor');
      if (selected < 0 || !points || !points[selected]) { readout.textContent = ''; return; }
      var p = points[selected];
      readout.textContent = 'Time ' + M.formatTime(p[0]) + '　Value ' + M.formatValue(p[1], policy);
    }

    /* ---------------- 滑鼠 ---------------- */
    canvas.addEventListener('mousedown', function (e) {
      /* 先換算座標再取得焦點，而且取得焦點時不准捲動。
         focus() 預設會把元素捲進可視範圍，Inspector 是可捲動的窄面板，
         點一張露出一半的圖就會讓它跳位；localPos 用的是**當下**的
         getBoundingClientRect，捲完之後再換算，落點就完全跑掉了
         （實測點在垂直中央卻得到 -101.8°，正確值是 -0.5°）。 */
      var pos = localPos(e);
      el.focus({ preventScroll: true });
      var at = hitTest(pos.x, pos.y);
      /* 一次拖曳（含「點空白處新增再拖到位」）算一筆歷史，
         中間的每一次 onLive 都不記錄。 */
      if (opts.onBegin) opts.onBegin(at < 0 ? '新增控制點於 ' : '調整 ');
      if (at < 0) {
        /* 空白處按下＝新增一個點，而且直接進入拖曳：
           「點一下再拖到位」比「點一下、放開、再按住拖」少一次操作。 */
        var c = fromPx(pos.x, pos.y);
        var r = M.addPoint(points || [], c.t, c.v, policy);
        if (r.index < 0) { flashLimit(); return; }
        points = r.points; selected = r.index;
      } else {
        selected = at;
      }
      dragging = true;
      updateReadout(); draw();
      e.preventDefault();
    });

    function onMove(e) {
      var pos = localPos(e);
      var inside = pos.x >= 0 && pos.x <= canvas.clientWidth &&
        pos.y >= 0 && pos.y <= canvas.clientHeight;
      if (!dragging) {
        /* 只有滑鼠真的在自己這張圖上時才廣播。
           每個編輯器都掛在 window 上聽 mousemove，若不在自己身上時也廣播 null，
           五張圖就會互相把對方剛設好的游標清掉——最後一個跑完的說了算。 */
        if (inside && opts.onCursor) opts.onCursor(M.clampTime(fromPx(pos.x, pos.y).t));
        var h = inside ? hitTest(pos.x, pos.y) : -1;
        if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? 'grab' : 'crosshair'; draw(); }
        return;
      }
      if (opts.onCursor) opts.onCursor(M.clampTime(fromPx(pos.x, pos.y).t));
      var c = fromPx(pos.x, pos.y);
      var r = M.movePoint(points, selected, c.t, c.v, policy);
      points = r.points; selected = r.index;
      updateReadout();
      draw();
      live();                                  // 每次移動就更新預覽，不等放開滑鼠
    }

    /* 清掉游標由「滑出去的那一張」負責。用 mouseleave 而不是在 mousemove 裡判斷，
       是因為滑鼠從一張圖直接移到另一張時，事件順序不保證，靠判斷會閃爍。 */
    canvas.addEventListener('mouseleave', function () {
      if (dragging) return;                    // 拖曳中滑出邊界仍要保留游標
      if (opts.onCursor) opts.onCursor(null);
    });

    function onUp() {
      if (!dragging) return;
      dragging = false;
      commit();                                // 放開才算一次正式修改
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    /* ---------------- 鍵盤 ----------------
       只處理「焦點真的在這個曲線元件裡」的情況，而且吃掉事件，
       這樣 Layer 面板那邊的 Delete 就不會同時被觸發。
       兩邊的優先順序由這個 stopPropagation 決定，不是靠誰先註冊。 */
    el.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'Delete' && k !== 'Backspace') return;
      e.stopPropagation();                     // 不讓 document 上的刪圖層 handler 收到
      if (selected < 0 || !points) { e.preventDefault(); return; }
      if (opts.onBegin) opts.onBegin('刪除控制點於 ');
      var r = M.removePoint(points, selected);
      points = r.points; selected = r.index;
      if (!points.length) points = null;
      updateReadout(); draw(); commit();
      e.preventDefault();
    });

    function flashLimit() {
      readout.textContent = '已達曲線點數上限（' + policy.maxPoints + '）';
      readout.classList.add('warn');
      setTimeout(function () { readout.classList.remove('warn'); updateReadout(); }, 1500);
    }

    /* 面板寬度會變（視窗縮放、Inspector 欄寬），Canvas 要跟著重畫。
       ResizeObserver 在某些嵌入式瀏覽器裡不會觸發（實測過），
       所以另外掛一個 window resize 當後援，兩條路都通往同一個 draw()。 */
    var ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(function () { draw(); });
      ro.observe(el);
    }
    window.addEventListener('resize', draw);

    /* 首次繪製要等元素進 DOM 才量得到寬度。呼叫端在整個 Inspector 組完之後
       還會再要求一次重繪——rAF 這一發有可能落在版面定案之前。 */
    updateReadout();               // 界外提示要一載入就看得到，不必先去點它
    requestAnimationFrame(draw);

    return {
      el: el,
      redraw: draw,
      setCurve: function (curve) {
        points = M.toPoints(curve);
        selected = -1;
        updateReadout(); draw();
      },
      getCurve: function () { return M.toCurve(points); },
      reset: function () {
        points = M.resetPoints(policy);
        selected = 0;
        updateReadout(); draw(); commit();
      },
      clear: function () {
        points = null; selected = -1;
        updateReadout(); draw(); commit();
      },
      hasFocus: function () { return el.contains(document.activeElement); },
      /* 由容器呼叫，把共用游標同步到這張圖上 */
      setCursor: function (t) {
        if (cursorT === t) return;
        cursorT = t;
        updateReadout(); draw();
      },
      destroy: function () {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('resize', draw);
        if (ro) ro.disconnect();
      }
    };
  }

  return { create: create, PAD: PAD, HIT_RADIUS: HIT_RADIUS };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXCurveEditor;
}
