'use strict';
/* ============================================================
   gradient-editor.js — 顏色曲線（tintOverLife）的編輯元件

   介面刻意與 curve-editor.js 對齊（create / el / reset / clear / hasFocus /
   setCursor / destroy、onBegin-onLive-onChange 三段式回呼），因為 editor.js 的
   OVER-LIFE 區塊是用同一套外框在排這些格子——歷史（undo）、對照模式的共用時間
   游標、Reset／停用按鈕全部沿用，不必為顏色另外開一條路。

   與數值曲線的差別只有兩點，其餘都一樣：
     ・沒有 Y 軸。時間是唯一的自由度，顏色由色票決定，所以是一條色帶＋色標。
     ・顏色不能用拖的。點選色標之後用 <input type="color"> 改——
       在一條 20px 高的色帶上拖出想要的顏色是不可能的事。

   一行資料運算都不做，全部委派 gradient-model.js。
   ============================================================ */

var VFXGradientEditor = (function () {
  var M = VFXGradientModel;

  var BAR_H = 22;                              // 色帶高度
  var STOP_H = 12;                             // 色標區高度（色帶下方）
  var HIT_RADIUS = 7;
  var MAX_STOPS = 16;                          // 與 Core 的 HARD_LIMITS.maxCurvePoints 一致

  /* opts：
       curve     目前的值（undefined／'#rrggbb'／[[t,'#rrggbb'],…]）
       onBegin   fn(what)   一次操作開始（開歷史交易）
       onLive    fn(value)  拖曳途中（只更新預覽）
       onChange  fn(value)  收尾（寫回 preset）
       onCursor  fn(t|null) 對照模式的共用時間游標
     回傳 { el, reset, clear, hasFocus, setCursor, destroy } */
  function create(opts) {
    var stops = M.toStops(opts.curve);
    var selected = stops && stops.length ? 0 : -1;
    var dragging = false;
    var hover = -1;
    var cursorT = null;

    var el = document.createElement('div');
    el.className = 'curve gradient';
    el.tabIndex = 0;

    var canvas = document.createElement('canvas');
    canvas.className = 'curve-canvas gradient-canvas';
    var bottom = document.createElement('div');
    bottom.className = 'gradient-bottom';
    var swatch = document.createElement('input');
    swatch.type = 'color';
    swatch.className = 'gradient-swatch';
    swatch.title = '選取色標的顏色';
    var readout = document.createElement('div');
    readout.className = 'curve-readout';
    bottom.appendChild(swatch);
    bottom.appendChild(readout);
    el.appendChild(canvas);
    el.appendChild(bottom);

    var ctx = canvas.getContext('2d');
    var height = BAR_H + STOP_H;

    /* ---------------- 座標換算 ----------------
       用 clientWidth 而不是設定值：canvas 是 border-box 且有 1px 邊框，
       backing store 照設定值配置會讓畫出來的東西橫向偏移一格。 */
    function innerW() { return Math.max(1, canvas.clientWidth - 2); }
    function toPx(t) { return 1 + t * innerW(); }
    function fromPx(x) { return M.clampTime((x - 1) / innerW()); }

    function localPos(e) {
      var box = canvas.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    }

    /* ---------------- 繪製 ---------------- */
    function draw() {
      var w = canvas.clientWidth || 1;
      var dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, height);

      if (!stops || !stops.length) {
        ctx.fillStyle = '#1a1a20';
        ctx.fillRect(0, 0, w, BAR_H);
        ctx.fillStyle = '#55555f';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('沒有顏色曲線（整段生命維持 tint）', w / 2, BAR_H / 2 + 3);
        ctx.textAlign = 'left';
        return;
      }

      /* 色帶逐像素畫，不用 CanvasGradient：內插必須與 gradient-model.lerp
         逐位元一致（含 |0 截斷），交給瀏覽器的漸層就會是它自己的插值。
         一條色帶最多幾百像素，成本可以忽略。 */
      var bw = innerW();
      for (var px = 0; px < bw; px++) {
        ctx.fillStyle = M.colorAt(stops, px / Math.max(1, bw - 1));
        ctx.fillRect(1 + px, 1, 1, BAR_H - 2);
      }
      ctx.strokeStyle = '#2c2c34';
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, w - 1, BAR_H - 1);

      /* 共用時間游標：畫在色帶上，對照模式下要能一眼讀出同一時刻各屬性的值 */
      if (cursorT !== null) {
        var cx = Math.round(toPx(cursorT)) + 0.5;
        ctx.strokeStyle = '#ffb454';
        ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, BAR_H); ctx.stroke();
      }

      stops.forEach(function (p, i) {
        var x = toPx(p[0]);
        var cy = BAR_H + STOP_H / 2;
        /* 色標畫成「上尖下圓」：尖端指著它在色帶上的位置，圓身填自己的顏色，
           這樣不必點開就看得出每個色標是什麼色。 */
        ctx.beginPath();
        ctx.moveTo(x, BAR_H);
        ctx.lineTo(x - 4, BAR_H + 4);
        ctx.lineTo(x + 4, BAR_H + 4);
        ctx.closePath();
        ctx.fillStyle = i === selected ? '#ffffff' : '#8a8a96';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, cy + 1, i === selected ? 5 : (i === hover ? 4.5 : 3.5), 0, Math.PI * 2);
        ctx.fillStyle = p[1];
        ctx.fill();
        ctx.strokeStyle = i === selected ? '#ffffff' : '#3a3a44';
        ctx.lineWidth = i === selected ? 1.5 : 1;
        ctx.stroke();
      });
    }

    function hitTest(px, py) {
      if (!stops) return -1;
      if (py < BAR_H - 4) return -1;           // 色帶上半部留給「新增色標」
      for (var i = 0; i < stops.length; i++) {
        if (Math.abs(toPx(stops[i][0]) - px) <= HIT_RADIUS) return i;
      }
      return -1;
    }

    /* ---------------- 回報 ---------------- */
    function commit() { if (opts.onChange) opts.onChange(M.toValue(stops)); }
    function live() { if (opts.onLive) opts.onLive(M.toValue(stops)); }

    function updateReadout() {
      if (!stops || !stops.length) {
        readout.textContent = '';
        swatch.disabled = true;
        swatch.value = '#ffffff';
        return;
      }
      swatch.disabled = selected < 0;
      if (cursorT !== null) {
        var c = M.colorAt(stops, cursorT);
        readout.textContent = M.formatTime(cursorT) + '　' + c;
        readout.classList.add('cursor');
        if (selected >= 0) swatch.value = stops[selected][1];
        return;
      }
      readout.classList.remove('cursor');
      if (selected < 0 || !stops[selected]) { readout.textContent = ''; return; }
      var p = stops[selected];
      swatch.value = p[1];
      readout.textContent = 'Time ' + M.formatTime(p[0]) + '　' + p[1];
    }

    function flashLimit() {
      readout.textContent = '已達色標數上限（' + MAX_STOPS + '）';
      readout.classList.add('warn');
    }

    /* ---------------- 滑鼠 ---------------- */
    canvas.addEventListener('mousedown', function (e) {
      /* 先換算座標再取焦點，而且不准捲動——理由與 curve-editor 同一條：
         focus() 會把元素捲進可視範圍，捲完再換算就落點全跑掉。 */
      var pos = localPos(e);
      el.focus({ preventScroll: true });
      if (!stops) { e.preventDefault(); return; }
      var at = hitTest(pos.x, pos.y);
      if (opts.onBegin) opts.onBegin(at < 0 ? '新增色標於 ' : '調整 ');
      if (at < 0) {
        if (stops.length >= MAX_STOPS) { flashLimit(); e.preventDefault(); return; }
        /* 在空白處按下＝在該時間點新增一個色標，顏色取當下的漸層值，
           所以新增的瞬間畫面完全不變，接著才由使用者調它。 */
        var t = fromPx(pos.x);
        var r = M.addStop(stops, t, M.colorAt(stops, t));
        stops = r.stops; selected = r.index;
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
        if (inside && opts.onCursor) opts.onCursor(fromPx(pos.x));
        var h = inside ? hitTest(pos.x, pos.y) : -1;
        if (h !== hover) { hover = h; canvas.style.cursor = h >= 0 ? 'grab' : 'crosshair'; draw(); }
        return;
      }
      if (opts.onCursor) opts.onCursor(fromPx(pos.x));
      var r = M.moveStop(stops, selected, fromPx(pos.x));
      stops = r.stops; selected = r.index;
      updateReadout(); draw(); live();
    }

    canvas.addEventListener('mouseleave', function () {
      if (dragging) return;
      if (opts.onCursor) opts.onCursor(null);
    });

    function onUp() {
      if (!dragging) return;
      dragging = false;
      commit();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    /* ---------------- 色票 ----------------
       input 的 'input' 事件在調色盤裡拖曳時連續觸發，'change' 才是收尾。
       兩者分別對應 live 與 commit，與拖曳色標同一個節奏。 */
    swatch.addEventListener('input', function () {
      if (selected < 0 || !stops) return;
      stops = M.setColor(stops, selected, swatch.value);
      updateReadout(); draw(); live();
    });
    swatch.addEventListener('change', function () {
      if (selected < 0 || !stops) return;
      if (opts.onBegin) opts.onBegin('改色 ');
      stops = M.setColor(stops, selected, swatch.value);
      updateReadout(); draw(); commit();
    });

    /* ---------------- 鍵盤 ----------------
       吃掉事件，否則 Layer 面板的 Delete（刪圖層）會同時被觸發。 */
    el.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k !== 'Delete' && k !== 'Backspace') return;
      e.stopPropagation();
      if (selected < 0 || !stops) { e.preventDefault(); return; }
      if (stops.length <= 1) {
        readout.textContent = '至少要有一個色標；要整條移除請按「停用」';
        readout.classList.add('warn');
        e.preventDefault();
        return;
      }
      if (opts.onBegin) opts.onBegin('刪除色標於 ');
      var r = M.removeStop(stops, selected);
      stops = r.stops; selected = r.index;
      updateReadout(); draw(); commit();
      e.preventDefault();
    });

    window.addEventListener('resize', draw);
    var ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(draw);
      ro.observe(canvas);
    }

    canvas.style.height = height + 'px';
    updateReadout();
    draw();

    return {
      el: el,
      /* editor.js 在 append 之後的下一幀會對所有元件呼叫一次：
         canvas 剛掛上去時量不到自己的寬度，第一次畫必然是錯的。 */
      redraw: draw,
      reset: function () {
        stops = M.resetStops();
        selected = 0;
        updateReadout(); draw(); commit();
      },
      clear: function () {
        stops = null; selected = -1;
        updateReadout(); draw(); commit();
      },
      hasFocus: function () { return el.contains(document.activeElement); },
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

  return { create: create, BAR_H: BAR_H, STOP_H: STOP_H, HIT_RADIUS: HIT_RADIUS,
    MAX_STOPS: MAX_STOPS };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = VFXGradientEditor;
}
