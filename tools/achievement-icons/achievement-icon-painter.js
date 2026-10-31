/* 成就圖示程序化繪製（config/CSV/Achievement.csv，115 枚）。
 *
 * 遊戲用的是這批畫出來的 PNG（images/achievements/ach_NNN.png，128x128），執行期不跑這些檔案。
 * 要改圖：改 tools/achievement-icons/*.js → node tools/achievement-icons/achievement-icon-server.cjs
 *        → 開 http://localhost:28392/ → 按「輸出全部」。
 *
 * 全部是 Canvas 2D 程序化繪製，沒有外部素材、沒有描圖。
 * 技能超神徽章（ids 50-115）會把遊戲自己的 images/skills/<群組>.png 當主體；
 * 符文真言徽章會用遊戲自己的 images/runes/stone-rNN.png 當主體。
 *
 * 檔案分工：
 *   achievement-icon-painter.js  工具函式、獎牌外框（medal）、規格表（specFor）、paintIcon
 *   ach-motifs-equip.js          裝備／等級／強化／太古／寶石類主題
 *   ach-motifs-craft.js          鍛造／符文／轉生／高塔／魔物主題
 *   ach-motifs-skill.js          技能超神徽章
 *
 * 座標：256x256 內部座標，獎牌中心 (128,128)；主題一律在 translate(128,128) 後以原點為中心繪製，
 * 可用內圈半徑約 92。
 */
