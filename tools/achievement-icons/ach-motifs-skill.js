/* 成就圖示：技能超神徽章（Achievement.csv 的 skillUlt，ids 50-115）。
 *
 * 主體是遊戲自己的 images/skills/<群組id>.png，裁成圓形獎章；
 * 同群組三個超神依序為 銅框／銀框／金框＋王冠光芒，並各自有不同的種子化點綴樣式、縮放裁切與色相偏移。 */
(function () {
  'use strict';
  var A = window.ACH, TAU = A.TAU;
  var add = A.add, normal = A.normal, rgba = A.rgba, mix = A.mix, glowDot = A.glowDot, lin = A.lin, poly = A.poly, rimLine = A.rimLine, lerp = A.lerp;
  var RI = 94, ART_R = 80;
  var colorCache = {};

  /* 由技能圖本身算出主色：以「飽和度×亮度」加權平均，再拉回高飽和 */
  function artColor(gid, img) {
    if (colorCache[gid]) return colorCache[gid];
    var cv = document.createElement('canvas'); cv.width = cv.height = 32;
    var x = cv.getContext('2d'); x.drawImage(img, 0, 0, 32, 32);
    var d = x.getImageData(0, 0, 32, 32).data, sr = 0, sg = 0, sb = 0, sw = 0, i, satSum = 0;
    for (i = 0; i < d.length; i += 4) {
      var r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      var sat = mx ? (mx - mn) / mx : 0, w = sat * sat * mx;
      sr += r * w; sg += g * w; sb += b * w; sw += w; satSum += sat;
    }
    var hex;
    if (sw < 0.5 || satSum / 1024 < 0.1) hex = '#9fd0ff';
    else {
      var rr = sr / sw * 255, gg = sg / sw * 255, bb = sb / sw * 255;
      hex = '#' + [rr, gg, bb].map(function (v) { v = Math.round(v); return (v < 16 ? '0' : '') + v.toString(16); }).join('');
    }
    var h = A.rgbHue(hex);
    return (colorCache[gid] = { hue: h, hex: hex });
  }

  function bezelBand(c, acc, tierCols) {
    // 技能圖外圍的凹槽環：暗底＋強調色細線
    c.beginPath(); c.arc(0, 0, RI - 1, 0, TAU); c.arc(0, 0, ART_R, 0, TAU, true);
    c.fillStyle = lin(c, -RI, -RI, RI, RI, [[0, mix('#14101c', acc, 0.18)], [1, '#04030a']]); c.fill('evenodd');
    c.beginPath(); c.arc(0, 0, ART_R + 0.5, 0, TAU); c.strokeStyle = rgba(mix(acc, '#ffffff', 0.35), 0.95); c.lineWidth = 2; c.stroke();
    add(c); c.beginPath(); c.arc(0, 0, ART_R + 1, 0, TAU); c.strokeStyle = rgba(acc, 0.35); c.lineWidth = 6; c.stroke(); normal(c);
    c.beginPath(); c.arc(0, 0, RI - 3, 0, TAU); c.strokeStyle = rgba(acc, 0.4); c.lineWidth = 1; c.stroke();
  }

  var STYLES = [
    // 0 光芒環：刻度＋直線光芒
    function (c, R, acc, order) {
      var i, n = 24;
      for (i = 0; i < n; i++) {
        var a = i * TAU / n, long = i % 2 === 0, r0 = ART_R + 2, r1 = RI - 4 - (long ? 0 : 3);
        c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
        c.strokeStyle = rgba(long ? '#ffffff' : acc, long ? 0.85 : 0.6); c.lineWidth = long ? 2.2 : 1.4; c.stroke();
      }
      A.rays(c, 0, 0, ART_R - 4, ART_R + 12, 12, acc, 0.5, 0.1, 0.07);
    },
    // 1 寶石環：均布寶石
    function (c, R, acc) {
      var n = 8, i, mid = (ART_R + RI) / 2 + 0.5;
      for (i = 0; i < n; i++) {
        var a = i * TAU / n - Math.PI / 2 + TAU / 16, x = Math.cos(a) * mid, y = Math.sin(a) * mid;
        c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2);
        c.beginPath(); c.moveTo(0, -6.5); c.lineTo(5, 0); c.lineTo(0, 6.5); c.lineTo(-5, 0); c.closePath();
        c.fillStyle = lin(c, -5, -6, 5, 6, [[0, '#ffffff'], [0.5, acc], [1, mix(acc, '#000', 0.6)]]); c.fill(); rimLine(c, '#ffffff', 1, 0.8);
        add(c); glowDot(c, 0, 0, 10, acc, 0.5); normal(c); c.restore();
      }
    },
    // 2 符文環：符號刻在凹槽
    function (c, R, acc) {
      var n = 12, i, mid = (ART_R + RI) / 2 + 0.5;
      for (i = 0; i < n; i++) {
        var a = i * TAU / n - Math.PI / 2;
        c.save(); c.translate(Math.cos(a) * mid, Math.sin(a) * mid); c.rotate(a + Math.PI / 2);
        c.strokeStyle = acc; c.fillStyle = acc; c.lineWidth = 1.6; c.shadowColor = acc; c.shadowBlur = 6; A.GLYPHS[(i * 7 + (R() * 6 | 0)) % 6](c, 3.6); c.restore();
      }
    },
    // 3 烈焰環：向內的尖刺
    function (c, R, acc) {
      var n = 16, i;
      for (i = 0; i < n; i++) {
        var a = i * TAU / n; c.save(); c.rotate(a);
        c.beginPath(); c.moveTo(RI - 3, -5); c.lineTo(ART_R + 3 + (i % 2) * 5, 0); c.lineTo(RI - 3, 5); c.closePath();
        c.fillStyle = lin(c, RI - 3, 0, ART_R, 0, [[0, rgba(acc, 0.15)], [1, rgba(mix(acc, '#ffffff', 0.55), 0.95)]]); c.fill(); c.restore();
      }
    },
    // 4 流星環：沿圓周散落光珠與尾跡
    function (c, R, acc) {
      var i, mid = (ART_R + RI) / 2 + 0.5;
      add(c);
      for (i = 0; i < 3; i++) {
        var a0 = R() * TAU, len = 0.9 + R() * 0.7;
        c.beginPath(); c.arc(0, 0, mid + (i - 1) * 2.6, a0, a0 + len); c.strokeStyle = rgba(acc, 0.55); c.lineWidth = 2.4; c.lineCap = 'round'; c.stroke();
        var hx = Math.cos(a0 + len) * (mid + (i - 1) * 2.6), hy = Math.sin(a0 + len) * (mid + (i - 1) * 2.6);
        glowDot(c, hx, hy, 9, acc, 0.9); c.fillStyle = '#fff'; c.beginPath(); c.arc(hx, hy, 2.2, 0, TAU); c.fill();
      }
      normal(c);
      for (i = 0; i < 10; i++) { var a = R() * TAU; A.sparkle(c, Math.cos(a) * mid, Math.sin(a) * mid, 3.4 + R() * 2, '#ffffff', 0); }
    },
    // 5 箭頭環：四方三角＋細鏈
    function (c, R, acc) {
      var i, mid = (ART_R + RI) / 2 + 0.5;
      for (i = 0; i < 36; i++) { var a = i * TAU / 36; c.beginPath(); c.arc(Math.cos(a) * mid, Math.sin(a) * mid, 1.2, 0, TAU); c.fillStyle = rgba(acc, 0.7); c.fill(); }
      for (i = 0; i < 4; i++) {
        c.save(); c.rotate(i * Math.PI / 2); c.translate(0, -mid);
        c.beginPath(); c.moveTo(0, -7); c.lineTo(8, 5); c.lineTo(0, 1); c.lineTo(-8, 5); c.closePath();
        c.fillStyle = lin(c, 0, -7, 0, 5, [[0, '#ffffff'], [1, acc]]); c.fill(); rimLine(c, '#ffffff', 1, 0.7);
        add(c); glowDot(c, 0, 0, 12, acc, 0.5); normal(c); c.restore();
      }
    }
  ];

  A.motifs.skillUlt = function (c, s, e, o) {
    var parts = e.param.split(':'), gid = parts[0], uid = parts[1];
    var order = (e.id - 50) % 3, h = A.hashStr(uid), R = A.mulberry32(h);
    var url = '/images/skills/' + gid + '.png', img = A.getImg(url);
    var ac = img ? artColor(gid, img) : { hue: 40, hex: '#ffd36a' };
    var shift = ((h % 7) - 3) * 10;
    var acc = A.hsl(ac.hue + shift, 88, 62), acc2 = A.hsl(ac.hue + shift + 28, 90, 70);
    var base = (A.hashStr(gid) + order * 2) % STYLES.length;
    var styleIdx = base;
    var wingStyle = (A.hashStr(uid + 'w') % 3 === 0) && order < 2; // 偶爾加小翅膀，讓同組更好分辨

    var o2 = { tier: order, glow: acc, inner: [mix(acc, '#000', 0.75), '#05060a'], pips: 0, pipCol: acc, gemCol: acc };
    o2.under = function (c0) {
      if (order === 2) {
        A.rays(c0, 0, 0, 96, 128, 16, '#fff6c8', 1, 0.0, 0.1);
        A.rays(c0, 0, 0, 96, 122, 16, acc, 0.9, Math.PI / 16, 0.07);
      } else if (order === 1) {
        A.rays(c0, 0, 0, 104, 122, 8, acc, 0.3, 0.2, 0.08);
      }
      if (wingStyle) { c0.save(); c0.translate(0, -4); A.wings(c0, 98, 0, 28, acc2, 5, 0.7); c0.restore(); }
    };
    o2.over = function (c0) {
      if (order === 2) { A.crown(c0, 0, -(A.medal.RO) - 1, 40, 19, '#ffd36a'); }
      A.banner(c0, '10', 0, 91, 34, 22, mix(acc, '#000', 0.65), 18);
    };

    A.medal.back(c, o2);
    c.save(); c.translate(128, 128);
    c.beginPath(); c.arc(0, 0, RI - 1, 0, TAU); c.clip();
    bezelBand(c, acc);
    // 技能圖
    c.save(); c.beginPath(); c.arc(0, 0, ART_R, 0, TAU); c.clip();
    c.fillStyle = '#06070c'; c.fillRect(-100, -100, 200, 200);
    if (img) {
      var zoom = [1.0, 1.18, 1.38][order] * 1.3, sz = 128 * zoom;
      var ox = (R() - 0.5) * 8, oy = (R() - 0.5) * 8 - (order * 2);
      c.filter = 'hue-rotate(' + shift + 'deg) saturate(1.12) contrast(1.05)';
      c.drawImage(img, -sz / 2 + ox, -sz / 2 + oy, sz, sz);
      c.filter = 'none';
    }
    // 暈影與色彩落光
    var vg = A.rad(c, 0, 0, ART_R * 0.55, ART_R, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.6)']]); c.fillStyle = vg; c.fillRect(-100, -100, 200, 200);
    add(c); var lg = A.rad(c, 0, ART_R, 0, ART_R * 1.1, [[0, rgba(acc, 0.35)], [1, rgba(acc, 0)]]); c.fillStyle = lg; c.fillRect(-100, -100, 200, 200); normal(c);
    // 玻璃弧光
    c.fillStyle = lin(c, -50, -70, 30, -10, [[0, 'rgba(255,255,255,0.2)'], [1, 'rgba(255,255,255,0)']]); c.beginPath(); c.ellipse(-24, -48, 52, 26, -0.55, 0, TAU); c.fill();
    c.restore();
    STYLES[styleIdx](c, R, acc, order);
    // 圓周亮邊
    c.beginPath(); c.arc(0, 0, ART_R, 0, TAU); c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke();
    c.restore();
    A.medal.front(c, o2);
  };
})();
