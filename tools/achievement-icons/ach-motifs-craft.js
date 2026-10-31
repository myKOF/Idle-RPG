/* 成就圖示主題：鍛造／符文／轉生／高塔／魔物類。座標原點在獎牌中心，內圈半徑約 92。 */
(function () {
  'use strict';
  var A = window.ACH, M = A.motifs, TAU = A.TAU;
  var add = A.add, normal = A.normal, rgba = A.rgba, mix = A.mix, glowDot = A.glowDot, lin = A.lin, poly = A.poly, rimLine = A.rimLine, lerp = A.lerp;

  /* ---------- 神匠之作：砧＋神火＋光環＋劍 ---------- */
  M.godEquip = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 104, '#ffb84a', 0.4); normal(c);
    A.rays(c, 0, -10, 20, 104, 18, '#ffe9a6', 0.3, 0.05, 0.05);
    A.flame(c, -46, 76, 40, 70, '#ff9a2a', 11, '#fff1c0'); A.flame(c, 46, 76, 40, 70, '#ff9a2a', 12, '#fff1c0');
    c.save(); c.translate(0, -48); c.scale(1, 0.3); A.ringGlow(c, 0, 0, 46, 6, '#ffe9a6', 1); c.restore();
    A.sword(c, 0, 12, 82, 17, '#fff4d6', 0, '#ffd36a');
    add(c); glowDot(c, 0, -20, 40, '#ffe9a6', 0.35); normal(c);
    A.anvil(c, 0, 34, 0.8, '#8e9ab4', null);
    A.flame(c, -26, 82, 22, 34, '#ffb84a', 14, '#fff1c0'); A.flame(c, 26, 82, 22, 34, '#ffb84a', 15, '#fff1c0');
    c.fillStyle = lin(c, -30, 0, 30, 0, [[0, 'rgba(255,200,90,0)'], [0.5, 'rgba(255,240,190,0.9)'], [1, 'rgba(255,200,90,0)']]); c.fillRect(-34, 31, 68, 3);
    for (i = 0; i < 8; i++) A.sparkle(c, A.range(R, -76, 76), A.range(R, -60, 60), A.range(R, 4, 9), '#fff1c0', 0);
    A.motes(c, R, 16, [-88, -88, 88, 88], ['#ffd36a', '#ffffff'], 0.8, 2, 90);
  };

  /* ---------- 太古精鑄：地面符陣＋重錘 ---------- */
  M.ancientCast = function (c, s, R) {
    var i, cy = '#6ff2ff', gd = '#ffd36a';
    add(c); glowDot(c, 0, 20, 100, cy, 0.4); glowDot(c, 0, 40, 60, gd, 0.3); normal(c);
    // 符陣
    c.save(); c.translate(0, 46); c.scale(1, 0.36);
    add(c); A.ringGlow(c, 0, 0, 80, 5, cy, 1); A.ringGlow(c, 0, 0, 60, 3, gd, 0.9);
    c.lineWidth = 2; c.strokeStyle = rgba(cy, 0.85); A.hexagram(c, 60, cy, 2.4, 0.85);
    for (i = 0; i < 12; i++) { var a = i * TAU / 12; c.save(); c.translate(Math.cos(a) * 70, Math.sin(a) * 70); c.strokeStyle = gd; c.fillStyle = gd; c.lineWidth = 3; A.GLYPHS[i % 6](c, 5.5); c.restore(); }
    normal(c); c.restore();
    // 衝擊光柱
    add(c); A.coreGlow(c, -4, 40, 30, gd, '#ffffff'); normal(c);
    A.rays(c, -4, 40, 10, 90, 12, cy, 0.35, 0.3, 0.04);
    A.hammer(c, -6, 20, Math.PI + 0.62, 112, 64, 36, '#9fe8ff');
    
    for (i = 0; i < 26; i++) {
      var an = -Math.PI * (0.1 + R() * 0.8), d0 = 8 + R() * 8, d1 = d0 + 16 + R() * 46, col = R() < 0.5 ? cy : gd;
      var x0 = -4 + Math.cos(an) * d0 * 1.5, y0 = 36 + Math.sin(an) * d0, x1 = -4 + Math.cos(an) * d1 * 1.5, y1 = 36 + Math.sin(an) * d1;
      add(c); var g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.4, rgba(col, 0.8)); g.addColorStop(1, rgba(col, 0));
      c.strokeStyle = g; c.lineWidth = 1 + R() * 1.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); normal(c);
    }
    A.motes(c, R, 16, [-88, -88, 88, 60], [cy, gd, '#ffffff'], 0.8, 2, 90);
  };

  /* ---------- 神聖刻印：印章壓在聖印陣上 ---------- */
  M.imprintCount = function (c, s, R) {
    var i, bl = '#6fb4ff';
    add(c); glowDot(c, 0, 10, 104, bl, 0.42); normal(c);
    c.save(); c.translate(0, 42); c.scale(1, 0.4);
    add(c); A.ringGlow(c, 0, 0, 82, 5, bl, 1); A.ringGlow(c, 0, 0, 64, 2.5, '#cfe6ff', 0.9);
    A.hexagram(c, 64, '#9fcfff', 2.6, 0.95); A.polyRing(c, 40, 6, 0, '#cfe6ff', 2, 0.8);
    for (i = 0; i < 12; i++) { var a = i * TAU / 12; c.save(); c.translate(Math.cos(a) * 73, Math.sin(a) * 73); c.strokeStyle = '#ffffff'; c.fillStyle = '#ffffff'; c.lineWidth = 3; A.GLYPHS[(i * 5) % 6](c, 5); c.restore(); }
    normal(c); c.restore();
    add(c); A.coreGlow(c, 0, 30, 46, bl, '#ffffff'); normal(c);
    A.rays(c, 0, 20, 10, 92, 14, '#9fcfff', 0.4, 0.2, 0.05);
    // 印章
    c.beginPath(); c.moveTo(-14, -40); c.lineTo(-10, 2); c.lineTo(10, 2); c.lineTo(14, -40); c.closePath();
    c.fillStyle = lin(c, -9, 0, 9, 0, [[0, '#fff0b8'], [0.5, '#d4a23a'], [1, '#6a420c']]); c.fill(); rimLine(c, '#fff3c0', 1.2, 0.7);
    c.beginPath(); c.ellipse(0, -48, 20, 12, 0, 0, TAU); c.fillStyle = A.rad(c, -4, -56, 1, 16, [[0, '#ffffff'], [0.4, '#7fc4ff'], [1, '#1d4a9a']]); c.fill(); rimLine(c, '#ffe9a6', 2.4, 1);
    c.beginPath(); c.ellipse(0, 6, 44, 13, 0, 0, TAU); c.fillStyle = lin(c, -34, 0, 34, 0, [[0, '#8a5a12'], [0.35, '#ffe9a6'], [0.7, '#c9962e'], [1, '#5a3608']]); c.fill(); rimLine(c, '#fff3c0', 1.4, 0.8);
    c.beginPath(); c.ellipse(0, 11, 44, 13, 0, 0, Math.PI); c.fillStyle = 'rgba(60,34,4,0.65)'; c.fill();
    add(c); c.beginPath(); c.ellipse(0, 7, 30, 7, 0, 0, TAU); c.fillStyle = rgba('#cfe6ff', 0.6); c.fill(); normal(c);
    A.sparkle(c, 40, -36, 11, '#ffffff', 0); A.sparkle(c, -50, -14, 8, '#cfe6ff', 0);
    A.motes(c, R, 18, [-88, -88, 88, 80], [bl, '#ffffff', '#cfe6ff'], 0.8, 2, 90);
  };

  /* ---------- 雙傳奇：長劍＋兩顆環繞的傳奇星 ---------- */
  function legendStar(c, x, y, r, col, rot) {
    add(c); glowDot(c, x, y, r * 2.4, col, 0.55); normal(c);
    c.save(); c.translate(x, y); c.rotate(rot);
    var p = []; for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, rr = i % 2 ? r * 0.38 : r; p.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    poly(c, p); c.fillStyle = lin(c, -r, -r, r, r, [[0, '#ffffff'], [0.4, mix(col, '#ffffff', 0.5)], [1, col]]); c.fill();
    rimLine(c, mix(col, '#ffffff', 0.9), 1.2, 0.9);
    c.restore();
    add(c); A.coreGlow(c, x, y, r * 0.8, col, '#ffffff'); normal(c);
  }
  M.dualLegend = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 100, '#ff9a3a', 0.4); glowDot(c, 0, 0, 60, '#ffd36a', 0.3); normal(c);
    A.rays(c, 0, 0, 20, 100, 16, '#ffb060', 0.3, 0.1, 0.05);
    // 軌道
    c.save(); c.rotate(-0.5); c.scale(1, 0.4);
    add(c); c.lineWidth = 2; c.strokeStyle = rgba('#ffd36a', 0.55); c.beginPath(); c.arc(0, 0, 78, 0, TAU); c.stroke(); normal(c); c.restore();
    A.sword(c, 0, 30, 90, 20, '#fff0d0', 0, '#ffb04a');
    add(c); A.coreGlow(c, 0, -10, 40, '#ff9a3a', '#ffffff'); normal(c);
    // 兩顆星與拖尾
    var o1 = [-62, 30], o2 = [62, -30], k;
    [[o1, '#ff8a2a', 0.3], [o2, '#ffd86a', 0.9]].forEach(function (st) {
      var p = st[0];
      add(c);
      for (k = 1; k <= 6; k++) { var tt = k / 6; glowDot(c, p[0] - (p[0] > 0 ? -1 : 1) * 0 + (p[0] > 0 ? -1 : 1) * tt * 22, p[1] + (p[0] > 0 ? 1 : -1) * tt * 10, 9 * (1 - tt * 0.6), st[1], 0.28 * (1 - tt)); }
      normal(c);
      legendStar(c, p[0], p[1], 17, st[1], st[2]);
    });
    A.sparkle(c, 6, -66, 9, '#ffffff', 0);
    A.motes(c, R, 18, [-88, -88, 88, 88], ['#ffb04a', '#ffffff', '#ffd36a'], 0.8, 2, 90);
  };

  /* ---------- 萬器歸爐：熔爐吞下一堆裝備 ---------- */
  M.divineConsumed = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 10, 104, '#ff6a1a', 0.5); normal(c);
    // 烈焰
    A.flame(c, 0, 26, 120, 130, '#ff5a14', 21, '#fff0b0');
    A.flame(c, -34, 26, 50, 88, '#ff8a2a', 22); A.flame(c, 34, 26, 50, 88, '#ff8a2a', 23);
    // 爐身
    c.beginPath(); c.moveTo(-62, 82); c.lineTo(-52, 34); c.quadraticCurveTo(-52, 22, -38, 22); c.lineTo(38, 22); c.quadraticCurveTo(52, 22, 52, 34); c.lineTo(62, 82); c.closePath();
    c.fillStyle = lin(c, -62, 0, 62, 0, [[0, '#2a2530'], [0.3, '#6a6572'], [0.5, '#8a8594'], [0.7, '#4a4552'], [1, '#17141b']]); c.fill();
    rimLine(c, '#b9b2c6', 2, 0.85);
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 2; [44, 62].forEach(function (y) { c.beginPath(); c.moveTo(-60 + (y - 34) * 0.1, y); c.lineTo(60 - (y - 34) * 0.1, y); c.stroke(); });
    // 爐口
    c.beginPath(); c.moveTo(-24, 82); c.lineTo(-24, 58); c.quadraticCurveTo(0, 36, 24, 58); c.lineTo(24, 82); c.closePath();
    c.fillStyle = A.rad(c, 0, 76, 2, 40, [[0, '#fff0b0'], [0.4, '#ff8a1a'], [1, '#6a1404']]); c.fill(); rimLine(c, '#ffb050', 1.6, 0.9);
    add(c); glowDot(c, 0, 66, 50, '#ff7a1a', 0.7); normal(c);
    // 爐頂開口
    c.beginPath(); c.ellipse(0, 22, 44, 9, 0, 0, TAU); c.fillStyle = '#ffcf70'; c.fill(); rimLine(c, '#ffe9b0', 2, 0.9);
    add(c); A.coreGlow(c, 0, 20, 40, '#ffb050', '#ffffff'); normal(c);
    // 落入的裝備
    var items = [[-46, -44, -0.5, 'sword'], [8, -66, 0.2, 'shield'], [44, -30, 0.5, 'helm'], [-14, -16, -0.1, 'ring'], [30, -62, 0.9, 'sword']];
    items.forEach(function (it, k) {
      c.save(); c.translate(it[0], it[1]); c.rotate(it[2]);
      add(c); var g = c.createLinearGradient(0, -34, 0, 0); g.addColorStop(0, 'rgba(255,170,60,0)'); g.addColorStop(1, 'rgba(255,170,60,0.55)'); c.fillStyle = g; c.fillRect(-5, -36, 10, 36); normal(c);
      if (it[3] === 'sword') { c.scale(0.55, 0.55); A.sword(c, 0, 18, 60, 14, '#d8e2f4', Math.PI, '#d4a23a'); }
      else if (it[3] === 'shield') {
        c.beginPath(); c.moveTo(-11, -12); c.lineTo(11, -12); c.lineTo(11, 2); c.quadraticCurveTo(11, 14, 0, 20); c.quadraticCurveTo(-11, 14, -11, 2); c.closePath();
        c.fillStyle = lin(c, -11, -12, 11, 20, [[0, '#e8d2a0'], [0.5, '#a8803a'], [1, '#4a3008']]); c.fill(); rimLine(c, '#fff0b8', 1.4, 0.9);
      } else if (it[3] === 'helm') {
        c.beginPath(); c.moveTo(-10, 10); c.lineTo(-11, -4); c.quadraticCurveTo(-11, -18, 0, -19); c.quadraticCurveTo(11, -18, 11, -4); c.lineTo(10, 10); c.closePath();
        c.fillStyle = lin(c, -11, 0, 11, 0, [[0, '#6a7288'], [0.4, '#d4dbea'], [1, '#2a3042']]); c.fill(); rimLine(c, '#ffffff', 1.2, 0.8); c.fillStyle = '#05060a'; c.fillRect(-8, -6, 16, 3);
      } else { c.beginPath(); c.arc(0, 0, 9, 0, TAU); c.lineWidth = 4; c.strokeStyle = '#ffd36a'; c.stroke(); A.gem(c, 0, -9, 4.5, '#ff4d5e'); }
      c.restore();
    });
    for (i = 0; i < 22; i++) { A.motes(c, R, 1, [-60, -84, 60, 26], ['#ffcf70', '#ff8a2a', '#ffffff'], 0.8, 2, 90); }
  };

  /* ---------- 萬錘不輟：交叉雙錘＋火花環 ---------- */
  M.upgradeCount = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 100, '#ffa030', 0.45); normal(c);
    add(c);
    for (i = 0; i < 40; i++) {
      var a = i * TAU / 40, r0 = 66 + (i % 2) * 4, r1 = r0 + (i % 2 ? 14 : 26);
      var g = c.createLinearGradient(Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,170,60,0.8)'); g.addColorStop(1, 'rgba(255,80,20,0)');
      c.strokeStyle = g; c.lineWidth = i % 2 ? 2 : 3.4; c.lineCap = 'round'; c.beginPath(); c.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); c.stroke();
    }
    A.ringGlow(c, 0, 0, 62, 3.4, '#ffb04a', 0.9); normal(c);
    A.hammer(c, -36, -40, -0.72, 104, 52, 30, '#b8c4dc');
    A.hammer(c, 36, -40, 0.72, 104, 52, 30, '#e0b890');
    add(c); A.coreGlow(c, 0, -2, 36, '#ffb04a', '#ffffff'); normal(c);
    A.sparkle(c, 0, -4, 16, '#ffffff', 0.4);
    A.motes(c, R, 16, [-60, -60, 60, 60], ['#ffcf70', '#ffffff'], 0.8, 2, 62);
  };
  A.overlays.upgradeCount = function (c) { A.banner(c, '10000', 0, 91, 62, 22, '#7a3a10', 17); };

  /* ---------- 爐火純青：咬合齒輪全亮 ---------- */
  M.forgePartsMax = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 104, '#ff9a30', 0.45); normal(c);
    A.flame(c, 0, 92, 120, 60, '#ff6a1a', 31, '#ffb060');
    A.rays(c, 0, 0, 30, 100, 14, '#ffcf70', 0.25, 0.2, 0.05);
    A.gear(c, -18, 14, 46, 12, '#ffb04a', 0.1);
    A.gear(c, 40, -34, 30, 9, '#ffd36a', 0.2);
    A.gear(c, 42, 44, 24, 8, '#ff8a3a', 0.35);
    A.gear(c, -52, -40, 20, 7, '#ffd36a', 0.05);
    add(c); A.coreGlow(c, -18, 14, 28, '#ffe9a0', '#ffffff'); normal(c);
    // 五星
    for (i = 0; i < 5; i++) A.sparkle(c, (i - 2) * 18, -76 + Math.abs(i - 2) * 5, 7, '#fff1c0', 0);
    A.motes(c, R, 18, [-88, -88, 88, 88], ['#ffcf70', '#ffffff', '#ff9a30'], 0.8, 2, 90);
  };

  /* ---------- 富可敵國：金幣山＋王冠 ---------- */
  function coin(c, x, y, rx, ry, tilt) {
    var th = ry * 0.9;
    c.save(); c.translate(x, y); c.rotate(tilt || 0);
    c.beginPath(); c.ellipse(0, th, rx, ry, 0, 0, TAU); c.fillStyle = '#6a4208'; c.fill();
    c.beginPath(); c.rect(-rx, 0, rx * 2, th); c.fillStyle = lin(c, -rx, 0, rx, 0, [[0, '#8a5a12'], [0.5, '#d49a2a'], [1, '#5a3608']]); c.fill();
    c.beginPath(); c.ellipse(0, th, rx, ry, 0, 0, Math.PI); c.fillStyle = lin(c, -rx, 0, rx, 0, [[0, '#8a5a12'], [0.5, '#c98a22'], [1, '#5a3608']]); c.fill();
    c.beginPath(); c.ellipse(0, 0, rx, ry, 0, 0, TAU); c.fillStyle = lin(c, -rx, -ry, rx, ry, [[0, '#fff6b8'], [0.45, '#ffd04a'], [1, '#c98a22']]); c.fill();
    c.strokeStyle = 'rgba(120,70,8,0.8)'; c.lineWidth = 1; c.stroke();
    c.beginPath(); c.ellipse(0, 0, rx * 0.66, ry * 0.66, 0, 0, TAU); c.strokeStyle = 'rgba(150,90,10,0.7)'; c.lineWidth = 1; c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(-rx * 0.4, -ry * 0.55, rx * 0.5, ry * 0.2);
    c.restore();
  }
  M.goldTotal = function (c, s, R) {
    var i, r, k;
    add(c); glowDot(c, 0, 10, 104, '#ffd36a', 0.55); normal(c);
    A.rays(c, 0, 0, 20, 104, 20, '#fff0b0', 0.35, 0.07, 0.045);
    var rows = [[-20, 2], [-8, 3], [4, 4], [16, 5], [28, 6], [40, 7], [52, 8]];
    rows.forEach(function (rw, ri) {
      var n = rw[1], span = 22;
      for (k = 0; k < n; k++) {
        var x = (k - (n - 1) / 2) * span + (R() - 0.5) * 3;
        coin(c, x, rw[0] + 14 + (R() - 0.5) * 3, 15, 7, (R() - 0.5) * 0.25);
      }
    });
    add(c); glowDot(c, 0, 20, 70, '#ffd36a', 0.25); normal(c);
    c.save(); c.translate(0, -26); A.crown(c, 0, 0, 52, 26, '#ffd36a'); c.restore();
    add(c); glowDot(c, 0, -40, 34, '#fff0b0', 0.5); normal(c);
    for (i = 0; i < 8; i++) A.sparkle(c, A.range(R, -70, 70), A.range(R, -70, 60), A.range(R, 5, 10), '#fff3c0', 0);
  };

  /* ---------- 符文真言：直接用遊戲自己的符文石圖 ---------- */
  function stoneUrl(n) { return '/images/runes/stone-r' + (n < 10 ? '0' : '') + n + '.png'; }
  function drawStone(c, n, x, y, size, glow) {
    var im = A.getImg(stoneUrl(n)); if (!im) return;
    if (glow) {
      c.save(); add(c); c.globalAlpha = 0.65; c.filter = 'blur(6px) brightness(1.7) saturate(1.6)'; c.drawImage(im, x - size / 2, y - size / 2, size, size); c.restore();
    }
    c.drawImage(im, x - size / 2, y - size / 2, size, size);
  }
  M.runewordActive = function (c, s, R) {
    var i;
    add(c); glowDot(c, 0, 0, 100, '#ffd36a', 0.45); normal(c);
    A.rays(c, 0, 0, 40, 100, 12, '#ffe08a', 0.3, 0.1, 0.05);
    c.save(); add(c); A.ringGlow(c, 0, 0, 76, 3, '#ffd36a', 0.8); normal(c); c.restore();
    for (i = 0; i < 6; i++) { var a = i * TAU / 6 - Math.PI / 2; c.save(); c.translate(Math.cos(a) * 76, Math.sin(a) * 76); c.strokeStyle = '#fff1c0'; c.fillStyle = '#fff1c0'; c.lineWidth = 2; c.shadowColor = '#ffd36a'; c.shadowBlur = 6; A.GLYPHS[i](c, 5); c.restore(); }
    drawStone(c, 15, 0, 2, 124, true);
    A.sparkle(c, 34, -40, 11, '#ffffff', 0); A.sparkle(c, -42, 30, 8, '#ffe08a', 0);
    A.motes(c, R, 16, [-88, -88, 88, 88], ['#ffd36a', '#ffffff'], 0.8, 2, 90);
  };
  M.runewordDistinct = function (c, s, R) {
    var i, ids = [2, 8, 11, 14, 17, 20, 23, 26, 29, 31];
    add(c); glowDot(c, 0, 0, 104, '#ffd36a', 0.4); normal(c);
    c.save(); add(c); A.ringGlow(c, 0, 0, 62, 2.6, '#ffd36a', 0.75); normal(c); c.restore();
    for (i = 0; i < 10; i++) { var a = i * TAU / 10 - Math.PI / 2; drawStone(c, ids[i], Math.cos(a) * 62, Math.sin(a) * 62, 44, true); }
    add(c); A.coreGlow(c, 0, 0, 40, '#ffe08a', '#ffffff'); normal(c);
    A.hexagram(c, 22, '#fff1c0', 2, 0.9);
    A.motes(c, R, 14, [-88, -88, 88, 88], ['#ffd36a', '#ffffff'], 0.8, 2, 90);
  };
  M.runeMade = function (c, s, R) {
    var i;
    // 虛空：深色漩渦
    c.save(); var g = A.rad(c, 0, 0, 0, 96, [[0, '#2a1a50'], [0.5, '#0d0620'], [1, '#020006']]); c.fillStyle = g; c.fillRect(-100, -100, 200, 200); c.restore();
    add(c);
    for (i = 0; i < 4; i++) {
      c.beginPath(); for (var k = 0; k <= 60; k++) { var t = k / 60, a = i * Math.PI / 2 + t * 3.4, r = 12 + t * 82; c[k ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
      c.strokeStyle = rgba(i % 2 ? '#9a7aff' : '#d8ccff', 0.22); c.lineWidth = 3; c.stroke();
    }
    glowDot(c, 0, 0, 96, '#b79cff', 0.42); normal(c);
    A.rays(c, 0, 0, 40, 98, 16, '#e6dcff', 0.4, 0.1, 0.035);
    drawStone(c, 33, 0, 4, 128, true);
    for (i = 0; i < 8; i++) { var aa = i * TAU / 8 + 0.3; c.save(); c.translate(Math.cos(aa) * 78, Math.sin(aa) * 78); c.rotate(aa); c.beginPath(); c.moveTo(0, -6); c.lineTo(10, 0); c.lineTo(0, 6); c.lineTo(-4, 0); c.closePath(); c.fillStyle = rgba('#e6dcff', 0.9); c.fill(); c.restore(); }
    A.sparkle(c, 38, -42, 12, '#ffffff', 0);
    A.motes(c, R, 18, [-88, -88, 88, 88], ['#e6dcff', '#b79cff', '#ffffff'], 0.8, 2, 90);
  };
  M.runewordTier = function (c, s, R) {
    var i, ids = [25, 26, 27, 28, 29, 30, 32];
    add(c); glowDot(c, 0, 0, 104, '#ff9a3a', 0.55); glowDot(c, 0, 0, 60, '#ffd36a', 0.35); normal(c);
    A.rays(c, 0, 0, 30, 104, 22, '#ffc060', 0.4, 0.05, 0.04);
    c.save(); add(c); A.ringGlow(c, 0, 0, 58, 3, '#ffb04a', 0.9); normal(c); c.restore();
    for (i = 0; i < 7; i++) { var a = i * TAU / 7 - Math.PI / 2; drawStone(c, ids[i], Math.cos(a) * 58, Math.sin(a) * 58, 50, true); }
    add(c); A.coreGlow(c, 0, 0, 44, '#ffc060', '#ffffff'); normal(c);
    A.flame(c, 0, 20, 36, 56, '#ff8a1a', 41, '#fff4c4');
    A.sparkle(c, 0, -2, 16, '#ffffff', 0);
    A.motes(c, R, 18, [-88, -88, 88, 88], ['#ffcf70', '#ffffff', '#ff9a3a'], 0.8, 2, 90);
  };

  /* ---------- 轉生：蓮花＋輪迴輪，隨轉數長大 ---------- */
  function petal(c, ang, len, w, col, edge) {
    c.save(); c.rotate(ang);
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(w, -len * 0.45, 0, -len); c.quadraticCurveTo(-w, -len * 0.45, 0, 0); c.closePath();
    c.fillStyle = lin(c, 0, 0, 0, -len, [[0, mix(col, '#2a0a2a', 0.5)], [0.5, col], [1, mix(col, '#ffffff', 0.45)]]); c.fill();
    c.strokeStyle = rgba(edge, 0.85); c.lineWidth = 1.3; c.stroke();
    c.beginPath(); c.moveTo(0, -len * 0.12); c.lineTo(0, -len * 0.85); c.strokeStyle = 'rgba(255,255,255,0.4)'; c.lineWidth = 1; c.stroke();
    c.restore();
  }
  M.reincarnation = function (c, s, R) {
    var n = s.n, t = (n - 1) / 9, i, k;
    var col = mix('#ff6fae', '#ffd36a', t * 0.75), edge = mix('#ffc8e0', '#fff3c0', t);
    var glow = s.glow;
    add(c); glowDot(c, 0, 0, 104, glow, 0.45); normal(c);
    if (n >= 10) A.rays(c, 0, -6, 30, 104, 24, '#fff1c0', 0.45, 0.05, 0.04);
    else if (n >= 7) A.rays(c, 0, -6, 30, 100, 12, glow, 0.28, 0.1, 0.05);
    // 輪迴輪
    c.save(); c.translate(0, -6);
    var spokes = 8;
    add(c); A.ringGlow(c, 0, 0, 76, 3.4, glow, 0.9);
    if (n >= 4) A.ringGlow(c, 0, 0, 66, 2, glow, 0.7);
    c.lineWidth = 2; c.strokeStyle = rgba(glow, 0.5);
    for (i = 0; i < spokes; i++) { var a = i * TAU / spokes + Math.PI / 8; c.beginPath(); c.moveTo(Math.cos(a) * 20, Math.sin(a) * 20); c.lineTo(Math.cos(a) * 74, Math.sin(a) * 74); c.stroke(); }
    for (i = 0; i < spokes; i++) { var a2 = i * TAU / spokes + Math.PI / 8; glowDot(c, Math.cos(a2) * 76, Math.sin(a2) * 76, 6, '#ffffff', 0.9); }
    normal(c); c.restore();
    if (n >= 7) { for (i = 0; i < 7; i++) { var af = -Math.PI * (0.12 + i * 0.1) - 0.0; var fx = Math.cos(Math.PI + (i + 0.5) * Math.PI / 7) * 76, fy = Math.sin(Math.PI + (i + 0.5) * Math.PI / 7) * 76 - 6; A.flame(c, fx, fy + 6, 14, 22 + (n - 6) * 3, n >= 10 ? '#ffd36a' : '#ff7a3a', 50 + i, '#fff4c4'); } }
    if (n >= 9) { c.save(); c.translate(0, 16); A.wings(c, 8, 0, 80, n >= 10 ? '#fff1c0' : '#ffd6ec', 6, 0.85); c.restore(); }
    // 蓮花：先放身後的日輪光，再疊花瓣
    add(c); glowDot(c, 0, -8, 46, '#fff1c0', 0.4); normal(c);
    c.save(); c.translate(0, 58);
    var L = 1 + Math.floor((n - 1) / 3), f = 3 + ((n - 1) % 3) * 2;
    for (var b = 0; b < L; b++) {
      var cnt = f + 2 * (L - 1 - b), span = Math.min(3.0, 0.36 * (cnt - 1) + 0.3), len = 90 - b * 9, w = 21 - b * 0.9;
      var cc = mix(mix(col, '#ff2a8a', 0.35), '#7a0a5a', 0.3 * (1 - b / Math.max(1, L)));
      for (k = 0; k < cnt; k++) {
        var ang = cnt === 1 ? 0 : lerp(-span / 2, span / 2, k / (cnt - 1));
        petal(c, ang, len * (1 - Math.abs(ang) * 0.12), w, mix(cc, '#ffffff', b * 0.05), edge);
      }
    }
    c.restore();
    add(c); glowDot(c, 0, 24, 20, '#fff1c0', 0.3); normal(c);
    A.sparkle(c, 0, 14, 11, '#ffffff', 0);
    if (n >= 5) { A.ringGlow(c, 0, 8, 17, 1.6, '#ffffff', 0.8); }
    if (n >= 10) { c.save(); c.translate(0, -72); A.crown(c, 0, 0, 34, 16, '#ffd36a'); c.restore(); }
    for (i = 0; i < 6 + n; i++) A.motes(c, R, 1, [-80, -86, 80, 60], [glow, '#ffffff', edge], 0.8, 2, 90);
  };
  A.overlays.reincarnation = function (c, s) { A.banner(c, String(s.n), 0, 91, s.n >= 10 ? 36 : 24, 24, '#5a1a4a', 20); };

  /* ---------- 封魔塔 ---------- */
  function talisman(c, x, y, w, h, R) {
    c.fillStyle = lin(c, x, y, x, y + h, [[0, '#fff2b0'], [1, '#d9a53a']]); c.fillRect(x - w / 2, y, w, h);
    c.strokeStyle = '#a81818'; c.lineWidth = Math.max(0.8, w * 0.14);
    for (var k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x - w * 0.22 + k * w * 0.22, y + h * 0.12); c.lineTo(x - w * 0.22 + k * w * 0.22, y + h * 0.88); c.stroke(); }
    c.strokeStyle = 'rgba(80,20,0,0.7)'; c.lineWidth = 0.6; c.strokeRect(x - w / 2, y, w, h);
  }
  M.towerFloor = function (c, s, R) {
    var lv = s.lv, T = [3, 5, 7][lv], i, k;
    // 月與霧
    add(c); glowDot(c, 0, -20, 100, '#9a5aff', 0.35); normal(c);
    c.beginPath(); c.arc(40, -56, 22, 0, TAU); c.fillStyle = A.rad(c, 36, -60, 2, 24, [[0, '#ffffff'], [1, '#c9b8ff']]); c.globalAlpha = 0.55; c.fill(); c.globalAlpha = 1;
    // 封印陣
    c.save(); c.translate(0, 78); c.scale(1, 0.28); add(c); A.ringGlow(c, 0, 0, 72, 5, '#ff3a3a', 0.9); A.ringGlow(c, 0, 0, 52, 3, '#ffb0b0', 0.8); A.hexagram(c, 52, '#ff6a6a', 3, 0.9); normal(c); c.restore();
    if (lv >= 1) { add(c); for (i = 0; i < 6; i++) { var a = -Math.PI * (0.1 + i * 0.16); glowDot(c, Math.cos(a) * 80, -8 + Math.sin(a) * 80, 8, '#ff6a6a', 0.0); } normal(c); }
    var y = 72, bodyH = (138 - 9 * T) / T;
    // 基座
    c.beginPath(); c.moveTo(-66, y + 6); c.lineTo(-58, y - 6); c.lineTo(58, y - 6); c.lineTo(66, y + 6); c.closePath();
    c.fillStyle = lin(c, 0, y - 6, 0, y + 6, [[0, '#6a6078'], [1, '#1c1626']]); c.fill(); rimLine(c, '#cbb8ff', 1.2, 0.7);
    y -= 6;
    for (k = 0; k < T; k++) {
      var w = lerp(56, 26, T === 1 ? 0 : k / (T - 1)) * (lv === 0 ? 1.1 : 1);
      // 塔身
      c.beginPath(); c.rect(-w, y - bodyH, w * 2, bodyH);
      c.fillStyle = lin(c, -w, 0, w, 0, [[0, '#3a2e50'], [0.4, '#7a6a9c'], [0.55, '#9484b8'], [1, '#241a34']]); c.fill();
      c.strokeStyle = 'rgba(210,190,255,0.7)'; c.lineWidth = 1.3; c.stroke();
      // 窗
      add(c); var wc = k % 2 ? '#ff6a6a' : '#c08aff';
      c.fillStyle = rgba(wc, 0.95); c.fillRect(-4, y - bodyH * 0.75, 8, bodyH * 0.55); glowDot(c, 0, y - bodyH * 0.45, 16, wc, 0.6); normal(c);
      // 符咒
      var tw = Math.max(5, w * 0.17), th = Math.max(8, bodyH * 0.9);
      if (lv >= 1) { talisman(c, -w * 0.62, y - bodyH + 1, tw, th * 0.8, R); talisman(c, w * 0.62, y - bodyH + 1, tw, th * 0.8, R); }
      // 屋簷
      var ew = w + 14 + (lv === 0 ? 4 : 0);
      c.beginPath(); c.moveTo(-ew, y - bodyH + 1); c.lineTo(-ew + 5, y - bodyH - 3); c.lineTo(-w + 2, y - bodyH - 9); c.lineTo(w - 2, y - bodyH - 9); c.lineTo(ew - 5, y - bodyH - 3); c.lineTo(ew, y - bodyH + 1); c.closePath();
      c.fillStyle = lin(c, 0, y - bodyH - 9, 0, y - bodyH + 1, [[0, '#7a5fb0'], [1, '#2a1e42']]); c.fill(); rimLine(c, '#e0d0ff', 1.4, 0.85);
      if (lv === 0) { talisman(c, -ew + 8, y - bodyH + 1, 5, 12, R); talisman(c, ew - 8, y - bodyH + 1, 5, 12, R); }
      y -= bodyH + 9;
    }
    // 塔尖
    c.beginPath(); c.moveTo(-5, y); c.lineTo(0, y - 24); c.lineTo(5, y); c.closePath(); c.fillStyle = lin(c, 0, y - 24, 0, y, [[0, '#ffffff'], [1, '#6a4aa8']]); c.fill();
    add(c); A.coreGlow(c, 0, y - 24, 16, '#c08aff', '#ffffff'); normal(c);
    if (lv >= 1) { add(c); A.rays(c, 0, y - 24, 6, 50, 8, '#d8b8ff', 0.5, 0.2, 0.05); normal(c); }
    // 鎖鏈（150）與光環
    if (lv >= 2) {
      add(c); A.ringGlow(c, 0, -8, 82, 2.6, '#ffd36a', 0.85); normal(c);
      for (i = 0; i < 16; i++) { var ca = i * TAU / 16; c.save(); c.translate(Math.cos(ca) * 82, -8 + Math.sin(ca) * 82); c.rotate(ca + Math.PI / 2); c.beginPath(); c.ellipse(0, 0, i % 2 ? 2.6 : 4.4, i % 2 ? 4.4 : 2.6, 0, 0, TAU); c.strokeStyle = '#ffe9a6'; c.lineWidth = 1.6; c.stroke(); c.restore(); }
    }
    A.motes(c, R, 14, [-88, -88, 88, 60], ['#c08aff', '#ffffff', '#ff6a6a'], 0.8, 2, 90);
  };
  A.overlays.towerFloor = function (c, s) { A.banner(c, String(s.n), 0, 91, 40, 24, '#3a2060', 20); };

  /* ---------- 魔物威能：角魔骷髏＋地獄火 ---------- */
  function horn(c, side, x0, y0, x1, y1, bend, w, col) {
    c.save(); c.scale(side, 1);
    c.beginPath(); c.moveTo(x0, y0 - w); c.quadraticCurveTo(x0 + bend, y0 - w * 0.2, x1, y1); c.quadraticCurveTo(x0 + bend * 0.5, y0 + w * 1.2, x0, y0 + w); c.closePath();
    c.fillStyle = lin(c, x0, y0, x1, y1, [[0, '#2a1a14'], [0.5, '#7a5a40'], [1, '#e8d8b8']]); c.fill();
    c.strokeStyle = rgba(col, 0.85); c.lineWidth = 1.5; c.stroke();
    c.beginPath(); c.moveTo(x0 + 4, y0 - w * 0.4); c.quadraticCurveTo(x0 + bend * 0.9, y0 - w * 0.3, x1 - 3, y1 + 2); c.strokeStyle = 'rgba(255,240,210,0.5)'; c.lineWidth = 1.2; c.stroke();
    c.restore();
  }
  M.monsterPower = function (c, s, R) {
    var lv = s.lv, i, fire = lv ? '#c02aff' : '#ff4a1a';
    add(c); glowDot(c, 0, 0, 104, lv ? '#ff2a4a' : '#ff3a2a', 0.5); normal(c);
    if (lv) { A.rays(c, 0, -10, 40, 104, 14, '#ff6a8a', 0.3, 0.1, 0.05); }
    // 地獄火
    A.flame(c, -60, 88, 52, lv ? 120 : 84, lv ? '#ff2a4a' : '#ff6a1a', 61, '#ffd0a0'); A.flame(c, 60, 88, 52, lv ? 120 : 84, lv ? '#ff2a4a' : '#ff6a1a', 62, '#ffd0a0');
    if (lv) { A.flame(c, -30, 90, 40, 90, '#c02aff', 63, '#ffd0ff'); A.flame(c, 30, 90, 40, 90, '#c02aff', 64, '#ffd0ff'); }
    A.flame(c, -78, 40, 30, 54, lv ? '#ff2a4a' : '#ff5a1a', 65, '#ffe0b0'); A.flame(c, 78, 40, 30, 54, lv ? '#ff2a4a' : '#ff5a1a', 66, '#ffe0b0');
    // 角
    horn(c, -1, 28, -34, 62, -72, 26, 15, '#ff9a6a'); horn(c, 1, 28, -34, 62, -72, 26, 15, '#ff9a6a');
    if (lv) { horn(c, -1, 38, -6, 76, -26, 22, 10, '#ff9a6a'); horn(c, 1, 38, -6, 76, -26, 22, 10, '#ff9a6a'); }
    // 顱骨
    c.save(); c.translate(0, 8); c.scale(1.12, 1.12);
    c.beginPath(); c.moveTo(-40, -22); c.quadraticCurveTo(-42, -66, 0, -68); c.quadraticCurveTo(42, -66, 40, -22); c.quadraticCurveTo(40, 4, 28, 14); c.lineTo(26, 26); c.lineTo(-26, 26); c.lineTo(-28, 14); c.quadraticCurveTo(-40, 4, -40, -22); c.closePath();
    c.fillStyle = A.rad(c, -10, -34, 4, 80, [[0, '#f4e8d0'], [0.5, '#a89270'], [1, '#2a2018']]); c.fill();
    c.strokeStyle = rgba('#ff6a4a', 0.9); c.lineWidth = 2; c.stroke();
    // 裂紋
    c.strokeStyle = 'rgba(40,20,10,0.6)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(6, -66); c.lineTo(10, -50); c.lineTo(4, -42); c.stroke();
    // 眼窩
    [-1, 1].forEach(function (k) {
      c.beginPath(); c.moveTo(k * 8, -22); c.lineTo(k * 34, -32); c.lineTo(k * 34, -10); c.lineTo(k * 18, -4); c.closePath(); c.fillStyle = '#080205'; c.fill();
      add(c); glowDot(c, k * 24, -20, 20, lv ? '#ff2a6a' : '#ff3a1a', 0.9);
      c.fillStyle = '#ffe0c0'; c.beginPath(); c.moveTo(k * 16, -20); c.lineTo(k * 30, -26); c.lineTo(k * 28, -17); c.closePath(); c.fill(); normal(c);
    });
    // 鼻
    c.beginPath(); c.moveTo(0, -6); c.lineTo(7, 8); c.lineTo(-7, 8); c.closePath(); c.fillStyle = '#080205'; c.fill();
    // 牙
    c.fillStyle = '#05010a'; c.fillRect(-24, 14, 48, 12);
    c.fillStyle = '#f0e4cc';
    for (i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-24 + i * 8, 14); c.lineTo(-16 + i * 8, 14); c.lineTo(-20 + i * 8, i % 2 ? 26 : 22); c.closePath(); c.fill(); }
    if (lv) { // 第三隻眼
      add(c); glowDot(c, 0, -46, 20, '#ff2a6a', 0.9); c.fillStyle = '#ffd0e0'; c.beginPath(); c.moveTo(0, -56); c.lineTo(5, -46); c.lineTo(0, -36); c.lineTo(-5, -46); c.closePath(); c.fill(); normal(c);
    }
    c.restore();
    if (lv) { for (i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-30 + i * 15, -70); c.lineTo(-24 + i * 15, -96 + Math.abs(i - 2) * 6); c.lineTo(-18 + i * 15, -70); c.closePath(); c.fillStyle = rgba('#ff3a5a', 0.75); c.fill(); } }
    A.motes(c, R, 18, [-88, -88, 88, 88], [fire, '#ffcf70', '#ffffff'], 0.8, 2, 90);
  };
  A.overlays.monsterPower = function (c, s) { A.banner(c, s.n + '%', 0, 91, 44, 24, '#5a0a0a', 18); };
})();
