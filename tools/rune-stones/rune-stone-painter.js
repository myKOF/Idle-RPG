/* 符文石（符文真言的符文圖示）程序化渲染——預覽用，尚未整合進遊戲。
 *
 * 「高度圖＋逐像素光照」管線（見 rune-stone-core.js）：每個色帶先建好一塊簡單的石頭（輪廓、微凸圓頂的高度、
 * 反照率、光澤），每顆符文再把字形「鑿」進同一張高度圖：V／U 形溝槽、筆畫寬度帶不規則、
 * 溝槽內保有石材顆粒，然後用同一套光照（光源左上）重算法線、環境遮蔽與自我陰影，
 * 品質色只以「嵌在溝槽底部的礦脈」形式出現。
 *
 * 畫風只參考過外部截圖的「簡單石頭＋刻痕」概念；所有形狀、紋理、光照都是自己程序化算出來的：
 * 沒有描圖、沒有取樣任何像素（見 AI_RULES.md 第二原則）。
 *
 *   RuneStonePainter.paint(band, glyph, color, size) → canvas
 *   RuneStonePainter.paintRuneStone(ctx, size, band, glyph, color)
 */
(function (root) {
  'use strict';

  var C = root.RSCore, N = C.N, NN = C.NN, K = C.K;
  var clamp = C.clamp, smoothstep = C.smoothstep, lerp = C.lerp, hex01 = C.hex01, mix3 = C.mix3;
  var PI = Math.PI, TAU = PI * 2;
  var FONT = "'Segoe UI Historic','Segoe UI Symbol','Noto Sans Runic',serif";
  var DEFAULT_COLORS = ['#9aa5b1', '#4ade80', '#38bdf8', '#c084fc', '#fb923c', '#f5c542'];

  /* ============================================================
   *  字形
   * ============================================================ */
  var measureCtx = null, metricCache = {};
  function glyphMetrics(glyph) {
    if (metricCache[glyph]) return metricCache[glyph];
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    var c = measureCtx; c.font = '100px ' + FONT; c.textBaseline = 'alphabetic'; c.textAlign = 'left';
    var m = c.measureText(glyph);
    return (metricCache[glyph] = { l: -m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, t: -m.actualBoundingBoxAscent, b: m.actualBoundingBoxDescent });
  }
  function drawGlyph(c, glyph, sp) {
    var g = glyphMetrics(glyph), w = g.r - g.l, h = g.b - g.t, k = Math.min(sp.H / h, sp.W / w);
    c.translate(sp.cx, sp.cy); c.scale(k, k); c.translate(-(g.l + g.r) / 2, -(g.t + g.b) / 2);
    c.font = '100px ' + FONT; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.lineJoin = 'round'; c.lineCap = 'round';
    c.fillStyle = '#fff'; c.fillText(glyph, 0, 0);
    if (sp.extra > 0) { c.lineWidth = sp.extra / k; c.strokeStyle = '#fff'; c.strokeText(glyph, 0, 0); }
  }

  /* ============================================================
   *  共用工具
   * ============================================================ */
  /* 邊緣磨損：凸起處（高度高於模糊後的高度）反照率變亮 */
  function wearPass(M, sigma, k, tint, amount) {
    var hb = C.gauss(M.H, sigma), t = hex01(tint);
    for (var i = 0; i < NN; i++) {
      if (M.cov[i] < 0.01) continue;
      var w = clamp((M.H[i] - hb[i]) * k, 0, 1) * amount;
      if (w > 0) for (var c = 0; c < 3; c++) M.alb[i * 3 + c] += (t[c] - M.alb[i * 3 + c]) * w;
    }
  }
  function smoothH(M, sigma) { M.H = C.gauss(M.H, sigma); }

  /* 靜態自發光（火星等）的 bloom：回傳 rgb 交錯陣列 */
  function bloomFromEmi(emi, s1, w1, s2, w2) {
    var out = C.F3(), ch = C.F();
    for (var c = 0; c < 3; c++) {
      var i;
      for (i = 0; i < NN; i++) ch[i] = emi[i * 3 + c];
      var a = C.gauss(ch, s1), b = C.gauss(ch, s2);
      for (i = 0; i < NN; i++) out[i * 3 + c] = a[i] * w1 + b[i] * w2;
    }
    return out;
  }

  function alphaCanvas(arr, rgb) {
    var cv = document.createElement('canvas'); cv.width = cv.height = N;
    var x = cv.getContext('2d'), img = x.createImageData(N, N), d = img.data, r = rgb[0] * 255, g = rgb[1] * 255, b = rgb[2] * 255;
    for (var i = 0, j = 0; i < NN; i++, j += 4) { d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = clamp(arr[i], 0, 1) * 255; }
    x.putImageData(img, 0, 0);
    return cv;
  }

  /* 凸多邊形的刻面距離：每個像素到「最近一條邊」的內側距離（像素），做寶石切面用（座標單位 256） */
  function convexFacetDist(poly) {
    var n = poly.length, area = 0, i, e = [];
    for (i = 0; i < n; i++) { var a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var sg = area > 0 ? 1 : -1;
    for (i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey);
      e.push({ px: p[0], py: p[1], nx: -ey / l * sg, ny: ex / l * sg });
    }
    var out = C.F();
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var ux = x / K, uy = y / K, best = 1e9;
      for (i = 0; i < n; i++) { var d = ((ux - e[i].px) * e[i].nx + (uy - e[i].py) * e[i].ny) * K; if (d < best) best = d; }
      out[y * N + x] = best;
    }
    return out;
  }

  /* 平面倒角場（凸多邊形，粗切石塊的 low-poly 倒角）：
     每條邊各自一個傾斜平面。t＝min_i(d_i / w_i)（≥1 即進入主面）、fd＝min_i(d_i − w_i)（主面內到倒角邊緣的距離，像素）。
     poly 座標單位 256，widths 為各邊倒角寬度（256 單位）。 */
  function chamferField(poly, widths) {
    var n = poly.length, area = 0, i, e = [];
    for (i = 0; i < n; i++) { var a = poly[i], b = poly[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var sg = area > 0 ? 1 : -1;
    for (i = 0; i < n; i++) {
      var p = poly[i], q = poly[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey);
      e.push({ px: p[0], py: p[1], nx: -ey / l * sg, ny: ex / l * sg, w: widths[i] * K });
    }
    var t = C.F(), fd = C.F();
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var ux = x / K, uy = y / K, bt = 1e9, bf = 1e9;
      for (i = 0; i < n; i++) {
        var d = ((ux - e[i].px) * e[i].nx + (uy - e[i].py) * e[i].ny) * K, r = d / e[i].w, f = d - e[i].w;
        if (r < bt) bt = r; if (f < bf) bf = f;
      }
      t[y * N + x] = bt; fd[y * N + x] = bf;
    }
    return { t: t, fd: fd };
  }

  /* 背景層：很淡的品質色邊緣光、接地陰影、投影、右下可見的側面厚度 */
  function buildBack(B) {
    var cv = document.createElement('canvas'); cv.width = cv.height = N;
    var x = cv.getContext('2d'), cov = B.M.cov, sideMask = B.sideMask || cov, i;
    var minx = N, maxx = 0, miny = N, maxy = 0;
    for (i = 0; i < NN; i++) if (sideMask[i] > 0.5) { var px = i % N, py = (i / N) | 0; if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py; }
    var a1 = C.gauss(cov, 16), aura = C.F();
    for (i = 0; i < NN; i++) aura[i] = clamp(a1[i] * B.auraK * 0.5, 0, 1);
    x.globalCompositeOperation = 'lighter';
    x.drawImage(alphaCanvas(aura, hex01(B.aura || DEFAULT_COLORS[B.band])), 0, 0);
    x.globalCompositeOperation = 'source-over';
    /* 接地陰影：貼地的橢圓 */
    var gw = (maxx - minx) * 0.5, gcx = (minx + maxx) / 2 + 10, gy = maxy - (maxy - miny) * 0.04;
    x.save(); x.filter = 'blur(11px)'; x.fillStyle = 'rgba(0,0,0,0.55)';
    x.beginPath(); x.ellipse(gcx, gy + 6, gw * 0.9, (maxy - miny) * 0.07 + 6, 0, 0, TAU); x.fill(); x.restore();
    /* 投影（往右下偏） */
    var mk = alphaCanvas(sideMask, [0, 0, 0]);
    x.save(); x.filter = 'blur(10px)'; x.globalAlpha = 0.4; x.drawImage(mk, 8, 12); x.restore();
    /* 厚度：重複位移的剪影，再上色與加顆粒 */
    var ex = document.createElement('canvas'); ex.width = ex.height = N;
    var e = ex.getContext('2d'), T = B.thick || 13;
    for (var k = T; k >= 1; k--) e.drawImage(mk, k * 0.62, k * 0.8);
    e.globalCompositeOperation = 'source-in';
    var g = e.createLinearGradient(80, 60, 420, 440);
    g.addColorStop(0, B.sideTop || '#4a4d58'); g.addColorStop(1, B.sideBot || '#14151a');
    e.fillStyle = g; e.fillRect(0, 0, N, N);
    e.globalCompositeOperation = 'source-atop';
    var gn = C.fbm(901, 60, 3, 0.5, 0), gl = C.F();
    for (var q = 0; q < NN; q++) gl[q] = clamp(Math.abs(gn[q]) * 0.7, 0, 1);
    e.drawImage(alphaCanvas(gl, [0, 0, 0]), 0, 0);
    x.drawImage(ex, 0, 0);
    return cv;
  }

  /* ============================================================
   *  石頭本體：微凸圓頂、圓滑磨損的邊緣、細緻顆粒（沒有凹陷、沒有崩缺）
   *  o：seed, outline(256 單位多邊形), bw 邊緣圓角寬(px), hb 邊緣圓角高, dome 中央圓頂高,
   *     noise [大, 中, 細] 高度起伏(px), pitDepth, ramp 反照率 LUT, strata 層理強度,
   *     facets 寶石切面多邊形（可選）, facetSoft, speck [暗, 亮] 斑點強度, wear
   * ============================================================ */
  function makeStone(o) {
    var M = new C.Mat(), sd = o.seed, i;
    var cov = C.rasterAlpha(function (c) { c.fillStyle = '#000'; C.fillPoly(c, o.outline); });
    var dIn = C.distIn(cov, 1.5), maxD = 1;
    for (i = 0; i < NN; i++) if (dIn[i] > maxD) maxD = dIn[i];
    var n1 = C.fbm(sd + 11, 4, 4, 0.5, 0.6), n2 = C.fbm(sd + 13, 18, 3, 0.5, 0), n3 = C.fbm(sd + 17, 70, 2, 0.5, 0);
    var spk = C.worley(sd + 19, 8), pit = C.worley(sd + 23, 26), grain = C.fbm(sd + 29, 150, 2, 0.5, 0);
    var facet = o.facets ? convexFacetDist(o.facets) : null, chd = o.chamfer ? chamferField(o.chamfer.poly, o.chamfer.widths) : null;
    var lowK = o.lowK === undefined ? 1 : o.lowK, albK = o.albK || 1, sdens = o.speckDens || 1, bw = o.bw, hb = o.hb, nz = o.noise, ramp = o.ramp, sp = o.speck || [0.35, 0.5], strata = o.strata || 0;
    M.paint(cov, function (j, p) {
      var edgeH;
      if (chd) edgeH = hb * Math.min(1, Math.max(0, chd.t[j]));
      else {
        var d = dIn[j]; if (facet) d = Math.min(facet[j], d * 1.3);
        var t = d <= 0 ? 0 : d >= bw ? 1 : d / bw;
        var circ = Math.sqrt(1 - (1 - t) * (1 - t));
        edgeH = hb * (facet ? 0.25 * circ + 0.75 * t : circ) + o.dome * Math.pow(dIn[j] / maxD, 0.85);
      }
      var h = edgeH + n1[j] * nz[0] + n2[j] * nz[1] + n3[j] * nz[2];
      var pk = pit.id[j] > 0.82 ? 1 - smoothstep(0.05, 0.18, pit.f1[j]) : 0;
      h -= pk * (o.pitDepth || 0.8);
      p.h = h;
      var y = (j / N) | 0;
      var v = clamp(0.5 + (n1[j] * 0.2 * lowK + n2[j] * 0.16 + n3[j] * 0.1) * albK + grain[j] * 0.05 + strata * Math.sin(y * 0.11 + n1[j] * 5), 0, 1), li = (v * 255) | 0;
      var r = ramp[li * 3], g = ramp[li * 3 + 1], b = ramp[li * 3 + 2];
      var sid = spk.id[j], sk = 1 - smoothstep(0.08, 0.2, spk.f1[j]);
      if (sid > 1 - 0.1 * sdens) { var kd = sk * sp[0]; r *= 1 - kd; g *= 1 - kd; b *= 1 - kd; }
      else if (sid < 0.07 * sdens) { var kl = sk * sp[1]; r += (1 - r) * kl; g += (1 - g) * kl; b += (1 - b) * kl; }
      var dk = 1 - pk * 0.35; p.r = r * dk; p.g = g * dk; p.b = b * dk;
      p.spec = o.spec === undefined ? 0.12 : o.spec; p.gloss = o.gloss || 16;
    });
    if (facet) smoothH(M, o.facetSoft || 4);
    if (chd) smoothH(M, o.chamferSoft || 1.0);
    smoothH(M, 0.7);
    var wr = o.wear || { sigma: 3, k: 0.25, tint: '#f2f0ea', amount: 0.35 };
    wearPass(M, wr.sigma, wr.k, wr.tint, wr.amount);
    return { M: M, cov: cov, dIn: dIn, maxD: maxD, n1: n1, n2: n2, n3: n3, chd: chd };
  }

  /* ============================================================
   *  渲染一顆符文：把字形鑿進石頭
   * ============================================================ */
  function render(band, glyph, color) {
    var B = getBand(band), M = B.M, sp = B.glyph, col = hex01(color || DEFAULT_COLORS[band]), i;
    var t0 = performance.now();
    /* 1 字形遮罩 → 鑿刀般的不規則邊緣（筆畫寬度 ±8%、端點小崩口） */
    var G0 = C.rasterAlpha(function (c) { drawGlyph(c, glyph, sp); });
    var Din0 = C.distIn(G0, 0), Dout0 = C.distOut(G0, 0);
    var jn1 = C.fbm(sp.seed || 77, 16, 2, 0.5, 0), jn2 = C.fbm((sp.seed || 77) + 1, 64, 2, 0.5, 0), mask = C.F();
    for (i = 0; i < NN; i++) {
      var s = G0[i] >= 0.5 ? Din0[i] : -Dout0[i];
      mask[i] = smoothstep(-0.8, 0.8, s + jn1[i] * sp.jit + jn2[i] * sp.jit * 0.5);
    }
    var Dm = C.distIn(mask, 0.6), maxD = 1;
    for (i = 0; i < NN; i++) if (Dm[i] > maxD) maxD = Dm[i];

    /* 2 V／U 形溝槽：邊緣銳、牆面陡、底部窄；溝槽是從「石面（含圓頂）」往下挖，所以服從石面弧度 */
    var wallW = sp.wallW, gd = C.F();
    for (i = 0; i < NN; i++) {
      var dm = Dm[i]; if (dm <= 0) continue;
      var tt = dm >= wallW ? 1 : dm / wallW;
      gd[i] = sp.depth * (1 - Math.pow(1 - tt, 1.7)) * Math.min(1, mask[i] * 1.2);
    }
    gd = C.gauss(gd, 0.8);
    var Hc = new Float32Array(NN), albC = Float32Array.from(M.alb), specC = Float32Array.from(M.spec), emi = Float32Array.from(M.emi);
    var gn = C.fbm(sp.seed ? sp.seed + 5 : 82, 110, 2, 0.5, 0), gn2 = C.fbm(sp.seed ? sp.seed + 6 : 83, 30, 2, 0.5, 0), E = C.F();
    var vein = B.veinRamp ? C.ramp([[0, B.veinRamp[0]], [0.5, B.veinRamp[1]], [1, B.veinRamp[2]]]) : C.ramp([[0, mix3(col, [0, 0, 0], 0.55)], [0.5, col], [1, mix3(col, [1, 1, 1], B.veinLight === undefined ? 0.18 : B.veinLight)]]);
    for (i = 0; i < NN; i++) {
      Hc[i] = M.H[i] - gd[i];
      var dm2 = Dm[i];
      if (dm2 <= 0.2) continue;
      /* 溝槽內仍是石材：反照率變暗、保留顆粒；底部因環境遮蔽更暗 */
      var dark = sp.dark * smoothstep(0, wallW * 0.9, dm2), g = 1 - dark * (0.8 + 0.4 * gn[i] / 1.7);
      albC[i * 3] *= g; albC[i * 3 + 1] *= g; albC[i * 3 + 2] *= g; specC[i] *= 0.5;
      /* 嵌在溝槽底部的發光礦脈：底部較亮、邊緣較暗，帶礦物顆粒的起伏，不是純白爆亮 */
      var t = clamp((dm2 - wallW * 0.35) / (maxD * 0.92 - wallW * 0.35), 0, 1);
      var grainMod = 0.5 + 0.75 * (0.5 + 0.5 * gn[i] / 1.7) + 0.5 * gn2[i] / 1.7;
      var e = B.veinK * (0.1 + 0.9 * Math.pow(t, 1.15)) * grainMod * Math.min(1, mask[i] * 1.3);
      var li = ((0.25 + 0.75 * t) * 255) | 0;
      emi[i * 3] += vein[li * 3] * e; emi[i * 3 + 1] += vein[li * 3 + 1] * e; emi[i * 3 + 2] += vein[li * 3 + 2] * e;
      E[i] = e;
    }
    var b1 = C.gauss(E, 2.5), b2 = C.gauss(E, 7);
    var glowCol = mix3(col, [1, 1, 1], 0.1);

    /* 3 光照（石面與刻痕共用同一套光源） */
    var Mc = Object.create(M); Mc.alb = albC; Mc.spec = specC;
    var opt = B.light; opt.glowCol = glowCol; opt.rimCol = opt.rimCol || col;
    var lit = C.shade(Mc, Hc, emi, b1, opt);

    /* 4 合成：石面 + 極小半徑的加法微光 */
    var cvFg = document.createElement('canvas'); cvFg.width = cvFg.height = N;
    var cvGl = document.createElement('canvas'); cvGl.width = cvGl.height = N;
    var xf = cvFg.getContext('2d'), xg = cvGl.getContext('2d');
    var fg = xf.createImageData(N, N), gl = xg.createImageData(N, N), fd = fg.data, gdt = gl.data, ex = B.expo || 1.3, sb = B.staticBloom, bk = B.bloomK;
    for (i = 0; i < NN; i++) {
      var c = M.cov[i], j = i * 4;
      if (c > 0.003) {
        fd[j] = 255 * (1 - Math.exp(-lit.r[i] * ex)); fd[j + 1] = 255 * (1 - Math.exp(-lit.g[i] * ex)); fd[j + 2] = 255 * (1 - Math.exp(-lit.b[i] * ex)); fd[j + 3] = c * 255;
      }
      var bs = (0.55 * b1[i] + 0.28 * b2[i]) * bk;
      var gr = glowCol[0] * bs, gg = glowCol[1] * bs, gb = glowCol[2] * bs;
      if (sb) { gr += sb[i * 3]; gg += sb[i * 3 + 1]; gb += sb[i * 3 + 2]; }
      var sf = 1 - 0.7 * c;                       // 石面上的微光已經在光照裡算過，這裡主要補石頭外面
      gr *= sf; gg *= sf; gb *= sf;
      var a = Math.max(gr, gg, gb); if (a > 1) a = 1;
      if (a > 0.002) { gdt[j] = clamp(gr / a, 0, 1) * 255; gdt[j + 1] = clamp(gg / a, 0, 1) * 255; gdt[j + 2] = clamp(gb / a, 0, 1) * 255; gdt[j + 3] = a * 255; }
    }
    xf.putImageData(fg, 0, 0); xg.putImageData(gl, 0, 0);
    var out = document.createElement('canvas'); out.width = out.height = N;
    var x = out.getContext('2d');
    x.save(); x.translate((B.ox || 0) * K, (B.oy || 0) * K);
    x.drawImage(B.back, 0, 0); x.drawImage(cvFg, 0, 0);
    x.globalCompositeOperation = 'lighter'; x.drawImage(cvGl, 0, 0); x.globalCompositeOperation = 'source-over';
    if (B.front) { x.save(); x.scale(K, K); B.front(x, col); x.restore(); }
    x.restore();
    /* 邊緣淡出 */
    var fade = document.createElement('canvas'); fade.width = fade.height = N;
    var fx = fade.getContext('2d'); fx.filter = 'blur(5px)'; fx.fillStyle = '#000'; fx.fillRect(12, 12, N - 24, N - 24);
    x.globalCompositeOperation = 'destination-in'; x.drawImage(fade, 0, 0); x.globalCompositeOperation = 'source-over';
    out.renderMs = performance.now() - t0; out.strokeU = 2 * maxD / K;
    return out;
  }

  /* ============================================================
   *  組裝
   * ============================================================ */
  var BUILDERS = [];
  var bandCache = [], renderCache = {};
  function getBand(i) { return bandCache[i] || (bandCache[i] = BUILDERS[i](i)); }

  function downscale(cv, size) {
    var cur = cv;
    while (cur.width / 2 >= size && cur.width / 2 === Math.round(cur.width / 2)) {
      var h = document.createElement('canvas'); h.width = h.height = cur.width / 2;
      var hc = h.getContext('2d'); hc.imageSmoothingQuality = 'high'; hc.drawImage(cur, 0, 0, h.width, h.height);
      cur = h;
    }
    if (cur.width === size) return cur;
    var out = document.createElement('canvas'); out.width = out.height = size;
    var oc = out.getContext('2d'); oc.imageSmoothingQuality = 'high'; oc.drawImage(cur, 0, 0, size, size);
    return out;
  }
  function renderFull(band, glyph, color) {
    var key = band + '|' + glyph + '|' + (color || '');
    return renderCache[key] || (renderCache[key] = render(band, glyph, color));
  }
  function paint(band, glyph, color, size) { return downscale(renderFull(band, glyph, color), size || 256); }
  function paintRuneStone(ctx, size, band, glyph, color) { ctx.drawImage(paint(band, glyph, color, size), 0, 0, size, size); }

  root.RuneStonePainter = {
    register: function (band, fn) { BUILDERS[band] = fn; },
    kit: { makeStone: makeStone, wearPass: wearPass, smoothH: smoothH, bloomFromEmi: bloomFromEmi, buildBack: buildBack, alphaCanvas: alphaCanvas },
    paint: paint, paintRuneStone: paintRuneStone, downscale: downscale, colors: DEFAULT_COLORS, bandCount: 6, getBand: getBand, renderFull: renderFull
  };
})(typeof window !== 'undefined' ? window : this);
