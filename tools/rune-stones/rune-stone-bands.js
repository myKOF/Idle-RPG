/* 符文石：6 個色帶各一塊簡單、圓潤、像真的石頭（卵石／石板），只靠石色、溝槽礦脈的顏色與極小的點綴區分。
 * 共用工具在 rune-stone-painter.js 的 kit。每個建構函式回傳
 *   { band, M(材質緩衝), glyph(字形位置與刻法), light(光照), veinK/bloomK(礦脈強度), back(背景層), front(前景點綴), ... }
 */
(function (root) {
  'use strict';
  var C = root.RSCore, N = C.N, NN = C.NN, K = C.K, P = root.RuneStonePainter, kit = P.kit;
  var clamp = C.clamp, smoothstep = C.smoothstep, lerp = C.lerp, rr = C.rr, hex01 = C.hex01;
  var PI = Math.PI, TAU = PI * 2;
  var makeStone = kit.makeStone, bloomFromEmi = kit.bloomFromEmi, buildBack = kit.buildBack;

  /* ---------- 輪廓：平滑、圓潤，只有真石頭那種輕微不對稱 ---------- */
  function eggPts(cx, cy, rx, ry, n, sx, sy, tilt) {
    var pts = [], c = Math.cos(tilt || 0), s = Math.sin(tilt || 0);
    for (var k = 0; k < n; k++) {
      var a = k / n * TAU, x = rx * Math.cos(a) * (1 + (sx || 0) * Math.sin(a)), y = ry * Math.sin(a) * (1 + (sy || 0) * Math.cos(a));
      pts.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return pts;
  }
  /* 倒圓角多邊形：每個轉角用二次貝茲取樣（rs 可為數字或每頂點半徑） */
  function roundedPoly(pts, rs) {
    var n = pts.length, out = [];
    for (var i = 0; i < n; i++) {
      var V = pts[i], A = pts[(i + n - 1) % n], B = pts[(i + 1) % n], r = Array.isArray(rs) ? rs[i] : rs;
      var la = Math.hypot(A[0] - V[0], A[1] - V[1]), lb = Math.hypot(B[0] - V[0], B[1] - V[1]);
      var ra = Math.min(r, la * 0.46), rb = Math.min(r, lb * 0.46);
      var p0 = [V[0] + (A[0] - V[0]) / la * ra, V[1] + (A[1] - V[1]) / la * ra], p2 = [V[0] + (B[0] - V[0]) / lb * rb, V[1] + (B[1] - V[1]) / lb * rb];
      for (var t = 0; t <= 10; t++) {
        var u = t / 10, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        out.push([w0 * p0[0] + w1 * V[0] + w2 * p2[0], w0 * p0[1] + w1 * V[1] + w2 * p2[1]]);
      }
    }
    return out;
  }
  function archPts(cx, top, bottom, hw, rc) {
    var pts = [], cy = top + hw, a;
    for (a = PI; a <= TAU + 1e-6; a += PI / 40) pts.push([cx + hw * Math.cos(a), cy + hw * Math.sin(a)]);
    for (a = 0; a <= PI / 2 + 1e-6; a += PI / 16) pts.push([cx + hw - rc + rc * Math.cos(a), bottom - rc + rc * Math.sin(a)]);
    for (a = PI / 2; a <= PI + 1e-6; a += PI / 16) pts.push([cx - hw + rc + rc * Math.cos(a), bottom - rc + rc * Math.sin(a)]);
    return pts;
  }
  /* 沿質心徑向的低頻起伏：真實石頭不會是完美幾何 */
  function wobble(pts, amp, seed) {
    var cx = 0, cy = 0, i;
    for (i = 0; i < pts.length; i++) { cx += pts[i][0]; cy += pts[i][1]; }
    cx /= pts.length; cy /= pts.length;
    return pts.map(function (p) {
      var a = Math.atan2(p[1] - cy, p[0] - cx), d = C.vn(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, seed) * amp * 1.6;
      var dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1;
      return [p[0] + dx / l * d, p[1] + dy / l * d];
    });
  }

  /* 共用的點綴工具 */
  function spark(c, x, y, r, rgb, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, r * 4);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 4, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.arc(x, y, r * 0.55, 0, TAU); c.fill();
  }

  /* ============================================================
   *  灰：扁寬橢圓花崗岩河石（最樸素：不發光、無點綴）
   * ============================================================ */
  function bandGray(band) {
    var outline = wobble(eggPts(128, 130, 106, 73, 96, 0.05, 0.07, -0.05), 1.0, 11);
    var S = makeStone({
      seed: 100, outline: outline, bw: 100, hb: 22, dome: 10, noise: [1.6, 0.9, 0.35], pitDepth: 0.9,
      ramp: C.ramp([[0, '#46474c'], [0.45, '#80808a'], [0.78, '#b2b0ac'], [1, '#dedcd6']]), speck: [0.5, 0.6], albK: 1.5, speckDens: 1.7
    });
    var B = {
      band: band, M: S.M, glyph: { cx: 128, cy: 130, H: 88, W: 104, extra: 7, depth: 10, wallW: 11, jit: 1.3, dark: 0.74, seed: 101 },
      light: { amb: [0.34, 0.37, 0.46], key: [1.3, 1.2, 1.05], bump: 1.4, aoK: 1.0, rimK: 0.35, wallK: 1.0 },
      veinK: 0.06, veinLight: 0.6, bloomK: 0.4, auraK: 0.2, sideTop: '#6c6c70', sideBot: '#1e1f23', thick: 12, ox: -1, oy: -2, expo: 1.3
    };
    B.back = buildBack(B);
    return B;
  }

  /* ============================================================
   *  綠：直立蛋形卵石（灰綠石材，底部一小撮苔蘚加兩片小葉）
   * ============================================================ */
  function bandGreen(band) {
    var outline = wobble(eggPts(128, 128, 78, 106, 96, 0.1, 0.03, 0.04), 0.9, 21);
    var S = makeStone({
      seed: 200, outline: outline, bw: 90, hb: 22, dome: 10, noise: [1.5, 0.9, 0.35], pitDepth: 0.8,
      ramp: C.ramp([[0, '#27322d'], [0.45, '#4c5b50'], [0.78, '#7b8c7a'], [1, '#aebcac']]), speck: [0.4, 0.5]
    });
    var M = S.M, tuft = C.worley(231, 11), nm = C.fbm(233, 12, 3, 0.5, 0), moss = C.ramp([[0, '#16280f'], [0.4, '#2b551d'], [0.75, '#52832f'], [1, '#8fb455']]);
    /* 底部一小撮苔蘚（留在輪廓內，不改剪影） */
    var mcov = C.F(), i;
    for (i = 0; i < NN; i++) {
      var x = (i % N) / K, y = ((i / N) | 0) / K, d = Math.hypot((x - 108) * 0.85, (y - 212) * 1.25) / 36;
      mcov[i] = smoothstep(0, 0.35, 1 - d + nm[i] * 0.22) * smoothstep(5, 18, S.dIn[i]);
    }
    M.paint(mcov, function (j, o) {
      var dome = 1 - tuft.f1[j] * 0.9;
      o.h += 3 + dome * 3.6 + nm[j] * 0.8;
      var t = clamp(0.25 + dome * 0.5 + nm[j] * 0.2, 0, 1), li = (t * 255) | 0;
      o.r = moss[li * 3]; o.g = moss[li * 3 + 1]; o.b = moss[li * 3 + 2]; o.spec = 0.05; o.gloss = 8;
    });
    /* 兩片小葉 */
    function leaf(cx, cy, len, wd, rot) {
      return C.rasterAlpha(function (c) {
        c.translate(cx, cy); c.rotate(rot); c.fillStyle = '#000';
        c.beginPath(); c.moveTo(-len / 2, 0); c.quadraticCurveTo(0, -wd, len / 2, 0); c.quadraticCurveTo(0, wd, -len / 2, 0); c.fill();
      });
    }
    [[148, 214, 28, 9, -0.35], [162, 202, 22, 7.5, 0.5]].forEach(function (L, k) {
      var lc = leaf(L[0], L[1], L[2], L[3], L[4]), lg = C.gauss(lc, 2.2);
      for (var q = 0; q < NN; q++) lc[q] *= smoothstep(2, 12, S.dIn[q]);
      M.paint(lc, function (j, o) {
        o.h += 2.5 + lg[j] * 4;
        var t = clamp(0.5 + lg[j] * 0.5 + (k ? 0.1 : 0), 0, 1), li = (t * 255) | 0;
        o.r = moss[li * 3] * 0.95; o.g = moss[li * 3 + 1]; o.b = moss[li * 3 + 2] * 0.9; o.spec = 0.18; o.gloss = 20;
      });
    });
    smoothH(M, 0.6);
    var B = {
      band: band, M: M, glyph: { cx: 128, cy: 130, H: 116, W: 88, extra: 9, depth: 10, wallW: 11, jit: 1.3, dark: 0.5, seed: 201 },
      light: { amb: [0.30, 0.38, 0.40], key: [1.3, 1.2, 1.02], bump: 1.4, aoK: 1.1, rimK: 0.5, wallK: 1.3 },
      veinK: 0.85, bloomK: 0.5, auraK: 0.3, sideTop: '#4a574d', sideBot: '#101512', thick: 12, ox: -1, oy: -2, expo: 1.3
    };
    B.back = buildBack(B);
    return B;
  }
  var smoothH = kit.smoothH;

  /* ---------- 粗切石塊（low-poly）：不規則 7～8 邊、大而平的主面、四周平面刻面倒角 ---------- */
  function polyCentroid(pts) {
    var a = 0, cx = 0, cy = 0, n = pts.length;
    for (var i = 0; i < n; i++) { var p = pts[i], q = pts[(i + 1) % n], cr = p[0] * q[1] - q[0] * p[1]; a += cr; cx += (p[0] + q[0]) * cr; cy += (p[1] + q[1]) * cr; }
    return [cx / (3 * a), cy / (3 * a)];
  }
  function polyBox(pts) {
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    return { w: x1 - x0, h: y1 - y0, x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  /* 第 i 條邊上 t 位置、往內 inset 的點 */
  function edgePoint(P, i, t, inset) {
    var n = P.length, a = P[i], b = P[(i + 1) % n], area = 0, k;
    for (k = 0; k < n; k++) area += P[k][0] * P[(k + 1) % n][1] - P[(k + 1) % n][0] * P[k][1];
    var sg = area > 0 ? 1 : -1, ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
    return [a[0] + ex * t - ey / l * sg * inset, a[1] + ey * t + ex / l * sg * inset];
  }
  function lowPoly(P, widths, seed, opts) {
    var o = { seed: seed, outline: wobble(roundedPoly(P, 3.5), 0.4, seed), chamfer: { poly: P, widths: widths } }, k;
    for (k in opts) o[k] = opts[k];
    var S = makeStone(o), Q = C.insetPoly(P, widths);
    return { S: S, Q: Q, box: polyBox(Q), c: polyCentroid(Q), P: P };
  }

  /* ============================================================
   *  藍：偏高瘦、略向右傾斜的七邊形立石（青灰板岩，上緣一點霜晶反光）
   * ============================================================ */
  function bandBlue(band) {
    var L = lowPoly([[110, 18], [180, 44], [204, 118], [172, 228], [88, 234], [52, 150], [66, 62]], [17, 15, 20, 18, 13, 19, 22], 300, {
      hb: 32, noise: [1.1, 0.8, 0.3], pitDepth: 0.7, strata: 0.05,
      ramp: C.ramp([[0, '#202938'], [0.45, '#43506a'], [0.78, '#74839d'], [1, '#a9b6cb']]), speck: [0.35, 0.5]
    });
    var S = L.S, M = S.M, nf = C.fbm(331, 30, 3, 0.5, 0), hf = C.fbm(333, 120, 2, 0.5, 0), ymin = N, i;
    for (i = 0; i < NN; i++) if (S.cov[i] > 0.5) { var yy = (i / N) | 0; if (yy < ymin) ymin = yy; }
    /* 上緣的霜晶 */
    var fcov = C.F();
    for (i = 0; i < NN; i++) {
      var yp = (i / N) | 0, wTop = clamp(1 - (yp - ymin) / 130, 0, 1);
      fcov[i] = smoothstep(0.4, 0.8, nf[i] * 0.4 + wTop * wTop * 0.85 * Math.exp(-S.dIn[i] / 70)) * smoothstep(2, 9, S.dIn[i]);
    }
    M.paint(fcov, function (j, o) {
      o.h += 0.8 + hf[j] * 0.5;
      var k = 0.62 + hf[j] * 0.1;
      o.r += (0.82 - o.r) * k; o.g += (0.93 - o.g) * k; o.b += (1.0 - o.b) * k;
      o.spec = 0.7; o.gloss = 50;
    });
    smoothH(M, 0.5);
    var B = {
      band: band, M: M, glyph: { cx: L.c[0], cy: L.c[1], H: L.box.h * 0.6, W: L.box.w * 0.88, extra: 6, depth: 10, wallW: 11, jit: 1.3, dark: 0.5, seed: 301 },
      light: { amb: [0.31, 0.36, 0.47], key: [1.3, 1.18, 1.02], bump: 1.3, aoK: 1.1, rimK: 0.4, wallK: 1.3 },
      veinK: 0.85, bloomK: 0.5, auraK: 0.3, sideTop: '#4a5568', sideBot: '#11151c', thick: 16, ox: -1, oy: -1, expo: 1.3
    };
    B.back = buildBack(B);
    var sp = [edgePoint(L.P, 0, 0.3, 6), edgePoint(L.P, 6, 0.55, 6), edgePoint(L.P, 1, 0.45, 6)];
    B.front = function (c) { spark(c, sp[0][0], sp[0][1], 3.2, '200,235,255', 0.5); spark(c, sp[1][0], sp[1][1], 2.4, '200,235,255', 0.45); spark(c, sp[2][0], sp[2][1], 1.8, '220,242,255', 0.4); };
    return B;
  }

  /* ============================================================
   *  紫：圓角六邊的寶石切面卵石（石面嵌幾粒與表面齊平的紫晶碎粒）
   * ============================================================ */
  function bandPurple(band) {
    var radii = [106, 104, 107, 105, 106, 104], hex = [], k;
    for (k = 0; k < 6; k++) { var a = -PI / 2 + k * PI / 3; hex.push([128 + radii[k] * Math.cos(a), 128 + radii[k] * Math.sin(a)]); }
    var outline = wobble(roundedPoly(hex, 36), 0.8, 41);
    var facets = []; for (k = 0; k < 6; k++) { var a2 = -PI / 2 + k * PI / 3; facets.push([128 + 100 * Math.cos(a2), 128 + 100 * Math.sin(a2)]); }
    var S = makeStone({
      seed: 400, outline: outline, facets: facets, bw: 100, hb: 34, dome: 0, facetSoft: 3, albK: 1.1, lowK: 0.35, speckDens: 1.8, wear: { sigma: 3, k: 0.25, tint: '#e6dff0', amount: 0.14 }, noise: [1.2, 0.8, 0.3], pitDepth: 0.7,
      ramp: C.ramp([[0, '#2a2034'], [0.45, '#4b3d5d'], [0.78, '#76678f'], [1, '#a999c1']]), speck: [0.35, 0.5]
    });
    var M = S.M, ame = C.ramp([[0, '#2a1250'], [0.45, '#7a3cd8'], [1, '#e2c4ff']]);
    /* 紫晶碎粒：小六角、與石面齊平，每個刻面一個覆寫法線（亮暗不同） */
    [[72, 84, 8, 0.2], [88, 70, 5, 0.9], [60, 102, 4, 0.5], [190, 180, 9, 0.1], [174, 196, 5, 0.7], [206, 160, 4, 0.3], [200, 92, 6, 0.6], [58, 178, 5, 0.4], [124, 210, 4.5, 0.8]].forEach(function (g, gi) {
      var cx = g[0], cy = g[1], r = g[2], rot = g[3];
      var cov = C.rasterAlpha(function (c) {
        c.fillStyle = '#000'; c.beginPath();
        for (var q = 0; q < 6; q++) { var an = rot + q * PI / 3; c[q ? 'lineTo' : 'moveTo'](cx + Math.cos(an) * r, cy + Math.sin(an) * r); }
        c.closePath(); c.fill();
      });
      var sock = C.gauss(cov, 2.2);
      for (var q2 = 0; q2 < NN; q2++) sock[q2] = Math.min(1, sock[q2] * 2.2) * (1 - cov[q2]) + cov[q2];
      M.paint(sock, function (j, o) { o.h -= 0.5; o.r *= 0.45; o.g *= 0.42; o.b *= 0.5; });
      M.paint(cov, function (j, o) {
        var px = (j % N) / K - cx, py = ((j / N) | 0) / K - cy, an = Math.atan2(py, px) - rot, sec = Math.floor(((an % TAU) + TAU) % TAU / (PI / 3)), mid = rot + (sec + 0.5) * PI / 3;
        var rd = Math.hypot(px, py) / r, tilt = 0.4 * rd;
        var nx = Math.cos(mid) * tilt, ny = Math.sin(mid) * tilt, nz = Math.sqrt(Math.max(0.2, 1 - nx * nx - ny * ny));
        var br = 0.55 + 0.45 * ((sec * 0.37 + gi * 0.21) % 1);
        var li = (clamp(br * (1.1 - 0.4 * rd), 0, 1) * 255) | 0;
        o.h += 0.5; o.r = ame[li * 3]; o.g = ame[li * 3 + 1]; o.b = ame[li * 3 + 2];
        o.spec = 1.0; o.gloss = 80; o.ow = 1; o.nx = nx; o.ny = ny; o.nz = nz;
        o.er = 0.18 * br; o.eg = 0.07 * br; o.eb = 0.3 * br;
      });
    });
    var B = {
      band: band, M: M, glyph: { cx: 128, cy: 130, H: 108, W: 92, extra: 9, depth: 10, wallW: 11, jit: 1.3, dark: 0.5, seed: 401 },
      light: { amb: [0.30, 0.27, 0.46], key: [1.3, 1.18, 1.05], bump: 1.4, aoK: 1.1, rimK: 0.25, wallK: 1.3 },
      veinK: 1.2, veinLight: 0.04, bloomK: 0.55, auraK: 0.3, sideTop: '#4d4260', sideBot: '#120e1a', thick: 12, ox: -1, oy: -1, expo: 1.3
    };
    B.staticBloom = bloomFromEmi(M.emi, 3, 0.7, 8, 0.35);
    B.back = buildBack(B);
    return B;
  }

  /* ============================================================
   *  橘：偏寬的八邊形不規則石塊（暗紅褐玄武岩，溝槽像餘燼，石面零星火星）
   * ============================================================ */
  function bandOrange(band) {
    var L = lowPoly([[60, 66], [132, 36], [206, 50], [232, 110], [214, 186], [150, 214], [66, 194], [26, 140]], [14, 19, 16, 21, 17, 13, 20, 16], 500, {
      hb: 30, noise: [1.3, 0.9, 0.35], pitDepth: 1.3, albK: 1.4, speckDens: 1.6,
      ramp: C.ramp([[0, '#1c0e0c'], [0.45, '#44261f'], [0.78, '#6e4234'], [1, '#9a6a55']]), speck: [0.4, 0.45]
    });
    var S = L.S, M = S.M, Rn = C.mulberry32(551), pts = [], k, gx = L.c[0], gy = L.c[1], gh = L.box.h * 0.68, gw = L.box.w * 0.62;
    /* 石面零星幾粒火星（平貼在主面上的小亮點，避開字形範圍） */
    var tries = 0;
    while (pts.length < 9 && tries++ < 200) {
      var px = rr(Rn, L.box.x0 + 8, L.box.x1 - 8), py = rr(Rn, L.box.y0 + 8, L.box.y1 - 8), rad = rr(Rn, 1.0, 1.9);
      if (Math.abs(px - gx) < gw / 2 + 8 && Math.abs(py - gy) < gh / 2 + 8) continue;
      pts.push([px, py, rad]);
    }
    var sp = C.rasterAlpha(function (c) { c.fillStyle = '#000'; pts.forEach(function (p) { c.beginPath(); c.arc(p[0], p[1], p[2], 0, TAU); c.fill(); }); });
    for (k = 0; k < NN; k++) sp[k] *= smoothstep(4, 14, S.chd.fd[k] + 40);
    var spg = C.gauss(sp, 1.0);
    M.paint(sp, function (j, o) { o.h -= 0.4; o.er += 1.6 * spg[j] * 2.2; o.eg += 0.65 * spg[j] * 2.2; o.eb += 0.12 * spg[j] * 2.2; o.r = 0.9; o.g = 0.5; o.b = 0.2; });
    var B = {
      band: band, M: M, glyph: { cx: gx, cy: gy, H: gh, W: L.box.w * 0.78, extra: 7, depth: 10, wallW: 11, jit: 1.3, dark: 0.55, seed: 501 },
      light: { amb: [0.32, 0.26, 0.26], key: [1.35, 1.12, 0.92], bump: 1.3, aoK: 1.1, rimK: 0.55, wallK: 1.3 },
      veinK: 1.2, veinRamp: ['#8a2010', '#ff8020', '#ffd080'], bloomK: 0.55, auraK: 0.32, sideTop: '#4a2c26', sideBot: '#100807', thick: 16, ox: -5, oy: -1, expo: 1.3
    };
    B.staticBloom = bloomFromEmi(M.emi, 3, 0.9, 9, 0.45);
    B.back = buildBack(B);
    return B;
  }

  /* ============================================================
   *  金：最大的粗切石塊，接近方正的不規則八邊形，倒角最寬最工整
   *  （近黑深色石帶細金屑，主面外緣內縮一圈極細的金屬刻線鑲嵌）
   * ============================================================ */
  function bandGold(band) {
    var L = lowPoly([[82, 20], [138, 12], [216, 40], [240, 124], [214, 220], [112, 244], [34, 208], [16, 94]], [26, 25, 27, 24, 26, 25, 27, 25], 600, {
      hb: 34, noise: [0.9, 0.7, 0.3], pitDepth: 0.6, spec: 0.28, gloss: 28,
      ramp: C.ramp([[0, '#121115'], [0.45, '#27242a'], [0.78, '#3e3a44'], [1, '#5b5762']]), speck: [0.3, 0.4]
    });
    var S = L.S, M = S.M, gf = C.worley(631, 9), ring = C.F(), i;
    for (i = 0; i < NN; i++) { var fd = S.chd.fd[i]; ring[i] = Math.exp(-Math.pow((fd - 12) / 1.8, 2)) * (fd > 4 ? 1 : 0) * S.cov[i]; }
    var gold = C.ramp([[0, '#7a5214'], [0.5, '#d9a430'], [1, '#fff0b0']]);
    M.paint(ring, function (j, o) {
      o.h -= 1.4; var t = clamp(0.5 + S.n2[j] * 0.3, 0, 1), li = (t * 255) | 0;
      o.r = gold[li * 3]; o.g = gold[li * 3 + 1]; o.b = gold[li * 3 + 2]; o.metal = 0.95; o.spec = 0.9; o.gloss = 70;
    });
    var fl = C.F();
    for (i = 0; i < NN; i++) fl[i] = gf.id[i] > 0.95 ? (1 - smoothstep(0.05, 0.16, gf.f1[i])) * smoothstep(1, 6, S.dIn[i]) : 0;
    M.paint(fl, function (j, o) {
      var t = clamp(0.55 + gf.id[j] * 0.4, 0, 1), li = (t * 255) | 0;
      o.r = gold[li * 3]; o.g = gold[li * 3 + 1]; o.b = gold[li * 3 + 2]; o.metal = 0.9; o.spec = 1.0; o.gloss = 60;
    });
    var B = {
      band: band, M: M, glyph: { cx: L.c[0], cy: L.c[1], H: L.box.h * 0.62, W: L.box.w * 0.7, extra: 7, depth: 10, wallW: 11, jit: 1.3, dark: 0.6, seed: 601 },
      light: { amb: [0.34, 0.30, 0.30], key: [1.35, 1.2, 1.0], bump: 1.3, aoK: 1.1, rimK: 0.5, wallK: 1.3, metalGain: 1.5 },
      veinK: 1.35, veinRamp: ['#7a4e12', '#eab032', '#fff0b0'], bloomK: 0.55, auraK: 0.4, sideTop: '#4a3c20', sideBot: '#0c0905', thick: 16, ox: -1, oy: -1, expo: 1.3
    };
    B.back = buildBack(B);
    return B;
  }

  P.register(0, bandGray);
  P.register(1, bandGreen);
  P.register(2, bandBlue);
  P.register(3, bandPurple);
  P.register(4, bandOrange);
  P.register(5, bandGold);
})(typeof window !== 'undefined' ? window : this);
