/* 成就圖示主題：裝備／等級／強化／太古／寶石類。座標原點在獎牌中心，內圈半徑約 92。 */
(function () {
  'use strict';
  var A = window.ACH, M = A.motifs, TAU = A.TAU;
  var add = A.add, normal = A.normal, rgba = A.rgba, mix = A.mix, glowDot = A.glowDot, lin = A.lin, poly = A.poly, rimLine = A.rimLine, lerp = A.lerp;

  /* ---------- 全身甲半身像 ---------- */
  function edgeStyle(c, s) {
    if (s.orn >= 2 && !s.col2) return lin(c, -60, -80, 60, 90, [[0, '#fff3b0'], [0.5, mix(s.col, '#ffd36a', 0.55)], [1, mix(s.col, '#000', 0.2)]]);
    var c2 = s.col2 || s.col;
    return lin(c, -60, -80, 60, 90, [[0, mix(s.col, '#ffffff', 0.55)], [0.55, mix(s.col, c2, 0.6)], [1, c2]]);
  }
  function plateFill(c, tint, x0, x1) {
    return lin(c, x0, 0, x1, 0, [[0, mix('#2a3042', tint, 0.28)], [0.36, mix('#8993a8', tint, 0.3)], [0.5, mix('#d4dbea', tint, 0.35)], [0.64, mix('#66708a', tint, 0.3)], [1, mix('#161a27', tint, 0.25)]]);
  }
  function drawChest(c, s, edge) {
    var i;
    // 護肩
    [-1, 1].forEach(function (k) {
      c.beginPath(); c.moveTo(k * 28, 4); c.quadraticCurveTo(k * 66, -4, k * 84, 30); c.quadraticCurveTo(k * 76, 52, k * 48, 44); c.quadraticCurveTo(k * 44, 24, k * 28, 4); c.closePath();
      c.fillStyle = lin(c, k * 30, 0, k * 84, 40, [[0, mix('#aab4c8', s.col, 0.3)], [0.5, mix('#59627a', s.col, 0.3)], [1, mix('#171b28', s.col, 0.25)]]); c.fill();
      c.strokeStyle = edge; c.lineWidth = 2.2; c.stroke();
      c.beginPath(); c.moveTo(k * 36, 10); c.quadraticCurveTo(k * 62, 6, k * 76, 32); c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1.2; c.stroke();
      for (i = 0; i < 3; i++) {
        c.beginPath(); c.moveTo(k * (46 + i * 8), 40 - i * 6); c.lineTo(k * (52 + i * 8), 18 + i * 2); c.strokeStyle = rgba(s.col, 0.55); c.lineWidth = 1.4; c.stroke();
      }
    });
    // 胸甲
    c.beginPath(); c.moveTo(-26, 8); c.quadraticCurveTo(-52, 12, -54, 36); c.lineTo(-50, 58); c.quadraticCurveTo(-44, 78, -16, 87); c.quadraticCurveTo(0, 93, 16, 87);
    c.quadraticCurveTo(44, 78, 50, 58); c.lineTo(54, 36); c.quadraticCurveTo(52, 12, 26, 8); c.closePath();
    c.fillStyle = plateFill(c, s.col, -54, 54); c.fill();
    c.strokeStyle = edge; c.lineWidth = 2.4; c.stroke();
    // 肋線與中央光紋
    c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 1.6;
    [60, 72].forEach(function (y) { c.beginPath(); c.moveTo(-44, y - 2); c.quadraticCurveTo(0, y + 12, 44, y - 2); c.stroke(); });
    add(c); c.strokeStyle = rgba(s.col, 0.85); c.lineWidth = 2.2; c.shadowColor = s.col; c.shadowBlur = 8;
    c.beginPath(); c.moveTo(-42, 30); c.lineTo(0, 54); c.lineTo(42, 30); c.stroke();
    c.beginPath(); c.moveTo(0, 54); c.lineTo(0, 88); c.stroke(); c.shadowBlur = 0;
    glowDot(c, 0, 54, 20, s.col2 ? mix(s.col, s.col2, 0.5) : s.col, 0.8); normal(c);
    c.beginPath(); c.moveTo(0, 44); c.lineTo(8, 54); c.lineTo(0, 64); c.lineTo(-8, 54); c.closePath();
    c.fillStyle = lin(c, 0, 44, 0, 64, [[0, '#ffffff'], [1, mix(s.col, '#ffffff', 0.4)]]); c.fill(); c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1; c.stroke();
    // 頸甲
    c.beginPath(); c.moveTo(-24, 8); c.quadraticCurveTo(0, 22, 24, 8); c.lineTo(20, -2); c.quadraticCurveTo(0, 8, -20, -2); c.closePath();
    c.fillStyle = plateFill(c, s.col, -24, 24); c.fill(); c.strokeStyle = edge; c.lineWidth = 1.6; c.stroke();
  }
  function drawHelm(c, s, edge) {
    // 頂飾
    if (s.orn >= 1) {
      c.beginPath(); c.moveTo(-6, -66); c.quadraticCurveTo(-14, -84, 0, -98); c.quadraticCurveTo(14, -84, 6, -66); c.closePath();
      c.fillStyle = lin(c, 0, -98, 0, -66, [[0, '#ffffff'], [0.4, s.col], [1, mix(s.col, '#000', 0.5)]]); c.fill(); c.strokeStyle = edge; c.lineWidth = 1.5; c.stroke();
    }
    if (s.orn >= 2) {
      [-1, 1].forEach(function (k) {
        c.save(); c.translate(k * 25, -42); c.scale(k, 1); A.wing(c, 0, 0, 34, s.orn >= 3 ? '#fff1c0' : '#ffe08a', 4, 0.8); c.restore();
      });
    }
    c.beginPath(); c.moveTo(-25, 8); c.lineTo(-28, -28); c.quadraticCurveTo(-28, -68, 0, -74); c.quadraticCurveTo(28, -68, 28, -28); c.lineTo(25, 8); c.quadraticCurveTo(0, 18, -25, 8); c.closePath();
    c.fillStyle = plateFill(c, s.col, -28, 28); c.fill(); c.strokeStyle = edge; c.lineWidth = 2.4; c.stroke();
    // 面甲：眼縫發光
    c.beginPath(); c.moveTo(-22, -32); c.lineTo(22, -32); c.lineTo(20, -22); c.lineTo(-20, -22); c.closePath(); c.fillStyle = '#05060a'; c.fill(); c.strokeStyle = edge; c.lineWidth = 1.4; c.stroke();
    add(c); glowDot(c, 0, -27, 34, s.col, 0.6);
    c.fillStyle = lin(c, -20, 0, 20, 0, [[0, rgba(s.col, 0.2)], [0.5, '#ffffff'], [1, rgba(s.col2 || s.col, 0.2)]]); c.fillRect(-19, -29.5, 38, 4.5); normal(c);
    // 中央稜線與呼吸孔
    c.beginPath(); c.moveTo(0, -72); c.lineTo(0, -32); c.moveTo(0, -22); c.lineTo(0, 12); c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1.6; c.stroke();
    c.fillStyle = 'rgba(0,0,0,0.6)';
    for (var i = 0; i < 4; i++) { c.fillRect(8 + (i % 2) * 7, -14 + Math.floor(i / 2) * 9, 3.4, 3.4); c.fillRect(-11.4 - (i % 2) * 7, -14 + Math.floor(i / 2) * 9, 3.4, 3.4); }
    c.beginPath(); c.moveTo(-26, -40); c.quadraticCurveTo(-20, -62, -4, -70); c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1.4; c.stroke();
  }

  M.equipFull = function (c, s, R) {
    c.save(); c.translate(0, -4); c.scale(0.92, 0.92);
    var col2 = s.col2 || s.col, i;
    add(c); glowDot(c, 0, -6, 108, s.col, 0.5); if (s.col2) glowDot(c, 36, 40, 80, col2, 0.4); normal(c);
    if (s.orn >= 3) {
      A.rays(c, 0, -34, 40, 110, 14, '#ffd36a', 0.5, 0.1, 0.07);
      A.ringGlow(c, 0, -36, 62, 4, '#ffd36a', 0.95);
      for (i = 0; i < 8; i++) { var a = i * TAU / 8 + 0.2; A.sparkle(c, Math.cos(a) * 62, -36 + Math.sin(a) * 62, 7, '#fff1c0', 0); }
    } else if (s.orn >= 2) {
      A.rays(c, 0, -20, 40, 104, 12, s.col, 0.28, 0, 0.06);
    }
    var edge = edgeStyle(c, s);
    drawChest(c, s, edge);
    drawHelm(c, s, edge);
    if (s.orn >= 2) { // 金線
      add(c); c.strokeStyle = rgba('#ffe9a6', 0.5); c.lineWidth = 1; c.beginPath(); c.moveTo(-50, 58); c.quadraticCurveTo(0, 96, 50, 58); c.stroke(); normal(c);
    }
    c.restore();
    var cols = s.col2 ? [s.col, col2, '#ffffff'] : [s.col, '#ffffff', mix(s.col, '#ffffff', 0.5)];
    if (s.orn >= 3) cols = ['#ffd36a', '#ff6bcb', '#fff1c0'];
    A.motes(c, R, s.orn >= 3 ? 26 : 14, [-88, -88, 88, 88], cols, 0.9, 2.2, 90);
  };

  /* ---------- 等級徽章 ---------- */
  M.level = function (c, s, R) {
    var lv = s.id - 9, col = s.col, i;
    add(c); glowDot(c, 0, 0, 100, col, 0.4); normal(c);
    if (lv >= 2) A.rays(c, 0, 0, 30, 100, 16, '#ffe08a', 0.35, 0.1, 0.06);
    if (lv >= 1) {
      c.save(); c.translate(0, -8); A.wings(c, 0, -6, lv === 2 ? 92 : 78, lv === 2 ? '#ffe9a6' : '#dff0ff', lv === 2 ? 6 : 5, 0.8); c.restore();
    }
    // 月桂
    var N = 6 + lv * 2;
    [-1, 1].forEach(function (k) {
      for (i = 0; i < N; i++) {
        var t = i / (N - 1), x = k * (46 + 11 * Math.sin(t * Math.PI * 0.85)), y = lerp(64, -40, t);
        c.save(); c.translate(x, y); c.rotate(-Math.PI / 2 + k * (0.75 - t * 0.35));
        c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(8, -7, 19, 0); c.quadraticCurveTo(8, 7, 0, 0); c.closePath();
        c.fillStyle = lin(c, 0, 0, 19, 0, [[0, '#2f6b2e'], [1, mix('#8be37a', col, lv * 0.25)]]); c.fill();
        c.strokeStyle = 'rgba(240,255,220,0.65)'; c.lineWidth = 0.8; c.stroke(); c.restore();
      }
    });
    // 盾
    c.save(); c.translate(0, 4);
    var path = function (k) {
      c.beginPath(); c.moveTo(-40 * k, -50 * k); c.lineTo(40 * k, -50 * k); c.lineTo(40 * k, -2 * k); c.quadraticCurveTo(40 * k, 44 * k, 0, 72 * k); c.quadraticCurveTo(-40 * k, 44 * k, -40 * k, -2 * k); c.closePath();
    };
    path(1); c.fillStyle = lin(c, -40, -50, 40, 70, [[0, A.METAL[s.tier][0]], [0.5, A.METAL[s.tier][1]], [1, A.METAL[s.tier][2]]]); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1.5; c.stroke();
    path(0.86); c.fillStyle = lin(c, 0, -44, 0, 62, [[0, mix(col, '#ffffff', 0.15)], [0.35, mix(col, '#0a0f24', 0.55)], [1, mix(col, '#02030a', 0.85)]]); c.fill();
    c.strokeStyle = rgba(mix(col, '#ffffff', 0.6), 0.9); c.lineWidth = 1.6; c.stroke();
    // 盾面光斜紋
    c.save(); path(0.86); c.clip(); add(c);
    c.fillStyle = lin(c, -34, -44, 34, 20, [[0, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']]);
    c.beginPath(); c.moveTo(-34, -44); c.lineTo(8, -44); c.lineTo(-34, 14); c.closePath(); c.fill(); normal(c); c.restore();
    // 頂部星
    c.save(); c.translate(0, -32);
    var st = []; for (i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 4.6 : 10; st.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    poly(c, st); c.fillStyle = '#fff3b8'; c.fill(); c.strokeStyle = '#a86a10'; c.lineWidth = 0.8; c.stroke(); c.restore();
    // 數字
    A.numeral(c, String(s.n), 0, 6, 33);
    // 底部 V 紋
    c.strokeStyle = rgba('#ffe9a6', 0.8); c.lineWidth = 2; c.beginPath(); c.moveTo(-20, 30); c.lineTo(0, 42); c.lineTo(20, 30); c.stroke();
    c.beginPath(); c.moveTo(-14, 40); c.lineTo(0, 49); c.lineTo(14, 40); c.stroke();
    c.restore();
    if (lv === 2) { c.save(); c.translate(0, -58); A.crown(c, 0, 0, 42, 20, '#ffd36a'); c.restore(); }
    A.motes(c, R, 16, [-88, -88, 88, 88], [col, '#ffffff', '#ffe08a'], 0.9, 2, 90);
  };

  /* ---------- 強化：錘與砧 ---------- */
  M.enhanceLevel = function (c, s, R) {
    var i, hot = s.id === 13;
    add(c); glowDot(c, 6, 20, 96, '#ff7a1a', 0.45); normal(c);
    A.anvil(c, 0, 30, 0.98, '#8a96b0', '#ff7a1a');
    // 燒紅鐵塊
    c.save(); c.translate(0, 0);
    c.fillStyle = lin(c, -26, 0, 30, 0, [[0, '#ff6a10'], [0.5, '#ffe9a0'], [1, '#ff4a0a']]);
    c.beginPath(); c.moveTo(-26, 30); c.lineTo(-20, 22); c.lineTo(30, 22); c.lineTo(34, 30); c.closePath(); c.fill();
    add(c); glowDot(c, 4, 24, 40, '#ffb040', 0.9); normal(c); c.restore();
    // 火花
    add(c);
    var n = hot ? 34 : 22;
    for (i = 0; i < n; i++) {
      var a = -Math.PI + R() * Math.PI, d0 = 8 + R() * 10, d1 = d0 + 14 + R() * (hot ? 50 : 36);
      var x0 = 4 + Math.cos(a) * d0 * 1.5, y0 = 20 + Math.sin(a) * d0, x1 = 4 + Math.cos(a) * d1 * 1.5, y1 = 20 + Math.sin(a) * d1;
      var g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.4, 'rgba(255,190,70,0.8)'); g.addColorStop(1, 'rgba(255,90,20,0)');
      c.strokeStyle = g; c.lineWidth = 1 + R() * 1.6; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
      glowDot(c, x1, y1, 3, '#ffcf70', 0.5);
    }
    A.coreGlow(c, 4, 22, 34, '#ff9a30', '#ffffff'); normal(c);
    // 錘
    A.hammer(c, -10, -42, 0.72, 96, 62, 34, hot ? '#ffd1a0' : '#b8c4dc');
    add(c); glowDot(c, -10, -42, 50, '#ff9a30', 0.28); normal(c);
    A.motes(c, R, 14, [-80, -88, 80, 40], ['#ffcf70', '#ff9a30', '#ffffff'], 0.8, 2, 90);
  };
  A.overlays.enhanceLevel = function (c, s) { A.banner(c, '+' + s.n, 0, 90, 66, 26, '#8a3a10', 22); };

  /* ---------- 太古 ---------- */
  var GLYPHS = [
    function (c, r) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); c.beginPath(); c.arc(0, 0, r * 0.3, 0, TAU); c.fill(); },
    function (c, r) { poly(c, [[0, -r], [r, r * 0.8], [-r, r * 0.8]]); c.stroke(); c.beginPath(); c.moveTo(0, -r * 0.2); c.lineTo(0, r * 0.8); c.stroke(); },
    function (c, r) { c.beginPath(); c.moveTo(-r, -r * 0.6); c.lineTo(0, 0); c.lineTo(r, -r * 0.6); c.moveTo(-r, r * 0.1); c.lineTo(0, r * 0.7); c.lineTo(r, r * 0.1); c.stroke(); },
    function (c, r) { poly(c, [[0, -r], [r, 0], [0, r], [-r, 0]]); c.stroke(); c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r); c.stroke(); },
    function (c, r) { c.beginPath(); c.moveTo(-r, r); c.lineTo(-r, -r); c.lineTo(r, -r); c.lineTo(r, r * 0.2); c.lineTo(-r * 0.2, r * 0.2); c.lineTo(-r * 0.2, -r * 0.4); c.stroke(); },
    function (c, r) { c.beginPath(); c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r); c.moveTo(-r * 0.7, -r * 0.7); c.lineTo(r * 0.7, r * 0.7); c.stroke(); }
  ];
  function tabletPath(c, w, h, top) {
    c.beginPath(); c.moveTo(-w, h); c.lineTo(-w, top + w * 0.9); c.quadraticCurveTo(-w, top, 0, top - 4); c.quadraticCurveTo(w, top, w, top + w * 0.9); c.lineTo(w, h); c.closePath();
  }
  function tablet(c, x, y, w, h, rot, col, gold, R) {
    c.save(); c.translate(x, y); c.rotate(rot);
    var top = -h;
    add(c); glowDot(c, 0, -h * 0.5, h * 0.9, col, 0.3); normal(c);
    tabletPath(c, w, 0, top);
    c.fillStyle = lin(c, -w, 0, w, 0, [[0, '#3b4a56'], [0.35, '#6f8190'], [0.5, '#8ea1af'], [0.7, '#46535f'], [1, '#161c24']]); c.fill();
    c.strokeStyle = rgba(mix(col, '#ffffff', 0.6), 0.95); c.lineWidth = 2; c.stroke();
    c.save(); tabletPath(c, w, 0, top); c.clip();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1;
    for (var i = 0; i < 5; i++) { var cy = top + R() * h; c.beginPath(); c.moveTo(-w, cy); c.lineTo(-w + R() * w * 1.2, cy + R() * 8 - 4); c.stroke(); }
    c.fillStyle = 'rgba(0,0,0,0.38)'; c.fillRect(0, top - 6, w, h + 8);
    c.restore();
    // 刻字
    var gc = gold ? '#ffd36a' : col;
    c.save(); c.strokeStyle = gc; c.fillStyle = gc; c.lineWidth = Math.max(1.8, w * 0.07); c.lineJoin = 'round'; c.shadowColor = gc; c.shadowBlur = 9;
    var rows = Math.max(2, Math.floor(h / (w * 1.15)));
    for (var r = 0; r < rows; r++) {
      c.save(); c.translate(0, top + w * 1.05 + r * (h - w * 1.2) / rows + w * 0.45); GLYPHS[Math.floor(R() * GLYPHS.length)](c, w * 0.34); c.restore();
    }
    c.restore();
    add(c); coreGlowSafe(c, 0, top + w * 0.7, w * 1.0, gc); normal(c);
    c.restore();
  }
  function coreGlowSafe(c, x, y, r, col) { glowDot(c, x, y, r, col, 0.55); }

  M.ancientEquipped = function (c, s, R) {
    var lv = s.lv, i, cy = '#6ff2ff', gd = '#ffd36a';
    add(c); glowDot(c, 0, 0, 100, cy, 0.38); glowDot(c, 0, 30, 70, gd, 0.22); normal(c);
    if (lv >= 2) {
      A.rays(c, 0, -10, 20, 100, 18, gd, 0.38, 0.1, 0.055);
      A.ringGlow(c, 0, -4, 74, 3.5, gd, 0.9);
      for (i = 0; i < 8; i++) {
        var a = i * TAU / 8 - Math.PI / 2;
        c.save(); c.translate(Math.cos(a) * 74, -4 + Math.sin(a) * 74); c.strokeStyle = gd; c.fillStyle = gd; c.lineWidth = 1.8; c.shadowColor = gd; c.shadowBlur = 7;
        GLYPHS[i % 6](c, 5.5); c.restore();
      }
    }
    // 地面光圈
    add(c); c.save(); c.translate(0, 62); c.scale(1, 0.32); A.ringGlow(c, 0, 0, lv >= 1 ? 74 : 56, 3, cy, 0.9); c.restore(); normal(c);
    if (lv === 0) tablet(c, 0, 68, 40, 136, 0, cy, false, R);
    else if (lv === 1) {
      tablet(c, -46, 68, 24, 74, -0.13, cy, false, R); tablet(c, 46, 68, 24, 74, 0.13, cy, false, R); tablet(c, 0, 70, 34, 124, 0, cy, true, R);
    } else {
      tablet(c, -48, 70, 22, 70, -0.14, gd, true, R); tablet(c, 48, 70, 22, 70, 0.14, gd, true, R); tablet(c, 0, 72, 36, 128, 0, gd, true, R);
      c.save(); c.translate(0, -66); A.crown(c, 0, 0, 36, 18, '#ffd36a'); c.restore();
    }
    var n = 10 + lv * 6;
    for (i = 0; i < n; i++) A.motes(c, R, 1, [-70, -80, 70, 60], [cy, gd, '#ffffff'], 0.8, 2, 90);
    A.sparkle(c, 40, -56, 9, '#ffffff', 0); A.sparkle(c, -50, -24, 7, gd, 0);
  };

  /* ---------- 洗煉 ---------- */
  function arrowArc(c, r, a0, a1, col) {
    c.save(); c.lineCap = 'butt';
    var N = 40, pts = [];
    for (var i = 0; i <= N; i++) { var a = lerp(a0, a1, i / N); pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    add(c);
    c.lineWidth = 17; c.strokeStyle = rgba(col, 0.2); c.beginPath(); c.arc(0, 0, r, a0, a1); c.stroke();
    normal(c);
    c.lineWidth = 9; c.strokeStyle = lin(c, pts[0][0], pts[0][1], pts[N][0], pts[N][1], [[0, mix(col, '#000', 0.4)], [1, mix(col, '#ffffff', 0.25)]]);
    c.beginPath(); c.arc(0, 0, r, a0, a1 - 0.05); c.stroke();
    c.lineWidth = 2.4; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.beginPath(); c.arc(0, 0, r - 1.5, a0 + 0.1, a1 - 0.1); c.stroke();
    // 箭頭
    var tx = Math.cos(a1), ty = Math.sin(a1), px = -ty, py = tx; // 切線（順時針）
    var bx = tx * r, by = ty * r;
    poly(c, [[bx + px * 20, by + py * 20], [bx + tx * 15 - px * 0, by + ty * 15], [bx - tx * 15, by - ty * 15]].map(function (p, i) { return i === 0 ? p : p; }));
    c.restore();
    var ax = Math.cos(a1) * r, ay = Math.sin(a1) * r;
    c.save(); c.translate(ax, ay); c.rotate(a1 + Math.PI / 2);
    c.beginPath(); c.moveTo(0, 18); c.lineTo(-14, -4); c.lineTo(14, -4); c.closePath();
    c.fillStyle = lin(c, 0, -4, 0, 18, [[0, mix(col, '#ffffff', 0.5)], [1, '#ffffff']]); c.fill();
    c.strokeStyle = rgba(col, 0.9); c.lineWidth = 1.5; c.stroke(); c.restore();
  }
  M.rerollCount = function (c, s, R) {
    var col = s.col, i;
    add(c); glowDot(c, 0, 0, 92, '#8a7bff', 0.4); glowDot(c, 0, 0, 50, col, 0.5); normal(c);
    // 結晶
    var cs = [[0, -44], [24, -18], [24, 20], [0, 46], [-24, 20], [-24, -18]];
    poly(c, cs); c.fillStyle = lin(c, -24, -44, 24, 46, [[0, '#d6f7ff'], [0.5, '#5bb8f0'], [1, '#2b2f8a']]); c.fill();
    var fc = [[[0, -44], [24, -18], [0, -6], [-24, -18]], 0.95, [[-24, -18], [0, -6], [0, 46], [-24, 20]], 0.2, [[24, -18], [24, 20], [0, 46], [0, -6]], 0.5];
    for (i = 0; i < fc.length; i += 2) {
      poly(c, fc[i]); var k = fc[i + 1];
      c.fillStyle = k > 0.6 ? 'rgba(255,255,255,0.45)' : (k < 0.3 ? 'rgba(10,10,60,0.5)' : 'rgba(120,200,255,0.18)'); c.fill();
    }
    poly(c, cs); rimLine(c, '#e8fbff', 1.8, 0.95);
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(-24, -18); c.lineTo(0, -6); c.lineTo(24, -18); c.moveTo(0, -6); c.lineTo(0, 46); c.stroke();
    add(c); A.coreGlow(c, -6, -14, 18, '#ffffff', '#ffffff'); normal(c);
    // 兩條環形箭頭
    arrowArc(c, 66, Math.PI * 1.08, Math.PI * 1.98, '#5ad7ff');
    arrowArc(c, 66, Math.PI * 0.08, Math.PI * 0.98, '#b69bff');
    A.sparkle(c, 48, -40, 9, '#ffffff', 0); A.sparkle(c, -52, 38, 8, '#c9b8ff', 0);
    A.motes(c, R, 14, [-84, -84, 84, 84], [col, '#ffffff', '#c9b8ff'], 0.8, 2, 90);
  };

  /* ---------- 鑲嵌 ---------- */
  var GEMCOLS = ['#ff4d5e', '#4dc9ff', '#5cf08a', '#ffd84d', '#c77dff', '#ff9a3a', '#4dffe0', '#ff7fd0'];
  function socket(c, x, y, r, col) {
    c.beginPath(); c.arc(x, y, r + 3, 0, TAU); c.fillStyle = lin(c, x - r, y - r, x + r, y + r, [[0, '#fff0b8'], [0.5, '#c9962e'], [1, '#6a420c']]); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = '#05060a'; c.fill();
    A.gem(c, x, y + r * 0.05, r * 0.92, col);
  }
  M.socketEquipped = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 100, '#ffd36a', 0.28); glowDot(c, 0, 0, 80, '#8a7bff', 0.2); normal(c);
    if (s.lv === 0) {
      c.save(); c.translate(0, -12);
      var ss = { col: '#9bd8ff', col2: null, orn: 1 };
      var edge = lin(c, -60, -20, 60, 90, [[0, '#fff3b0'], [0.5, '#d4a23a'], [1, '#7a4d0e']]);
      drawChest(c, ss, edge);
      c.restore();
      var pos = [[0, 36, 10], [-22, 52, 8.5], [22, 52, 8.5], [-52, 22, 8], [52, 22, 8], [-12, 70, 7.5], [12, 70, 7.5]];
      pos.forEach(function (p, k) { socket(c, p[0], p[1] - 12 + (k >= 5 ? 6 : 0), p[2] * 1.15, GEMCOLS[k]); });
      A.sparkle(c, -30, -50, 10, '#fff1c0', 0);
    } else {
      A.rays(c, 0, 0, 20, 100, 16, '#ffe08a', 0.3, 0.1, 0.05);
      c.beginPath(); c.arc(0, 0, 66, 0, TAU); c.lineWidth = 17; c.strokeStyle = lin(c, -66, -66, 66, 66, [[0, '#fff0b8'], [0.5, '#c9962e'], [1, '#5a3608']]); c.stroke();
      c.beginPath(); c.arc(0, 0, 66, 0, TAU); c.lineWidth = 1.5; c.strokeStyle = 'rgba(0,0,0,0.5)'; c.stroke();
      for (i = 0; i < 12; i++) {
        var a = i * TAU / 12 - Math.PI / 2; socket(c, Math.cos(a) * 66, Math.sin(a) * 66, 9, GEMCOLS[i % 8]);
      }
      c.beginPath(); c.arc(0, 0, 44, 0, TAU); c.fillStyle = rad2(c); c.fill(); A.ringGlow(c, 0, 0, 44, 2.4, '#ffe9a6', 0.9);
      A.gem(c, 0, 2, 33, '#e6f4ff');
      A.sparkle(c, 30, -34, 11, '#ffffff', 0);
    }
    A.motes(c, R, 16, [-88, -88, 88, 88], ['#ffd36a', '#ffffff', '#c9b8ff'], 0.8, 2, 90);
  };
  function rad2(c) { return A.rad(c, 0, 0, 0, 44, [[0, '#2a2f66'], [1, '#05060f']]); }

  /* ---------- 寶石 ---------- */
  M.gemLevel = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, -6, 100, '#ff4a6a', 0.5); normal(c);
    A.rays(c, 0, -8, 30, 100, 14, '#ff9aaa', 0.34, 0.12, 0.05);
    A.ringGlow(c, 0, -8, 64, 3, '#ffd36a', 0.9);
    for (i = 0; i < 10; i++) { var a = i * TAU / 10 - Math.PI / 2; c.save(); c.translate(Math.cos(a) * 64, -8 + Math.sin(a) * 64); c.rotate(a); c.fillStyle = '#fff3b0'; c.fillRect(-1.5, -6, 3, 12); c.restore(); }
    // 基座
    c.beginPath(); c.moveTo(-34, 72); c.lineTo(-26, 58); c.lineTo(26, 58); c.lineTo(34, 72); c.closePath();
    c.fillStyle = lin(c, 0, 58, 0, 72, [[0, '#ffe9a6'], [1, '#8a5a12']]); c.fill(); rimLine(c, '#fff3c0', 1.2, 0.8);
    c.fillStyle = lin(c, 0, 52, 0, 60, [[0, '#d4a23a'], [1, '#6a420c']]); c.fillRect(-20, 51, 40, 8);
    A.gem(c, 0, -8, 40, '#ff3a5c');
    A.motes(c, R, 18, [-84, -84, 84, 84], ['#ff9aaa', '#ffffff', '#ffd36a'], 0.8, 2.2, 90);
  };
  A.overlays.gemLevel = function (c) { A.banner(c, '10', 0, 92, 40, 24, '#7a1030', 20); };
  M.gemAllTypes = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 100, '#a8e0ff', 0.35); normal(c);
    if (c.createConicGradient) {
      var cg = c.createConicGradient(0, 0, 0);
      GEMCOLS.concat([GEMCOLS[0]]).forEach(function (cc, k, arr) { cg.addColorStop(k / (arr.length - 1), cc); });
      c.beginPath(); c.arc(0, 0, 58, 0, TAU); c.lineWidth = 7; c.strokeStyle = cg; c.globalAlpha = 0.8; c.stroke(); c.globalAlpha = 1;
    }
    for (i = 0; i < 8; i++) {
      var a = i * TAU / 8 - Math.PI / 2; A.gem(c, Math.cos(a) * 58, Math.sin(a) * 58, 17, GEMCOLS[i]);
    }
    A.rays(c, 0, 0, 20, 52, 8, '#ffffff', 0.4, Math.PI / 8, 0.1);
    A.gem(c, 0, 0, 29, '#eaf6ff');
    A.motes(c, R, 12, [-88, -88, 88, 88], ['#ffffff', '#a8e0ff'], 0.8, 2, 90);
  };
  A.overlays.gemAllTypes = function (c) { A.banner(c, '10', 0, 92, 40, 24, '#2a3a6a', 20); };
  M.gemDivine = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, -4, 104, '#fff1c0', 0.4); normal(c);
    A.rays(c, 0, 0, 56, 104, 16, '#fff3c0', 0.3, 0.1, 0.04);
    c.save(); c.translate(0, -2); A.wings(c, 10, 0, 84, '#ffd98a', 6, 0.55); c.restore();
    c.save(); c.translate(0, -62); c.scale(1, 0.3); A.ringGlow(c, 0, 0, 42, 6, '#ffe9a6', 1); c.restore();
    A.gem(c, 0, 8, 44, '#ffd77a');
    for (i = 0; i < 6; i++) A.sparkle(c, A.range(R, -80, 80), A.range(R, -80, 70), A.range(R, 5, 10), '#fff1c0', 0);
    A.motes(c, R, 14, [-88, -88, 88, 88], ['#fff1c0', '#ffffff'], 0.8, 2, 90);
  };
  // 供其他檔案共用
  A.drawChest = drawChest; A.drawHelm = drawHelm; A.GEMCOLS = GEMCOLS; A.socket = socket; A.GLYPHS = GLYPHS;
})();
