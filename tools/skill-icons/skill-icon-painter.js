/* 技能圖示程序化繪製（skills2 的 23 個技能群組）。
 *
 * 遊戲裡用的是這支畫出來的 PNG（images/skills/<群組id>.png），執行期不跑這支。
 * 要改圖：改這裡 → 開 skill-icon-studio.html 看 → 按「輸出」覆寫 PNG。
 *
 * 畫風參考過外部圖示集（深色底、單一元素主色、亮芯＋光暈、弧形劃痕、粒子），
 * 但那批素材授權不明，所以這裡全部是自己用 Canvas 2D 程序化畫的——
 * 沒有描圖、沒有取樣任何像素（見 AI_RULES.md 第二原則）。
 *
 * 座標系固定 256×256；輸出尺寸由呼叫端縮放。每個群組用 id 當亂數種子，
 * 同一份程式碼每次畫出來都一樣。
 */
(function (root) {
  'use strict';

  var S = 256;
  var TAU = Math.PI * 2;

  /* ---------- 基礎工具 ---------- */

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  function rgba(hex, a) {
    var c = hexRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')';
  }
  function mix(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    var r = [0, 1, 2].map(function (i) { return Math.round(x[i] + (y[i] - x[i]) * t); });
    return '#' + r.map(function (v) { return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function range(R, a, b) { return a + (b - a) * R(); }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h; return cv;
  }

  function add(c) { c.globalCompositeOperation = 'lighter'; }
  function normal(c) { c.globalCompositeOperation = 'source-over'; }

  function glowDot(c, x, y, r, color, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a === undefined ? 1 : a));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  /* 中心亮芯：白 → 主色 → 透明 */
  function coreGlow(c, x, y, r, color, hot) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hot || '#ffffff', 1));
    g.addColorStop(0.18, rgba(hot || '#ffffff', 0.9));
    g.addColorStop(0.4, rgba(color, 0.55));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  /* 四芒星閃光 */
  function sparkle(c, x, y, r, color, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    add(c);
    glowDot(c, 0, 0, r * 0.7, color, 0.55);
    c.fillStyle = rgba('#ffffff', 0.95);
    c.beginPath();
    var w = r * 0.07;
    c.moveTo(0, -r); c.quadraticCurveTo(w, -w, r, 0); c.quadraticCurveTo(w, w, 0, r);
    c.quadraticCurveTo(-w, w, -r, 0); c.quadraticCurveTo(-w, -w, 0, -r);
    c.fill();
    c.restore();
  }

  /* 散佈的火星／光點 */
  function motes(c, R, n, box, colors, rMin, rMax) {
    add(c);
    for (var i = 0; i < n; i++) {
      var x = range(R, box[0], box[2]), y = range(R, box[1], box[3]);
      var r = range(R, rMin, rMax);
      var col = colors[Math.floor(R() * colors.length)];
      glowDot(c, x, y, r * 3, col, 0.35);
      c.fillStyle = rgba('#ffffff', 0.9);
      c.beginPath(); c.arc(x, y, r * 0.5, 0, TAU); c.fill();
    }
    normal(c);
  }

  /* ---------- 路徑與帶狀筆觸 ---------- */

  function arcPts(cx, cy, r, a0, a1, n, ry) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = lerp(a0, a1, i / (n - 1));
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * (ry === undefined ? r : ry)]);
    }
    return pts;
  }
  function bezPts(p0, p1, p2, p3, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
      ]);
    }
    return pts;
  }
  function linePts(x0, y0, x1, y1, n) {
    var pts = [];
    for (var i = 0; i < n; i++) { var t = i / (n - 1); pts.push([lerp(x0, x1, t), lerp(y0, y1, t)]); }
    return pts;
  }
  function spiralPts(cx, cy, r0, r1, a0, turns, n, squash) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), a = a0 + turns * TAU * t, r = lerp(r0, r1, t);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * (squash || 1)]);
    }
    return pts;
  }

  /* 沿著折線長出可變寬度的帶子，回傳左右兩條邊（給描邊用）。
     wFn(t) 給寬度；side 不為 0 時只長在單側（-1 左、1 右）。 */
  function ribbonEdges(pts, wFn, side) {
    var L = [], Rr = [], n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1], len = Math.hypot(tx, ty) || 1;
      var nx = -ty / len, ny = tx / len;
      var w = wFn(i / (n - 1));
      var wl = side > 0 ? 0 : (side < 0 ? w : w / 2);
      var wr = side < 0 ? 0 : (side > 0 ? w : w / 2);
      L.push([pts[i][0] + nx * wl, pts[i][1] + ny * wl]);
      Rr.push([pts[i][0] - nx * wr, pts[i][1] - ny * wr]);
    }
    return { L: L, R: Rr };
  }
  function fillEdges(c, e, style) {
    c.fillStyle = style;
    c.beginPath();
    c.moveTo(e.L[0][0], e.L[0][1]);
    for (var i = 1; i < e.L.length; i++) c.lineTo(e.L[i][0], e.L[i][1]);
    for (var j = e.R.length - 1; j >= 0; j--) c.lineTo(e.R[j][0], e.R[j][1]);
    c.closePath(); c.fill();
  }
  function ribbon(c, pts, wFn, style, side) {
    var e = ribbonEdges(pts, wFn, side || 0);
    fillEdges(c, e, style);
    return e;
  }
  function strokePts(c, pts, width, style, blur, blurColor) {
    c.save();
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = width; c.strokeStyle = style;
    if (blur) { c.shadowBlur = blur; c.shadowColor = blurColor || style; }
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.stroke();
    c.restore();
  }
  /* 沿帶子方向的漸層（尾 → 頭） */
  function alongGrad(c, pts, stops) {
    var a = pts[0], b = pts[pts.length - 1];
    var g = c.createLinearGradient(a[0], a[1], b[0], b[1]);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }

  /* 刀光／弧形劃痕：多層疊加（外暈 → 主色 → 白芯 → 外緣亮線）。
     taper 'mid' 兩端尖、'head' 尾細頭粗。 */
  function swoosh(c, pts, width, color, opt) {
    opt = opt || {};
    var shape = opt.taper === 'head'
      ? function (t) { return Math.pow(t, 1.3) * Math.pow(1 - t, 0.18); }
      : function (t) { return Math.pow(Math.sin(Math.PI * t), 0.85); };
    add(c);
    ribbon(c, pts, function (t) { return width * 1.9 * shape(t); },
      alongGrad(c, pts, [[0, rgba(color, 0)], [0.6, rgba(color, 0.22)], [1, rgba(color, 0.3)]]));
    var e = ribbon(c, pts, function (t) { return width * shape(t); },
      alongGrad(c, pts, [[0, rgba(color, 0)], [0.45, rgba(color, 0.7)], [0.9, rgba(mix(color, '#ffffff', 0.25), 0.9)], [1, rgba(mix(color, '#ffffff', 0.5), 0.9)]]), opt.side || 0);
    ribbon(c, pts, function (t) { return width * 0.16 * shape(t); },
      alongGrad(c, pts, [[0, rgba('#ffffff', 0)], [0.6, rgba('#ffffff', 0.45)], [1, rgba('#ffffff', 0.85)]]), opt.side || 0);
    if (opt.edge !== false) {
      var edge = opt.side < 0 ? e.L : (opt.side > 0 ? e.R : e.L);
      var cut = Math.floor(edge.length * 0.25);
      strokePts(c, edge.slice(cut), 1.6, rgba('#ffffff', 0.85), 6, rgba(color, 1));
    }
    normal(c);
    return e;
  }

  /* ---------- 元素圖元 ---------- */

  /* 中點位移閃電；回傳折線 */
  function boltPts(x0, y0, x1, y1, R, rough, depth) {
    var pts = [[x0, y0], [x1, y1]];
    var off = Math.hypot(x1 - x0, y1 - y0) * rough;
    for (var d = 0; d < depth; d++) {
      var next = [pts[0]];
      for (var i = 0; i < pts.length - 1; i++) {
        var a = pts[i], b = pts[i + 1];
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        var k = (R() * 2 - 1) * off;
        next.push([mx - dy / len * k, my + dx / len * k], b);
      }
      pts = next; off *= 0.55;
    }
    return pts;
  }
  function lightning(c, x0, y0, x1, y1, R, o) {
    o = o || {};
    var w = o.width || 4, color = o.color || '#ffd84a';
    var pts = boltPts(x0, y0, x1, y1, R, o.rough || 0.22, o.depth || 6);
    add(c);
    strokePts(c, pts, w * 4.5, rgba(color, 0.18), 22, rgba(color, 0.9));
    strokePts(c, pts, w * 1.8, rgba(color, 0.85), 10, rgba(color, 1));
    strokePts(c, pts, w * 0.7, rgba('#ffffff', 1), 4, '#ffffff');
    normal(c);
    var branches = o.branches || 0;
    for (var b = 0; b < branches; b++) {
      var i = 2 + Math.floor(R() * (pts.length - 4));
      var p = pts[i], q = pts[Math.min(pts.length - 1, i + 3)];
      var ang = Math.atan2(q[1] - p[1], q[0] - p[0]) + (R() < 0.5 ? -1 : 1) * range(R, 0.4, 0.9);
      var len = Math.hypot(x1 - x0, y1 - y0) * range(R, 0.15, 0.35);
      lightning(c, p[0], p[1], p[0] + Math.cos(ang) * len, p[1] + Math.sin(ang) * len, R,
        { width: w * 0.5, color: color, rough: 0.3, depth: 4, branches: 0 });
    }
    return pts;
  }

  /* 一束火舌：底部在 (x, y)、往上長 h，lean 是火尖的水平偏移 */
  function flameTongue(c, x, y, w, h, lean, stops) {
    var tipX = x + lean, tipY = y - h;
    c.beginPath();
    c.moveTo(x - w / 2, y);
    c.bezierCurveTo(x - w * 0.62, y - h * 0.42, tipX - w * 0.22, y - h * 0.68, tipX, tipY);
    c.bezierCurveTo(tipX + w * 0.05, y - h * 0.62, x + w * 0.66, y - h * 0.38, x + w / 2, y);
    c.quadraticCurveTo(x, y + w * 0.42, x - w / 2, y);
    var g = c.createLinearGradient(x, y + w * 0.3, tipX, tipY);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    c.fillStyle = g; c.fill();
  }
  var FIRE_OUTER = [[0, 'rgba(180,30,8,0.9)'], [0.55, 'rgba(150,20,6,0.55)'], [1, 'rgba(90,10,4,0)']];
  var FIRE_MID = [[0, 'rgba(255,120,20,0.95)'], [0.6, 'rgba(240,70,10,0.6)'], [1, 'rgba(200,40,8,0)']];
  var FIRE_IN = [[0, 'rgba(255,230,120,1)'], [0.55, 'rgba(255,170,40,0.75)'], [1, 'rgba(255,120,20,0)']];
  var FIRE_CORE = [[0, 'rgba(255,255,240,1)'], [0.6, 'rgba(255,240,170,0.7)'], [1, 'rgba(255,220,120,0)']];

  function fireBush(c, R, x, y, w, h, lean) {
    add(c);
    var layers = [[FIRE_OUTER, 1, 6], [FIRE_MID, 0.78, 5], [FIRE_IN, 0.55, 4], [FIRE_CORE, 0.3, 2]];
    layers.forEach(function (L) {
      for (var i = 0; i < L[2]; i++) {
        var ox = (R() - 0.5) * w * 0.5 * L[1];
        flameTongue(c, x + ox, y, w * L[1] * range(R, 0.45, 0.75), h * L[1] * range(R, 0.6, 1.05),
          lean * L[1] + (R() - 0.5) * w * 0.35, L[0]);
      }
    });
    normal(c);
  }

  /* 冰晶碎片：脊線把菱形切成亮面與暗面 */
  function shard(c, x, y, ang, len, wid, light, dark, opt) {
    opt = opt || {};
    var mid = opt.mid === undefined ? 0.28 : opt.mid;
    c.save(); c.translate(x, y); c.rotate(ang);
    var hw = wid / 2;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(len * mid, -hw); c.lineTo(len, 0); c.closePath();
    c.fillStyle = light; c.fill();
    c.beginPath(); c.moveTo(0, 0); c.lineTo(len * mid, hw); c.lineTo(len, 0); c.closePath();
    c.fillStyle = dark; c.fill();
    add(c);
    c.strokeStyle = rgba('#ffffff', opt.ridge || 0.75); c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(len * 0.05, 0); c.lineTo(len * 0.98, 0); c.stroke();
    c.strokeStyle = rgba('#ffffff', 0.5); c.lineWidth = 1;
    c.beginPath(); c.moveTo(len * mid, -hw); c.lineTo(len, 0); c.stroke();
    normal(c);
    c.restore();
  }

  /* 金屬刀身：沿中心線 pts 長出刀身，左半亮、右半暗，外刃一條亮線 */
  function bladeAlong(c, pts, wid, steel, opt) {
    opt = opt || {};
    var tipLen = opt.tip || 0.16;
    var wFn = opt.wFn
      ? function (t) { return wid * opt.wFn(t); }
      : function (t) { return t > 1 - tipLen ? wid * (1 - t) / tipLen : wid * (opt.flare ? lerp(0.85, 1, t) : 1); };
    var light = ribbonEdges(pts, wFn, -1), dark = ribbonEdges(pts, wFn, 1);
    var a = pts[0], b = pts[pts.length - 1];
    var gl = c.createLinearGradient(a[0], a[1], b[0], b[1]);
    gl.addColorStop(0, steel[1]); gl.addColorStop(0.7, steel[2]); gl.addColorStop(1, mix(steel[2], '#ffffff', 0.5));
    fillEdges(c, light, gl);
    var gd = c.createLinearGradient(a[0], a[1], b[0], b[1]);
    gd.addColorStop(0, steel[0]); gd.addColorStop(1, mix(steel[0], steel[1], 0.6));
    fillEdges(c, dark, gd);
    add(c);
    strokePts(c, light.L, 1.4, rgba('#ffffff', 0.9), 5, steel[3] || '#ffffff');
    strokePts(c, dark.R.slice(0, Math.floor(dark.R.length * 0.85)), 1, rgba('#ffffff', 0.35));
    normal(c);
  }
  var STEEL = ['#1c2430', '#5e6e84', '#b4c4d8', '#bfe0ff'];

  /* 護手＋握把＋柄頭；(x,y) 是護手中心，ang 指向刀尖 */
  function hilt(c, x, y, ang, size, gold) {
    gold = gold || ['#5a3a10', '#d9a441', '#fff1b8'];
    c.save(); c.translate(x, y); c.rotate(ang);
    var g = c.createLinearGradient(0, -size, 0, size);
    g.addColorStop(0, gold[2]); g.addColorStop(0.5, gold[1]); g.addColorStop(1, gold[0]);
    c.fillStyle = g;
    roundRect(c, -size * 0.18, -size * 0.95, size * 0.36, size * 1.9, size * 0.15); c.fill();
    c.fillStyle = '#2a1a12';
    roundRect(c, -size * 1.5, -size * 0.2, size * 1.35, size * 0.4, size * 0.12); c.fill();
    c.strokeStyle = rgba(gold[1], 0.8); c.lineWidth = 1;
    for (var i = 1; i < 5; i++) {
      var xx = -size * 0.15 - i * size * 0.27;
      c.beginPath(); c.moveTo(xx, -size * 0.2); c.lineTo(xx - size * 0.12, size * 0.2); c.stroke();
    }
    c.fillStyle = g;
    c.beginPath(); c.arc(-size * 1.62, 0, size * 0.26, 0, TAU); c.fill();
    c.restore();
  }
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath();
  }

  /* 剪影（深色填色＋主色輪廓光） */
  function silhouette(c, pathFn, fill, rim, rimW) {
    c.save();
    pathFn(c); c.fillStyle = fill; c.fill();
    c.restore();
    c.save(); add(c);
    pathFn(c); c.lineWidth = rimW || 2.2; c.strokeStyle = rim; c.shadowBlur = 10; c.shadowColor = rim; c.stroke();
    c.restore();
  }

  /* ---------- 背景與後製 ---------- */

  function background(c, R, p) {
    c.fillStyle = p.base; c.fillRect(0, 0, S, S);
    var cx = p.cx === undefined ? S / 2 : p.cx, cy = p.cy === undefined ? S / 2 : p.cy;
    var g = c.createRadialGradient(cx, cy, 0, cx, cy, S * 0.8);
    g.addColorStop(0, rgba(p.tint, 1)); g.addColorStop(0.5, rgba(p.tint, 0.5)); g.addColorStop(1, rgba(p.tint, 0));
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    /* 筆刷般的雲霧 */
    add(c);
    for (var i = 0; i < 16; i++) {
      var x = range(R, 0, S), y = range(R, 0, S), r = range(R, S * 0.1, S * 0.32);
      glowDot(c, x, y, r, p.cloud || p.tint, range(R, 0.08, 0.2));
    }
    /* 細長的流動紋理 */
    for (var k = 0; k < 7; k++) {
      var y0 = range(R, 0, S), amp = range(R, 10, 40), ph = range(R, 0, TAU);
      var pts = [];
      for (var j = 0; j <= 24; j++) {
        var x2 = j / 24 * S;
        pts.push([x2, y0 + Math.sin(j / 24 * Math.PI * 1.5 + ph) * amp]);
      }
      ribbon(c, pts, function (t) { return 10 * Math.sin(Math.PI * t); }, rgba(p.cloud || p.tint, 0.07));
    }
    normal(c);
  }

  function vignette(c, strength, tint) {
    var g = c.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.74);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, tint ? rgba(tint, strength) : 'rgba(0,0,0,' + strength + ')');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
  }

  /* 泛光：只放大亮部（模糊後拉對比壓掉暗部）再用 screen 疊回去 */
  function bloom(c, radius, alpha) {
    var tmp = makeCanvas(S, S), t = tmp.getContext('2d');
    t.filter = 'blur(' + radius + 'px) brightness(0.95) contrast(2.4)';
    t.drawImage(c.canvas, 0, 0);
    c.save();
    c.globalCompositeOperation = 'screen'; c.globalAlpha = alpha;
    c.drawImage(tmp, 0, 0);
    c.restore();
  }

  /* 外框：細暗邊＋內緣元素色微光，讓圖示在任何底色上都有邊界 */
  function frame(c, color) {
    c.save();
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.55)'; c.strokeRect(3, 3, S - 6, S - 6);
    add(c);
    c.lineWidth = 2; c.strokeStyle = rgba(color, 0.35); c.strokeRect(7, 7, S - 14, S - 14);
    c.restore();
  }

  /* ---------- 色盤 ---------- */
  var PAL = {
    steel: { base: '#06080c', tint: '#1e2a3c', cloud: '#2c3f5c', key: '#9fc7ff' },
    gold: { base: '#0a0704', tint: '#3a2608', cloud: '#5a3a0c', key: '#ffc85a' },
    blood: { base: '#0b0305', tint: '#4a0712', cloud: '#6a0c18', key: '#ff3344' },
    fire: { base: '#0d0402', tint: '#5a1505', cloud: '#7a2008', key: '#ff7a1e' },
    earth: { base: '#090604', tint: '#3a220e', cloud: '#55331a', key: '#e3a457' },
    swamp: { base: '#050604', tint: '#26250c', cloud: '#2f3a10', key: '#9be04a' },
    life: { base: '#040805', tint: '#16331a', cloud: '#21502a', key: '#b8f26a' },
    holy: { base: '#0b0906', tint: '#3a3016', cloud: '#5a4a20', key: '#fff2b0' },
    bolt: { base: '#07050f', tint: '#241848', cloud: '#352266', key: '#ffd84a' },
    orb: { base: '#05040f', tint: '#1a1a4e', cloud: '#2a2672', key: '#b4b8ff' },
    boltBlue: { base: '#02050e', tint: '#0b1e4c', cloud: '#132c6e', key: '#6ab8ff' },
    ice: { base: '#03070f', tint: '#0c2a52', cloud: '#14406e', key: '#8fd3ff' },
    water: { base: '#020812', tint: '#06325c', cloud: '#0a4a7a', key: '#5fd0ff' },
    wind: { base: '#030a08', tint: '#0d3a2a', cloud: '#145040', key: '#8ff5c0' },
    vacuum: { base: '#04080c', tint: '#0c3040', cloud: '#134a5a', key: '#9ff0ff' }
  };

  /* ---------- 各技能 ---------- */

  var PAINTERS = {};

  /* 突刺：只取刀身前半段——刀身從左下畫外伸入，刀尖在畫面中央偏右上，衝擊波紋＋閃光是主角 */
  PAINTERS.thrust = function (c, R) {
    background(c, R, Object.assign({ cx: 150, cy: 106 }, PAL.steel));
    var tx = 156, ty = 96;  /* 量出重心偏右 11，往左補 */
    var ang = Math.atan2(-1, 1), dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    /* 速度線（短、集中在刀身周圍） */
    add(c);
    for (var i = 0; i < 12; i++) {
      var off = range(R, -56, 56), st = range(R, -150, -30), ln = range(R, 40, 90);
      var x0 = tx + nx * off + dx * st, y0 = ty + ny * off + dy * st;
      ribbon(c, linePts(x0, y0, x0 + dx * ln, y0 + dy * ln, 8), function (t) { return 2.2 * Math.sin(Math.PI * t); },
        rgba('#a8d0ff', range(R, 0.15, 0.4)));
    }
    normal(c);
    /* 衝擊波紋：刀尖最小，沿刀身往後一圈比一圈大、越淡（像音爆錐往後擴散；使用者指定由小漸大，不能反過來） */
    add(c);
    for (var k = 0; k < 4; k++) {
      var d = 14 - k * 20;
      c.save(); c.translate(tx + dx * d, ty + dy * d); c.rotate(ang);
      c.strokeStyle = rgba('#bfe0ff', 0.85 - k * 0.17); c.lineWidth = 3.2 - k * 0.5;
      c.shadowBlur = 12; c.shadowColor = '#7fb8ff';
      c.beginPath(); c.ellipse(0, 0, 7 + k * 3, 22 + k * 13, 0, 0, TAU); c.stroke();
      c.restore();
    }
    normal(c);
    /* 刀身前半段：寬，往刀尖收 */
    var bx = tx - dx * 190, by = ty - dy * 190;
    bladeAlong(c, linePts(bx, by, tx, ty, 26), 19, STEEL, { wFn: function (t) { return t > 0.4 ? Math.pow((1 - t) / 0.6, 0.75) : 1; } });
    /* 中央血槽 */
    add(c);
    strokePts(c, linePts(bx + dx * 10, by + dy * 10, tx - dx * 70, ty - dy * 70, 2), 2.4, 'rgba(220,235,255,0.45)');
    normal(c);
    /* 刀尖閃光與往前迸的光束 */
    add(c);
    for (var r2 = 0; r2 < 9; r2++) {
      var a = ang + range(R, -0.45, 0.45), ln2 = range(R, 22, 60);
      ribbon(c, linePts(tx, ty, tx + Math.cos(a) * ln2, ty + Math.sin(a) * ln2, 5), function (t) { return 3.4 * (1 - t); }, rgba('#dff0ff', 0.75));
    }
    normal(c);
    coreGlow(c, tx, ty, 36, '#7fb8ff');
    sparkle(c, tx, ty, 24, '#9fd0ff', 0.2);
    motes(c, R, 14, [90, 20, 246, 170], ['#bfe0ff', '#ffffff'], 1, 2.4);
  };

  /* 迴旋斬：俯視的旋風刀光圓盤，刀光平均分布一整圈；金橘赤紅洋紅多色，青白火花點綴（不畫兵器） */
  PAINTERS.cleave = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 128 }, PAL.gold));
    /* 圓盤中心往右 10：最外圈刀光的粗頭落在左側，量出重心偏左 11 */
    var cx = 138, cy = 128, sq = 0.62;
    /* 底色加一層紅紫，讓畫面不只有黃 */
    add(c);
    glowDot(c, 70, 70, 110, '#8a1a4a', 0.35);
    glowDot(c, 190, 196, 110, '#6a1a7a', 0.3);
    c.save(); c.translate(cx, cy); c.scale(1, sq);
    glowDot(c, 0, 0, 124, '#ff7a2a', 0.32);
    c.restore();
    normal(c);
    /* 刀光：每圈起點錯開 120 度，三圈一組，整圈都有東西，重心才會在中央 */
    var cols = ['#ffcf5a', '#ff7a2a', '#ff3a5a', '#ff5ad0', '#ffd27a', '#ff4a3a'];
    for (var k = 0; k < 6; k++) {
      var r = 116 - k * 15, a0 = k * TAU / 3 + (k > 2 ? 0.9 : 0.2), span = lerp(3.6, 2.4, k / 5);
      swoosh(c, arcPts(cx, cy, r, a0, a0 + span, 60, r * sq), lerp(18, 9, k / 5), cols[k], { taper: 'head', edge: k < 3 });
    }
    /* 中心旋渦亮芯 */
    add(c);
    for (var j = 0; j < 3; j++) {
      var sp = spiralPts(cx, cy, 34, 4, j * TAU / 3, 0.8, 24, sq);
      ribbon(c, sp, function (t) { return 6 * Math.sin(Math.PI * t); }, rgba(j ? '#ffe0f0' : '#fff2c0', 0.7));
    }
    normal(c);
    coreGlow(c, cx, cy, 34, '#ff8a4a', '#fffbe8');
    /* 沿切線甩出的火花：暖色為主，夾幾顆青白 */
    add(c);
    for (var i = 0; i < 18; i++) {
      var a = i / 18 * TAU + range(R, -0.15, 0.15), rr = range(R, 76, 114);
      var px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr * sq;
      var tx = -Math.sin(a), ty = Math.cos(a) * sq, ln = range(R, 14, 32);
      var col = i % 5 === 0 ? '#9ff0ff' : (i % 3 === 0 ? '#ff8ad8' : '#ffe7a0');
      ribbon(c, linePts(px - tx * ln, py - ty * ln, px, py, 6), function (t) { return 3 * t; }, rgba(col, 0.85));
      glowDot(c, px, py, 5, col, 0.9);
    }
    normal(c);
    motes(c, R, 16, [10, 10, 246, 246], ['#ffcf6a', '#ff5ad0', '#9ff0ff'], 1, 2.4);
  };

  /* 飛刀：三把苦無平行疾射，拖出殘光 */
  PAINTERS.knife = function (c, R) {
    background(c, R, Object.assign({ cx: 196, cy: 72 }, PAL.steel));
    var ang = -0.78, dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    var main = [200, 66];
    var knives = [
      [main[0], main[1], 1],
      [main[0] - nx * 54 - dx * 26, main[1] - ny * 54 - dy * 26, 0.82],
      [main[0] + nx * 54 - dx * 26, main[1] + ny * 54 - dy * 26, 0.82]
    ];
    var steelK = ['#18202c', '#56667c', '#c2d2e6', '#9fe0ff'];
    knives.forEach(function (k, idx) {
      var x = k[0], y = k[1], s = k[2];
      var bladeLen = 64 * s, gripLen = 30 * s;
      var gx = x - dx * bladeLen, gy = y - dy * bladeLen;   /* 刀身底部 */
      var ex = gx - dx * gripLen, ey = gy - dy * gripLen;  /* 握柄尾端 */
      /* 尾跡 */
      var tail = linePts(ex - dx * 120 * s, ey - dy * 120 * s, gx, gy, 16);
      add(c);
      ribbon(c, tail, function (t) { return 26 * s * Math.pow(t, 1.3); },
        alongGrad(c, tail, [[0, 'rgba(80,190,255,0)'], [1, 'rgba(120,210,255,0.45)']]));
      ribbon(c, tail, function (t) { return 5 * s * Math.pow(t, 1.1); },
        alongGrad(c, tail, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(230,248,255,0.85)']]));
      normal(c);
      /* 握柄：纏繩＋環 */
      c.save(); c.translate(gx, gy); c.rotate(ang);
      c.fillStyle = '#141820'; roundRect(c, -gripLen, -4 * s, gripLen, 8 * s, 2); c.fill();
      c.strokeStyle = '#3c5a78'; c.lineWidth = 1.4;
      for (var w = 1; w < 6; w++) {
        var xx = -gripLen * w / 6;
        c.beginPath(); c.moveTo(xx + 3 * s, -4 * s); c.lineTo(xx - 3 * s, 4 * s); c.stroke();
      }
      c.strokeStyle = '#8fa6c0'; c.lineWidth = 3 * s;
      c.beginPath(); c.arc(-gripLen - 7 * s, 0, 7 * s, 0, TAU); c.stroke();
      c.restore();
      /* 柳葉形雙刃 */
      bladeAlong(c, linePts(gx, gy, x, y, 16), 22 * s, steelK, {
        wFn: function (t) { return t < 0.3 ? lerp(0.45, 1, t / 0.3) : Math.pow((1 - t) / 0.7, 0.9); }
      });
      if (idx === 0) sparkle(c, x, y, 18, '#9fd0ff', 0.4);
    });
    motes(c, R, 12, [30, 20, 240, 230], ['#bfe0ff'], 1, 2);
  };

  /* 疾風迅雷：深藍人影突進的剪影（兩道殘影），前方一道白光斬擊，周圍只用細細的白色電弧點綴——本質是斬擊，雷不是主角 */
  PAINTERS.gale = function (c, R) {
    background(c, R, Object.assign({ cx: 120, cy: 128 }, PAL.ice));
    /* 水平速度線 */
    add(c);
    for (var i = 0; i < 16; i++) {
      var y = range(R, 40, 220), x0 = range(R, -20, 120), ln = range(R, 50, 130);
      ribbon(c, linePts(x0, y, x0 + ln, y - ln * 0.12, 8), function (t) { return 2.2 * Math.sin(Math.PI * t); }, rgba('#bfe0ff', range(R, 0.12, 0.35)));
    }
    normal(c);
    /* 人影：在離屏畫布畫成單色剪影，之後拿來做殘影、本體、輪廓光 */
    var fig = makeCanvas(S, S), f = fig.getContext('2d');
    f.fillStyle = '#000'; f.strokeStyle = '#000'; f.lineCap = 'round'; f.lineJoin = 'round';
    var limb = function (pts, w) {
      f.lineWidth = w; f.beginPath(); f.moveTo(pts[0][0], pts[0][1]);
      for (var k = 1; k < pts.length; k++) f.lineTo(pts[k][0], pts[k][1]);
      f.stroke();
    };
    /* 身體大幅前傾往右上衝：頭在右上、後腳往左下拉長。整個人影往左下移，重心才會在中央 */
    f.translate(-16, 16);
    /* 披風：從肩膀往後飄的大片布，給剪影份量 */
    f.beginPath();
    f.moveTo(146, 94);
    f.bezierCurveTo(112, 84, 82, 96, 34, 84);
    f.bezierCurveTo(60, 104, 66, 122, 46, 140);
    f.bezierCurveTo(84, 138, 104, 150, 122, 150);
    f.closePath(); f.fill();
    f.beginPath(); f.arc(166, 80, 17, 0, TAU); f.fill();                         /* 頭 */
    f.beginPath();                                                               /* 軀幹：寬肩窄腰 */
    f.moveTo(144, 90); f.lineTo(176, 100); f.lineTo(140, 158); f.lineTo(108, 150); f.closePath(); f.fill();
    limb([[150, 102], [120, 118], [96, 116]], 15);                                /* 後擺的手 */
    limb([[166, 104], [192, 120], [214, 114]], 15);                               /* 前伸持刀的手 */
    limb([[128, 150], [158, 176], [184, 190]], 21);                               /* 前腳（彎曲踏地） */
    limb([[118, 152], [84, 172], [42, 196]], 19);                                 /* 後腳（拉長蹬地） */
    f.beginPath(); f.ellipse(190, 192, 13, 6, 0.2, 0, TAU); f.fill();             /* 前腳掌 */
    /* 手上的刀（短直刀，順著前伸方向） */
    limb([[208, 115], [250, 104]], 5);
    f.setTransform(1, 0, 0, 1, 0, 0);

    var tinted = function (color, alpha) {
      var t = makeCanvas(S, S), tc = t.getContext('2d');
      tc.drawImage(fig, 0, 0);
      tc.globalCompositeOperation = 'source-in'; tc.fillStyle = color; tc.fillRect(0, 0, S, S);
      c.save(); c.globalAlpha = alpha; c.drawImage(t, 0, 0); c.restore();
      return t;
    };
    /* 殘影：往左下錯開、越遠越淡 */
    c.save(); c.translate(-62, 18); add(c); tinted('#3a7aff', 0.18); c.restore();
    c.save(); c.translate(-32, 9); add(c); tinted('#5a9aff', 0.32); c.restore();
    /* 本體：先畫藍色光暈再蓋深藍剪影 */
    c.save(); c.filter = 'blur(6px)'; add(c); tinted('#4a8cff', 0.9); c.restore();
    tinted('#0a1846', 1);
    /* 輪廓光：白色剪影扣掉往左下位移的剪影，只留朝前（右上）的邊 */
    var rim = makeCanvas(S, S), rc = rim.getContext('2d');
    rc.drawImage(fig, 0, 0);
    rc.globalCompositeOperation = 'source-in'; rc.fillStyle = '#d8ecff'; rc.fillRect(0, 0, S, S);
    rc.globalCompositeOperation = 'destination-out'; rc.drawImage(fig, -3, 3);
    c.save(); add(c); c.drawImage(rim, 0, 0); c.restore();
    /* 白光斬擊：從人影前方劃出的細長弧 */
    /* 斬擊弧很亮，量出重心偏右 14，整條往左移 */
    swoosh(c, arcPts(84, 266, 186, Math.PI * 1.38, Math.PI * 1.88, 50), 15, '#cfe6ff', { side: 1 });
    /* 點綴用的細電弧（白藍、細、短） */
    lightning(c, 184, 64, 220, 84, R, { width: 1.1, color: '#bfe0ff', rough: 0.4, depth: 4 });
    lightning(c, 150, 186, 196, 214, R, { width: 1.1, color: '#bfe0ff', rough: 0.4, depth: 4 });
    lightning(c, 60, 186, 96, 210, R, { width: 0.9, color: '#bfe0ff', rough: 0.4, depth: 4 });
    sparkle(c, 220, 124, 16, '#cfe6ff', 0.2);
    motes(c, R, 14, [20, 20, 246, 236], ['#cfe6ff', '#ffffff'], 1, 2);
  };

  /* 血刃斬：一道大弧形血斬（重心在正中），紫色外暈與紫羅蘭細血痕，切口噴出紅紫血珠（不畫兵器） */
  PAINTERS.bloodblade = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 128 }, PAL.blood));
    add(c);
    glowDot(c, 200, 70, 110, '#5a1a8a', 0.4);
    glowDot(c, 60, 200, 100, '#6a1080', 0.3);
    for (var i = 0; i < 6; i++) glowDot(c, range(R, 30, 226), range(R, 206, 252), range(R, 22, 40), '#4caf2b', 0.12);
    normal(c);
    /* 弧心放右下、半徑 120：弧頂在 (115,115)、弦中點在 (142,142)，筆畫重心落在畫面中央 */
    var ox = 196, oy = 214;  /* 量測後補正：原本重心偏上 14、偏右 4 */
    var arc = arcPts(ox, oy, 120, Math.PI * 0.98, Math.PI * 1.52, 60);
    swoosh(c, arc, 58, '#a00818', { taper: 'mid', edge: false });
    swoosh(c, arc, 32, '#ff2a3a', { taper: 'mid' });
    swoosh(c, arcPts(ox + 16, oy + 16, 96, Math.PI * 1.02, Math.PI * 1.46, 40), 11, '#a050ff', { taper: 'mid' });
    swoosh(c, arcPts(ox - 16, oy - 16, 140, Math.PI * 1.06, Math.PI * 1.42, 40), 6, '#ff7aa0', { taper: 'mid', edge: false });
    /* 從切口往外噴的血珠：紅為主、夾紫 */
    var drop = function (x, y, r, purple) {
      c.beginPath(); c.arc(x, y, r, 0, TAU);
      var g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, 0, x, y, r);
      if (purple) { g.addColorStop(0, '#e0a0ff'); g.addColorStop(0.45, '#8a20c0'); g.addColorStop(1, '#2a0040'); }
      else { g.addColorStop(0, '#ff8a8a'); g.addColorStop(0.45, '#d0101e'); g.addColorStop(1, '#4a0008'); }
      c.fillStyle = g; c.fill();
    };
    for (var k = 0; k < 26; k++) {
      var t = range(R, 0.15, 0.85), idx = Math.floor(t * (arc.length - 1));
      var p = arc[idx], vx = p[0] - ox, vy = p[1] - oy, L = Math.hypot(vx, vy);
      var out = range(R, 10, 60) * (R() < 0.5 ? -1 : 1);   /* 兩側都噴，避免全堆在一邊 */
      var x = p[0] + vx / L * out + range(R, -8, 8), y = p[1] + vy / L * out + range(R, -8, 8);
      var r = lerp(7, 2, Math.abs(out) / 60) * range(R, 0.7, 1.2);
      var purple = k % 4 === 0;
      add(c); glowDot(c, x, y, r * 3, purple ? '#a040ff' : '#ff2030', 0.35); normal(c);
      drop(x, y, r, purple);
    }
    coreGlow(c, 118, 134, 34, '#ff3a4a');
    motes(c, R, 16, [10, 10, 246, 246], ['#ff4455', '#c070ff', '#ff8a8a'], 1, 2.2);
  };

  /* 雙刀亂舞：兩把比例合理的短劍交叉（刀身細、刀柄約刀身四分之一），四周不閉合的旋舞刀光 */
  PAINTERS.dualdance = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 120 }, PAL.blood));
    swoosh(c, arcPts(118, 132, 100, Math.PI * 0.62, Math.PI * 1.55, 50), 24, '#ff3040', { taper: 'head' });
    swoosh(c, arcPts(140, 120, 92, Math.PI * 1.72, Math.PI * 2.55, 46), 20, '#ff7a2a', { taper: 'head' });
    swoosh(c, arcPts(128, 128, 64, Math.PI * 0.05, Math.PI * 0.6, 30), 12, '#ffb04a', { taper: 'head' });
    var steelR = ['#24141a', '#6e4c56', '#d4b6bc', '#ff7a7a'];
    var gold = ['#30080c', '#a8262e', '#ffb0a0'];
    /* 護手在 (gx,gy)、刀尖在 (tx,ty)；握把由 hilt() 往刀尖反方向畫 */
    var sword = function (gx, gy, tx, ty) {
      bladeAlong(c, linePts(gx, gy, tx, ty, 22), 10, steelR, { tip: 0.16 });
      hilt(c, gx, gy, Math.atan2(ty - gy, tx - gx), 18, gold);
    };
    sword(176, 180, 60, 48);
    sword(80, 180, 196, 48);
    coreGlow(c, 128, 123, 30, '#ff5a3a');
    sparkle(c, 128, 123, 20, '#ffb070', 0.4);
    motes(c, R, 20, [20, 20, 236, 236], ['#ff8a2a', '#ff4455', '#ffd27a'], 1, 2.4);
  };

  /* 反擊：置中的盾牌，外圍是反彈出去的金色衝擊環與碎片（不畫武器） */
  PAINTERS.counter = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 128 }, PAL.gold));
    var cx = 128, cy = 132;
    /* 外圍：反彈衝擊環（三段不閉合弧，像能量被彈開） */
    for (var k = 0; k < 3; k++) {
      var a0 = -Math.PI / 2 + k * TAU / 3 + 0.35;
      swoosh(c, arcPts(cx, cy, 104, a0, a0 + 1.55, 36), 14, '#ffb33a', { taper: 'head' });
    }
    /* 往外放射的光芒 */
    add(c);
    for (var i = 0; i < 18; i++) {
      var a = i / 18 * TAU + range(R, -0.08, 0.08), r0 = 74, ln = range(R, 18, 44);
      ribbon(c, linePts(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * (r0 + ln), cy + Math.sin(a) * (r0 + ln), 6),
        function (t) { return 4 * (1 - t); }, rgba('#ffe7a0', 0.6));
    }
    glowDot(c, cx, cy, 110, '#ffb33a', 0.35);
    normal(c);
    /* 盾 */
    var shield = function (cc) {
      cc.beginPath();
      cc.moveTo(cx - 54, cy - 62); cc.quadraticCurveTo(cx, cy - 80, cx + 54, cy - 62);
      cc.lineTo(cx + 54, cy - 2); cc.quadraticCurveTo(cx + 52, cy + 52, cx, cy + 82);
      cc.quadraticCurveTo(cx - 52, cy + 52, cx - 54, cy - 2); cc.closePath();
    };
    c.save();
    shield(c);
    var sg = c.createLinearGradient(cx - 54, cy - 70, cx + 54, cy + 80);
    sg.addColorStop(0, '#6a7c98'); sg.addColorStop(0.45, '#2a3650'); sg.addColorStop(1, '#0e1320');
    c.fillStyle = sg; c.fill();
    c.lineWidth = 8; c.strokeStyle = '#b8862e'; c.stroke();
    c.lineWidth = 2; c.strokeStyle = '#ffe7a0'; c.stroke();
    /* 盾面中央的金色徽紋：菱形＋放射紋 */
    c.beginPath(); c.moveTo(cx, cy - 40); c.lineTo(cx + 28, cy + 2); c.lineTo(cx, cy + 46); c.lineTo(cx - 28, cy + 2); c.closePath();
    var eg = c.createLinearGradient(cx - 28, cy - 40, cx + 28, cy + 46);
    eg.addColorStop(0, '#fff1b8'); eg.addColorStop(0.5, '#d9a441'); eg.addColorStop(1, '#6a4410');
    c.fillStyle = eg; c.fill();
    c.strokeStyle = 'rgba(40,24,6,0.8)'; c.lineWidth = 1.5; c.stroke();
    c.strokeStyle = 'rgba(255,245,210,0.8)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(cx, cy - 40); c.lineTo(cx, cy + 46); c.moveTo(cx - 28, cy + 2); c.lineTo(cx + 28, cy + 2); c.stroke();
    /* 盾面左上的反光 */
    c.save(); shield(c); c.clip();
    add(c);
    var hl = c.createLinearGradient(cx - 54, cy - 70, cx, cy);
    hl.addColorStop(0, 'rgba(200,220,255,0.35)'); hl.addColorStop(1, 'rgba(200,220,255,0)');
    c.fillStyle = hl; c.fillRect(cx - 60, cy - 80, 70, 90);
    c.restore();
    c.restore();
    /* 盾緣金光 */
    c.save(); add(c); shield(c);
    c.strokeStyle = 'rgba(255,210,120,0.6)'; c.lineWidth = 3; c.shadowBlur = 16; c.shadowColor = '#ffb33a'; c.stroke();
    c.restore();
    /* 被彈開的碎片 */
    for (var j = 0; j < 9; j++) {
      var a2 = range(R, 0, TAU), d = range(R, 92, 116);
      shard(c, cx + Math.cos(a2) * d, cy + Math.sin(a2) * d, a2, range(R, 10, 16), range(R, 4, 7), '#fff1c0', '#c8902e', { ridge: 0.5 });
    }
    sparkle(c, cx + 40, cy - 58, 18, '#ffd27a', 0.3);
    motes(c, R, 14, [10, 10, 246, 246], ['#ffd27a'], 1, 2.2);
  };

  /* 嗜血狂怒：血焰中的有角狂戰士面孔，怒目獠牙 */
  PAINTERS.bloodrage = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 160 }, PAL.blood));
    var redFire = function (x, y, w, h, lean) {
      add(c);
      for (var i = 0; i < 6; i++) flameTongue(c, x + (R() - 0.5) * w * 0.5, y, w * range(R, 0.4, 0.7), h * range(R, 0.7, 1.05), lean + (R() - 0.5) * 30,
        [[0, 'rgba(200,10,20,0.85)'], [0.6, 'rgba(140,0,10,0.45)'], [1, 'rgba(80,0,0,0)']]);
      for (var j = 0; j < 3; j++) flameTongue(c, x + (R() - 0.5) * w * 0.3, y, w * range(R, 0.25, 0.4), h * range(R, 0.45, 0.7), lean,
        [[0, 'rgba(255,90,60,0.8)'], [1, 'rgba(255,40,30,0)']]);
      normal(c);
    };
    redFire(128, 256, 250, 250, 0);
    redFire(46, 246, 80, 170, -18);
    redFire(210, 246, 80, 170, 18);
    /* 角：從太陽穴往外再往上彎，根部粗 */
    var horn = function (cc, sgn) {
      var X = function (x) { return 128 + sgn * (x - 128); };
      cc.beginPath();
      cc.moveTo(X(98), 92);
      cc.bezierCurveTo(X(70), 96, X(44), 84, X(34), 56);
      cc.quadraticCurveTo(X(30), 40, X(40), 18);
      cc.quadraticCurveTo(X(46), 48, X(62), 62);
      cc.bezierCurveTo(X(76), 72, X(92), 70, X(106), 74);
      cc.closePath();
    };
    [-1, 1].forEach(function (sgn) {
      c.save();
      horn(c, sgn);
      var hg = c.createLinearGradient(128 + sgn * 30, 90, 128 + sgn * 90, 20);
      hg.addColorStop(0, '#1a0608'); hg.addColorStop(0.7, '#3a1210'); hg.addColorStop(1, '#8a5a40');
      c.fillStyle = hg; c.fill();
      add(c); c.lineWidth = 2; c.strokeStyle = 'rgba(255,80,60,0.75)'; c.shadowBlur = 8; c.shadowColor = '#ff3020'; c.stroke();
      c.restore();
    });
    /* 臉：寬顴骨、尖下巴 */
    var head = function (cc) {
      cc.beginPath();
      cc.moveTo(128, 64);
      cc.quadraticCurveTo(168, 64, 180, 100);
      cc.lineTo(188, 140);
      cc.quadraticCurveTo(180, 176, 160, 200);
      cc.lineTo(128, 226);
      cc.lineTo(96, 200);
      cc.quadraticCurveTo(76, 176, 68, 140);
      cc.lineTo(76, 100);
      cc.quadraticCurveTo(88, 64, 128, 64);
      cc.closePath();
    };
    silhouette(c, head, '#0d0204', 'rgba(255,60,50,0.85)', 2.4);
    /* 怒眉：V 形重眉骨 */
    c.save();
    c.fillStyle = '#2a0a0c';
    c.beginPath(); c.moveTo(78, 112); c.lineTo(126, 132); c.lineTo(130, 132); c.lineTo(178, 112); c.lineTo(176, 122); c.lineTo(128, 142); c.lineTo(80, 122); c.closePath(); c.fill();
    c.restore();
    /* 燃燒的雙眼：內眼角向下 */
    [[104, 140, 0.38], [152, 140, -0.38]].forEach(function (e) {
      c.save(); c.translate(e[0], e[1]); c.rotate(e[2]);
      add(c);
      glowDot(c, 0, 0, 30, '#ff2a1a', 0.75);
      c.fillStyle = '#ffd27a';
      c.beginPath(); c.moveTo(-14, 0); c.quadraticCurveTo(0, -6, 14, 0); c.quadraticCurveTo(0, 5, -14, 0); c.fill();
      c.fillStyle = '#ffffff';
      c.beginPath(); c.ellipse(1, 0, 6, 2, 0, 0, TAU); c.fill();
      normal(c);
      c.restore();
    });
    /* 咆哮的嘴與獠牙 */
    c.save();
    c.beginPath(); c.moveTo(100, 178); c.quadraticCurveTo(128, 170, 156, 178); c.quadraticCurveTo(146, 208, 128, 210); c.quadraticCurveTo(110, 208, 100, 178); c.closePath();
    var mg = c.createRadialGradient(128, 192, 2, 128, 192, 28);
    mg.addColorStop(0, '#ffd27a'); mg.addColorStop(0.45, '#ff3a1a'); mg.addColorStop(1, '#5a0408');
    c.fillStyle = mg; c.fill();
    c.fillStyle = '#f2e6d0';
    [[106, 178, 1], [150, 178, 1]].forEach(function (f) {
      c.beginPath(); c.moveTo(f[0] - 5, f[1]); c.lineTo(f[0] + 5, f[1] + 1); c.lineTo(f[0], f[1] + 18); c.closePath(); c.fill();
    });
    [[116, 208], [140, 208]].forEach(function (f) {
      c.beginPath(); c.moveTo(f[0] - 4, f[1]); c.lineTo(f[0] + 4, f[1]); c.lineTo(f[0], f[1] - 12); c.closePath(); c.fill();
    });
    c.restore();
    motes(c, R, 22, [10, 10, 246, 246], ['#ff3344', '#ff8a5a'], 1, 2.6);
  };

  /* 火球術：火球斜劈而下，拖著長長的火尾 */
  PAINTERS.fireball = function (c, R) {
    background(c, R, Object.assign({ cx: 160, cy: 96 }, PAL.fire));
    var hx = 160, hy = 96;
    var ang = Math.atan2(96 - 214, 160 - 42);
    /* 火尾：沿反方向的多條火帶 */
    for (var i = 0; i < 7; i++) {
      var spread = (i - 3) * 0.09 + (R() - 0.5) * 0.05;
      var a = ang + Math.PI + spread, ln = range(R, 120, 175);
      var bend = (R() - 0.5) * 40;
      var tail = bezPts([hx + Math.cos(a) * ln, hy + Math.sin(a) * ln],
        [hx + Math.cos(a) * ln * 0.6 + bend, hy + Math.sin(a) * ln * 0.6 - bend],
        [hx + Math.cos(a) * ln * 0.3, hy + Math.sin(a) * ln * 0.3], [hx, hy], 30);
      add(c);
      var w = range(R, 24, 44);
      ribbon(c, tail, function (t) { return w * Math.pow(t, 1.1); },
        alongGrad(c, tail, [[0, 'rgba(160,20,5,0)'], [0.5, 'rgba(230,60,10,0.55)'], [1, 'rgba(255,170,40,0.9)']]));
      ribbon(c, tail, function (t) { return w * 0.35 * Math.pow(t, 1.4); },
        alongGrad(c, tail, [[0, 'rgba(255,220,120,0)'], [1, 'rgba(255,250,210,0.95)']]));
      normal(c);
    }
    /* 火球本體 */
    add(c);
    glowDot(c, hx, hy, 80, '#ff6a10', 0.55);
    var g = c.createRadialGradient(hx + 6, hy - 6, 2, hx, hy, 44);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.25, '#fff2a8'); g.addColorStop(0.55, '#ffa020'); g.addColorStop(0.85, 'rgba(230,60,10,0.7)'); g.addColorStop(1, 'rgba(200,30,5,0)');
    c.fillStyle = g; c.beginPath(); c.arc(hx, hy, 44, 0, TAU); c.fill();
    normal(c);
    /* 火球表面的漩渦紋 */
    add(c);
    for (var k = 0; k < 3; k++) {
      var sp = spiralPts(hx, hy, 6, 34, k * TAU / 3, 0.55, 20);
      ribbon(c, sp, function (t) { return 6 * Math.sin(Math.PI * t); }, rgba('#fff2c0', 0.55));
    }
    normal(c);
    motes(c, R, 26, [20, 60, 220, 240], ['#ffb347', '#ff6a10', '#ffe27a'], 1, 2.8);
  };

  /* 火龍捲：螺旋火帶往上張開，中間夾火舌 */
  PAINTERS.firepillar = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 150 }, PAL.fire));
    add(c);
    c.save(); c.translate(128, 224); c.scale(1, 0.3);
    glowDot(c, 0, 0, 110, '#ff5a10', 0.8);
    c.restore();
    normal(c);
    /* 螺旋：t 從底到頂，角度轉 3.2 圈；sin(角度)>0 是前面 */
    var turns = 3.2, n = 220, helix = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), a = t * turns * TAU + 0.6;
      var rx = lerp(12, 96, Math.pow(t, 0.9)), y = lerp(226, 40, t) + Math.sin(a) * rx * 0.24;
      helix.push({ p: [128 + Math.cos(a) * rx + Math.sin(t * 7) * 6, y], front: Math.sin(a) > 0, t: t });
    }
    var segs = [], cur = null;
    helix.forEach(function (h) {
      if (!cur || cur.front !== h.front) { cur = { front: h.front, pts: cur ? [cur.pts[cur.pts.length - 1]] : [] }; segs.push(cur); }
      cur.pts.push(h.p); cur.t = h.t;
    });
    segs.forEach(function (sg) {
      if (sg.front || sg.pts.length < 3) return;
      add(c);
      ribbon(c, sg.pts, function (u) { return lerp(4, 14, sg.t) * Math.sin(Math.PI * u); }, rgba('#b02808', 0.6));
      normal(c);
    });
    fireBush(c, R, 128, 236, 64, 196, 0);
    segs.forEach(function (sg) {
      if (!sg.front || sg.pts.length < 3) return;
      swoosh(c, sg.pts, lerp(6, 20, sg.t), sg.t > 0.5 ? '#ffb030' : '#ff7a1e', { edge: sg.t > 0.3 });
    });
    motes(c, R, 26, [20, 10, 236, 230], ['#ffb347', '#ff6a10', '#ffe27a'], 1, 2.6);
  };

  /* 火狩：烈日核心，三顆火球沿傾斜星環繞行 */
  PAINTERS.firehunt = function (c, R) {
    background(c, R, PAL.fire);
    var cx = 128, cy = 128, rx = 98, ry = 44, tilt = -0.42;
    var P = function (a) {
      var x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
    };
    var ring = function (a0, a1) { var p = []; for (var i = 0; i < 60; i++) p.push(P(lerp(a0, a1, i / 59))); return p; };
    /* 背後半圈 */
    add(c); strokePts(c, ring(Math.PI, TAU), 2, rgba('#ff9a3a', 0.35), 6, '#ff6a10'); normal(c);
    /* 太陽 */
    add(c);
    for (var k = 0; k < 16; k++) {
      var a = k / 16 * TAU + 0.1, ln = k % 2 ? 54 : 70;
      ribbon(c, linePts(cx, cy, cx + Math.cos(a) * ln, cy + Math.sin(a) * ln, 6), function (t) { return 9 * (1 - t); }, rgba('#ffb030', 0.45));
    }
    normal(c);
    coreGlow(c, cx, cy, 62, '#ff7a1e', '#fffbe0');
    add(c); glowDot(c, cx, cy, 30, '#ffe27a', 0.9); normal(c);
    /* 前半圈＋三顆火球（頭在前、尾巴沿軌道） */
    add(c); strokePts(c, ring(0, Math.PI), 2.4, rgba('#ffc060', 0.6), 6, '#ff6a10'); normal(c);
    [0.35, 0.35 + TAU / 3, 0.35 + TAU * 2 / 3].forEach(function (a0) {
      var tail = ring(a0 - 1.3, a0);
      var depth = Math.sin(a0) > 0 ? 1 : 0.7;
      swoosh(c, tail, 16 * depth, '#ff8a1e', { taper: 'head', edge: false });
      var h = P(a0);
      coreGlow(c, h[0], h[1], 22 * depth, '#ff7a1e', '#fff6d0');
    });
    motes(c, R, 18, [20, 20, 236, 236], ['#ffb347', '#ffe27a'], 1, 2.4);
  };

  /* 岩甲術：多面岩石鑿成的盾，裂縫透出熔金色 */
  PAINTERS.rockarmor = function (c, R) {
    background(c, R, PAL.earth);
    coreGlow(c, 128, 124, 120, '#c27a2a', '#ffcf80');
    /* 盾形外輪廓上的頂點，切成三角鑿面 */
    var outline = [[128, 34], [176, 46], [206, 82], [204, 136], [180, 184], [128, 226], [76, 184], [52, 136], [50, 82], [80, 46]];
    var center = [128, 124];
    var inner = outline.map(function (p, i) {
      var t = 0.52 + (i % 2) * 0.08;
      return [lerp(center[0], p[0], t) + (R() - 0.5) * 8, lerp(center[1], p[1], t) + (R() - 0.5) * 8];
    });
    var light = [-0.6, -0.8]; /* 左上主光 */
    var face = function (pts) {
      var ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], bx = pts[2][0] - pts[0][0], by = pts[2][1] - pts[0][1];
      var mx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3 - center[0], my = (pts[0][1] + pts[1][1] + pts[2][1]) / 3 - center[1];
      var len = Math.hypot(mx, my) || 1;
      var shade = 0.5 + 0.5 * ((mx / len) * light[0] + (my / len) * light[1]) + (R() - 0.5) * 0.25;
      shade = Math.max(0, Math.min(1, shade));
      c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); c.lineTo(pts[1][0], pts[1][1]); c.lineTo(pts[2][0], pts[2][1]); c.closePath();
      c.fillStyle = mix('#2a1a0e', '#c49a6a', shade); c.fill();
      c.strokeStyle = 'rgba(20,10,4,0.6)'; c.lineWidth = 1; c.stroke();
      void ax; void ay; void bx; void by;
    };
    for (var i = 0; i < outline.length; i++) {
      var j = (i + 1) % outline.length;
      face([outline[i], outline[j], inner[i]]);
      face([outline[j], inner[j], inner[i]]);
    }
    /* 中央寶石狀的岩核 */
    c.beginPath();
    inner.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
    c.closePath();
    var cg = c.createLinearGradient(80, 70, 180, 190);
    cg.addColorStop(0, '#a2785a'); cg.addColorStop(1, '#3a2414');
    c.fillStyle = cg; c.fill();
    /* 熔金裂縫 */
    var cracks = [[[128, 124], [118, 100], [124, 74], [114, 52]], [[128, 124], [150, 134], [168, 158], [184, 166]],
      [[128, 124], [108, 146], [96, 178]], [[128, 124], [154, 108], [182, 98]], [[128, 124], [104, 118], [70, 112]]];
    cracks.forEach(function (cr) {
      add(c);
      strokePts(c, cr, 5, rgba('#ff9a2a', 0.35), 12, '#ff8a1e');
      strokePts(c, cr, 1.8, rgba('#ffe7a0', 0.95), 4, '#ffcf6a');
      normal(c);
    });
    add(c); glowDot(c, 128, 124, 26, '#ffcf6a', 0.9); normal(c);
    /* 盾緣亮線 */
    c.save(); add(c);
    c.beginPath(); outline.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.closePath();
    c.strokeStyle = 'rgba(255,200,130,0.5)'; c.lineWidth = 2; c.shadowBlur = 10; c.shadowColor = '#ff9a2a'; c.stroke();
    c.restore();
    /* 浮空碎石 */
    for (var k = 0; k < 6; k++) {
      var a = range(R, 0, TAU), d = range(R, 104, 118);
      shard(c, 128 + Math.cos(a) * d, 128 + Math.sin(a) * d, a + range(R, -2, 2), range(R, 10, 16), range(R, 7, 11), '#b48a60', '#3e2614', { ridge: 0.3, mid: 0.5 });
    }
    motes(c, R, 12, [20, 20, 236, 236], ['#ffcf6a'], 1, 2);
  };

  /* 泥沼術：不規則的毒泥潭（雜訊擾動的輪廓、散落的毒液窪、氣泡與毒氣），刻意不用同心圓 */
  PAINTERS.mire = function (c, R) {
    background(c, R, Object.assign({ cy: 150 }, PAL.swamp));
    /* 不規則輪廓：半徑疊幾個不同頻率的正弦，再壓成斜視 */
    var blob = function (cx, cy, r, sq, seedPh, amp) {
      var pts = [], ph = [seedPh, seedPh * 1.7 + 1, seedPh * 2.3 + 2];
      for (var i = 0; i < 72; i++) {
        var a = i / 72 * TAU;
        var k = 1 + amp * (0.55 * Math.sin(a * 3 + ph[0]) + 0.3 * Math.sin(a * 5 + ph[1]) + 0.18 * Math.sin(a * 9 + ph[2]));
        pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k * sq]);
      }
      return pts;
    };
    var path = function (pts) {
      c.beginPath();
      pts.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); });
      c.closePath();
    };
    /* 泥潭外緣的毒光 */
    var outer = blob(128, 156, 112, 0.6, range(R, 0, TAU), 0.22);
    c.save(); add(c); path(outer); c.shadowBlur = 24; c.shadowColor = '#7ad02a'; c.fillStyle = 'rgba(90,150,30,0.35)'; c.fill(); c.restore();
    /* 泥潭本體 */
    path(outer);
    var mg = c.createLinearGradient(0, 90, 0, 230);
    mg.addColorStop(0, '#4a3a16'); mg.addColorStop(0.5, '#2c220c'); mg.addColorStop(1, '#140f05');
    c.fillStyle = mg; c.fill();
    c.save(); path(outer); c.clip();
    /* 泥面的流紋（不規則彎曲，不繞中心） */
    add(c);
    for (var i = 0; i < 7; i++) {
      var x0 = range(R, 30, 120), y0 = range(R, 110, 210);
      var p = bezPts([x0, y0], [x0 + range(R, 20, 60), y0 + range(R, -30, 30)], [x0 + range(R, 60, 110), y0 + range(R, -30, 30)], [x0 + range(R, 100, 150), y0 + range(R, -20, 20)], 24);
      ribbon(c, p, function (t) { return range(R, 3, 6) * Math.sin(Math.PI * t); }, rgba('#8a6a30', 0.35));
    }
    normal(c);
    /* 散落的毒液窪：大小、位置、形狀都不同 */
    var pools = [[100, 150, 30], [162, 170, 22], [142, 128, 14], [72, 182, 12], [190, 140, 10]];
    pools.forEach(function (q) {
      var pp = blob(q[0], q[1], q[2], 0.55, range(R, 0, TAU), 0.3);
      c.save(); add(c); path(pp); c.shadowBlur = 8; c.shadowColor = '#9be04a';
      var pg = c.createRadialGradient(q[0] - q[2] * 0.3, q[1] - q[2] * 0.2, 0, q[0], q[1], q[2] * 1.2);
      pg.addColorStop(0, 'rgba(210,255,130,0.85)'); pg.addColorStop(0.4, 'rgba(110,200,40,0.6)'); pg.addColorStop(1, 'rgba(50,110,15,0.35)');
      c.fillStyle = pg; c.fill(); c.restore();
    });
    c.restore();
    /* 泥潭邊緣：不描整圈硬邊，只在上緣（朝光的那側）留一道濕亮的泥唇 */
    var lip = outer.filter(function (p) { return p[1] < 156; });
    lip.sort(function (a, b) { return a[0] - b[0]; });
    add(c);
    strokePts(c, lip, 1.6, 'rgba(200,170,110,0.45)', 6, 'rgba(160,220,80,0.6)');
    normal(c);
    /* 濺到泥潭外的泥點 */
    for (var sp = 0; sp < 10; sp++) {
      var oa = range(R, 0, TAU), od = range(R, 1.05, 1.25), op = outer[Math.floor(oa / TAU * outer.length)];
      var sx = 128 + (op[0] - 128) * od, sy = 156 + (op[1] - 156) * od, sr = range(R, 2, 5);
      c.fillStyle = '#3a2c10'; c.beginPath(); c.ellipse(sx, sy, sr * 1.4, sr * 0.8, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(200,170,110,0.5)'; c.beginPath(); c.arc(sx - sr * 0.4, sy - sr * 0.3, sr * 0.35, 0, TAU); c.fill();
    }
    /* 氣泡（有的完整、有的破開成小圈） */
    for (var b = 0; b < 8; b++) {
      var x = range(R, 60, 196), y = range(R, 118, 196), r = range(R, 4, 12);
      add(c); glowDot(c, x, y, r * 2.4, '#7ad02a', 0.35); normal(c);
      if (b % 3 === 2) {
        c.save(); add(c); c.strokeStyle = 'rgba(200,255,140,0.75)'; c.lineWidth = 1.5;
        c.beginPath(); c.ellipse(x, y, r * 1.3, r * 0.5, 0, 0, TAU); c.stroke(); c.restore();
        continue;
      }
      var bg = c.createRadialGradient(x - r * 0.4, y - r * 0.4, 0, x, y, r);
      bg.addColorStop(0, 'rgba(235,255,210,0.95)'); bg.addColorStop(0.5, 'rgba(120,200,60,0.55)'); bg.addColorStop(1, 'rgba(50,110,15,0.9)');
      c.fillStyle = bg; c.beginPath(); c.arc(x, y - r * 0.4, r, 0, TAU); c.fill();
    }
    /* 往上飄的毒氣 */
    add(c);
    for (var j = 0; j < 5; j++) {
      var wx = range(R, 60, 196);
      var wisp = bezPts([wx, 150], [wx - range(R, 10, 30), 110], [wx + range(R, 10, 30), 70], [wx + range(R, -14, 14), 22], 26);
      ribbon(c, wisp, function (t) { return 12 * Math.sin(Math.PI * t); }, rgba('#9be04a', 0.16));
      ribbon(c, wisp, function (t) { return 3 * Math.sin(Math.PI * t); }, rgba('#d8ff9a', 0.25));
    }
    normal(c);
    motes(c, R, 14, [30, 20, 226, 200], ['#b8f26a', '#9be04a'], 1, 2.2);
  };

  /* 大地守護：黃白聖光——天降光束、六角光盾罩、地面符文陣、中央聖光十字星 */
  PAINTERS.earthguard = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 120 }, PAL.holy));
    var cx = 128, gy = 200;
    /* 天降光束 */
    add(c);
    for (var i = 0; i < 7; i++) {
      var x = 128 + (i - 3) * 22 + range(R, -6, 6), w = range(R, 10, 26);
      var g = c.createLinearGradient(0, 0, 0, gy);
      g.addColorStop(0, 'rgba(255,248,210,0.0)'); g.addColorStop(0.35, 'rgba(255,244,190,' + range(R, 0.12, 0.25) + ')'); g.addColorStop(1, 'rgba(255,236,160,0.02)');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(x - w * 0.3, 0); c.lineTo(x + w * 0.3, 0); c.lineTo(x + w + (x - 128) * 0.4, gy); c.lineTo(x - w + (x - 128) * 0.4, gy); c.closePath(); c.fill();
    }
    normal(c);
    /* 地面符文陣（斜視橢圓＋刻度） */
    c.save(); c.translate(cx, gy); c.scale(1, 0.32);
    add(c);
    glowDot(c, 0, 0, 118, '#ffe48a', 0.5);
    c.strokeStyle = 'rgba(255,240,180,0.85)'; c.lineWidth = 3; c.shadowBlur = 12; c.shadowColor = '#ffd86a';
    c.beginPath(); c.arc(0, 0, 100, 0, TAU); c.stroke();
    c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 80, 0, TAU); c.stroke();
    for (var k = 0; k < 24; k++) {
      var a = k / 24 * TAU;
      c.beginPath(); c.moveTo(Math.cos(a) * 82, Math.sin(a) * 82); c.lineTo(Math.cos(a) * (k % 2 ? 90 : 98), Math.sin(a) * (k % 2 ? 90 : 98)); c.stroke();
    }
    /* 陣中的六芒線 */
    c.lineWidth = 1.6;
    [0, Math.PI].forEach(function (off) {
      c.beginPath();
      for (var t = 0; t < 3; t++) { var a2 = off + t * TAU / 3 - Math.PI / 2; c[t ? 'lineTo' : 'moveTo'](Math.cos(a2) * 78, Math.sin(a2) * 78); }
      c.closePath(); c.stroke();
    });
    c.restore();
    normal(c);
    /* 六角光盾罩：半球上排六角格，越上越透 */
    var domeR = 96, domeCy = gy;
    c.save();
    c.beginPath(); c.arc(cx, domeCy, domeR, Math.PI, TAU); c.closePath(); c.clip();
    add(c);
    var dg = c.createRadialGradient(cx, domeCy, 30, cx, domeCy, domeR);
    dg.addColorStop(0, 'rgba(255,250,220,0.05)'); dg.addColorStop(0.8, 'rgba(255,240,180,0.12)'); dg.addColorStop(1, 'rgba(255,240,180,0.4)');
    c.fillStyle = dg; c.fillRect(0, 0, S, S);
    var hs = 16, hh = hs * Math.sqrt(3);
    c.lineWidth = 1.2;
    for (var row = -1; row < 9; row++) {
      for (var col = -1; col < 12; col++) {
        var hx = 20 + col * hs * 1.5, hy = domeCy - row * hh - (col % 2 ? hh / 2 : 0);
        var d = Math.hypot(hx - cx, hy - domeCy) / domeR;
        if (d > 1.05) continue;
        c.strokeStyle = 'rgba(255,244,200,' + (0.12 + 0.45 * d * d) + ')';
        c.beginPath();
        for (var v = 0; v < 6; v++) { var va = v / 6 * TAU; c[v ? 'lineTo' : 'moveTo'](hx + Math.cos(va) * hs * 0.92, hy + Math.sin(va) * hs * 0.92); }
        c.closePath(); c.stroke();
      }
    }
    normal(c);
    c.restore();
    c.save(); add(c);
    c.strokeStyle = 'rgba(255,248,215,0.9)'; c.lineWidth = 2.6; c.shadowBlur = 16; c.shadowColor = '#ffe07a';
    c.beginPath(); c.arc(cx, domeCy, domeR, Math.PI, TAU); c.stroke();
    c.restore();
    /* 中央聖光十字星 */
    var sy = 128;
    add(c);
    glowDot(c, cx, sy, 80, '#ffe48a', 0.55);
    [[0, 62, 7], [Math.PI / 2, 46, 6], [Math.PI / 4, 26, 3], [-Math.PI / 4, 26, 3]].forEach(function (ray) {
      [1, -1].forEach(function (sgn) {
        var a = ray[0] + (sgn < 0 ? Math.PI : 0);
        var p = linePts(cx, sy, cx + Math.sin(a) * ray[1], sy - Math.cos(a) * ray[1], 8);
        ribbon(c, p, function (t) { return ray[2] * 2 * (1 - t); }, alongGrad(c, p, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,236,160,0)']]));
      });
    });
    normal(c);
    coreGlow(c, cx, sy, 30, '#ffe48a', '#ffffff');
    motes(c, R, 24, [30, 30, 226, 220], ['#fff2b0', '#ffe48a', '#ffffff'], 1, 2.4);
  };

  /* 連鎖閃電：五個光點沿不閉合的五角形跳一圈，均勻鋪滿正方形（W 形會被看成英文字母） */
  PAINTERS.chainlightning = function (c, R) {
    background(c, R, PAL.boltBlue);
    var nodes = [[46, 104], [116, 54], [208, 84], [182, 184], [88, 210]];
    for (var i = 0; i < nodes.length - 1; i++) {
      lightning(c, nodes[i][0], nodes[i][1], nodes[i + 1][0], nodes[i + 1][1], R, { width: 3.6, branches: 1, rough: 0.18, color: '#5aa8ff' });
    }
    nodes.forEach(function (n, i) {
      var big = i === 0 || i === nodes.length - 1;
      coreGlow(c, n[0], n[1], big ? 40 : 30, '#3a8cff', '#ffffff');
      sparkle(c, n[0], n[1], big ? 26 : 18, '#8fd0ff', i * 0.6);
    });
    motes(c, R, 18, [10, 10, 246, 246], ['#8fd0ff', '#c8e6ff'], 1, 2.2);
  };

  /* 落雷術：雷雲劈下巨雷，地面炸開 */
  PAINTERS.thunderstrike = function (c, R) {
    background(c, R, Object.assign({ cy: 60 }, PAL.bolt));
    /* 雷雲 */
    for (var i = 0; i < 16; i++) {
      var x = range(R, -10, 266), y = range(R, 10, 56), r = range(R, 24, 46);
      var g = c.createRadialGradient(x, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, '#5a4690'); g.addColorStop(0.6, '#2a1e4a'); g.addColorStop(1, 'rgba(20,14,40,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    add(c); glowDot(c, 128, 48, 70, '#ffd84a', 0.45); normal(c);
    /* 地面撞擊 */
    add(c);
    c.save(); c.translate(128, 216); c.scale(1, 0.28);
    glowDot(c, 0, 0, 120, '#ffb020', 0.85);
    c.strokeStyle = 'rgba(255,240,180,0.8)'; c.lineWidth = 5; c.beginPath(); c.arc(0, 0, 70, 0, TAU); c.stroke();
    c.lineWidth = 3; c.strokeStyle = 'rgba(255,220,120,0.5)'; c.beginPath(); c.arc(0, 0, 100, 0, TAU); c.stroke();
    c.restore();
    for (var k = 0; k < 12; k++) {
      var a = range(R, Math.PI * 1.05, Math.PI * 1.95), ln = range(R, 30, 70);
      ribbon(c, linePts(128, 214, 128 + Math.cos(a) * ln * 1.4, 214 + Math.sin(a) * ln, 6), function (t) { return 4 * (1 - t); }, rgba('#ffe7a0', 0.75));
    }
    normal(c);
    lightning(c, 118, 40, 128, 214, R, { width: 7.5, branches: 4, rough: 0.16, depth: 7 });
    lightning(c, 60, 46, 84, 120, R, { width: 2.2, rough: 0.3 });
    lightning(c, 200, 44, 176, 110, R, { width: 2.2, rough: 0.3 });
    coreGlow(c, 128, 212, 40, '#ffb020', '#ffffff');
    motes(c, R, 18, [20, 120, 236, 240], ['#ffd84a', '#ffffff'], 1, 2.4);
  };

  /* 雷球：半透明電漿球，淡藍帶紫的電弧四竄（使用者指定色系；不要整顆發白） */
  PAINTERS.thunderorb = function (c, R) {
    background(c, R, PAL.orb);
    var cx = 128, cy = 128, r = 70;
    add(c);
    glowDot(c, cx, cy, 116, '#7a7cff', 0.3);
    var g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(240,244,255,0.95)'); g.addColorStop(0.12, 'rgba(176,196,255,0.7)'); g.addColorStop(0.45, 'rgba(120,110,230,0.16)');
    g.addColorStop(0.85, 'rgba(170,170,255,0.32)'); g.addColorStop(1, 'rgba(170,170,255,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    normal(c);
    /* 球內偏暗，電弧才看得清楚 */
    c.save(); c.globalCompositeOperation = 'multiply';
    var dk = c.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    dk.addColorStop(0, 'rgba(255,255,255,1)'); dk.addColorStop(1, 'rgba(110,100,170,1)');
    c.fillStyle = dk; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    c.restore();
    for (var i = 0; i < 6; i++) {
      var a = i / 6 * TAU + range(R, -0.3, 0.3);
      lightning(c, cx, cy, cx + Math.cos(a) * r * 0.96, cy + Math.sin(a) * r * 0.96, R, { width: 1.6, rough: 0.35, depth: 5, color: '#a8b8ff' });
    }
    for (var j = 0; j < 4; j++) {
      var a2 = range(R, 0, TAU), a3 = a2 + range(R, 0.5, 0.9);
      lightning(c, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r, cx + Math.cos(a3) * (r + 32), cy + Math.sin(a3) * (r + 32), R, { width: 1.6, rough: 0.4, depth: 4, color: '#b8a8ff' });
    }
    c.save(); add(c);
    c.strokeStyle = 'rgba(200,210,255,0.85)'; c.lineWidth = 2.4; c.shadowBlur = 16; c.shadowColor = '#8a8cff';
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
    c.restore();
    add(c);
    ribbon(c, arcPts(cx, cy, r * 0.82, Math.PI * 1.1, Math.PI * 1.45, 16), function (t) { return 6 * Math.sin(Math.PI * t); }, 'rgba(255,255,255,0.45)');
    normal(c);
    coreGlow(c, cx, cy, 22, '#a8b8ff');
    motes(c, R, 16, [10, 10, 246, 246], ['#b8c4ff', '#c8a8ff'], 1, 2.2);
  };

  /* 寒冰箭：魔法凝成的冰錐飛彈——多面冰晶本體、兩側小冰晶，霜氣螺旋纏繞的尾跡（不畫箭桿箭羽） */
  PAINTERS.icearrow = function (c, R) {
    background(c, R, PAL.ice);
    var tx = 206, ty = 52;            /* 冰錐尖 */
    var ang = Math.atan2(-1, 1.05), dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
    var tailX = tx - dx * 230, tailY = ty - dy * 230;
    /* 寒霜尾跡 */
    swoosh(c, linePts(tailX, tailY, tx - dx * 70, ty - dy * 70, 24), 56, '#3a9aff', { taper: 'head', edge: false });
    /* 纏繞冰錐的螺旋霜氣 */
    var helix = function (phase, color) {
      var pts = [];
      for (var i = 0; i < 80; i++) {
        var t = i / 79, along = lerp(150, 30, t) * -1;
        var amp = lerp(6, 26, Math.sin(Math.PI * Math.min(1, t * 1.1)));
        var w = Math.sin(t * TAU * 2.2 + phase) * amp;
        pts.push([tx + dx * (along - 40) + nx * w, ty + dy * (along - 40) + ny * w]);
      }
      swoosh(c, pts, 7, color, { taper: 'head', edge: false });
    };
    helix(0, '#9fe0ff');
    helix(Math.PI, '#5fb8ff');
    /* 兩側伴飛的小冰晶 */
    [[-1, 0.9], [1, 0.75]].forEach(function (s) {
      var bx = tx - dx * 100 + nx * s[0] * 34, by = ty - dy * 100 + ny * s[0] * 34;
      shard(c, bx, by, ang, 54 * s[1], 18 * s[1], '#dff4ff', '#2a64b0', { mid: 0.35 });
    });
    /* 主冰錐：長而粗的多面晶體，後端再接一截短晶體當底座 */
    var baseX = tx - dx * 128, baseY = ty - dy * 128;
    shard(c, baseX, baseY, ang + Math.PI, 26, 34, '#a8d8ff', '#163e80', { mid: 0.2, ridge: 0.4 });
    shard(c, baseX, baseY, ang, 128, 40, '#eaf8ff', '#2a64b0', { mid: 0.22 });
    /* 晶體內部的冷光 */
    add(c);
    strokePts(c, linePts(baseX + dx * 10, baseY + dy * 10, tx - dx * 20, ty - dy * 20, 2), 6, 'rgba(160,220,255,0.35)', 12, '#5fb8ff');
    normal(c);
    coreGlow(c, tx, ty, 38, '#5fb8ff');
    sparkle(c, tx, ty, 20, '#9fd8ff', 0.25);
    motes(c, R, 26, [10, 40, 240, 250], ['#cfeeff', '#8fd3ff'], 1, 2.4);
  };

  /* 水流彈：水球裡捲著漩流，四周水花 */
  PAINTERS.waterball = function (c, R) {
    background(c, R, PAL.water);
    var cx = 128, cy = 132, r = 74;
    /* 外圍水流 */
    swoosh(c, arcPts(cx, cy, r + 22, Math.PI * 0.6, Math.PI * 1.75, 50), 20, '#3ac0ff', { taper: 'head' });
    swoosh(c, arcPts(cx, cy, r + 18, Math.PI * 1.65, Math.PI * 2.75, 50), 14, '#7ae0ff', { taper: 'head' });
    /* 水球本體 */
    var g = c.createRadialGradient(cx - 22, cy - 26, 6, cx, cy, r);
    g.addColorStop(0, '#bff0ff'); g.addColorStop(0.35, '#2a9ae0'); g.addColorStop(0.8, '#0a3c8a'); g.addColorStop(1, '#06265a');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.fill();
    /* 內部漩流 */
    c.save(); c.beginPath(); c.arc(cx, cy, r - 2, 0, TAU); c.clip();
    add(c);
    for (var k = 0; k < 3; k++) {
      var sp = spiralPts(cx, cy, r * 0.95, 8, k * TAU / 3, 0.9, 40);
      ribbon(c, sp, function (t) { return 14 * Math.sin(Math.PI * t); }, rgba('#7ae0ff', 0.35));
      ribbon(c, sp, function (t) { return 3 * Math.sin(Math.PI * t); }, rgba('#ffffff', 0.6));
    }
    normal(c);
    c.restore();
    /* 邊緣折射亮線＋高光 */
    c.save(); add(c);
    c.strokeStyle = 'rgba(160,235,255,0.75)'; c.lineWidth = 2.5; c.shadowBlur = 12; c.shadowColor = '#3ac0ff';
    c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
    c.restore();
    c.save();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath(); c.ellipse(cx - 30, cy - 36, 18, 8, -0.7, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.beginPath(); c.arc(cx - 6, cy - 52, 4, 0, TAU); c.fill();
    c.restore();
    /* 水滴 */
    for (var i = 0; i < 10; i++) {
      var a = range(R, 0, TAU), d = range(R, r + 18, r + 44), dr = range(R, 3, 7);
      var x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      var dg = c.createRadialGradient(x - dr * 0.3, y - dr * 0.3, 0, x, y, dr);
      dg.addColorStop(0, '#e8fbff'); dg.addColorStop(0.6, '#3ac0ff'); dg.addColorStop(1, '#0a4a9a');
      c.fillStyle = dg; c.beginPath(); c.arc(x, y, dr, 0, TAU); c.fill();
    }
    motes(c, R, 10, [10, 10, 246, 246], ['#7ae0ff'], 1, 2);
  };

  /* 冰霜新星：中心爆開一圈冰刺 */
  PAINTERS.frostnova = function (c, R) {
    background(c, R, PAL.ice);
    var cx = 128, cy = 128;
    /* 霜環 */
    add(c);
    c.save(); c.strokeStyle = 'rgba(150,215,255,0.55)'; c.lineWidth = 6; c.shadowBlur = 20; c.shadowColor = '#5fb8ff';
    c.beginPath(); c.arc(cx, cy, 98, 0, TAU); c.stroke(); c.restore();
    glowDot(c, cx, cy, 110, '#3a8ae0', 0.5);
    normal(c);
    /* 冰刺（長短交錯） */
    var n = 12;
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU + 0.13 + range(R, -0.06, 0.06);
      var long = i % 2 === 0;
      var len = long ? range(R, 92, 108) : range(R, 58, 72);
      var st = long ? 18 : 26;
      shard(c, cx + Math.cos(a) * st, cy + Math.sin(a) * st, a, len, long ? 22 : 16, '#e2f6ff', '#2a68b4');
    }
    /* 中心雪花 */
    add(c);
    for (var k = 0; k < 6; k++) {
      var a2 = k / 6 * TAU;
      var arm = linePts(cx, cy, cx + Math.cos(a2) * 34, cy + Math.sin(a2) * 34, 2);
      strokePts(c, arm, 3, 'rgba(255,255,255,0.95)', 8, '#9fd8ff');
      [0.5, 0.75].forEach(function (f) {
        var bx = cx + Math.cos(a2) * 34 * f, by = cy + Math.sin(a2) * 34 * f;
        [-0.8, 0.8].forEach(function (s) {
          strokePts(c, [[bx, by], [bx + Math.cos(a2 + s) * 9, by + Math.sin(a2 + s) * 9]], 2, 'rgba(255,255,255,0.9)');
        });
      });
    }
    normal(c);
    coreGlow(c, cx, cy, 34, '#7ac8ff');
    motes(c, R, 26, [10, 10, 246, 246], ['#cfeeff', '#8fd3ff'], 1, 2.4);
  };

  /* 風刃：三道新月風刃錯落飛出，落葉隨行 */
  PAINTERS.windblade = function (c, R) {
    background(c, R, Object.assign({ cx: 128, cy: 128 }, PAL.wind));
    /* 氣流線 */
    add(c);
    for (var i = 0; i < 6; i++) {
      var y0 = range(R, 40, 230);
      var p = bezPts([0, y0 + 30], [70, y0 + 10], [150, y0 - 30], [256, y0 - 70], 30);
      ribbon(c, p, function (t) { return 3 * Math.sin(Math.PI * t); }, rgba('#8ff5c0', range(R, 0.12, 0.3)));
    }
    normal(c);
    var blade = function (cx, cy, r, rot, w) {
      swoosh(c, arcPts(cx, cy, r, rot - 1.25, rot + 1.25, 40), w, '#5ef0a8', { side: 1 });
    };
    /* 圓心＋半徑往右上 0.7r 才是刀光的實際位置，所以圓心刻意偏左下，讓三道刀光的重心落在畫面中央 */
    blade(53, 214, 46, -0.75, 18);
    blade(87, 162, 58, -0.75, 24);
    blade(133, 112, 50, -0.75, 20);
    /* 葉片 */
    for (var k = 0; k < 7; k++) {
      var x = range(R, 30, 230), y = range(R, 30, 230), ang = range(R, 0, TAU), s = range(R, 0.6, 1.1);
      c.save(); c.translate(x, y); c.rotate(ang); c.scale(s, s);
      c.beginPath(); c.moveTo(-9, 0); c.quadraticCurveTo(0, -6, 9, 0); c.quadraticCurveTo(0, 6, -9, 0); c.closePath();
      c.fillStyle = '#5ad08a'; c.fill();
      c.strokeStyle = 'rgba(220,255,230,0.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-8, 0); c.lineTo(8, 0); c.stroke();
      c.restore();
    }
    motes(c, R, 14, [10, 10, 246, 246], ['#c8ffe0', '#8ff5c0'], 1, 2.2);
  };

  /* 真空斬：X 形斬擊劈開虛空裂口 */
  PAINTERS.vacuumslash = function (c, R) {
    background(c, R, PAL.vacuum);
    var cx = 128, cy = 128;
    /* 虛空：被吸入的旋臂＋黑洞 */
    add(c);
    for (var k = 0; k < 4; k++) {
      var sp = spiralPts(cx, cy, 104, 20, k * TAU / 4, 0.85, 44);
      ribbon(c, sp, function (t) { return 12 * Math.sin(Math.PI * t); }, rgba('#4ad8e8', 0.32));
      ribbon(c, sp, function (t) { return 2.5 * Math.sin(Math.PI * t); }, rgba('#d8ffff', 0.55));
    }
    normal(c);
    var vg = c.createRadialGradient(cx, cy, 0, cx, cy, 46);
    vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(0.7, 'rgba(2,10,16,0.95)'); vg.addColorStop(1, 'rgba(2,10,16,0)');
    c.fillStyle = vg; c.beginPath(); c.arc(cx, cy, 46, 0, TAU); c.fill();
    c.save(); add(c);
    c.strokeStyle = 'rgba(160,250,255,0.85)'; c.lineWidth = 2; c.shadowBlur = 14; c.shadowColor = '#4ad8e8';
    c.beginPath(); c.arc(cx, cy, 34, 0, TAU); c.stroke();
    c.restore();
    /* 兩道斬擊 */
    var s1 = bezPts([36, 50], [100, 100], [150, 150], [222, 210], 40);
    var s2 = bezPts([214, 44], [160, 98], [108, 152], [40, 216], 40);
    swoosh(c, s1, 22, '#7af0ff');
    swoosh(c, s2, 26, '#b8ffff');
    sparkle(c, cx, cy, 40, '#9ff0ff', 0.78);
    /* 被切碎的空間碎片 */
    for (var i = 0; i < 8; i++) {
      var a = range(R, 0, TAU), d = range(R, 56, 108);
      shard(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, a, range(R, 10, 18), range(R, 5, 8), '#d8ffff', '#1a6a80', { ridge: 0.5 });
    }
    motes(c, R, 14, [10, 10, 246, 246], ['#c8ffff'], 1, 2);
  };

  /* 暴風屏障：多道傾斜氣旋環繞成球狀屏障 */
  PAINTERS.stormbarrier = function (c, R) {
    background(c, R, PAL.wind);
    var cx = 128, cy = 130;
    add(c);
    var dg = c.createRadialGradient(cx, cy, 30, cx, cy, 100);
    dg.addColorStop(0, 'rgba(120,255,190,0)'); dg.addColorStop(0.85, 'rgba(120,255,190,0.12)'); dg.addColorStop(1, 'rgba(160,255,210,0.35)');
    c.fillStyle = dg; c.beginPath(); c.arc(cx, cy, 100, 0, TAU); c.fill();
    normal(c);
    var tilts = [-0.5, 0.35, 1.2, -1.25];
    var ell = function (tilt, a0, a1, rx, ry) {
      var pts = [];
      for (var i = 0; i < 50; i++) {
        var a = lerp(a0, a1, i / 49), x = Math.cos(a) * rx, y = Math.sin(a) * ry;
        pts.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
      }
      return pts;
    };
    /* 背面（暗） */
    tilts.forEach(function (t) {
      add(c);
      ribbon(c, ell(t, Math.PI, TAU, 98, 34), function (u) { return 8 * Math.sin(Math.PI * u); }, rgba('#2ab880', 0.4));
      normal(c);
    });
    coreGlow(c, cx, cy, 44, '#5ef0a8', '#f0fff6');
    /* 正面（亮、帶頭） */
    tilts.forEach(function (t, i) {
      swoosh(c, ell(t, 0.1, Math.PI * 0.95, 98, 34), 14 - i, i % 2 ? '#8ff5c0' : '#5ef0d0', { taper: 'head' });
    });
    /* 被捲起的葉子 */
    for (var k = 0; k < 6; k++) {
      var a = range(R, 0, TAU), d = range(R, 70, 112);
      var x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8;
      c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2);
      c.beginPath(); c.moveTo(-8, 0); c.quadraticCurveTo(0, -5, 8, 0); c.quadraticCurveTo(0, 5, -8, 0); c.closePath();
      c.fillStyle = '#5ad08a'; c.fill();
      c.restore();
    }
    motes(c, R, 18, [10, 10, 246, 246], ['#c8ffe0', '#8ff5c0'], 1, 2.2);
  };

  /* 元素主色（外框微光用） */
  var KEY = {
    thrust: PAL.steel.key, cleave: PAL.gold.key, knife: PAL.steel.key, gale: PAL.bolt.key,
    bloodblade: PAL.blood.key, dualdance: PAL.blood.key, counter: PAL.gold.key, bloodrage: PAL.blood.key,
    fireball: PAL.fire.key, firepillar: PAL.fire.key, firehunt: PAL.fire.key,
    rockarmor: PAL.earth.key, mire: PAL.swamp.key, earthguard: PAL.holy.key,
    chainlightning: PAL.boltBlue.key, thunderstrike: PAL.bolt.key, thunderorb: PAL.orb.key,
    icearrow: PAL.ice.key, waterball: PAL.water.key, frostnova: PAL.ice.key,
    windblade: PAL.wind.key, vacuumslash: PAL.vacuum.key, stormbarrier: PAL.wind.key
  };

  /* 畫一張圖示到 size×size 的 canvas 並回傳它 */
  function paint(gid, size) {
    var painter = PAINTERS[gid];
    if (!painter) throw new Error('沒有這個技能群組的畫法：' + gid);
    var cv = makeCanvas(S, S), c = cv.getContext('2d');
    var R = mulberry32(hashStr(gid));
    c.save(); painter(c, R); c.restore();
    normal(c); c.globalAlpha = 1;
    bloom(c, 7, 0.4);
    vignette(c, 0.7);
    frame(c, KEY[gid] || '#ffffff');
    if (!size || size === S) return cv;
    /* 逐次減半縮圖，細線才不會閃爍 */
    var cur = cv, w = S;
    while (w / 2 >= size) {
      var half = makeCanvas(w / 2, w / 2), hc = half.getContext('2d');
      hc.imageSmoothingEnabled = true; hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, 0, 0, w / 2, w / 2);
      cur = half; w = w / 2;
    }
    if (w !== size) {
      var out = makeCanvas(size, size), oc = out.getContext('2d');
      oc.imageSmoothingEnabled = true; oc.imageSmoothingQuality = 'high';
      oc.drawImage(cur, 0, 0, size, size);
      cur = out;
    }
    return cur;
  }

  root.SkillIconPainter = { paint: paint, ids: Object.keys(PAINTERS), SIZE: S };
})(typeof self !== 'undefined' ? self : this);
