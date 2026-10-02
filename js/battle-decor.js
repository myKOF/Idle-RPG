/* 戰場地形裝飾（2026-10）
   ============================================================
   原本每張地圖只有一張 128px 的平鋪地磚，畫面單調。這裡加三層，全部是純表現，模擬層一行不動：
     1. 地面裝飾（decal）：大片色塊、裂痕、碎石、骨骸、水窪、符文圈…貼在地面平面上，打破磚紋重複。
        掛在 bg 層「地板之上、暗角之下」的地面平面容器（scale.y = GROUND_Y_SCALE），子節點用世界座標。
     2. 擺件（prop）：岩石、斷柱、枯樹、墓碑、冰晶…直立物件，掛進實體層（entity），zIndex＝腳底的畫面 y，
        和角色、敵人一起依前後遮擋；擋到玩家時自動變半透明。
     3. 天氣（ambient）：飄沙、落雪、螢火蟲、餘燼…螢幕座標的小粒子，數量固定。

   世界沒有邊界、鏡頭跟著玩家走，所以裝飾依「區塊」產生：鏡頭附近的區塊用 (區塊座標, 地圖, 階段帶) 當亂數種子
   擺放，看不到的區塊回收到物件池。同一個區塊每次回來長得都一樣。
   每 10 個階段換一個「階段帶」：單數帶是地表、雙數帶是地下（沙下神殿、冰窟、腐根地穴、地下墓窟），
   地下版地面較暗、多火盆與光源、少植物。

   貼圖全部執行期用 Canvas 2D 程序化畫好、打包成一張圖集（每張地圖一次，約 20ms），不另外載圖檔。
   效能：全部是靜態精靈，同一張圖集可以合批；每幀只做區塊進出判斷（越過區塊邊界才重算）與粒子位移。
   ?decor=0 整個關掉（A/B 對照用），?decor=lite 減量。 */