(function (root) {
  'use strict';

  var S = 256, TAU = Math.PI * 2;
  var ACH = root.ACH = { S: S, motifs: {}, imgs: {} };

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
  function hexRgb(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = hexRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a === undefined ? 1 : a) + ')'; }
  function toHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
  }
  function mix(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }
  function hsl(h, s, l) {
    h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); };
    return toHex(f(0) * 255, f(8) * 255, f(4) * 255);
  }
  function rgbHue(hex) {
    var c = hexRgb(hex), r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    var h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function range(R, a, b) { return a + (b - a) * R(); }
  function add(c) { c.globalCompositeOperation = 'lighter'; }
  function normal(c) { c.globalCompositeOperation = 'source-over'; }

  function glowDot(c, x, y, r, color, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(color, a === undefined ? 1 : a));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  function coreGlow(c, x, y, r, color, hot) {
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hot || '#ffffff', 1));
    g.addColorStop(0.18, rgba(hot || '#ffffff', 0.9));
    g.addColorStop(0.4, rgba(color, 0.55));
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  function sparkle(c, x, y, r, color, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    add(c); glowDot(c, 0, 0, r * 0.7, color, 0.55);
    c.fillStyle = rgba('#ffffff', 0.95);
    c.beginPath();
    var w = r * 0.07;
    c.moveTo(0, -r); c.quadraticCurveTo(w, -w, r, 0); c.quadraticCurveTo(w, w, 0, r);
    c.quadraticCurveTo(-w, w, -r, 0); c.quadraticCurveTo(-w, -w, 0, -r);
    c.fill(); c.restore(); normal(c);
  }
  function motes(c, R, n, box, colors, rMin, rMax, inside) {
    add(c);
    for (var i = 0; i < n; i++) {
      var x = range(R, box[0], box[2]), y = range(R, box[1], box[3]);
      if (inside && Math.hypot(x, y) > inside) continue;
      var r = range(R, rMin, rMax), col = colors[Math.floor(R() * colors.length)];
      glowDot(c, x, y, r * 3, col, 0.35);
      c.fillStyle = rgba('#ffffff', 0.9); c.beginPath(); c.arc(x, y, r * 0.5, 0, TAU); c.fill();
    }
    normal(c);
  }
  function poly(c, pts) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
  }
  function lin(c, x0, y0, x1, y1, stops) {
    var g = c.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }
  function rad(c, x, y, r0, r1, stops) {
    var g = c.createRadialGradient(x, y, r0, x, y, r1);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    return g;
  }
  /* 帶著色調的鋼材漸層（左上亮、右下暗） */
  function steel(c, x0, y0, x1, y1, tint, k) {
    k = k === undefined ? 0.3 : k;
    return lin(c, x0, y0, x1, y1, [
      [0, mix('#cfd8e6', tint, k)], [0.35, mix('#6d7890', tint, k)], [0.7, mix('#2d3445', tint, k * 0.9)], [1, mix('#12151f', tint, k * 0.6)]]);
  }
  function rimLine(c, color, w, a) { c.strokeStyle = rgba(color, a === undefined ? 0.9 : a); c.lineWidth = w; c.stroke(); }
  /* 直射光芒：直線 */
  function rays(c, x, y, r0, r1, n, color, alpha, rot, wdt) {
    add(c);
    for (var i = 0; i < n; i++) {
      var a = (rot || 0) + i * TAU / n;
      var g = c.createLinearGradient(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      g.addColorStop(0, rgba(color, alpha)); g.addColorStop(1, rgba(color, 0));
      c.fillStyle = g;
      var w = (wdt || 0.05);
      c.beginPath();
      c.moveTo(x + Math.cos(a - w) * r0, y + Math.sin(a - w) * r0);
      c.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
      c.lineTo(x + Math.cos(a + w) * r0, y + Math.sin(a + w) * r0);
      c.closePath(); c.fill();
    }
    normal(c);
  }
  function ringGlow(c, x, y, r, w, color, a) {
    add(c);
    c.lineWidth = w * 3; c.strokeStyle = rgba(color, (a || 1) * 0.18); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.lineWidth = w; c.strokeStyle = rgba(color, (a || 1) * 0.8); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    c.lineWidth = Math.max(1, w * 0.35); c.strokeStyle = rgba('#ffffff', (a || 1) * 0.8); c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    normal(c);
  }
  function numeral(c, text, x, y, size, fill, stroke) {
    c.save();
    c.font = '900 ' + size + 'px "Georgia","Times New Roman",serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = size * 0.2; c.strokeStyle = stroke || 'rgba(10,6,2,0.9)';
    c.strokeText(text, x, y + 1);
    c.fillStyle = fill || lin(c, 0, y - size / 2, 0, y + size / 2, [[0, '#ffffff'], [0.45, '#ffe9a6'], [1, '#e0a63a']]);
    c.fillText(text, x, y + 1);
    c.restore();
  }
  function banner(c, text, x, y, w, h, col, size) {
    c.save(); c.translate(x, y);
    var g = lin(c, 0, -h / 2, 0, h / 2, [[0, mix(col, '#000', 0.45)], [1, mix(col, '#000', 0.8)]]);
    c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
    c.fillStyle = g;
    c.beginPath(); c.moveTo(-w / 2 - 10, -h / 2 + 3); c.lineTo(-w / 2, -h / 2); c.lineTo(w / 2, -h / 2); c.lineTo(w / 2 + 10, -h / 2 + 3);
    c.lineTo(w / 2 + 4, 0); c.lineTo(w / 2 + 10, h / 2 - 3); c.lineTo(w / 2, h / 2); c.lineTo(-w / 2, h / 2); c.lineTo(-w / 2 - 10, h / 2 - 3);
    c.lineTo(-w / 2 - 4, 0); c.closePath(); c.fill();
    c.shadowBlur = 0; c.shadowOffsetY = 0;
    c.strokeStyle = lin(c, 0, -h / 2, 0, h / 2, [[0, '#fff0b8'], [0.5, '#d4a23a'], [1, '#7a4d0e']]); c.lineWidth = 2.4; c.stroke();
    c.strokeStyle = rgba(col, 0.7); c.lineWidth = 1;
    c.beginPath(); c.moveTo(-w / 2 + 3, -h / 2 + 4); c.lineTo(w / 2 - 3, -h / 2 + 4); c.stroke();
    numeral(c, text, 0, 0, size || h * 0.78);
    c.restore();
  }

  /* ---------- 常用物件 ---------- */
  function flameTongue(c, x, y, w, h, lean, stops) {
    c.beginPath(); c.moveTo(x - w / 2, y);
    c.bezierCurveTo(x - w * 0.62, y - h * 0.38, x - w * 0.2 + lean * 0.3, y - h * 0.62, x + lean, y - h);
    c.bezierCurveTo(x + w * 0.2 + lean * 0.3, y - h * 0.62, x + w * 0.62, y - h * 0.38, x + w / 2, y);
    c.closePath();
    var g = c.createLinearGradient(x, y, x + lean, y - h);
    stops.forEach(function (s) { g.addColorStop(s[0], s[1]); });
    c.fillStyle = g; c.fill();
  }
  /* 火焰：底在 (x,y)，往上長；col 主色，hot 芯色 */
  function flame(c, x, y, w, h, col, seed, hot) {
    var R = mulberry32(seed || 7), i;
    hot = hot || '#fff4c4';
    add(c);
    glowDot(c, x, y - h * 0.4, Math.max(w, h * 0.6), col, 0.28);
    for (i = 0; i < 5; i++) {
      var off = (i - 2) * w * 0.26, hh = h * range(R, 0.45, 0.8) * (1 - Math.abs(i - 2) * 0.12);
      flameTongue(c, x + off, y, w * range(R, 0.35, 0.5), hh, range(R, -w * 0.18, w * 0.18),
        [[0, rgba(col, 0.75)], [0.6, rgba(mix(col, '#ffffff', 0.25), 0.55)], [1, rgba(col, 0)]]);
    }
    flameTongue(c, x, y, w * 0.9, h, range(R, -w * 0.1, w * 0.1), [[0, rgba(col, 0.9)], [0.55, rgba(mix(col, hot, 0.5), 0.75)], [1, rgba(col, 0)]]);
    flameTongue(c, x, y, w * 0.55, h * 0.72, range(R, -w * 0.06, w * 0.06), [[0, rgba(hot, 0.95)], [0.6, rgba(mix(col, hot, 0.7), 0.6)], [1, rgba(col, 0)]]);
    flameTongue(c, x, y, w * 0.26, h * 0.42, 0, [[0, rgba('#ffffff', 0.95)], [1, rgba(hot, 0)]]);
    normal(c);
  }
  /* 琢面寶石（側視）：中心 (x,y)，半徑 r，主色 col */
  function gem(c, x, y, r, col, R) {
    var P = {
      A: [-0.55, -0.72], B: [0.55, -0.72], C: [1, -0.18], D: [0, 1], E: [-1, -0.18], F: [-0.32, -0.18], G: [0.32, -0.18], H: [0, -0.72]
    };
    function pt(k) { return [x + P[k][0] * r, y + P[k][1] * r]; }
    var facets = [
      ['A', 'H', 'F', 0.55], ['H', 'B', 'G', 0.78], ['H', 'G', 'F', 1.0], ['A', 'F', 'E', 0.28], ['B', 'C', 'G', 0.22],
      ['E', 'F', 'D', 0.12], ['F', 'G', 'D', 0.5], ['G', 'C', 'D', 0.02]
    ];
    c.save();
    add(c); glowDot(c, x, y, r * 1.9, col, 0.4); normal(c);
    facets.forEach(function (f) {
      var a = pt(f[0]), b = pt(f[1]), d = pt(f[2]), k = f[3];
      var base = k > 0.5 ? mix(col, '#ffffff', (k - 0.5) * 1.1) : mix(col, '#000000', (0.5 - k) * 1.15);
      poly(c, [a, b, d]);
      c.fillStyle = lin(c, a[0], a[1], d[0], d[1], [[0, mix(base, '#ffffff', 0.12)], [1, mix(base, '#000', 0.12)]]); c.fill();
    });
    poly(c, [pt('A'), pt('B'), pt('C'), pt('D'), pt('E')]);
    rimLine(c, mix(col, '#ffffff', 0.75), Math.max(1, r * 0.05), 0.85);
    c.strokeStyle = rgba('#ffffff', 0.35); c.lineWidth = Math.max(0.6, r * 0.025);
    c.beginPath(); c.moveTo(pt('E')[0], pt('E')[1]); c.lineTo(pt('C')[0], pt('C')[1]); c.stroke();
    c.beginPath(); c.moveTo(pt('A')[0], pt('A')[1]); c.lineTo(pt('F')[0], pt('F')[1]); c.lineTo(pt('D')[0], pt('D')[1]); c.lineTo(pt('G')[0], pt('G')[1]); c.lineTo(pt('B')[0], pt('B')[1]); c.stroke();
    c.restore();
    sparkle(c, x - r * 0.35, y - r * 0.5, r * 0.5, '#ffffff', 0);
  }
  function crown(c, x, y, w, h, col) {
    c.save(); c.translate(x, y);
    var p = [[-w / 2, 0], [-w / 2, -h * 0.55], [-w * 0.27, -h * 0.25], [-w * 0.13, -h], [0, -h * 0.35], [w * 0.13, -h], [w * 0.27, -h * 0.25], [w / 2, -h * 0.55], [w / 2, 0]];
    poly(c, p);
    c.fillStyle = lin(c, 0, -h, 0, 0, [[0, mix(col, '#ffffff', 0.7)], [0.5, col], [1, mix(col, '#000', 0.55)]]); c.fill();
    rimLine(c, mix(col, '#ffffff', 0.8), Math.max(1, h * 0.07), 0.9);
    c.fillStyle = rgba('#ffffff', 0.5); c.fillRect(-w / 2, -h * 0.14, w, h * 0.06);
    [[-w / 2, -h * 0.58], [-w * 0.13, -h * 1.02], [w * 0.13, -h * 1.02], [w / 2, -h * 0.58], [0, -h * 0.38]].forEach(function (q, i) {
      c.fillStyle = i === 4 ? '#ff4d6d' : '#fff7d0'; c.beginPath(); c.arc(q[0], q[1], Math.max(1.4, h * 0.09), 0, TAU); c.fill();
    });
    c.restore();
  }
  /* 單邊羽翼，朝右展開；呼叫端用 scale(-1,1) 做另一邊 */
  function wing(c, x, y, len, col, n, hi) {
    c.save(); c.translate(x, y);
    for (var i = n - 1; i >= 0; i--) {
      var t = i / Math.max(1, n - 1);
      var a = lerp(-1.25, 0.55, t), L = len * lerp(0.6, 1, Math.sin(Math.PI * (0.3 + t * 0.7)));
      var w = len * 0.13;
      c.save(); c.rotate(a);
      c.beginPath(); c.moveTo(0, -w * 0.5); c.quadraticCurveTo(L * 0.55, -w * 1.1, L, 0); c.quadraticCurveTo(L * 0.55, w * 1.0, 0, w * 0.5); c.closePath();
      c.fillStyle = lin(c, 0, 0, L, 0, [[0, mix(col, '#000', 0.55)], [0.5, col], [1, mix(col, '#ffffff', hi === undefined ? 0.75 : hi)]]); c.fill();
      c.strokeStyle = rgba(mix(col, '#ffffff', 0.85), 0.7); c.lineWidth = 0.9; c.stroke();
      c.restore();
    }
    c.restore();
  }
  function wings(c, x, y, len, col, n, hi) {
    c.save(); c.translate(x, y); wing(c, 0, 0, len, col, n, hi); c.scale(-1, 1); wing(c, 0, 0, len, col, n, hi); c.restore();
  }
  function laurel(c, r, col, n, y0) {
    for (var s = -1; s <= 1; s += 2) {
      for (var i = 0; i < n; i++) {
        var t = i / (n - 1), a = lerp(Math.PI * 0.62, Math.PI * 1.45, t);
        var px = s * Math.cos(a) * -r, py = (y0 || 0) + Math.sin(a) * -r * -1;
        px = s * (-Math.cos(a)) * r * -1; py = (y0 || 0) - Math.sin(a) * r;
        c.save(); c.translate(px, py); c.rotate((s > 0 ? -a : a) + (s > 0 ? Math.PI : 0) + s * 0.2);
        c.scale(s, 1);
        c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(7, -8, 18, 0); c.quadraticCurveTo(7, 8, 0, 0); c.closePath();
        c.fillStyle = lin(c, 0, 0, 18, 0, [[0, mix(col, '#000', 0.45)], [1, mix(col, '#ffffff', 0.35)]]); c.fill();
        c.strokeStyle = rgba(mix(col, '#fff', 0.7), 0.7); c.lineWidth = 0.8; c.stroke();
        c.restore();
      }
    }
  }
  function gear(c, x, y, r, teeth, col, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    var pts = [], i;
    for (i = 0; i < teeth * 4; i++) {
      var a = i * TAU / (teeth * 4), k = (i % 4 === 1 || i % 4 === 2) ? r : r * 0.82;
      pts.push([Math.cos(a) * k, Math.sin(a) * k]);
    }
    poly(c, pts);
    c.fillStyle = lin(c, -r, -r, r, r, [[0, mix('#e8dcc0', col, 0.35)], [0.5, mix('#6a6f7e', col, 0.35)], [1, mix('#1b1d28', col, 0.3)]]); c.fill();
    rimLine(c, mix(col, '#ffffff', 0.65), 1.4, 0.9);
    c.beginPath(); c.arc(0, 0, r * 0.62, 0, TAU); c.fillStyle = mix('#0b0c12', col, 0.12); c.fill(); rimLine(c, col, 1.2, 0.8);
    add(c); glowDot(c, 0, 0, r * 0.7, col, 0.7); normal(c);
    c.beginPath(); c.arc(0, 0, r * 0.22, 0, TAU); c.fillStyle = mix(col, '#ffffff', 0.8); c.fill();
    c.restore();
  }
  /* 錘：原點是錘頭中心，握柄沿 +y 往下 */
  function hammer(c, x, y, rot, L, hw, hh, col) {
    c.save(); c.translate(x, y); c.rotate(rot);
    c.fillStyle = lin(c, -5, 0, 5, 0, [[0, '#a9753d'], [0.45, '#6b4423'], [1, '#2e1c0d']]);
    c.fillRect(-4.5, 0, 9, L);
    c.strokeStyle = 'rgba(255,220,160,0.55)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-3.6, 2); c.lineTo(-3.6, L); c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (var k = L * 0.45; k < L - 4; k += 6) c.fillRect(-4.5, k, 9, 2.2);
    c.beginPath(); c.arc(0, L, 6, 0, TAU); c.fillStyle = '#c9a45a'; c.fill();
    c.fillStyle = steel(c, -hw / 2, -hh / 2, hw / 2, hh / 2, col, 0.35);
    c.beginPath(); c.moveTo(-hw / 2 + 4, -hh / 2); c.lineTo(hw / 2 - 4, -hh / 2); c.lineTo(hw / 2, -hh / 2 + 5); c.lineTo(hw / 2, hh / 2 - 5);
    c.lineTo(hw / 2 - 4, hh / 2); c.lineTo(-hw / 2 + 4, hh / 2); c.lineTo(-hw / 2, hh / 2 - 5); c.lineTo(-hw / 2, -hh / 2 + 5); c.closePath(); c.fill();
    rimLine(c, mix(col, '#ffffff', 0.8), 1.4, 0.9);
    c.fillStyle = 'rgba(255,255,255,0.45)'; c.fillRect(-hw / 2 + 5, -hh / 2 + 2, hw - 10, 3);
    c.fillStyle = rgba(col, 0.9); c.fillRect(-hw / 2 + 3, -1.2, hw - 6, 2.4);
    c.restore();
  }
  function anvil(c, x, y, s, col, heat) {
    c.save(); c.translate(x, y); c.scale(s, s);
    var p = [[-64, 6], [-34, 0], [58, 0], [54, 18], [26, 20], [32, 44], [50, 50], [50, 62], [-50, 62], [-50, 50], [-32, 44], [-26, 20], [-40, 18], [-54, 16]];
    c.beginPath(); c.moveTo(-64, 6); c.lineTo(-34, 0); c.lineTo(58, 0); c.lineTo(54, 18); c.lineTo(26, 20); c.lineTo(32, 44); c.lineTo(50, 50); c.lineTo(50, 62);
    c.lineTo(-50, 62); c.lineTo(-50, 50); c.lineTo(-32, 44); c.lineTo(-26, 20); c.lineTo(-40, 18); c.quadraticCurveTo(-58, 16, -64, 6); c.closePath();
    c.fillStyle = steel(c, -60, 0, 50, 62, col, 0.25); c.fill();
    rimLine(c, mix(col, '#ffffff', 0.7), 1.6, 0.85);
    c.fillStyle = lin(c, 0, 0, 0, 8, [[0, '#f4f7ff'], [1, 'rgba(255,255,255,0)']]);
    c.fillRect(-34, 0, 90, 4);
    if (heat) { add(c); glowDot(c, 10, -2, 46, heat, 0.55); c.fillStyle = rgba(heat, 0.8); c.fillRect(-30, -1, 84, 3); normal(c); }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(-50, 50, 100, 3);
    c.restore();
  }
  /* 直刃劍：劍尖朝上，原點在護手中心 */
  function sword(c, x, y, len, w, col, rot, hiltCol) {
    c.save(); c.translate(x, y); c.rotate(rot || 0);
    var hc = hiltCol || '#d4a23a';
    // 劍柄
    c.fillStyle = lin(c, -4, 0, 4, 0, [[0, '#5b3b22'], [0.5, '#8d6038'], [1, '#2a180c']]); c.fillRect(-w * 0.18, 3, w * 0.36, w * 0.9);
    c.beginPath(); c.arc(0, 3 + w * 0.9 + 3, w * 0.28, 0, TAU); c.fillStyle = hc; c.fill();
    // 劍身
    var tip = -len;
    poly(c, [[0, tip], [-w / 2, tip + w * 1.3], [-w / 2, 0], [w / 2, 0], [w / 2, tip + w * 1.3]]);
    c.fillStyle = lin(c, -w / 2, 0, w / 2, 0, [[0, mix(col, '#ffffff', 0.9)], [0.5, mix(col, '#ffffff', 0.55)], [0.5, mix(col, '#000', 0.2)], [1, mix(col, '#000', 0.55)]]); c.fill();
    rimLine(c, mix(col, '#ffffff', 0.9), 1.1, 0.9);
    // 護手
    c.fillStyle = lin(c, 0, -4, 0, 5, [[0, mix(hc, '#fff', 0.7)], [1, mix(hc, '#000', 0.5)]]);
    c.beginPath(); c.moveTo(-w * 1.05, 2); c.lineTo(-w * 0.6, -4); c.lineTo(w * 0.6, -4); c.lineTo(w * 1.05, 2); c.lineTo(w * 0.6, 6); c.lineTo(-w * 0.6, 6); c.closePath(); c.fill();
    rimLine(c, '#fff3c0', 1, 0.7);
    add(c); glowDot(c, 0, tip * 0.5, len * 0.5, col, 0.25); normal(c);
    c.restore();
  }
  function hexagram(c, r, color, w, a) {
    [0, Math.PI].forEach(function (off) {
      var pts = [];
      for (var i = 0; i < 3; i++) pts.push([Math.cos(off - Math.PI / 2 + i * TAU / 3) * r, Math.sin(off - Math.PI / 2 + i * TAU / 3) * r]);
      poly(c, pts); c.lineWidth = w; c.strokeStyle = rgba(color, a === undefined ? 0.9 : a); c.stroke();
    });
  }
  function polyRing(c, r, n, rot, color, w, a) {
    var pts = [];
    for (var i = 0; i < n; i++) pts.push([Math.cos(rot + i * TAU / n) * r, Math.sin(rot + i * TAU / n) * r]);
    poly(c, pts); c.lineWidth = w; c.strokeStyle = rgba(color, a === undefined ? 0.9 : a); c.stroke();
  }

  /* ---------- 圖片載入（遊戲自己的素材） ---------- */
  function loadImg(url) {
    if (ACH.imgs[url]) return ACH.imgs[url].p;
    var im = new Image(), rec = { img: im };
    rec.p = new Promise(function (res) { im.onload = function () { rec.ok = true; res(rec); }; im.onerror = function () { rec.ok = false; res(rec); }; });
    ACH.imgs[url] = rec; im.src = url; return rec.p;
  }
  function getImg(url) { var r = ACH.imgs[url]; return r && r.ok ? r.img : null; }

  Object.assign(ACH, {
    mulberry32: mulberry32, hashStr: hashStr, hexRgb: hexRgb, rgba: rgba, mix: mix, hsl: hsl, rgbHue: rgbHue, lerp: lerp, range: range,
    add: add, normal: normal, glowDot: glowDot, coreGlow: coreGlow, sparkle: sparkle, motes: motes, poly: poly, lin: lin, rad: rad,
    steel: steel, rimLine: rimLine, rays: rays, ringGlow: ringGlow, numeral: numeral, banner: banner, flame: flame, flameTongue: flameTongue,
    gem: gem, crown: crown, wing: wing, wings: wings, laurel: laurel, gear: gear, hammer: hammer, anvil: anvil, sword: sword,
    hexagram: hexagram, polyRing: polyRing, loadImg: loadImg, getImg: getImg, TAU: TAU
  });

  /* ---------- 獎牌外框 ---------- */
  var METAL = {
    0: ['#f6c690', '#b0702f', '#53290f'],
    1: ['#ffffff', '#b9c6d8', '#4b566a'],
    2: ['#fff4b0', '#e9b93e', '#7d4e0c'],
    3: ['#f4ffff', '#9be4f4', '#2c6a8e'],
    4: ['#ffffff', '#f2c8ff', '#6a4aa8'],
    5: ['#8b8f9c', '#3d404c', '#14151b']
  };
  var RO = 110, RI = 94;

  function medalBack(c, o) {
    var t = o.tier, m = METAL[t], g = o.glow || '#ffd36a', i;
    c.clearRect(0, 0, S, S);
    c.save(); c.translate(128, 128);
    add(c); glowDot(c, 0, 0, 126, g, 0.28); glowDot(c, 0, 0, 112, mix(g, m[1], 0.5), 0.2); normal(c);
    if (o.under) o.under(c);
    // 羽翼
    if (t >= 3 && t !== 5) {
      var wc = t === 4 ? '#ffe6ff' : '#dff8ff';
      c.save(); c.translate(0, -6);
      wing(c, RO - 4, 0, 24, mix(wc, g, 0.25), 5, 0.8); c.scale(-1, 1); wing(c, RO - 4, 0, 24, mix(wc, g, 0.25), 5, 0.8);
      c.restore();
    }
    // 魔鐵尖刺
    if (t === 5) {
      for (i = 0; i < 16; i++) {
        var a = i * TAU / 16 + TAU / 32;
        c.save(); c.rotate(a); c.beginPath(); c.moveTo(RO - 6, -7); c.lineTo(RO + 15, 0); c.lineTo(RO - 6, 7); c.closePath();
        c.fillStyle = lin(c, RO - 6, 0, RO + 15, 0, [[0, '#2b2d36'], [1, '#6d2020']]); c.fill(); rimLine(c, '#ff6a4a', 1, 0.7); c.restore();
      }
    }
    // 金屬環
    c.beginPath(); c.arc(0, 0, RO, 0, TAU); c.arc(0, 0, RI, 0, TAU, true);
    var rg;
    if (t === 4 && c.createConicGradient) {
      rg = c.createConicGradient(-Math.PI / 4, 0, 0);
      ['#ffd6f5', '#c8e8ff', '#d6ffe4', '#fff3b8', '#ffc9c9', '#ffd6f5'].forEach(function (cc, k, arr) { rg.addColorStop(k / (arr.length - 1), cc); });
    } else rg = lin(c, -RO, -RO, RO, RO, [[0, m[0]], [0.45, m[1]], [1, m[2]]]);
    c.fillStyle = rg; c.fill('evenodd');
    // 倒角：外緣亮線、環中槽線
    c.beginPath(); c.arc(0, 0, RO - 1, Math.PI * 0.95, Math.PI * 1.75);
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(0, 0, RO - 1, Math.PI * 0.05, Math.PI * 0.6);
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(0, 0, (RO + RI) / 2, 0, TAU); c.strokeStyle = rgba(m[2], 0.55); c.lineWidth = 1.3; c.stroke();
    c.beginPath(); c.arc(0, 0, (RO + RI) / 2 + 1.6, 0, TAU); c.strokeStyle = rgba(m[0], 0.35); c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(0, 0, RI, 0, TAU); c.strokeStyle = rgba('#000000', 0.7); c.lineWidth = 2; c.stroke();
    // 內底
    var ic = o.inner || ['#2a2030', '#06050a'];
    c.beginPath(); c.arc(0, 0, RI - 1, 0, TAU);
    c.fillStyle = rad(c, -10, -16, 4, RI + 8, [[0, ic[0]], [0.65, mix(ic[0], ic[1], 0.7)], [1, ic[1]]]); c.fill();
    c.restore();
  }

  function medalFront(c, o) {
    var t = o.tier, m = METAL[t], g = o.glow || '#ffd36a', i;
    c.save(); c.translate(128, 128);
    // 玻璃反光與內緣陰影
    c.save(); c.beginPath(); c.arc(0, 0, RI - 1, 0, TAU); c.clip();
    c.lineWidth = 12; c.strokeStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.arc(0, 0, RI + 3, 0, TAU); c.stroke();
    c.lineWidth = 3; c.strokeStyle = rgba(g, 0.22); c.beginPath(); c.arc(0, 0, RI - 4, 0, TAU); c.stroke();
    var sh = lin(c, -60, -90, 40, -10, [[0, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]);
    c.fillStyle = sh; c.beginPath(); c.ellipse(-26, -52, 62, 34, -0.55, 0, TAU); c.fill();
    c.restore();
    // 鉚釘
    var studs = t === 0 ? 4 : (t === 5 ? 0 : 8);
    for (i = 0; i < studs; i++) {
      var a = i * TAU / studs + (t === 0 ? TAU / 8 : 0) - Math.PI / 2;
      if (t >= 1 && i === 0) continue;
      var sx = Math.cos(a) * (RO + RI) / 2, sy = Math.sin(a) * (RO + RI) / 2;
      c.beginPath(); c.arc(sx, sy, 3.4, 0, TAU); c.fillStyle = rad(c, sx - 1, sy - 1, 0.5, 4, [[0, '#ffffff'], [0.5, m[1]], [1, m[2]]]); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 0.8; c.stroke();
    }
    // 頂端寶石／王冠
    if (t >= 1) {
      var gy = -(RO + RI) / 2;
      var gc = o.gemCol || g;
      if (t === 4) {
        crown(c, 0, gy - 4, 36, 17, '#ffe08a');
      } else if (t === 5) {
        c.beginPath(); c.moveTo(0, gy - 9); c.lineTo(8, gy); c.lineTo(0, gy + 9); c.lineTo(-8, gy); c.closePath();
        c.fillStyle = '#ff4a3a'; c.fill(); rimLine(c, '#ffb09a', 1.2, 0.9);
      } else {
        var gr = t === 1 ? 7 : (t === 2 ? 9 : 10);
        c.beginPath(); c.moveTo(0, gy - gr); c.lineTo(gr * 0.9, gy); c.lineTo(0, gy + gr); c.lineTo(-gr * 0.9, gy); c.closePath();
        c.fillStyle = lin(c, -gr, gy - gr, gr, gy + gr, [[0, mix(gc, '#ffffff', 0.8)], [0.5, gc], [1, mix(gc, '#000', 0.6)]]); c.fill();
        rimLine(c, m[0], 1.8, 0.95);
        c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 0.8; c.beginPath(); c.moveTo(-gr * 0.9, gy); c.lineTo(gr * 0.9, gy); c.moveTo(0, gy - gr); c.lineTo(0, gy + gr); c.stroke();
      }
    }
    // 下方 pips：以點數表示等級
    var pips = o.pips || 0;
    for (i = 0; i < pips; i++) {
      var pa = Math.PI / 2 + (i - (pips - 1) / 2) * 0.17;
      var px = Math.cos(pa) * (RO + RI) / 2, py = Math.sin(pa) * (RO + RI) / 2;
      c.beginPath(); c.arc(px, py, 3.2, 0, TAU);
      c.fillStyle = rad(c, px - 1, py - 1, 0.3, 4, [[0, '#ffffff'], [0.5, o.pipCol || g], [1, mix(o.pipCol || g, '#000', 0.6)]]); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 0.8; c.stroke();
    }
    if (o.over) o.over(c);
    c.restore();
  }

  ACH.medal = { back: medalBack, front: medalFront, RI: RI, RO: RO };

  /* ---------- 規格表：每個成就用哪個主題與參數 ---------- */
  var RARITY = {
    2: { col: '#38bdf8', orn: 0 }, 3: { col: '#ffd700', orn: 0 }, 4: { col: '#c084fc', orn: 1 }, 5: { col: '#fb923c', orn: 1 },
    6: { col: '#f87171', orn: 2 }, 7: { col: '#e8b020', orn: 2 }, 9: { col: '#a8305c', col2: '#7a55c8', orn: 2 }, 10: { col: '#ff6bcb', col2: '#ffd36a', orn: 3 }
  };
  var EQUIP_TIER = { 2: 0, 3: 0, 4: 1, 5: 1, 6: 2, 7: 2, 9: 3, 10: 4 };

  function specFor(e) {
    var id = +e.id, tp = e.type, p = e.param, n = +e.count;
    var s = { motif: tp, tier: 2, glow: '#ffd36a', inner: ['#2a2030', '#06050a'], pips: 0, n: n, p: p, id: id };
    var R;
    switch (tp) {
      case 'equipFull':
        R = RARITY[+p]; s.col = R.col; s.col2 = R.col2; s.orn = R.orn; s.tier = EQUIP_TIER[+p]; s.glow = R.col2 ? mix(R.col, R.col2, 0.5) : R.col;
        s.inner = [mix(R.col, '#000', 0.72), mix(R.col, '#000', 0.94)]; s.pips = 0; s.gemCol = R.col; s.pipCol = R.col;
        if (+p === 10) s.pips = 0;
        break;
      case 'level': s.tier = id - 8; s.col = ['#6aa9ff', '#ffd36a', '#ff9a4a'][id - 9]; s.glow = s.col; s.inner = ['#1d2a4a', '#05070f']; break;
      case 'enhanceLevel': s.tier = id === 12 ? 2 : 3; s.col = id === 12 ? '#ff9a3a' : '#ffd1a0'; s.glow = '#ff8a2a'; s.inner = ['#3a1c10', '#0a0504']; break;
      case 'ancientEquipped': s.tier = id - 13; s.col = '#6ff2ff'; s.glow = '#6ff2ff'; s.inner = ['#10323c', '#040b0e']; s.gemCol = '#6ff2ff'; s.lv = id - 14; break;
      case 'rerollCount': s.tier = 2; s.col = '#8fe6ff'; s.glow = '#8fe6ff'; s.inner = ['#1a2c46', '#05080f']; break;
      case 'socketEquipped': s.tier = id === 18 ? 2 : 3; s.col = '#9bd8ff'; s.glow = '#ffd36a'; s.inner = ['#241b36', '#07050c']; s.lv = id === 18 ? 0 : 1; break;
      case 'gemLevel': s.tier = 2; s.col = '#ff5a6e'; s.glow = '#ff7a8a'; s.inner = ['#3a1020', '#0a0408']; break;
      case 'gemAllTypes': s.tier = 3; s.col = '#ffffff'; s.glow = '#a8e0ff'; s.inner = ['#1d2540', '#05060c']; break;
      case 'gemDivine': s.tier = 4; s.col = '#fff1c0'; s.glow = '#fff1c0'; s.inner = ['#3b3320', '#0b0905']; break;
      case 'godEquip': s.tier = 4; s.col = '#ffe08a'; s.glow = '#ffd36a'; s.inner = ['#3a2a12', '#0b0703']; break;
      case 'ancientCast': s.tier = 3; s.col = '#6ff2ff'; s.glow = '#6ff2ff'; s.inner = ['#10323c', '#040b0e']; break;
      case 'imprintCount': s.tier = 2; s.col = '#6fb4ff'; s.glow = '#6fb4ff'; s.inner = ['#10244a', '#04060f']; break;
      case 'dualLegend': s.tier = 3; s.col = '#ff9a3a'; s.glow = '#ff9a3a'; s.inner = ['#3a1a0c', '#0b0504']; break;
      case 'divineConsumed': s.tier = 3; s.col = '#ff7a2a'; s.glow = '#ff7a2a'; s.inner = ['#3a1208', '#0b0403']; break;
      case 'upgradeCount': s.tier = 3; s.col = '#ffb04a'; s.glow = '#ffa030'; s.inner = ['#33180c', '#0a0504']; break;
      case 'forgePartsMax': s.tier = 3; s.col = '#ffb04a'; s.glow = '#ffb04a'; s.inner = ['#2d1c10', '#09060a']; break;
      case 'goldTotal': s.tier = 4; s.col = '#ffd36a'; s.glow = '#ffd36a'; s.inner = ['#3a2a0a', '#0b0803']; break;
      case 'runewordActive': s.tier = 1; s.col = '#ffd36a'; s.glow = '#ffd36a'; s.inner = ['#2a2418', '#07060a']; break;
      case 'runewordDistinct': s.tier = 2; s.col = '#ffd36a'; s.glow = '#ffd36a'; s.inner = ['#2a2418', '#07060a']; break;
      case 'runeMade': s.tier = 3; s.col = '#cdb8ff'; s.glow = '#b79cff'; s.inner = ['#241a40', '#050308']; break;
      case 'runewordTier': s.tier = 4; s.col = '#ff9a3a'; s.glow = '#ffb04a'; s.inner = ['#3a200c', '#0b0604']; break;
      case 'reincarnation': s.tier = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4][n - 1]; s.col = '#ff7fb5'; s.glow = n < 10 ? mix('#ff7fb5', '#ffd36a', (n - 1) / 9) : '#ffe9a6';
        s.inner = ['#33143a', '#07040b']; s.pips = 0; break;
      case 'towerFloor': s.tier = id - 44; s.col = '#b07aff'; s.glow = '#c08aff'; s.inner = ['#1f1236', '#05030a']; s.lv = id - 45; break;
      case 'monsterPower': s.tier = 5; s.col = '#ff3a2a'; s.glow = '#ff3a2a'; s.inner = ['#3a0a0a', '#080203']; s.lv = id - 48; break;
      case 'skillUlt': s.motif = 'skillUlt'; break;
    }
    return s;
  }

  /* 單枚成就繪製。e = { id, name, type, param, count } */
  function paintIcon(c, e) {
    var s = specFor(e);
    var o = { tier: s.tier, glow: s.glow, inner: s.inner, pips: s.pips, gemCol: s.gemCol, pipCol: s.pipCol };
    var fn = ACH.motifs[s.motif];
    if (s.motif === 'skillUlt') { ACH.motifs.skillUlt(c, s, e, o); return; }
    medalBack(c, o);
    c.save(); c.translate(128, 128);
    c.beginPath(); c.arc(0, 0, RI - 1, 0, TAU); c.clip();
    var R = mulberry32(hashStr('ach' + e.id));
    if (fn) fn(c, s, R); else { numeral(c, '?', 0, 0, 80); }
    c.restore();
    medalFront(c, o);
    c.save(); c.translate(128, 128); if (ACH.overlays[s.motif]) ACH.overlays[s.motif](c, s); c.restore();
  }
  ACH.overlays = {};
  ACH.specFor = specFor;
  ACH.paintIcon = paintIcon;
  ACH.METAL = METAL;

  /* ---------- 圖片預載清單 ---------- */
  ACH.assetUrls = function () {
    var l = [], i;
    ['bloodblade', 'bloodrage', 'chainlightning', 'cleave', 'counter', 'dualdance', 'earthguard', 'fireball', 'firehunt', 'firepillar', 'frostnova', 'gale', 'icearrow', 'knife', 'mire', 'rockarmor',
      'stormbarrier', 'thrust', 'thunderorb', 'thunderstrike', 'vacuumslash', 'waterball', 'windblade'].forEach(function (g) { l.push('/images/skills/' + g + '.png'); });
    for (i = 1; i <= 33; i++) l.push('/images/runes/stone-r' + (i < 10 ? '0' : '') + i + '.png');
    return l;
  };
  ACH.preload = function () { return Promise.all(ACH.assetUrls().map(loadImg)); };
})(typeof window !== 'undefined' ? window : globalThis);