var BattleDecor = (function () {
  'use strict';

  /* ============ 小工具 ============ */
  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash3(x, y, z) {
    var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function strHash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // k > 0 變亮、k < 0 變暗（-1～1）
  function shade(hex, k) {
    var c = hexRgb(hex);
    var t = k < 0 ? 0 : 255, p = Math.abs(k);
    return 'rgb(' + Math.round(c[0] + (t - c[0]) * p) + ',' + Math.round(c[1] + (t - c[1]) * p) + ',' + Math.round(c[2] + (t - c[2]) * p) + ')';
  }
  // 調亮／調暗後再帶透明度
  function shadeRgba(hex, k, a) {
    var c = hexRgb(hex);
    var t = k < 0 ? 0 : 255, p = Math.abs(k);
    return 'rgba(' + Math.round(c[0] + (t - c[0]) * p) + ',' + Math.round(c[1] + (t - c[1]) * p) + ',' + Math.round(c[2] + (t - c[2]) * p) + ',' + a + ')';
  }
  function rgba(hex, a) {
    var c = hexRgb(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function range(r, a, b) { return a + (b - a) * r(); }
  function pick(r, list) { return list[Math.floor(r() * list.length) % list.length]; }

  // 不規則的團塊輪廓（以橢圓為底加雜訊），回傳點陣列
  function blob(cx, cy, rx, ry, n, jitter, r) {
    var pts = [];
    var phase = r() * Math.PI * 2;
    for (var i = 0; i < n; i++) {
      var a = phase + i / n * Math.PI * 2;
      var k = 1 + (r() * 2 - 1) * jitter;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  function pathPoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  // 平滑的封閉曲線（中點二次曲線）
  function pathSmooth(g, pts) {
    var n = pts.length;
    g.beginPath();
    var m0 = [(pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2];
    g.moveTo(m0[0], m0[1]);
    for (var i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    g.closePath();
  }
  function shadowEllipse(g, cx, cy, rx, ry, a) {
    g.save();
    var grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
    grad.addColorStop(0, 'rgba(0,0,0,' + a + ')');
    grad.addColorStop(0.7, 'rgba(0,0,0,' + (a * 0.6) + ')');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    g.beginPath();
    g.arc(0, 0, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  function speckle(g, r, x0, y0, w, h, n, color, size, clipPath) {
    g.save();
    if (clipPath) { clipPath(); g.clip(); }
    g.fillStyle = color;
    for (var i = 0; i < n; i++) {
      var s = size * (0.4 + r());
      g.fillRect(x0 + r() * w, y0 + r() * h, s, s);
    }
    g.restore();
  }

  /* ============ 直立擺件 ============
     每個畫法收 (g, w, h, r, pal)，座標是邏輯像素（外層已依圖集解析度放大）；腳底在 (w/2, h - FOOT)。 */
  var FOOT = 8;

  // 低多邊形分面岩石：受光的頂面、半亮的左側面、背光的右側面，邊緣只描一層淡淡的暗線
  function drawRock(g, w, h, r, pal, opt) {
    opt = opt || {};
    var fy = h - FOOT, cx = w / 2;
    var bw = w * 0.86, bh = h - FOOT - 3;
    shadowEllipse(g, cx + 4, fy - 1, bw * 0.62, bw * 0.15, 0.5);
    var pts = [
      [cx - bw * 0.5, fy],
      [cx - bw * range(r, 0.44, 0.52), fy - bh * range(r, 0.32, 0.5)],
      [cx - bw * range(r, 0.18, 0.32), fy - bh * range(r, 0.8, 0.95)],
      [cx + bw * range(r, -0.06, 0.14), fy - bh],
      [cx + bw * range(r, 0.26, 0.4), fy - bh * range(r, 0.66, 0.86)],
      [cx + bw * 0.5, fy - bh * range(r, 0.26, 0.44)],
      [cx + bw * range(r, 0.38, 0.47), fy]
    ];
    var ridge = [cx + bw * range(r, -0.12, 0.04), fy - bh * range(r, 0.5, 0.62)];
    var footMid = [cx + bw * range(r, -0.02, 0.14), fy];
    var body = function () { pathPoly(g, pts); };
    function face(poly, c0, c1, x0, y0, x1, y1) {
      pathPoly(g, poly);
      var gr = g.createLinearGradient(x0, y0, x1, y1);
      gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr;
      g.fill();
    }
    // 左側面、右側面、頂面
    face([pts[0], pts[1], ridge, footMid], shade(pal.base, 0.02), shade(pal.base, -0.3), cx - bw / 2, fy - bh * 0.5, cx, fy);
    face([footMid, ridge, pts[4], pts[5], pts[6]], shade(pal.base, -0.32), pal.dark, cx, fy - bh * 0.5, cx + bw / 2, fy);
    face([pts[1], pts[2], pts[3], pts[4], ridge], pal.light, shade(pal.base, 0.05), cx - bw * 0.2, fy - bh, cx + bw * 0.2, fy - bh * 0.5);
    g.save(); body(); g.clip();
    // 次要的切面線與缺角
    g.strokeStyle = 'rgba(0,0,0,0.22)';
    g.lineWidth = 1;
    for (var e = 0; e < 3; e++) {
      var a = pick(r, pts), b = [lerp(ridge[0], a[0], range(r, 0.3, 0.7)), lerp(ridge[1], a[1], range(r, 0.3, 0.7))];
      g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] + range(r, -8, 8), b[1] + range(r, 2, 10)); g.stroke();
    }
    // 稜線受光
    g.strokeStyle = rgba(pal.hi || '#ffffff', 0.22);
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(pts[1][0], pts[1][1]); g.lineTo(ridge[0], ridge[1]); g.lineTo(pts[4][0], pts[4][1]); g.stroke();
    g.beginPath(); g.moveTo(ridge[0], ridge[1]); g.lineTo(footMid[0], footMid[1]); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.stroke();
    // 石面顆粒
    speckle(g, r, cx - bw / 2, fy - bh, bw, bh, Math.round(bw * bh / 45), 'rgba(0,0,0,0.16)', 1.4);
    speckle(g, r, cx - bw / 2, fy - bh, bw, bh * 0.6, Math.round(bw * bh / 110), rgba(pal.hi || '#ffffff', 0.12), 1.2);
    // 貼地處的環境遮蔽
    var ao = g.createLinearGradient(0, fy - bh * 0.25, 0, fy);
    ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = ao; g.fillRect(cx - bw / 2, fy - bh * 0.25, bw, bh * 0.25);
    if (opt.snow) {
      var sp = [[pts[1][0] + 2, pts[1][1] + 2], pts[2], pts[3], pts[4], [lerp(pts[4][0], ridge[0], 0.4), ridge[1] - bh * 0.02],
        [lerp(ridge[0], pts[1][0], 0.5), ridge[1] + bh * range(r, -0.04, 0.06)]];
      pathSmooth(g, sp);
      var sgr = g.createLinearGradient(0, fy - bh, 0, ridge[1]);
      sgr.addColorStop(0, '#f6f9ff'); sgr.addColorStop(1, '#b6cadf');
      g.fillStyle = sgr; g.fill();
    }
    if (opt.moss) {
      for (var m = 0; m < 5; m++) {
        var mx = cx + range(r, -bw * 0.4, bw * 0.2), my = fy - bh * range(r, 0.5, 0.95);
        var mg = g.createRadialGradient(mx, my, 0, mx, my, bw * 0.2);
        mg.addColorStop(0, rgba(opt.moss, 0.6)); mg.addColorStop(1, rgba(opt.moss, 0));
        g.fillStyle = mg; g.fillRect(mx - bw * 0.2, my - bw * 0.2, bw * 0.4, bw * 0.4);
      }
    }
    g.restore();
    body();
    g.strokeStyle = 'rgba(8,6,4,0.55)';
    g.lineWidth = 1;
    g.stroke();
  }

  function drawPillar(g, w, h, r, pal, opt) {
    opt = opt || {};
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 7, fy - 1, w * 0.5, w * 0.15, 0.5);
    // 兩層底座（有頂面，看得出厚度）
    function block(bw, bh, by, tone) {
      var top = 5;
      g.fillStyle = shade(pal.base, tone - 0.28);
      g.fillRect(cx - bw / 2, by - bh, bw, bh);
      var fg = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
      fg.addColorStop(0, shade(pal.base, tone - 0.1)); fg.addColorStop(0.4, shade(pal.base, tone + 0.05)); fg.addColorStop(1, shade(pal.base, tone - 0.4));
      g.fillStyle = fg;
      g.fillRect(cx - bw / 2, by - bh, bw, bh);
      g.fillStyle = shade(pal.base, tone + 0.18);
      g.beginPath();
      g.moveTo(cx - bw / 2, by - bh); g.lineTo(cx + bw / 2, by - bh); g.lineTo(cx + bw / 2 - 4, by - bh - top); g.lineTo(cx - bw / 2 + 4, by - bh - top);
      g.closePath(); g.fill();
      g.strokeStyle = 'rgba(8,6,4,0.5)'; g.lineWidth = 1;
      g.strokeRect(cx - bw / 2, by - bh, bw, bh);
      return by - bh - top;
    }
    var y = block(w * 0.9, h * 0.06, fy, -0.05);
    y = block(w * 0.74, h * 0.05, y + 2, 0);
    var sw = w * 0.54;
    var topY = opt.intact ? h * 0.14 : h * range(r, 0.2, 0.36);
    var jag = [];
    if (!opt.intact) {
      var steps = 5;
      for (var s = 0; s <= steps; s++) jag.push([cx - sw / 2 + sw * s / steps, topY + range(r, -5, 6) + (s / steps) * range(r, 0, 14)]);
    }
    var shaft = function () {
      g.beginPath();
      g.moveTo(cx - sw / 2, y + 2);
      if (opt.intact) {
        g.lineTo(cx - sw / 2, topY); g.lineTo(cx + sw / 2, topY);
      } else {
        for (var j = 0; j < jag.length; j++) g.lineTo(jag[j][0], jag[j][1]);
      }
      g.lineTo(cx + sw / 2, y + 2);
      g.closePath();
    };
    var sg = g.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
    sg.addColorStop(0, shade(pal.base, -0.3));
    sg.addColorStop(0.3, shade(pal.base, 0.18));
    sg.addColorStop(0.55, shade(pal.base, 0.02));
    sg.addColorStop(1, shade(pal.base, -0.55));
    shaft(); g.fillStyle = sg; g.fill();
    g.save(); shaft(); g.clip();
    // 細凹槽
    for (var f = 1; f < 6; f++) {
      var fx = cx - sw / 2 + sw * f / 6;
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(fx - 1, topY - 10, 1.4, y - topY + 12);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(fx + 0.6, topY - 10, 1, y - topY + 12);
    }
    // 裂痕與風化
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 1;
    for (var c = 0; c < 2; c++) {
      var x = cx + range(r, -sw * 0.35, sw * 0.35), yy = range(r, topY + 18, y - 20);
      g.beginPath(); g.moveTo(x, yy);
      for (var k = 0; k < 4; k++) { x += range(r, -5, 5); yy += range(r, 4, 10); g.lineTo(x, yy); }
      g.stroke();
    }
    speckle(g, r, cx - sw / 2, topY, sw, y - topY, 60, 'rgba(0,0,0,0.14)', 1.4);
    var ao = g.createLinearGradient(0, y - 30, 0, y);
    ao.addColorStop(0, 'rgba(0,0,0,0)'); ao.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = ao; g.fillRect(cx - sw / 2, y - 30, sw, 32);
    if (opt.moss) {
      for (var m = 0; m < 4; m++) {
        var mx = cx + range(r, -sw * 0.5, sw * 0.3), my = range(r, topY + 10, y);
        var mg = g.createRadialGradient(mx, my, 0, mx, my, sw * 0.35);
        mg.addColorStop(0, rgba(opt.moss, 0.55)); mg.addColorStop(1, rgba(opt.moss, 0));
        g.fillStyle = mg; g.fillRect(mx - sw * 0.4, my - sw * 0.4, sw * 0.8, sw * 0.8);
      }
    }
    g.restore();
    if (opt.intact) {
      // 柱頭（兩層）
      g.fillStyle = shade(pal.base, -0.2);
      g.fillRect(cx - sw * 0.62, topY - 3, sw * 1.24, 7);
      g.fillStyle = shade(pal.base, 0.12);
      g.fillRect(cx - sw * 0.7, topY - 11, sw * 1.4, 8);
      g.fillStyle = shade(pal.base, 0.3);
      g.beginPath(); g.moveTo(cx - sw * 0.7, topY - 11); g.lineTo(cx + sw * 0.7, topY - 11); g.lineTo(cx + sw * 0.64, topY - 16); g.lineTo(cx - sw * 0.64, topY - 16); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(8,6,4,0.5)'; g.lineWidth = 1;
      g.strokeRect(cx - sw * 0.7, topY - 11, sw * 1.4, 8);
    } else {
      // 斷面
      g.fillStyle = shade(pal.base, 0.1);
      g.beginPath();
      g.moveTo(jag[0][0], jag[0][1]);
      for (var j2 = 1; j2 < jag.length; j2++) g.lineTo(jag[j2][0], jag[j2][1]);
      for (var j3 = jag.length - 1; j3 >= 0; j3--) g.lineTo(jag[j3][0] + 3, jag[j3][1] - 5);
      g.closePath(); g.fill();
    }
    shaft();
    g.strokeStyle = 'rgba(8,6,4,0.55)';
    g.lineWidth = 1;
    g.stroke();
    // 腳邊碎塊
    if (!opt.intact) {
      var side = r() < 0.5 ? -1 : 1;
      g.save();
      g.translate(cx + side * w * 0.42 - 13, fy - 18);
      drawRock(g, 26, 22, r, { light: shade(pal.base, 0.2), base: pal.base, dark: shade(pal.base, -0.5), hi: '#ffffff' });
      g.restore();
    }
  }

  function drawDeadTree(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.3, w * 0.08, 0.4);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    function branch(x, y, len, ang, width, depth) {
      var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
      var mx = (x + x2) / 2 + range(r, -len * 0.12, len * 0.12), my = (y + y2) / 2 + range(r, -len * 0.08, len * 0.08);
      g.strokeStyle = pal.wood;
      g.lineWidth = width;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, x2, y2); g.stroke();
      g.strokeStyle = rgba(pal.hi || '#c8b090', 0.25);
      g.lineWidth = Math.max(0.6, width * 0.3);
      g.beginPath(); g.moveTo(x - width * 0.25, y); g.quadraticCurveTo(mx - width * 0.25, my, x2 - width * 0.2, y2); g.stroke();
      if (depth <= 0 || width < 1.2) return;
      var n = depth > 2 ? 2 : (r() < 0.6 ? 2 : 1);
      for (var i = 0; i < n; i++) {
        branch(x2, y2, len * range(r, 0.55, 0.78), ang + range(r, -0.75, 0.75), width * 0.62, depth - 1);
      }
    }
    // 樹根
    for (var k = 0; k < 3; k++) {
      g.strokeStyle = pal.wood;
      g.lineWidth = 3;
      g.beginPath(); g.moveTo(cx, fy - 4);
      g.quadraticCurveTo(cx + (k - 1) * 10, fy - 2, cx + (k - 1) * 18 + range(r, -4, 4), fy + 1);
      g.stroke();
    }
    branch(cx, fy - 2, h * 0.36, -Math.PI / 2 + range(r, -0.12, 0.12), Math.max(5, w * 0.09), 4);
  }

  function drawCactus(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.32, w * 0.09, 0.4);
    function column(x, y0, y1, cw) {
      var grad = g.createLinearGradient(x - cw / 2, 0, x + cw / 2, 0);
      grad.addColorStop(0, shade(pal.base, -0.35));
      grad.addColorStop(0.35, shade(pal.base, 0.2));
      grad.addColorStop(1, shade(pal.base, -0.55));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - cw / 2, y0);
      g.lineTo(x - cw / 2, y1 + cw / 2);
      g.arc(x, y1 + cw / 2, cw / 2, Math.PI, 0);
      g.lineTo(x + cw / 2, y0);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.lineWidth = 1;
      for (var i = -1; i <= 1; i++) {
        g.beginPath(); g.moveTo(x + i * cw * 0.25, y0); g.lineTo(x + i * cw * 0.25, y1 + cw * 0.3); g.stroke();
      }
      g.fillStyle = rgba('#f0e8c8', 0.6);
      for (var s = y1 + 6; s < y0; s += 7) {
        g.fillRect(x - cw / 2 - 1, s, 1.5, 1.5);
        g.fillRect(x + cw / 2 - 0.5, s + 3, 1.5, 1.5);
      }
      g.strokeStyle = 'rgba(10,14,8,0.8)';
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x - cw / 2, y0); g.lineTo(x - cw / 2, y1 + cw / 2); g.arc(x, y1 + cw / 2, cw / 2, Math.PI, 0); g.lineTo(x + cw / 2, y0);
      g.stroke();
    }
    var cw = w * 0.24;
    // 手臂
    var armY = fy - h * range(r, 0.38, 0.5);
    var lx = cx - cw * 1.25, rx = cx + cw * 1.25;
    g.fillStyle = shade(pal.base, -0.2);
    g.fillRect(lx, armY - cw * 0.3, cx - lx, cw * 0.6);
    column(lx, armY + cw * 0.3, armY - h * 0.22, cw * 0.78);
    if (r() < 0.75) {
      var armY2 = fy - h * range(r, 0.3, 0.42);
      g.fillStyle = shade(pal.base, -0.3);
      g.fillRect(cx, armY2 - cw * 0.3, rx - cx, cw * 0.6);
      column(rx, armY2 + cw * 0.3, armY2 - h * 0.16, cw * 0.74);
    }
    column(cx, fy, fy - h * 0.8, cw);
  }

  function drawCrystals(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.42, w * 0.11, 0.35);
    var halo = g.createRadialGradient(cx, fy - h * 0.4, 0, cx, fy - h * 0.4, w * 0.55);
    halo.addColorStop(0, rgba(pal.glow, 0.28));
    halo.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = halo;
    g.fillRect(0, 0, w, h);
    var n = 3 + Math.floor(r() * 3);
    var shards = [];
    for (var i = 0; i < n; i++) {
      shards.push({
        x: cx + range(r, -w * 0.28, w * 0.28),
        hgt: h * range(r, 0.35, 0.82) * (i === 0 ? 1 : 0.8),
        sw: w * range(r, 0.1, 0.17),
        lean: range(r, -0.35, 0.35)
      });
    }
    shards.sort(function (a, b) { return b.hgt - a.hgt; });
    shards.forEach(function (s) {
      var bx = s.x, by = fy - 2;
      var tx = bx + s.lean * s.hgt, ty = by - s.hgt;
      var lx = bx - s.sw / 2, rx = bx + s.sw / 2;
      // 左面（受光）
      g.beginPath();
      g.moveTo(lx, by); g.lineTo(lx + s.lean * s.hgt * 0.8, ty + s.hgt * 0.18); g.lineTo(tx, ty); g.lineTo(bx + s.lean * 2, by);
      g.closePath();
      var lg = g.createLinearGradient(lx, ty, bx, by);
      lg.addColorStop(0, pal.light); lg.addColorStop(1, pal.base);
      g.fillStyle = lg; g.fill();
      // 右面（背光）
      g.beginPath();
      g.moveTo(bx + s.lean * 2, by); g.lineTo(tx, ty); g.lineTo(rx + s.lean * s.hgt * 0.8, ty + s.hgt * 0.18); g.lineTo(rx, by);
      g.closePath();
      var rg = g.createLinearGradient(bx, ty, rx, by);
      rg.addColorStop(0, pal.base); rg.addColorStop(1, pal.dark);
      g.fillStyle = rg; g.fill();
      // 內光
      g.strokeStyle = rgba('#ffffff', 0.5);
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(bx - s.sw * 0.2, by - 4); g.lineTo(tx - s.sw * 0.08, ty + 6); g.stroke();
      g.strokeStyle = rgba(pal.dark, 0.9);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(lx, by); g.lineTo(lx + s.lean * s.hgt * 0.8, ty + s.hgt * 0.18); g.lineTo(tx, ty);
      g.lineTo(rx + s.lean * s.hgt * 0.8, ty + s.hgt * 0.18); g.lineTo(rx, by);
      g.stroke();
    });
    // 底部碎石
    for (var k = 0; k < 4; k++) {
      g.save();
      g.translate(cx + range(r, -w * 0.38, w * 0.3), fy - 10);
      drawRock(g, 16, 14, r, { light: shade(pal.rock || '#6a6a78', 0.3), base: pal.rock || '#6a6a78', dark: shade(pal.rock || '#6a6a78', -0.5) });
      g.restore();
    }
  }

  function drawGrave(g, w, h, r, pal, opt) {
    opt = opt || {};
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 5, fy, w * 0.46, w * 0.12, 0.45);
    // 土丘
    g.fillStyle = shade(pal.dirt || '#3a3028', -0.1);
    g.beginPath(); g.ellipse(cx, fy - 2, w * 0.42, 7, 0, Math.PI, 0); g.fill();
    var sw = w * 0.56, sh = h * 0.7, tilt = range(r, -0.12, 0.12);
    g.save();
    g.translate(cx, fy - 4);
    g.rotate(tilt);
    var slab = function (dx) {
      g.beginPath();
      g.moveTo(-sw / 2 + dx, 0);
      g.lineTo(-sw / 2 + dx, -sh + sw / 2);
      g.arc(dx, -sh + sw / 2, sw / 2, Math.PI, 0);
      g.lineTo(sw / 2 + dx, 0);
      g.closePath();
    };
    // 側面厚度
    slab(4); g.fillStyle = shade(pal.base, -0.5); g.fill();
    slab(0);
    var sg = g.createLinearGradient(-sw / 2, -sh, sw / 2, 0);
    sg.addColorStop(0, shade(pal.base, 0.25)); sg.addColorStop(0.5, pal.base); sg.addColorStop(1, shade(pal.base, -0.35));
    g.fillStyle = sg; g.fill();
    g.save(); slab(0); g.clip();
    speckle(g, r, -sw / 2, -sh, sw, sh, 50, 'rgba(0,0,0,0.2)', 1.5);
    if (opt.moss) {
      var mg = g.createLinearGradient(0, 0, 0, -sh * 0.5);
      mg.addColorStop(0, rgba(opt.moss, 0.55)); mg.addColorStop(1, rgba(opt.moss, 0));
      g.fillStyle = mg; g.fillRect(-sw / 2, -sh * 0.5, sw, sh * 0.5);
    }
    // 刻紋
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = 2.2;
    if (opt.cross !== false) {
      g.beginPath(); g.moveTo(0, -sh + sw * 0.3); g.lineTo(0, -sh * 0.38); g.stroke();
      g.beginPath(); g.moveTo(-sw * 0.2, -sh + sw * 0.52); g.lineTo(sw * 0.2, -sh + sw * 0.52); g.stroke();
    }
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-sw * 0.28, -sh * 0.28); g.lineTo(sw * 0.28, -sh * 0.28); g.stroke();
    g.beginPath(); g.moveTo(-sw * 0.22, -sh * 0.2); g.lineTo(sw * 0.22, -sh * 0.2); g.stroke();
    // 裂痕
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.1;
    var x = range(r, -sw * 0.3, sw * 0.3), y = -sh + range(r, 4, 14);
    g.beginPath(); g.moveTo(x, y);
    for (var k = 0; k < 4; k++) { x += range(r, -5, 5); y += range(r, 5, 11); g.lineTo(x, y); }
    g.stroke();
    g.restore();
    slab(0);
    g.strokeStyle = 'rgba(8,8,10,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  }

  function drawSkullPile(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.44, w * 0.12, 0.4);
    function bone(x, y, len, ang) {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = pal.bone;
      g.fillRect(-len / 2, -1.6, len, 3.2);
      [-1, 1].forEach(function (sd) {
        g.beginPath(); g.arc(sd * len / 2, -2, 2.6, 0, Math.PI * 2); g.arc(sd * len / 2, 2, 2.6, 0, Math.PI * 2); g.fill();
      });
      g.strokeStyle = 'rgba(30,24,18,0.6)'; g.lineWidth = 0.8;
      g.strokeRect(-len / 2, -1.6, len, 3.2);
      g.restore();
    }
    function skull(x, y, s) {
      var grad = g.createRadialGradient(x - s * 0.3, y - s * 0.4, 1, x, y, s * 1.2);
      grad.addColorStop(0, shade(pal.bone, 0.25)); grad.addColorStop(1, shade(pal.bone, -0.35));
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y - s * 0.2, s, Math.PI * 0.95, Math.PI * 2.05); g.lineTo(x + s * 0.6, y + s * 0.7); g.lineTo(x - s * 0.6, y + s * 0.7); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,24,18,0.75)'; g.lineWidth = 1; g.stroke();
      g.fillStyle = '#16120e';
      g.beginPath(); g.ellipse(x - s * 0.38, y, s * 0.26, s * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(x + s * 0.38, y, s * 0.26, s * 0.3, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.moveTo(x, y + s * 0.25); g.lineTo(x - s * 0.1, y + s * 0.45); g.lineTo(x + s * 0.1, y + s * 0.45); g.closePath(); g.fill();
      g.strokeStyle = '#16120e'; g.lineWidth = 0.8;
      for (var t = -2; t <= 2; t++) { g.beginPath(); g.moveTo(x + t * s * 0.12, y + s * 0.55); g.lineTo(x + t * s * 0.12, y + s * 0.72); g.stroke(); }
    }
    for (var b = 0; b < 6; b++) bone(cx + range(r, -w * 0.32, w * 0.32), fy - range(r, 2, 10), range(r, 12, 20), range(r, -0.6, 0.6));
    var s = w * 0.11;
    skull(cx - s * 1.2, fy - s * 1.1, s);
    skull(cx + s * 1.1, fy - s * 0.9, s * 0.9);
    if (r() < 0.7) skull(cx, fy - s * 2.3, s * 0.95);
  }

  function drawMushrooms(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx, fy, w * 0.4, w * 0.1, 0.35);
    var halo = g.createRadialGradient(cx, fy - h * 0.35, 0, cx, fy - h * 0.35, w * 0.6);
    halo.addColorStop(0, rgba(pal.glow, 0.3)); halo.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    var n = 2 + Math.floor(r() * 3);
    var list = [];
    for (var i = 0; i < n; i++) list.push({ x: cx + range(r, -w * 0.3, w * 0.3), hh: h * range(r, 0.25, 0.7), cw: w * range(r, 0.18, 0.34) });
    list.sort(function (a, b) { return b.hh - a.hh; });
    list.forEach(function (m) {
      g.strokeStyle = shade(pal.stem, -0.2); g.lineWidth = m.cw * 0.3; g.lineCap = 'round';
      g.beginPath(); g.moveTo(m.x, fy - 2); g.quadraticCurveTo(m.x + range(r, -4, 4), fy - m.hh * 0.5, m.x, fy - m.hh); g.stroke();
      g.strokeStyle = pal.stem; g.lineWidth = m.cw * 0.16;
      g.beginPath(); g.moveTo(m.x - m.cw * 0.05, fy - 2); g.lineTo(m.x - m.cw * 0.05, fy - m.hh); g.stroke();
      var cy = fy - m.hh;
      var cg = g.createRadialGradient(m.x - m.cw * 0.2, cy - m.cw * 0.3, 1, m.x, cy, m.cw * 0.7);
      cg.addColorStop(0, shade(pal.cap, 0.35)); cg.addColorStop(0.7, pal.cap); cg.addColorStop(1, shade(pal.cap, -0.4));
      g.fillStyle = cg;
      g.beginPath(); g.ellipse(m.x, cy, m.cw * 0.6, m.cw * 0.38, 0, Math.PI, 0); g.closePath(); g.fill();
      g.fillStyle = shade(pal.cap, -0.45);
      g.beginPath(); g.ellipse(m.x, cy, m.cw * 0.6, m.cw * 0.1, 0, 0, Math.PI); g.fill();
      g.fillStyle = rgba(pal.spot || '#ffffff', 0.8);
      for (var s = 0; s < 4; s++) {
        g.beginPath(); g.arc(m.x + range(r, -m.cw * 0.4, m.cw * 0.4), cy - range(r, m.cw * 0.06, m.cw * 0.28), range(r, 1, 2.4), 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(10,10,8,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.ellipse(m.x, cy, m.cw * 0.6, m.cw * 0.38, 0, Math.PI, 0); g.closePath(); g.stroke();
    });
  }

  function drawReeds(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx, fy, w * 0.36, w * 0.08, 0.3);
    g.lineCap = 'round';
    var n = 9 + Math.floor(r() * 6);
    for (var i = 0; i < n; i++) {
      var x = cx + range(r, -w * 0.3, w * 0.3);
      var hh = h * range(r, 0.45, 0.92);
      var bend = range(r, -w * 0.18, w * 0.18);
      var col = shade(pal.base, range(r, -0.35, 0.15));
      g.strokeStyle = col;
      g.lineWidth = range(r, 1.4, 2.6);
      g.beginPath(); g.moveTo(x, fy); g.quadraticCurveTo(x + bend * 0.3, fy - hh * 0.6, x + bend, fy - hh); g.stroke();
      if (r() < 0.4) {
        g.strokeStyle = pal.head || '#5a3a20';
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(x + bend * 0.92, fy - hh * 0.92); g.lineTo(x + bend * 0.98, fy - hh * 0.8); g.stroke();
      }
    }
  }

  function drawStump(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.44, w * 0.12, 0.4);
    var sw = w * 0.62, sh = h * 0.5;
    var top = fy - sh;
    var bg = g.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
    bg.addColorStop(0, shade(pal.wood, -0.3)); bg.addColorStop(0.35, shade(pal.wood, 0.15)); bg.addColorStop(1, shade(pal.wood, -0.55));
    g.fillStyle = bg;
    g.beginPath();
    g.moveTo(cx - sw / 2 - 6, fy); g.lineTo(cx - sw / 2, top); g.lineTo(cx + sw / 2, top); g.lineTo(cx + sw / 2 + 6, fy);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1;
    for (var k = 0; k < 5; k++) {
      var x = cx - sw / 2 + sw * (k + 0.5) / 5;
      g.beginPath(); g.moveTo(x, top + 4); g.lineTo(x + range(r, -3, 3), fy - 2); g.stroke();
    }
    g.fillStyle = shade(pal.ring || '#a08060', 0);
    g.beginPath(); g.ellipse(cx, top, sw / 2, sw * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = rgba('#3a2818', 0.6);
    for (var rr = 1; rr < 4; rr++) { g.beginPath(); g.ellipse(cx, top, sw / 2 * rr / 4, sw * 0.2 * rr / 4, 0, 0, Math.PI * 2); g.stroke(); }
    g.strokeStyle = 'rgba(10,8,6,0.85)'; g.lineWidth = 1.4;
    g.beginPath(); g.ellipse(cx, top, sw / 2, sw * 0.2, 0, 0, Math.PI * 2); g.stroke();
    if (pal.moss) {
      var mg = g.createLinearGradient(0, fy, 0, top);
      mg.addColorStop(0, rgba(pal.moss, 0.6)); mg.addColorStop(1, rgba(pal.moss, 0));
      g.fillStyle = mg; g.fillRect(cx - sw / 2 - 6, top, sw + 12, sh);
    }
  }

  function drawBrazier(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 3, fy, w * 0.36, w * 0.1, 0.45);
    var bowlY = fy - h * 0.58;
    g.strokeStyle = shade(pal.metal, -0.3);
    g.lineWidth = 3;
    g.lineCap = 'round';
    [[-0.32, 0], [0.32, 0], [0, 0.08]].forEach(function (l) {
      g.beginPath(); g.moveTo(cx + l[0] * w * 0.4, bowlY + 6); g.lineTo(cx + l[0] * w, fy - l[1] * h); g.stroke();
    });
    var bw = w * 0.62;
    var bgr = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    bgr.addColorStop(0, shade(pal.metal, -0.4)); bgr.addColorStop(0.35, shade(pal.metal, 0.25)); bgr.addColorStop(1, shade(pal.metal, -0.6));
    g.fillStyle = bgr;
    g.beginPath(); g.moveTo(cx - bw / 2, bowlY); g.quadraticCurveTo(cx, bowlY + bw * 0.55, cx + bw / 2, bowlY); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(8,8,8,0.9)'; g.lineWidth = 1.3; g.stroke();
    var coal = g.createRadialGradient(cx, bowlY, 0, cx, bowlY, bw / 2);
    coal.addColorStop(0, pal.fire2 || '#ffd27a'); coal.addColorStop(0.5, pal.fire || '#e25a1c'); coal.addColorStop(1, '#3a1206');
    g.fillStyle = coal;
    g.beginPath(); g.ellipse(cx, bowlY, bw / 2, bw * 0.13, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = shade(pal.metal, 0.1); g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(cx, bowlY, bw / 2, bw * 0.13, 0, 0, Math.PI * 2); g.stroke();
  }

  // 火焰（單獨一張，掛在火盆上做閃爍）
  function drawFlame(g, w, h, r, pal) {
    var cx = w / 2, by = h - 4;
    var glow = g.createRadialGradient(cx, by - h * 0.3, 0, cx, by - h * 0.3, w * 0.55);
    glow.addColorStop(0, rgba(pal.fire || '#ff8a2a', 0.35)); glow.addColorStop(1, rgba(pal.fire || '#ff8a2a', 0));
    g.fillStyle = glow; g.fillRect(0, 0, w, h);
    function tongue(sx, hh, ww, col) {
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(cx + sx - ww, by);
      g.quadraticCurveTo(cx + sx - ww * 1.1, by - hh * 0.5, cx + sx + ww * 0.2, by - hh);
      g.quadraticCurveTo(cx + sx + ww * 0.9, by - hh * 0.45, cx + sx + ww, by);
      g.closePath(); g.fill();
    }
    tongue(0, h * 0.86, w * 0.26, pal.fire || '#ff6a1a');
    tongue(-w * 0.1, h * 0.6, w * 0.18, pal.fire || '#ff6a1a');
    tongue(w * 0.1, h * 0.55, w * 0.16, pal.fire || '#ff6a1a');
    tongue(0, h * 0.58, w * 0.16, pal.fire2 || '#ffd27a');
    tongue(0, h * 0.3, w * 0.09, '#fff6d8');
  }

  function drawRuinWall(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 8, fy, w * 0.5, w * 0.1, 0.45);
    var ww = w * 0.9, depth = 10;
    var x0 = cx - ww / 2;
    var cols = 6, rowH = 11;
    var heights = [];
    for (var c = 0; c < cols; c++) heights.push(Math.round(range(r, 2, 6)) * rowH * (c === 0 || c === cols - 1 ? 0.6 : 1));
    var bw = ww / cols;
    for (var c2 = 0; c2 < cols; c2++) {
      var hh = heights[c2];
      for (var y = 0; y < hh; y += rowH) {
        var off = (Math.floor(y / rowH) % 2) * bw * 0.5;
        var bx = x0 + c2 * bw + (off && c2 === cols - 1 ? 0 : 0);
        var yy = fy - y - rowH;
        var tone = range(r, -0.18, 0.12);
        g.fillStyle = shade(pal.base, tone);
        g.fillRect(bx + 0.8, yy + 0.8, bw - 1.6 - (off ? 0 : 0), rowH - 1.6);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(bx, yy + rowH - 1.4, bw, 1.4);
        if (off) g.fillRect(bx + bw * 0.5, yy, 1.4, rowH);
        else g.fillRect(bx + bw - 1.2, yy, 1.2, rowH);
      }
      // 頂面
      var ty = fy - hh;
      g.fillStyle = shade(pal.base, 0.25);
      g.beginPath();
      g.moveTo(x0 + c2 * bw, ty); g.lineTo(x0 + (c2 + 1) * bw, ty);
      g.lineTo(x0 + (c2 + 1) * bw + 4, ty - depth * 0.6); g.lineTo(x0 + c2 * bw + 4, ty - depth * 0.6);
      g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(8,8,8,0.8)';
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(x0, fy);
    for (var c3 = 0; c3 < cols; c3++) { g.lineTo(x0 + c3 * bw, fy - heights[c3]); g.lineTo(x0 + (c3 + 1) * bw, fy - heights[c3]); }
    g.lineTo(x0 + ww, fy);
    g.stroke();
    if (pal.moss) {
      for (var m = 0; m < 4; m++) {
        var mx = x0 + range(r, 0, ww), my = fy - range(r, 4, 30);
        var mg = g.createRadialGradient(mx, my, 0, mx, my, 16);
        mg.addColorStop(0, rgba(pal.moss, 0.5)); mg.addColorStop(1, rgba(pal.moss, 0));
        g.fillStyle = mg; g.fillRect(mx - 16, my - 16, 32, 32);
      }
    }
  }

  function drawSword(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 6, fy, w * 0.3, w * 0.08, 0.4);
    var ang = range(r, -0.35, 0.35);
    g.save();
    g.translate(cx, fy - 3);
    g.rotate(ang);
    var L = h * 0.78;
    var bl = g.createLinearGradient(-4, 0, 4, 0);
    bl.addColorStop(0, '#5a6068'); bl.addColorStop(0.45, '#d8dde4'); bl.addColorStop(1, '#3a3e44');
    g.fillStyle = bl;
    g.beginPath(); g.moveTo(-4, 0); g.lineTo(-4, -L * 0.72); g.lineTo(4, -L * 0.72); g.lineTo(4, 0); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(10,10,12,0.8)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = pal.metal || '#8a6a30';
    g.fillRect(-13, -L * 0.75, 26, 5);
    g.fillStyle = '#3a2618';
    g.fillRect(-2.5, -L, 5, L * 0.25);
    g.fillStyle = pal.metal || '#8a6a30';
    g.beginPath(); g.arc(0, -L, 4, 0, Math.PI * 2); g.fill();
    g.restore();
    g.fillStyle = shade(pal.dirt || '#3a3028', 0);
    g.beginPath(); g.ellipse(cx, fy - 2, 8, 3, 0, 0, Math.PI * 2); g.fill();
  }

  function drawBanner(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w * 0.35;
    shadowEllipse(g, cx + 6, fy, w * 0.3, w * 0.08, 0.4);
    g.strokeStyle = '#2e2218';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, fy); g.lineTo(cx + range(r, -3, 3), fy - h * 0.92); g.stroke();
    var top = fy - h * 0.88;
    var fw = w * 0.55, fh = h * 0.5;
    g.fillStyle = pal.cloth;
    g.beginPath();
    g.moveTo(cx + 2, top);
    g.lineTo(cx + fw, top + 4);
    g.lineTo(cx + fw - 6, top + fh * 0.5);
    g.lineTo(cx + fw, top + fh);
    for (var i = 4; i > 0; i--) g.lineTo(cx + fw * i / 5, top + fh - range(r, 0, 14));
    g.lineTo(cx + 2, top + fh * 0.85);
    g.closePath();
    var cg = g.createLinearGradient(cx, top, cx + fw, top + fh);
    cg.addColorStop(0, shade(pal.cloth, 0.15)); cg.addColorStop(1, shade(pal.cloth, -0.5));
    g.fillStyle = cg; g.fill();
    g.strokeStyle = 'rgba(10,6,6,0.8)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = rgba(pal.emblem || '#d8b26a', 0.85);
    g.beginPath(); g.arc(cx + fw * 0.45, top + fh * 0.4, fw * 0.14, 0, Math.PI * 2); g.fill();
  }

  function drawRuneStone(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    shadowEllipse(g, cx + 4, fy, w * 0.4, w * 0.1, 0.4);
    var halo = g.createRadialGradient(cx, fy - h * 0.45, 0, cx, fy - h * 0.45, w * 0.6);
    halo.addColorStop(0, rgba(pal.glow, 0.22)); halo.addColorStop(1, rgba(pal.glow, 0));
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    var sw = w * 0.46, top = fy - h * 0.85;
    var slab = function () {
      g.beginPath();
      g.moveTo(cx - sw / 2, fy); g.lineTo(cx - sw * 0.42, top + 10); g.lineTo(cx, top); g.lineTo(cx + sw * 0.42, top + 10); g.lineTo(cx + sw / 2, fy);
      g.closePath();
    };
    var sg = g.createLinearGradient(cx - sw / 2, 0, cx + sw / 2, 0);
    sg.addColorStop(0, shade(pal.base, -0.35)); sg.addColorStop(0.4, shade(pal.base, 0.15)); sg.addColorStop(1, shade(pal.base, -0.55));
    slab(); g.fillStyle = sg; g.fill();
    g.save(); slab(); g.clip();
    speckle(g, r, cx - sw / 2, top, sw, fy - top, 40, 'rgba(0,0,0,0.2)', 1.5);
    g.restore();
    g.save();
    g.shadowColor = pal.glow; g.shadowBlur = 8;
    g.strokeStyle = shade(pal.glow, 0.4); g.lineWidth = 1.6;
    var ry = top + 18;
    for (var k = 0; k < 4; k++) {
      var y = ry + k * 14;
      g.beginPath();
      g.moveTo(cx - 5, y); g.lineTo(cx + range(r, -4, 6), y + 6); g.lineTo(cx + 5, y + range(r, 0, 10));
      g.stroke();
    }
    g.restore();
    slab(); g.strokeStyle = 'rgba(8,8,10,0.9)'; g.lineWidth = 1.4; g.stroke();
  }

  function drawGrass(g, w, h, r, pal) {
    var fy = h - FOOT, cx = w / 2;
    g.lineCap = 'round';
    var n = 10 + Math.floor(r() * 8);
    for (var i = 0; i < n; i++) {
      var x = cx + range(r, -w * 0.32, w * 0.32);
      var hh = h * range(r, 0.3, 0.85);
      var bend = range(r, -w * 0.22, w * 0.22);
      g.strokeStyle = shade(pal.base, range(r, -0.3, 0.2));
      g.lineWidth = range(r, 1.2, 2.2);
      g.beginPath(); g.moveTo(x, fy); g.quadraticCurveTo(x + bend * 0.2, fy - hh * 0.6, x + bend, fy - hh); g.stroke();
    }
  }

  /* ============ 地面裝飾（俯視畫，地面平面容器會縱向壓成 GROUND_Y_SCALE） ============ */
  function decalPatch(g, w, h, r, pal) {
    var cx = w / 2, cy = h / 2;
    for (var i = 0; i < 26; i++) {
      var a = r() * Math.PI * 2, d = r() * w * 0.26;
      var x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      var rad = w * range(r, 0.12, 0.26);
      var gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(pal.color, pal.alpha || 0.14));
      gr.addColorStop(1, rgba(pal.color, 0));
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // 細碎顆粒，讓色塊不是平的
    for (var k = 0; k < w * 1.2; k++) {
      var a2 = r() * Math.PI * 2, d2 = Math.sqrt(r()) * w * 0.4;
      g.fillStyle = rgba(r() < 0.5 ? '#000000' : (pal.grain || '#ffffff'), 0.08 + r() * 0.08);
      var s = 1 + r() * 2;
      g.fillRect(cx + Math.cos(a2) * d2, cy + Math.sin(a2) * d2, s, s);
    }
  }

  function decalCrack(g, w, h, r, pal) {
    var cx = w / 2, cy = h / 2;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    var segs = [];
    function grow(x, y, ang, len, width, depth) {
      var pts = [[x, y]];
      var n = 4 + Math.floor(r() * 3);
      for (var i = 0; i < n; i++) {
        ang += range(r, -0.5, 0.5);
        x += Math.cos(ang) * len / n; y += Math.sin(ang) * len / n;
        pts.push([x, y]);
        if (depth > 0 && r() < 0.35) grow(x, y, ang + range(r, -1.2, 1.2), len * 0.5, width * 0.6, depth - 1);
      }
      segs.push({ pts: pts, width: width });
    }
    var arms = 2 + Math.floor(r() * 2);
    for (var a = 0; a < arms; a++) grow(cx, cy, a / arms * Math.PI * 2 + range(r, -0.4, 0.4), w * range(r, 0.3, 0.45), range(r, 3, 5), 2);
    function strokeAll(col, extra, blur) {
      g.save();
      if (blur) { g.shadowColor = col; g.shadowBlur = blur; }
      g.strokeStyle = col;
      segs.forEach(function (s) {
        g.lineWidth = Math.max(0.6, s.width + extra);
        g.beginPath(); g.moveTo(s.pts[0][0], s.pts[0][1]);
        for (var i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i][0], s.pts[i][1]);
        g.stroke();
      });
      g.restore();
    }
    if (pal.glow) strokeAll(rgba(pal.glow, 0.55), 3, 10);
    strokeAll(rgba(pal.rim || '#ffffff', 0.12), 2.4);
    strokeAll(pal.dark || 'rgba(0,0,0,0.75)', 0);
    if (pal.glow) strokeAll(shadeRgba(pal.glow, 0.5, 0.9), -1.5);
  }

  function decalPebbles(g, w, h, r, pal) {
    var n = 6 + Math.floor(r() * 8);
    for (var i = 0; i < n; i++) {
      var x = w / 2 + range(r, -w * 0.4, w * 0.4), y = h / 2 + range(r, -h * 0.4, h * 0.4);
      var s = range(r, 2.5, 7);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.ellipse(x + 1.5, y + 1.5, s, s * 0.8, 0, 0, Math.PI * 2); g.fill();
      var gr = g.createRadialGradient(x - s * 0.3, y - s * 0.3, 0.5, x, y, s);
      gr.addColorStop(0, shade(pal.color, 0.3)); gr.addColorStop(1, shade(pal.color, -0.35));
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(x, y, s, s * 0.8, r() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  }

  function decalBones(g, w, h, r, pal) {
    var n = 3 + Math.floor(r() * 4);
    for (var i = 0; i < n; i++) {
      var x = w / 2 + range(r, -w * 0.35, w * 0.35), y = h / 2 + range(r, -h * 0.35, h * 0.35);
      var len = range(r, 14, 26), ang = r() * Math.PI;
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-len / 2 + 1.5, -1.5, len, 4.5);
      g.fillStyle = pal.color;
      g.fillRect(-len / 2, -2, len, 4);
      [-1, 1].forEach(function (sd) { g.beginPath(); g.arc(sd * len / 2, -2.4, 3, 0, Math.PI * 2); g.arc(sd * len / 2, 2.4, 3, 0, Math.PI * 2); g.fill(); });
      g.restore();
    }
    if (r() < 0.6) {
      var sx = w / 2 + range(r, -w * 0.2, w * 0.2), sy = h / 2 + range(r, -h * 0.2, h * 0.2);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(sx + 2, sy + 2, 10, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = pal.color; g.beginPath(); g.ellipse(sx, sy, 10, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#16120e';
      g.beginPath(); g.arc(sx - 4, sy + 1, 3, 0, Math.PI * 2); g.arc(sx + 4, sy + 1, 3, 0, Math.PI * 2); g.fill();
    }
  }

  function decalPuddle(g, w, h, r, pal) {
    var pts = blob(w / 2, h / 2, w * 0.38, h * 0.32, 12, 0.18, r);
    pathSmooth(g, pts);
    var gr = g.createRadialGradient(w * 0.45, h * 0.42, 0, w / 2, h / 2, w * 0.42);
    gr.addColorStop(0, rgba(pal.color, 0.85));
    gr.addColorStop(0.8, shadeRgba(pal.color, -0.4, 0.85));
    gr.addColorStop(1, rgba(pal.color, 0.4));
    g.fillStyle = gr; g.fill();
    g.save(); pathSmooth(g, pts); g.clip();
    g.strokeStyle = rgba('#ffffff', 0.18); g.lineWidth = 2;
    for (var i = 0; i < 3; i++) {
      var y = h * range(r, 0.3, 0.7);
      g.beginPath(); g.moveTo(w * 0.2, y); g.quadraticCurveTo(w * 0.5, y - 4, w * 0.8, y); g.stroke();
    }
    g.restore();
    pathSmooth(g, pts);
    g.strokeStyle = rgba(pal.rim || '#000000', 0.5); g.lineWidth = 3; g.stroke();
    g.strokeStyle = rgba('#ffffff', 0.12); g.lineWidth = 1; g.stroke();
  }

  function decalRunes(g, w, h, r, pal) {
    var cx = w / 2, cy = h / 2, R = w * 0.42;
    g.save();
    g.shadowColor = pal.glow; g.shadowBlur = 10;
    g.strokeStyle = rgba(pal.glow, 0.55);
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.4;
    g.beginPath(); g.arc(cx, cy, R * 0.8, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(cx, cy, R * 0.32, 0, Math.PI * 2); g.stroke();
    var n = 12;
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      var x = cx + Math.cos(a) * R * 0.9, y = cy + Math.sin(a) * R * 0.9;
      g.save(); g.translate(x, y); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(-3, -3); g.lineTo(3, 0); g.lineTo(-3, 3); if (i % 2) { g.moveTo(0, -4); g.lineTo(0, 4); } g.stroke();
      g.restore();
    }
    for (var k = 0; k < 3; k++) {
      var a2 = k / 3 * Math.PI * 2 - Math.PI / 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a2) * R * 0.32, cy + Math.sin(a2) * R * 0.32); g.lineTo(cx + Math.cos(a2) * R * 0.8, cy + Math.sin(a2) * R * 0.8); g.stroke();
    }
    g.restore();
  }

  function decalTiles(g, w, h, r, pal) {
    var cell = 34;
    var cx = w / 2, cy = h / 2;
    for (var y = 0; y < h; y += cell) {
      for (var x = 0; x < w; x += cell) {
        var d = Math.hypot(x + cell / 2 - cx, y + cell / 2 - cy) / (w * 0.48);
        if (d > 1) continue;
        var a = (1 - d * d) * range(r, 0.5, 0.9);
        if (r() < 0.12) continue;   // 缺磚
        g.fillStyle = shadeRgba(pal.color, range(r, -0.12, 0.12), 0.45 * a);
        g.fillRect(x + 1.5, y + 1.5, cell - 3, cell - 3);
        g.fillStyle = rgba('#000000', 0.4 * a);
        g.fillRect(x, y + cell - 1.5, cell, 1.5);
        g.fillRect(x + cell - 1.5, y, 1.5, cell);
        g.fillStyle = rgba('#ffffff', 0.06 * a);
        g.fillRect(x + 1.5, y + 1.5, cell - 3, 2);
      }
    }
  }

  function decalLight(g, w, h, r, pal) {
    var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, rgba(pal.color, 0.55));
    gr.addColorStop(0.4, rgba(pal.color, 0.22));
    gr.addColorStop(1, rgba(pal.color, 0));
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }

  function decalSnow(g, w, h, r, pal) {
    for (var i = 0; i < 18; i++) {
      var a = r() * Math.PI * 2, d = r() * w * 0.24;
      var x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
      var rad = w * range(r, 0.1, 0.22);
      var gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(pal.color, 0.3));
      gr.addColorStop(0.6, rgba(pal.color, 0.16));
      gr.addColorStop(1, rgba(pal.color, 0));
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    for (var k = 0; k < 60; k++) {
      g.fillStyle = rgba('#ffffff', 0.25);
      g.fillRect(w / 2 + range(r, -w * 0.3, w * 0.3), h / 2 + range(r, -h * 0.3, h * 0.3), 1.5, 1.5);
    }
  }

  /* ============ 粒子貼圖 ============ */
  function particleDot(g, w, h) {
    var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }
  function particleFog(g, w, h, r) {
    for (var i = 0; i < 14; i++) {
      var x = w / 2 + range(r, -w * 0.28, w * 0.28), y = h / 2 + range(r, -h * 0.2, h * 0.2);
      var rad = w * range(r, 0.15, 0.3);
      var gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.22)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }

  /* ============ 各地圖的組合 ============
     props：[種類, 權重, 寬, 高, 調色, 選項]；decals：[種類, 權重, 尺寸, 調色]
     deep：地下版（每 10 階段一帶，雙數帶）——地面加暗、換一批擺件、光源多 */
  var SAND = { light: '#c8a87e', base: '#8a6c4c', dark: '#34261a', hi: '#ffe8c8' };
  var DARKSTONE = { light: '#8a8a94', base: '#55555e', dark: '#1e1e24' };
  var ICEROCK = { light: '#c8dcec', base: '#6e8aa4', dark: '#24364a', hi: '#ffffff' };
  var MOSSROCK = { light: '#7a8a6a', base: '#4a5640', dark: '#1a2216' };
  var MARBLE = { light: '#f4efe4', base: '#c9c1b0', dark: '#6e6658', hi: '#ffffff' };
  var CHAOSROCK = { light: '#6a5a7a', base: '#3a2e48', dark: '#120c1a' };
  var ASH = { light: '#7a6a62', base: '#4a3e38', dark: '#1a1412' };

  var KITS = {
    desert: {
      tint: 0xffffff, deepTint: 0x8a7f78,
      props: [['rock', 5, 70, 56, SAND], ['rock', 3, 46, 36, SAND], ['pillar', 1.6, 64, 132, { base: '#b8966a' }], ['deadTree', 1.6, 96, 128, { wood: '#3e2c1e', hi: '#c8a878' }],
        ['cactus', 1.6, 64, 104, { base: '#4a5e36' }], ['skullPile', 1, 64, 50, { bone: '#e2d6bc' }]],
      deepProps: [['pillar', 2.5, 64, 140, { base: '#a88a62' }, { intact: true }], ['pillar', 2, 64, 132, { base: '#a88a62' }], ['ruinWall', 2, 120, 76, { base: '#8a6e4c' }],
        ['brazier', 1.6, 58, 80, { metal: '#6a5a48' }], ['rock', 2, 64, 50, SAND], ['skullPile', 1.2, 64, 50, { bone: '#d8ccb0' }]],
      decals: [['patch', 6, 360, { color: '#c09868', alpha: 0.11 }], ['patch', 4, 300, { color: '#2a1a0e', alpha: 0.18 }], ['crack', 3, 150, { dark: 'rgba(30,18,8,0.8)', rim: '#e8c890' }],
        ['pebbles', 4, 90, { color: '#8a6a4a' }], ['bones', 1.2, 90, { color: '#d8ccb0' }]],
      deepDecals: [['tiles', 4, 300, { color: '#8a7050' }], ['patch', 4, 300, { color: '#1a1008', alpha: 0.22 }], ['crack', 3, 150, { dark: 'rgba(20,12,6,0.8)', rim: '#c8a070' }], ['pebbles', 3, 90, { color: '#7a5a3a' }]],
      ambient: { kind: 'dust', count: 34, color: 0xf0d8a8 }, deepAmbient: { kind: 'embers', count: 26, color: 0xffa040 }
    },
    Icefield: {
      tint: 0xffffff, deepTint: 0x7f8aa0,
      props: [['rock', 4, 72, 58, ICEROCK, { snow: true }], ['rock', 3, 46, 38, ICEROCK, { snow: true }], ['crystals', 3, 70, 96, { light: '#e8f6ff', base: '#8cc8f0', dark: '#2a5a8a', glow: '#9ad8ff', rock: '#6a7a8c' }],
        ['deadTree', 1.4, 90, 120, { wood: '#2e3440', hi: '#e8f0ff' }], ['skullPile', 0.6, 60, 48, { bone: '#dfe6ee' }]],
      deepProps: [['crystals', 5, 80, 118, { light: '#f0fbff', base: '#7ab8e8', dark: '#1e4a7a', glow: '#7ad0ff', rock: '#4a5a6c' }], ['rock', 3, 70, 56, ICEROCK, { snow: true }],
        ['pillar', 1.2, 60, 128, { base: '#9ab0c4' }], ['brazier', 1, 58, 80, { metal: '#5a6474', fire: '#4ab0ff', fire2: '#d8f4ff' }]],
      decals: [['snow', 6, 340, { color: '#eef6ff' }], ['patch', 3, 300, { color: '#203448', alpha: 0.16 }], ['crack', 3, 160, { dark: 'rgba(20,40,70,0.75)', rim: '#ffffff', glow: '#9ad8ff' }],
        ['puddle', 1.5, 150, { color: '#9ccbe8', rim: '#ffffff' }], ['pebbles', 2, 80, { color: '#8aa0b4' }]],
      deepDecals: [['crack', 4, 170, { dark: 'rgba(10,30,60,0.8)', rim: '#cfefff', glow: '#7ad0ff' }], ['puddle', 3, 170, { color: '#6aa8d8', rim: '#e8f8ff' }], ['patch', 4, 320, { color: '#0e1a2a', alpha: 0.22 }],
        ['snow', 2, 280, { color: '#dcecff' }]],
      ambient: { kind: 'snow', count: 46, color: 0xffffff }, deepAmbient: { kind: 'motes', count: 28, color: 0x9ad8ff }
    },
    swamp: {
      tint: 0xffffff, deepTint: 0x7c8a78,
      props: [['reeds', 4, 70, 96, { base: '#6a7a3a', head: '#4a2e1a' }], ['mushrooms', 2.6, 62, 66, { cap: '#8a3a6a', stem: '#d8d0b8', spot: '#f0e0f0', glow: '#c070ff' }],
        ['stump', 2, 64, 58, { wood: '#4a3424', ring: '#8a6a48', moss: '#4a6a2a' }], ['rock', 2.4, 64, 50, MOSSROCK, { moss: '#5a8a3a' }], ['deadTree', 1.4, 96, 132, { wood: '#2a2a1e', hi: '#8a9a6a' }],
        ['grass', 3, 54, 40, { base: '#5a7a34' }]],
      deepProps: [['mushrooms', 5, 70, 78, { cap: '#2a7a6a', stem: '#c8d8c8', spot: '#d0fff0', glow: '#40ffd0' }], ['stump', 2, 64, 58, { wood: '#3a2a1e', ring: '#7a5a3a', moss: '#3a5a2a' }],
        ['rock', 2, 64, 50, MOSSROCK, { moss: '#3a7a4a' }], ['ruinWall', 1.2, 110, 70, { base: '#5a5a48', moss: '#4a7a3a' }], ['reeds', 2, 70, 96, { base: '#4a5a2a', head: '#2a1a10' }]],
      decals: [['puddle', 5, 190, { color: '#2a3a24', rim: '#0a0e08' }], ['patch', 5, 340, { color: '#3a4a1e', alpha: 0.2 }], ['patch', 3, 300, { color: '#0e140a', alpha: 0.2 }],
        ['pebbles', 2, 80, { color: '#4a5a3a' }]],
      deepDecals: [['puddle', 5, 200, { color: '#1a3a34', rim: '#06100e' }], ['patch', 5, 340, { color: '#0a1410', alpha: 0.24 }], ['light', 2, 200, { color: '#40ffd0' }]],
      ambient: { kind: 'fireflies', count: 26, color: 0xd8ff7a, fog: 3 }, deepAmbient: { kind: 'fireflies', count: 30, color: 0x60ffd8, fog: 4 }
    },
    undead_mountains: {
      tint: 0xffffff, deepTint: 0x7a7480,
      props: [['grave', 4, 54, 72, { base: '#7a7a82', dirt: '#2e2a26' }, { moss: '#4a5a3a' }], ['skullPile', 2, 66, 52, { bone: '#cfc6b4' }], ['deadTree', 2.4, 100, 140, { wood: '#1e1a1e', hi: '#8a8090' }],
        ['rock', 3, 66, 52, DARKSTONE], ['ruinWall', 1.2, 116, 72, { base: '#5a5660' }]],
      deepProps: [['grave', 3, 54, 72, { base: '#6a6672', dirt: '#24201e' }], ['skullPile', 3, 70, 56, { bone: '#c6bca8' }], ['ruinWall', 2.4, 120, 80, { base: '#4a4652' }],
        ['brazier', 2.2, 58, 80, { metal: '#4a4450', fire: '#9a4aff', fire2: '#e8c8ff' }], ['pillar', 1.6, 62, 136, { base: '#6a6672' }]],
      decals: [['patch', 6, 340, { color: '#1a161e', alpha: 0.22 }], ['crack', 3, 160, { dark: 'rgba(10,8,12,0.85)', rim: '#b0a8c0' }], ['bones', 2.4, 100, { color: '#c6bca8' }],
        ['pebbles', 3, 90, { color: '#5a5660' }]],
      deepDecals: [['tiles', 4, 300, { color: '#4a4652' }], ['crack', 3, 170, { dark: 'rgba(10,6,16,0.85)', rim: '#a090c0', glow: '#8a4aff' }], ['bones', 2.4, 100, { color: '#beb4a0' }],
        ['light', 1.4, 220, { color: '#9a5aff' }]],
      ambient: { kind: 'wisps', count: 18, color: 0xb8a8ff }, deepAmbient: { kind: 'embers', count: 24, color: 0xb070ff }
    },
    god_battlefield: {
      tint: 0xffffff, deepTint: 0x8a7a72,
      props: [['sword', 3, 46, 80, { metal: '#8a6a30', dirt: '#2a2018' }], ['banner', 2, 70, 116, { cloth: '#7a1e1a', emblem: '#d8b26a' }], ['rock', 3, 70, 54, ASH],
        ['pillar', 1.6, 64, 132, { base: '#8a7a6a' }], ['skullPile', 1.6, 66, 52, { bone: '#cfc2a8' }]],
      deepProps: [['brazier', 3, 58, 80, { metal: '#5a4a3a' }], ['ruinWall', 2, 120, 80, { base: '#6a5a4c' }], ['sword', 2.4, 46, 80, { metal: '#a07a30', dirt: '#20180e' }], ['banner', 1.6, 70, 116, { cloth: '#4a1a40', emblem: '#e0c070' }]],
      decals: [['patch', 6, 340, { color: '#140c08', alpha: 0.24 }], ['crack', 4, 170, { dark: 'rgba(20,6,2,0.85)', rim: '#ffb070', glow: '#ff5a1a' }], ['bones', 1.6, 100, { color: '#cfc2a8' }],
        ['pebbles', 2, 90, { color: '#5a4a40' }]],
      deepDecals: [['crack', 5, 180, { dark: 'rgba(20,4,0,0.9)', rim: '#ffc080', glow: '#ff4a10' }], ['patch', 5, 340, { color: '#0a0604', alpha: 0.28 }], ['light', 1.6, 220, { color: '#ff7a2a' }]],
      ambient: { kind: 'embers', count: 34, color: 0xff8a3a }, deepAmbient: { kind: 'embers', count: 40, color: 0xff6a20 }
    },
    god_chaos: {
      tint: 0xffffff, deepTint: 0x7a7088,
      props: [['crystals', 4, 72, 104, { light: '#f0c8ff', base: '#a050e0', dark: '#3a1060', glow: '#c070ff', rock: '#3a2e48' }], ['rock', 4, 70, 56, CHAOSROCK], ['rock', 2, 44, 36, CHAOSROCK],
        ['ruinWall', 1, 110, 70, { base: '#4a3e58' }]],
      deepProps: [['crystals', 6, 80, 120, { light: '#ffd0ff', base: '#c040c0', dark: '#40104a', glow: '#ff60ff', rock: '#2a2034' }], ['rock', 3, 70, 56, CHAOSROCK], ['runeStone', 1.4, 56, 104, { base: '#3a2e48', glow: '#e070ff' }]],
      decals: [['crack', 5, 180, { dark: 'rgba(10,0,20,0.85)', rim: '#e0b0ff', glow: '#b040ff' }], ['patch', 5, 340, { color: '#1a0a2a', alpha: 0.26 }], ['pebbles', 2, 90, { color: '#4a3a5a' }]],
      deepDecals: [['crack', 6, 190, { dark: 'rgba(10,0,20,0.9)', rim: '#ffc0ff', glow: '#ff40ff' }], ['patch', 4, 340, { color: '#0a0414', alpha: 0.3 }], ['runes', 1.4, 220, { glow: '#d070ff' }]],
      ambient: { kind: 'motes', count: 34, color: 0xd080ff }, deepAmbient: { kind: 'motes', count: 40, color: 0xff70ff }
    },
    god_sanctuary: {
      tint: 0xffffff, deepTint: 0x9a9488,
      props: [['pillar', 3, 64, 150, { base: '#d8d0c0' }, { intact: true }], ['pillar', 2.4, 64, 132, { base: '#d0c8b6' }], ['rock', 2, 62, 48, MARBLE],
        ['runeStone', 1.6, 56, 104, { base: '#c8c0b0', glow: '#ffd870' }], ['brazier', 1.2, 58, 80, { metal: '#a08850', fire: '#ffc040', fire2: '#fff4c0' }]],
      deepProps: [['pillar', 4, 64, 150, { base: '#c8c0ae' }, { intact: true }], ['brazier', 2.4, 58, 80, { metal: '#a08850', fire: '#ffc040', fire2: '#fff4c0' }],
        ['runeStone', 2, 56, 104, { base: '#b8b0a0', glow: '#ffe080' }], ['ruinWall', 1.2, 120, 76, { base: '#c0b8a8' }]],
      decals: [['tiles', 5, 300, { color: '#e8e0d0' }], ['runes', 2, 220, { glow: '#ffd870' }], ['patch', 3, 320, { color: '#fff8e0', alpha: 0.12 }], ['crack', 1.6, 150, { dark: 'rgba(60,50,40,0.6)', rim: '#ffffff' }]],
      deepDecals: [['tiles', 5, 300, { color: '#d8d0c0' }], ['runes', 3, 230, { glow: '#ffe080' }], ['light', 2, 220, { color: '#ffd060' }]],
      ambient: { kind: 'motes', count: 30, color: 0xffe08a }, deepAmbient: { kind: 'motes', count: 36, color: 0xffd060 }
    }
  };
  KITS[''] = KITS.desert;

  var PROP_DRAW = {
    rock: drawRock, pillar: drawPillar, deadTree: drawDeadTree, cactus: drawCactus, crystals: drawCrystals,
    grave: drawGrave, skullPile: drawSkullPile, mushrooms: drawMushrooms, reeds: drawReeds, stump: drawStump,
    brazier: drawBrazier, ruinWall: drawRuinWall, sword: drawSword, banner: drawBanner, runeStone: drawRuneStone, grass: drawGrass
  };
  var DECAL_DRAW = {
    patch: decalPatch, crack: decalCrack, pebbles: decalPebbles, bones: decalBones, puddle: decalPuddle,
    runes: decalRunes, tiles: decalTiles, light: decalLight, snow: decalSnow
  };
  var VARIANTS = 3;          // 每種擺件／地面裝飾畫幾個變體
  var TEX_SCALE = 1.5;       // 圖集解析度（畫面放大或高 DPI 時仍清楚；開 mipmap 避免縮小時閃爍）

  /* ============ 圖集 ============ */
  function buildAtlas(kitKey, deep) {
    var kit = KITS[kitKey] || KITS[''];
    var specs = [];
    var props = deep ? kit.deepProps : kit.props;
    var decals = deep ? kit.deepDecals : kit.decals;
    props.forEach(function (p, i) {
      for (var v = 0; v < VARIANTS; v++) specs.push({ kind: 'prop', key: 'p' + i + '_' + v, type: p[0], w: p[2], h: p[3], pal: p[4], opt: p[5], seed: strHash(kitKey + p[0] + i + '_' + v + (deep ? 'd' : '')) });
      if (p[0] === 'brazier' && !specs.some(function (s) { return s.key === 'flame' + i; })) {
        specs.push({ kind: 'flame', key: 'flame' + i, type: 'flame', w: 34, h: 48, pal: p[4], seed: 7 + i });
      }
    });
    decals.forEach(function (d, i) {
      var nv = d[0] === 'light' ? 1 : VARIANTS;
      for (var v = 0; v < nv; v++) specs.push({ kind: 'decal', key: 'd' + i + '_' + v, type: d[0], w: d[2], h: d[2], pal: d[3], seed: strHash(kitKey + d[0] + i + '_' + v + (deep ? 'd' : '')) });
    });
    specs.push({ kind: 'particle', key: 'dot', type: 'dot', w: 16, h: 16, seed: 1 });
    specs.push({ kind: 'particle', key: 'fog', type: 'fog', w: 200, h: 120, seed: 2 });
    // 架子式打包
    var PAD = 6, MAXW = 2048;
    var x = PAD, y = PAD, rowH = 0;
    specs.sort(function (a, b) { return b.h - a.h; });
    specs.forEach(function (s) {
      var pw = Math.ceil(s.w * TEX_SCALE), ph = Math.ceil(s.h * TEX_SCALE);
      if (x + pw + PAD > MAXW) { x = PAD; y += rowH + PAD; rowH = 0; }
      s.px = x; s.py = y; s.pw = pw; s.ph = ph;
      x += pw + PAD;
      rowH = Math.max(rowH, ph);
    });
    var H = y + rowH + PAD;
    var canvas = document.createElement('canvas');
    canvas.width = MAXW;
    canvas.height = Math.min(4096, Math.max(64, H));
    var g = canvas.getContext('2d');
    specs.forEach(function (s) {
      g.save();
      g.beginPath(); g.rect(s.px, s.py, s.pw, s.ph); g.clip();
      g.translate(s.px, s.py);
      g.scale(TEX_SCALE, TEX_SCALE);
      var r = mulberry(s.seed);
      try {
        if (s.kind === 'prop') PROP_DRAW[s.type](g, s.w, s.h, r, s.pal, s.opt);
        else if (s.kind === 'decal') DECAL_DRAW[s.type](g, s.w, s.h, r, s.pal);
        else if (s.kind === 'flame') drawFlame(g, s.w, s.h, r, s.pal);
        else if (s.type === 'dot') particleDot(g, s.w, s.h);
        else particleFog(g, s.w, s.h, r);
      } catch (e) {
        if (typeof console !== 'undefined') console.warn('[decor] 畫 ' + s.type + ' 失敗', e);
      }
      g.restore();
    });
    return { canvas: canvas, specs: specs, kit: kit, props: props, decals: decals };
  }

  function weightedPick(r, list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i][1];
    var t = r() * total;
    for (var j = 0; j < list.length; j++) { t -= list[j][1]; if (t <= 0) return j; }
    return list.length - 1;
  }

  /* ============ 執行期 ============ */
  var CHUNK_W = 560;             // 區塊寬（世界單位）
  var CHUNK_H = 560;             // 區塊高（世界單位；畫面上是一半）
  var STAGE_BAND = 10;           // 每 10 個階段換一帶，雙數帶是地下
  var PLAYER_FADE_ALPHA = 0.38;  // 擺件擋到玩家時的透明度

  function decorQueryMode() {
    try {
      var m = /[?&]decor=([^&]+)/.exec(location.search);
      return m ? decodeURIComponent(m[1]) : '';
    } catch (e) { return ''; }
  }

  function create(opts) {
    var PIXI = opts.PIXI;
    var mode = decorQueryMode();
    var enabled = mode !== '0' && mode !== 'off';
    var lite = mode === 'lite';
    var groundScale = opts.groundScale || 0.5;
    var decalLayer = opts.decalLayer;     // 地面平面（世界座標，scale.y = groundScale）
    var lightLayer = opts.lightLayer;     // 同上，加色光暈（火盆地面光）
    var propLayer = opts.propLayer;       // 實體層（畫面座標，sortable）
    var ambientLayer = opts.ambientLayer; // 螢幕座標

    var D = {
      kitKey: null, deep: false, band: -1, atlas: null, baseTex: null, textures: {}, seedBase: 0,
      chunks: new Map(), lastChunkKey: '', pools: { decal: [], prop: [], flame: [], light: [] },
      particles: [], fogs: [], lastCam: null, visible: true, time: 0,
      counts: { decals: 0, props: 0 }
    };

    function texFor(key) { return D.textures[key] || null; }

    function releaseAll() {
      D.chunks.forEach(function (c) { releaseChunk(c); });
      D.chunks.clear();
      D.lastChunkKey = '';
    }

    function destroyAtlas() {
      releaseAll();
      ['decal', 'prop', 'flame', 'light'].forEach(function (k) {
        D.pools[k].forEach(function (s) { s.destroy(); });
        D.pools[k] = [];
      });
      clearParticles();
      for (var k2 in D.textures) if (D.textures[k2]) D.textures[k2].destroy(false);
      D.textures = {};
      if (D.baseTex) { D.baseTex.destroy(true); D.baseTex = null; }
      D.atlas = null;
    }

    function buildTextures(kitKey, deep) {
      var atlas = buildAtlas(kitKey, deep);
      var source = new PIXI.CanvasSource({ resource: atlas.canvas, autoGenerateMipmaps: true, scaleMode: 'linear' });
      D.baseTex = new PIXI.Texture({ source: source });
      atlas.specs.forEach(function (s) {
        D.textures[s.key] = new PIXI.Texture({ source: source, frame: new PIXI.Rectangle(s.px, s.py, s.pw, s.ph) });
      });
      D.atlas = atlas;
    }

    function sceneKey(kitKey, deep) { return kitKey + (deep ? '#deep' : ''); }

    function setScene(zoneKey, stageNum) {
      if (!enabled) return;
      var kitKey = KITS[zoneKey] ? zoneKey : '';
      var band = Math.max(0, Math.floor((Math.max(1, Number(stageNum) || 1) - 1) / STAGE_BAND));
      var deep = band % 2 === 1;
      var key = sceneKey(kitKey, deep);
      if (D.atlas && D.sceneKey === key && D.band === band) return;
      var needTextures = !D.atlas || D.sceneKey !== key;
      if (needTextures) {
        destroyAtlas();
        buildTextures(kitKey, deep);
      } else {
        releaseAll();
      }
      D.sceneKey = key;
      D.kitKey = kitKey;
      D.deep = deep;
      D.band = band;
      D.seedBase = strHash(key + ':' + band);
      if (opts.onTint) opts.onTint(deep ? D.atlas.kit.deepTint : D.atlas.kit.tint);
      if (needTextures) setupAmbient();
    }

    /* ---- 物件池 ---- */
    function takeSprite(pool, tex, parent) {
      var s = D.pools[pool].pop();
      if (!s || s.destroyed) {
        s = new PIXI.Sprite(tex);
      } else {
        s.texture = tex;
      }
      s.visible = D.visible;   // 高塔戰期間整體隱藏時，新產生的區塊也跟著藏
      s.alpha = 1;
      s.tint = 0xffffff;
      s.rotation = 0;
      s.blendMode = pool === 'light' ? 'add' : 'normal';
      parent.addChild(s);
      return s;
    }
    function giveSprite(pool, s) {
      if (!s || s.destroyed) return;
      if (s.parent) s.parent.removeChild(s);
      D.pools[pool].push(s);
    }

    /* ---- 區塊 ---- */
    function buildChunk(cx, cy) {
      var atlas = D.atlas;
      var r = mulberry(hash3(cx, cy, D.seedBase));
      var chunk = { cx: cx, cy: cy, decals: [], props: [], flames: [], lights: [] };
      var x0 = cx * CHUNK_W, y0 = cy * CHUNK_H;
      var nDecal = lite ? 2 : 3 + Math.floor(r() * 3);
      for (var i = 0; i < nDecal; i++) {
        var di = weightedPick(r, atlas.decals);
        var d = atlas.decals[di];
        var dv = d[0] === 'light' ? 0 : Math.floor(r() * VARIANTS);
        var tex = texFor('d' + di + '_' + dv);
        if (!tex) continue;
        var isLight = d[0] === 'light';
        var s = takeSprite(isLight ? 'light' : 'decal', tex, isLight ? lightLayer : decalLayer);
        s.anchor.set(0.5);
        var k = (1 / TEX_SCALE) * range(r, 0.8, 1.3);
        s.scale.set(k);
        s.rotation = r() * Math.PI * 2;
        s.x = x0 + r() * CHUNK_W;
        s.y = y0 + r() * CHUNK_H;
        s.alpha = isLight ? 0.55 : range(r, 0.75, 1);
        (isLight ? chunk.lights : chunk.decals).push(s);
      }
      // 大型擺件每區塊 1～3 個（偶爾空一塊留白），再補 1～3 個矮的小碎物（間距可以近一點）
      var nProp = lite ? (r() < 0.5 ? 1 : 0) : (r() < 0.12 ? 0 : (1 + Math.floor(r() * 2.6)));
      var nSmall = lite ? 0 : 1 + Math.floor(r() * 3);
      var smallList = atlas.props.map(function (p, idx) { return [idx, p[3] <= 60 ? p[1] : 0]; }).filter(function (x) { return x[1] > 0; });
      var placed = [];
      for (var j = 0; j < nProp + nSmall; j++) {
        var small = j >= nProp;
        if (small && !smallList.length) break;
        var pi = small ? smallList[weightedPick(r, smallList)][0] : weightedPick(r, atlas.props);
        var p = atlas.props[pi];
        var px = x0 + range(r, 0.06, 0.94) * CHUNK_W, py = y0 + range(r, 0.06, 0.94) * CHUNK_H;
        var gapX = small ? 70 : 150, gapY = small ? 80 : 180;
        var clash = placed.some(function (q) { return Math.abs(q[0] - px) < gapX && Math.abs(q[1] - py) < gapY; });
        if (clash) continue;
        placed.push([px, py]);
        var ptex = texFor('p' + pi + '_' + Math.floor(r() * VARIANTS));
        if (!ptex) continue;
        var ps = takeSprite('prop', ptex, propLayer);
        ps.anchor.set(0.5, (p[3] - FOOT) / p[3]);
        var flip = r() < 0.5 ? -1 : 1;
        var sc = (1 / TEX_SCALE) * range(r, 0.85, 1.15);
        ps.scale.set(sc * flip, sc);
        ps.x = px;
        ps.y = py * groundScale;
        ps.zIndex = ps.y;
        ps._decorH = p[3] * sc;
        ps._decorW = p[2] * sc;
        chunk.props.push(ps);
        if (p[0] === 'brazier') {
          var ftex = texFor('flame' + pi);
          if (ftex) {
            var fl = takeSprite('flame', ftex, propLayer);
            fl.anchor.set(0.5, 1);
            fl.scale.set(1 / TEX_SCALE);
            fl.x = px;
            fl.y = ps.y - (p[3] * 0.58 - FOOT) * sc;
            fl.zIndex = ps.zIndex + 0.5;
            fl._phase = r() * 10;
            fl._baseY = fl.y;
            chunk.flames.push(fl);
          }
          var glowTex = lightTexture();
          if (glowTex) {
            var lg = takeSprite('light', glowTex, lightLayer);
            lg.anchor.set(0.5);
            // dot 貼圖是 16 邏輯像素（×TEX_SCALE）；地面光圈直徑約 230 世界單位（地面平面再壓扁成橢圓）
            lg.scale.set(230 / (16 * TEX_SCALE));
            lg.tint = flameTint(p[4]);
            lg.x = px; lg.y = py;
            lg.alpha = 0.5;
            lg._phase = r() * 10;
            chunk.lights.push(lg);
            chunk.flames.push(lg);
          }
        }
      }
      return chunk;
    }

    function flameTint(pal) {
      var hex = (pal && pal.fire) || '#ff8a2a';
      return parseInt(hex.slice(1), 16);
    }
    function lightTexture() {
      return texFor('dot');
    }

    function releaseChunk(chunk) {
      chunk.decals.forEach(function (s) { giveSprite('decal', s); });
      chunk.props.forEach(function (s) { giveSprite('prop', s); });
      chunk.flames.forEach(function (s) { if (s.blendMode === 'add') return; giveSprite('flame', s); });
      chunk.lights.forEach(function (s) { giveSprite('light', s); });
    }

    function syncChunks(view) {
      var R = view.drawRect;
      // 畫得到的世界範圍：橫向直接換算；縱向是投影座標，換回世界要除以 groundScale。
      // 直立擺件的腳在畫面下緣以下仍可能露出上半身，所以下方多留一段。
      var wx0 = view.camX + (R.x - view.W / 2) - 160;
      var wx1 = view.camX + (R.x + R.width - view.W / 2) + 160;
      var wy0 = view.camY + (R.y - view.H / 2) / groundScale - 120;
      var wy1 = view.camY + (R.y + R.height - view.H / 2) / groundScale + 420;
      var cx0 = Math.floor(wx0 / CHUNK_W), cx1 = Math.floor(wx1 / CHUNK_W);
      var cy0 = Math.floor(wy0 / CHUNK_H), cy1 = Math.floor(wy1 / CHUNK_H);
      var key = cx0 + ',' + cx1 + ',' + cy0 + ',' + cy1;
      if (key === D.lastChunkKey) return;
      D.lastChunkKey = key;
      var want = {};
      for (var cy = cy0; cy <= cy1; cy++) {
        for (var cx = cx0; cx <= cx1; cx++) {
          var k = cx + ':' + cy;
          want[k] = true;
          if (!D.chunks.has(k)) D.chunks.set(k, buildChunk(cx, cy));
        }
      }
      D.chunks.forEach(function (c, k2) {
        if (!want[k2]) { releaseChunk(c); D.chunks.delete(k2); }
      });
      var nd = 0, np = 0;
      D.chunks.forEach(function (c) { nd += c.decals.length + c.lights.length; np += c.props.length; });
      D.counts.decals = nd; D.counts.props = np;
    }

    /* ---- 擋到玩家的擺件變半透明 ---- */
    function fadeNearPlayer(view) {
      var px = view.playerX, py = view.playerScreenY;
      if (px === undefined || py === undefined) return;
      D.chunks.forEach(function (c) {
        for (var i = 0; i < c.props.length; i++) {
          var s = c.props[i];
          // 擺件在玩家前面（腳底較低）、橫向蓋得到、高度蓋得到玩家身體才淡出
          var front = s.y > py && s.y - s._decorH < py + 4;
          var over = Math.abs(s.x - px) < s._decorW * 0.5 + 18;
          var target = front && over ? PLAYER_FADE_ALPHA : 1;
          if (s.alpha !== target) s.alpha += (target - s.alpha) * 0.25;
          if (Math.abs(s.alpha - target) < 0.02) s.alpha = target;
        }
      });
    }

    function animateFlames(dt) {
      D.chunks.forEach(function (c) {
        for (var i = 0; i < c.flames.length; i++) {
          var f = c.flames[i];
          var t = D.time * 9 + f._phase;
          var flick = 0.85 + 0.15 * Math.sin(t) * Math.sin(t * 1.7 + 1.3);
          if (f.blendMode === 'add') {
            f.alpha = 0.38 + 0.14 * flick;
          } else {
            f.scale.y = (1 / TEX_SCALE) * (0.9 + 0.18 * flick);
            f.scale.x = (1 / TEX_SCALE) * (0.95 + 0.08 * Math.sin(t * 1.3));
          }
        }
      });
    }

    /* ---- 天氣粒子（螢幕座標；鏡頭移動時跟著反向漂，看起來釘在場景裡） ---- */
    function clearParticles() {
      D.particles.forEach(function (p) { p.s.destroy(); });
      D.fogs.forEach(function (p) { p.s.destroy(); });
      D.particles = []; D.fogs = [];
    }
    function setupAmbient() {
      clearParticles();
      if (!ambientLayer || !D.atlas) return;
      var amb = D.deep ? D.atlas.kit.deepAmbient : D.atlas.kit.ambient;
      if (!amb) return;
      D.ambient = amb;
      var count = lite ? Math.round(amb.count * 0.4) : amb.count;
      var r = mulberry(D.seedBase ^ 99);
      var dot = texFor('dot');
      for (var i = 0; i < count; i++) {
        var s = new PIXI.Sprite(dot);
        s.anchor.set(0.5);
        s.tint = amb.color;
        ambientLayer.addChild(s);
        D.particles.push(resetParticle({ s: s, r: r }, true));
      }
      var fogN = lite ? 0 : (amb.fog || 0);
      var fogTex = texFor('fog');
      for (var k = 0; k < fogN; k++) {
        var f = new PIXI.Sprite(fogTex);
        f.anchor.set(0.5);
        f.tint = amb.kind === 'fireflies' ? 0xb8d0b0 : 0xffffff;
        f.alpha = 0.22;
        f.scale.set(range(r, 1.6, 2.6) / TEX_SCALE * 2);
        ambientLayer.addChildAt(f, 0);
        D.fogs.push({ s: f, x: r(), y: range(r, 0.2, 0.9), vx: range(r, 0.004, 0.012) * (r() < 0.5 ? -1 : 1) });
      }
    }
    function resetParticle(p, anywhere) {
      var r = p.r, kind = D.ambient.kind;
      var W = D.lastW || 800, H = D.lastH || 800;
      p.x = r() * W;
      p.y = anywhere ? r() * H : (kind === 'snow' ? -10 : (kind === 'embers' || kind === 'motes' || kind === 'wisps' ? H + 10 : r() * H));
      p.life = 0;
      p.maxLife = range(r, 4, 9);
      p.phase = r() * 10;
      var size;
      if (kind === 'snow') { p.vx = range(r, -12, 6); p.vy = range(r, 28, 60); size = range(r, 3, 7); p.a = range(r, 0.5, 0.9); }
      else if (kind === 'dust') { p.vx = range(r, -26, -10); p.vy = range(r, -4, 4); size = range(r, 2, 5); p.a = range(r, 0.2, 0.5); }
      else if (kind === 'embers') { p.vx = range(r, -10, 10); p.vy = range(r, -46, -20); size = range(r, 2.5, 5); p.a = range(r, 0.5, 0.9); }
      else if (kind === 'fireflies') { p.vx = range(r, -14, 14); p.vy = range(r, -10, 10); size = range(r, 4, 8); p.a = range(r, 0.5, 1); }
      else if (kind === 'wisps') { p.vx = range(r, -8, 8); p.vy = range(r, -16, -6); size = range(r, 12, 22); p.a = range(r, 0.12, 0.25); }
      else { p.vx = range(r, -6, 6); p.vy = range(r, -18, -6); size = range(r, 3, 6); p.a = range(r, 0.4, 0.8); }
      p.s.scale.set(size / (16 * TEX_SCALE));   // dot 貼圖是 16 邏輯像素 × 圖集解析度
      p.s.alpha = 0;
      return p;
    }
    function updateParticles(view, dt) {
      if (!D.particles.length && !D.fogs.length) return;
      var W = view.W, H = view.H;
      D.lastW = W; D.lastH = H;
      // 鏡頭位移換成畫面上的反向漂移（視差 0.9：粒子在地面之上一點點）
      var dx = 0, dy = 0;
      if (D.lastCam) {
        dx = (view.camX - D.lastCam.x) * 0.9;
        dy = (view.camY - D.lastCam.y) * groundScale * 0.9;
        if (Math.abs(dx) > W || Math.abs(dy) > H) { dx = 0; dy = 0; }
      }
      D.lastCam = { x: view.camX, y: view.camY };
      var kind = D.ambient ? D.ambient.kind : '';
      for (var i = 0; i < D.particles.length; i++) {
        var p = D.particles[i];
        p.life += dt;
        var sway = kind === 'snow' ? Math.sin(D.time * 1.6 + p.phase) * 14 : (kind === 'fireflies' ? Math.sin(D.time * 0.9 + p.phase) * 18 : 0);
        p.x += p.vx * dt - dx;
        p.y += p.vy * dt - dy;
        var fade = Math.min(1, p.life / 0.8, (p.maxLife - p.life) / 0.8);
        var blink = kind === 'fireflies' ? 0.55 + 0.45 * Math.sin(D.time * 3 + p.phase * 2) : 1;
        p.s.alpha = Math.max(0, fade) * p.a * blink;
        p.s.x = p.x + sway;
        p.s.y = p.y;
        if (p.life > p.maxLife || p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40) {
          resetParticle(p, p.life < p.maxLife);
          if (p.life === 0 && !(p.x >= 0 && p.x <= W)) p.x = Math.random() * W;
        }
      }
      for (var k = 0; k < D.fogs.length; k++) {
        var f = D.fogs[k];
        f.x += f.vx * dt - dx / W;
        if (f.x < -0.4) f.x += 1.8; else if (f.x > 1.4) f.x -= 1.8;
        f.s.x = f.x * W;
        f.s.y = f.y * H - dy;
      }
    }

    function update(view) {
      if (!enabled || !D.atlas) return;
      var dt = Math.max(0, Math.min(0.1, view.dt || 0));
      D.time += dt;
      syncChunks(view);
      fadeNearPlayer(view);
      animateFlames(dt);
      updateParticles(view, dt);
    }

    function setVisible(on) {
      on = !!on && enabled;
      if (D.visible === on) return;
      D.visible = on;
      if (decalLayer) decalLayer.visible = on;
      if (lightLayer) lightLayer.visible = on;
      if (ambientLayer) ambientLayer.visible = on;
      D.chunks.forEach(function (c) {
        c.props.forEach(function (s) { s.visible = on; });
        c.flames.forEach(function (s) { s.visible = on; });
      });
    }

    function stats() {
      return {
        enabled: enabled, lite: lite, scene: D.atlas ? D.sceneKey : null, band: D.band, chunks: D.chunks.size,
        decals: D.counts.decals, props: D.counts.props, particles: D.particles.length + D.fogs.length,
        atlas: D.atlas ? D.atlas.canvas.width + 'x' + D.atlas.canvas.height : null
      };
    }

    function destroy() {
      destroyAtlas();
    }

    return { setScene: setScene, update: update, setVisible: setVisible, stats: stats, destroy: destroy, enabled: enabled };
  }

  return {
    create: create,
    KITS: KITS,
    // 給預覽頁與測試用：畫出某張地圖（地表／地下）的整張圖集
    buildAtlas: buildAtlas,
    STAGE_BAND: STAGE_BAND,
    _internals: { mulberry: mulberry, hash3: hash3, CHUNK_W: CHUNK_W, CHUNK_H: CHUNK_H }
  };
})();
