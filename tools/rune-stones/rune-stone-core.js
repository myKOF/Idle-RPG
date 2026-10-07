/* 符文石渲染核心：高度圖＋逐像素光照的程序化渲染工具（預覽用，尚未整合進遊戲）。
 *
 * 純 Canvas 2D／ImageData＋Float32Array，沒有任何外部套件或素材。
 * 工作解析度 512×512；繪圖座標沿用 256 單位（Canvas 以 2 倍縮放），逐像素運算用 512 像素。
 *
 *   RSCore.N                  工作解析度（512）
 *   RSCore.fbm / ridge / worley   雜訊場（有快取）
 *   RSCore.gauss / distIn      高斯模糊（浮點場）、有號距離（chamfer）
 *   RSCore.roughOutline        不規則、崩缺的輪廓
 *   RSCore.rasterAlpha         用 Canvas 畫向量形狀，取 alpha 當遮罩
 *   RSCore.Mat                 材質緩衝（高度、反照率、光澤、金屬、自發光、法線覆寫）
 *   RSCore.shade               法線＋漫反射＋Blinn-Phong＋環境光遮蔽＋自我陰影＋環境反射
 */
(function (root) {
  'use strict';

  var N = 512, K = 2, NN = N * N, PI = Math.PI, TAU = PI * 2;

  /* ---------- 基礎 ---------- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, v) { var t = (v - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
  function rr(R, a, b) { return a + (b - a) * R(); }
  function hex01(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function rgbCss(c, a) { return 'rgba(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ',' + (a === undefined ? 1 : a) + ')'; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function F() { return new Float32Array(NN); }
  function F3() { return new Float32Array(NN * 3); }

  /* 色階表：stops=[[t,'#hex'],...] → 256 項 LUT（rgb 0..1 交錯） */
  function ramp(stops) {
    var lut = new Float32Array(256 * 3), cs = stops.map(function (s) { return [s[0], typeof s[1] === 'string' ? hex01(s[1]) : s[1]]; });
    for (var i = 0; i < 256; i++) {
      var t = i / 255, k = 0;
      while (k < cs.length - 2 && t > cs[k + 1][0]) k++;
      var a = cs[k], b = cs[k + 1], u = clamp((t - a[0]) / (b[0] - a[0] || 1), 0, 1);
      lut[i * 3] = a[1][0] + (b[1][0] - a[1][0]) * u;
      lut[i * 3 + 1] = a[1][1] + (b[1][1] - a[1][1]) * u;
      lut[i * 3 + 2] = a[1][2] + (b[1][2] - a[1][2]) * u;
    }
    return lut;
  }

  /* ---------- 雜訊 ---------- */
  function h2(x, y, s) {
    var h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
    return (h >>> 0) / 2147483648 - 1;
  }
  function vn(x, y, s) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = h2(ix, iy, s), b = h2(ix + 1, iy, s), c = h2(ix, iy + 1, s), d = h2(ix + 1, iy + 1, s);
    var t = a + (b - a) * fx, u = c + (d - c) * fx;
    return t + (u - t) * fy;
  }
  var cache = {};
  /* 分形雜訊（約 -1..1）：freq＝整張圖的格數，warp＝域扭曲量（格數單位） */
  function fbm(seed, freq, oct, gain, warp) {
    var key = 'f' + [seed, freq, oct, gain, warp].join(',');
    if (cache[key]) return cache[key];
    var out = F(), g = gain === undefined ? 0.5 : gain, wa = warp || 0, norm = 0, amp = 1, o;
    for (o = 0; o < oct; o++) { norm += amp; amp *= g; }
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var px = x / N * freq, py = y / N * freq;
      if (wa) {
        var wx = vn(px * 0.7 + 11.3, py * 0.7 + 3.1, seed + 101) * wa, wy = vn(px * 0.7 + 5.7, py * 0.7 + 17.9, seed + 203) * wa;
        px += wx; py += wy;
      }
      var s = 0, a = 1, f = 1;
      for (o = 0; o < oct; o++) { s += a * vn(px * f, py * f, seed + o * 31); a *= g; f *= 2; }
      out[y * N + x] = s / norm * 1.7;
    }
    return (cache[key] = out);
  }
  /* 脊狀雜訊：1-|n|，峰值處（接近 1）是裂紋線 */
  function ridge(seed, freq, oct, warp) {
    var key = 'r' + [seed, freq, oct, warp].join(',');
    if (cache[key]) return cache[key];
    var n = fbm(seed, freq, oct, 0.5, warp), out = F();
    for (var i = 0; i < NN; i++) { var v = Math.abs(n[i] / 1.7) * 2.2; out[i] = 1 - (v > 1 ? 1 : v); }
    return (cache[key] = out);
  }
  /* Worley：f1／f2＝到最近／次近特徵點的距離（以格寬正規化），id＝最近格的隨機值（0..1），
     vx／vy＝像素到最近特徵點的向量（像素，拿來做每格一個平面的刻面） */
  function worley(seed, cell) {
    var key = 'w' + seed + ',' + cell;
    if (cache[key]) return cache[key];
    var f1 = F(), f2 = F(), id = F(), vx = F(), vy = F();
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var cx = Math.floor(x / cell), cy = Math.floor(y / cell), best = 1e9, second = 1e9, bid = 0, bx = 0, by = 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var gx = cx + dx, gy = cy + dy;
        var fx = (gx + 0.5 + h2(gx, gy, seed) * 0.42) * cell, fy = (gy + 0.5 + h2(gx, gy, seed + 7) * 0.42) * cell;
        var d = (fx - x) * (fx - x) + (fy - y) * (fy - y);
        if (d < best) { second = best; best = d; bid = h2(gx, gy, seed + 13) * 0.5 + 0.5; bx = x - fx; by = y - fy; }
        else if (d < second) second = d;
      }
      var i = y * N + x;
      f1[i] = Math.sqrt(best) / cell; f2[i] = Math.sqrt(second) / cell; id[i] = bid; vx[i] = bx; vy[i] = by;
    }
    return (cache[key] = { f1: f1, f2: f2, id: id, vx: vx, vy: vy });
  }

  /* ---------- 模糊（零填充）---------- */
  function boxesForGauss(sigma, n) {
    var wI = Math.sqrt(12 * sigma * sigma / n + 1), wl = Math.floor(wI);
    if (wl % 2 === 0) wl--;
    var wu = wl + 2, mI = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4), m = Math.round(mI), r = [];
    for (var i = 0; i < n; i++) r.push(((i < m ? wl : wu) - 1) / 2);
    return r;
  }
  function blurH(src, dst, r) {
    var inv = 1 / (2 * r + 1);
    for (var y = 0; y < N; y++) {
      var o = y * N, sum = 0, x;
      for (x = 0; x <= r && x < N; x++) sum += src[o + x];
      dst[o] = sum * inv;
      for (x = 1; x < N; x++) {
        var add = x + r, sub = x - r - 1;
        if (add < N) sum += src[o + add];
        if (sub >= 0) sum -= src[o + sub];
        dst[o + x] = sum * inv;
      }
    }
  }
  function blurV(src, dst, r) {
    var inv = 1 / (2 * r + 1);
    for (var x = 0; x < N; x++) {
      var sum = 0, y;
      for (y = 0; y <= r && y < N; y++) sum += src[y * N + x];
      dst[x] = sum * inv;
      for (y = 1; y < N; y++) {
        var add = y + r, sub = y - r - 1;
        if (add < N) sum += src[add * N + x];
        if (sub >= 0) sum -= src[sub * N + x];
        dst[y * N + x] = sum * inv;
      }
    }
  }
  /* 高斯近似（3 次方框模糊）；回傳新陣列 */
  function gauss(src, sigma) {
    if (sigma < 0.4) return Float32Array.from(src);
    var rs = boxesForGauss(sigma, 3), a = Float32Array.from(src), b = F();
    for (var k = 0; k < 3; k++) { blurH(a, b, rs[k]); blurV(b, a, rs[k]); }
    return a;
  }

  /* ---------- 距離場（兩趟 chamfer）：遮罩 ≥0.5 的內部到邊界的距離（像素）---------- */
  function distIn(mask, smooth) {
    var d = F(), BIG = 1e6, i, x, y, v;
    for (i = 0; i < NN; i++) d[i] = mask[i] >= 0.5 ? BIG : 0;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      i = y * N + x; v = d[i]; if (v === 0) continue;
      if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
      if (y > 0) {
        if (d[i - N] + 1 < v) v = d[i - N] + 1;
        if (x > 0 && d[i - N - 1] + 1.4142 < v) v = d[i - N - 1] + 1.4142;
        if (x < N - 1 && d[i - N + 1] + 1.4142 < v) v = d[i - N + 1] + 1.4142;
      }
      d[i] = v;
    }
    for (y = N - 1; y >= 0; y--) for (x = N - 1; x >= 0; x--) {
      i = y * N + x; v = d[i]; if (v === 0) continue;
      if (x < N - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1;
      if (y < N - 1) {
        if (d[i + N] + 1 < v) v = d[i + N] + 1;
        if (x < N - 1 && d[i + N + 1] + 1.4142 < v) v = d[i + N + 1] + 1.4142;
        if (x > 0 && d[i + N - 1] + 1.4142 < v) v = d[i + N - 1] + 1.4142;
      }
      d[i] = v;
    }
    for (i = 0; i < NN; i++) if (d[i] > 0) d[i] = Math.max(0, d[i] - 0.5);
    return smooth ? gauss(d, smooth) : d;
  }
  function distOut(mask, smooth) {
    var inv = F();
    for (var i = 0; i < NN; i++) inv[i] = mask[i] >= 0.5 ? 0 : 1;
    return distIn(inv, smooth);
  }

  /* ---------- 向量形狀 → 遮罩 ---------- */
  var rcv = document.createElement('canvas'); rcv.width = rcv.height = N;
  var rx = rcv.getContext('2d', { willReadFrequently: true });
  function rasterAlpha(draw) {
    rx.setTransform(1, 0, 0, 1, 0, 0); rx.clearRect(0, 0, N, N);
    rx.globalCompositeOperation = 'source-over'; rx.globalAlpha = 1; rx.filter = 'none';
    rx.setTransform(K, 0, 0, K, 0, 0);
    rx.save(); draw(rx); rx.restore();
    var d = rx.getImageData(0, 0, N, N).data, a = F();
    for (var i = 0, j = 3; i < NN; i++, j += 4) a[i] = d[j] / 255;
    return a;
  }
  function fillPoly(c, pts) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath(); c.fill();
  }
  function polyPath(c, pts) {
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
  }

  /* 不規則輪廓：沿邊重新取樣，疊多尺度雜訊位移，再切幾處崩缺與轉角缺口。座標單位 256。
     o：step 取樣間距、big/mid/fine 三種尺度的位移幅度、nChips 邊上崩缺數、chipDepth/chipLen、
        cornerChipProb 轉角崩缺機率、cornerDepth/cornerLen */
  function roughOutline(base, seed, o) {
    o = o || {};
    var R = mulberry32(seed), n = base.length, lens = [], total = 0, i, area = 0;
    for (i = 0; i < n; i++) {
      var a = base[i], b = base[(i + 1) % n];
      lens.push(Math.hypot(b[0] - a[0], b[1] - a[1])); total += lens[i];
      area += a[0] * b[1] - b[0] * a[1];
    }
    var sgn = area > 0 ? 1 : -1, chips = [], acc = 0;
    var cd = o.cornerDepth || [4, 8], cl = o.cornerLen || [14, 24];
    for (i = 0; i < n; i++) {
      var elig = !o.cornerIdx || o.cornerIdx.indexOf(i) >= 0;
      if (elig && R() < (o.cornerChipProb === undefined ? 0.7 : o.cornerChipProb)) chips.push({ s: acc, len: rr(R, cl[0], cl[1]), depth: rr(R, cd[0], cd[1]) });
      acc += lens[i];
    }
    var chd = o.chipDepth || [2, 5], chl = o.chipLen || [8, 20];
    for (i = 0; i < (o.nChips === undefined ? 5 : o.nChips); i++) chips.push({ s: R() * total, len: rr(R, chl[0], chl[1]), depth: rr(R, chd[0], chd[1]) });
    var step = o.step || 3, big = o.big === undefined ? 2.5 : o.big, mid = o.mid === undefined ? 1.4 : o.mid, fine = o.fine === undefined ? 0.7 : o.fine;
    var pts = [], s = 0;
    function disp(sv) {
      var d = big * vn(sv / 55, 0.37, seed) + mid * vn(sv / 20, 1.71, seed + 5) + fine * vn(sv / 6.5, 3.3, seed + 9);
      for (var k = 0; k < chips.length; k++) {
        var c = chips[k], t = sv - c.s;
        if (t > total / 2) t -= total; else if (t < -total / 2) t += total;
        t = t / c.len + 0.5;
        if (t > 0 && t < 1) {
          var p = t < 0.14 ? t / 0.14 : t > 0.86 ? (1 - t) / 0.14 : 1;
          d -= c.depth * p * (0.8 + 0.2 * vn(sv / 3, k, seed + 21));
        }
      }
      return d;
    }
    for (i = 0; i < n; i++) {
      var A = base[i], B = base[(i + 1) % n], l = lens[i], ex = (B[0] - A[0]) / l, ey = (B[1] - A[1]) / l;
      var nx = ey * sgn, ny = -ex * sgn, cnt = Math.max(1, Math.round(l / step));
      for (var j = 0; j < cnt; j++) {
        var t = j / cnt * l, d = disp(s + t);
        pts.push([A[0] + ex * t + nx * d, A[1] + ey * t + ny * d]);
      }
      s += l;
    }
    return pts;
  }

  /* Chaikin 切角平滑（封閉多邊形），做出圓潤的卵石輪廓 */
  function chaikin(pts, iters) {
    var p = pts;
    for (var k = 0; k < iters; k++) {
      var q = [];
      for (var i = 0; i < p.length; i++) {
        var a = p[i], b = p[(i + 1) % p.length];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      p = q;
    }
    return p;
  }

  /* 凸多邊形內縮（螢幕座標，視覺順時針為正面積） */
  function insetPoly(pts, d) {
    var n = pts.length, area = 0, i;
    for (i = 0; i < n; i++) { var a = pts[i], b = pts[(i + 1) % n]; area += a[0] * b[1] - b[0] * a[1]; }
    var sgn = area > 0 ? 1 : -1, lines = [];
    for (i = 0; i < n; i++) {
      var p = pts[i], q = pts[(i + 1) % n], ex = q[0] - p[0], ey = q[1] - p[1], l = Math.hypot(ex, ey);
      ex /= l; ey /= l;
      var nx = -ey * sgn, ny = ex * sgn;
      var di = Array.isArray(d) ? d[i] : d;
      lines.push({ px: p[0] + nx * di, py: p[1] + ny * di, ex: ex, ey: ey });
    }
    var out = [];
    for (i = 0; i < n; i++) {
      var A = lines[(i + n - 1) % n], B = lines[i], den = A.ex * B.ey - A.ey * B.ex;
      var t = ((B.px - A.px) * B.ey - (B.py - A.py) * B.ex) / den;
      out.push([A.px + A.ex * t, A.py + A.ey * t]);
    }
    return out;
  }

  /* ---------- 材質緩衝 ---------- */
  function Mat() {
    this.cov = F(); this.H = F(); this.alb = F3(); this.spec = F(); this.gloss = F(); this.metal = F();
    this.emi = F3(); this.nov = F3(); this.ovw = F();
  }
  /* 把一層疊上去：cov 為該層覆蓋率；fn(i, o) 填 o 的欄位（未填的用預設）。
     o：h, r,g,b, spec, gloss, metal, er,eg,eb, ow, nx,ny,nz */
  Mat.prototype.paint = function (cov, fn, defaults) {
    var d = defaults || {}, o = {}, i;
    var dSpec = d.spec === undefined ? 0.12 : d.spec, dGloss = d.gloss === undefined ? 14 : d.gloss;
    for (i = 0; i < NN; i++) {
      var c = cov[i]; if (c < 0.004) continue;
      o.h = this.H[i]; o.r = this.alb[i * 3]; o.g = this.alb[i * 3 + 1]; o.b = this.alb[i * 3 + 2];
      o.spec = dSpec; o.gloss = dGloss; o.metal = 0; o.er = 0; o.eg = 0; o.eb = 0; o.ow = 0; o.nx = 0; o.ny = 0; o.nz = 1;
      fn(i, o);
      var k = i * 3;
      this.H[i] += (o.h - this.H[i]) * c;
      this.alb[k] += (o.r - this.alb[k]) * c; this.alb[k + 1] += (o.g - this.alb[k + 1]) * c; this.alb[k + 2] += (o.b - this.alb[k + 2]) * c;
      this.spec[i] += (o.spec - this.spec[i]) * c; this.gloss[i] += (o.gloss - this.gloss[i]) * c; this.metal[i] += (o.metal - this.metal[i]) * c;
      this.emi[k] += (o.er - this.emi[k]) * c; this.emi[k + 1] += (o.eg - this.emi[k + 1]) * c; this.emi[k + 2] += (o.eb - this.emi[k + 2]) * c;
      this.nov[k] += (o.nx - this.nov[k]) * c; this.nov[k + 1] += (o.ny - this.nov[k + 1]) * c; this.nov[k + 2] += (o.nz - this.nov[k + 2]) * c;
      this.ovw[i] += (o.ow - this.ovw[i]) * c;
      this.cov[i] = c + this.cov[i] * (1 - c);
    }
  };

  /* ---------- 光照 ---------- */
  var ENV = ramp([[0, '#ffffff'], [0.25, '#dcdcdc'], [0.42, '#a0a0a0'], [0.5, '#f0f0f0'], [0.6, '#808080'], [0.8, '#3c3c3c'], [1, '#6a6a6a']]);
  /* 光源：左上、略朝觀看者 */
  var LX = -0.5, LY = -0.7, LZ = 0.6, LL = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
  LX /= LL; LY /= LL; LZ /= LL;
  var HX = LX, HY = LY, HZ = LZ + 1, HL = Math.sqrt(HX * HX + HY * HY + HZ * HZ);
  HX /= HL; HY /= HL; HZ /= HL;

  /* 回傳 {r,g,b}（浮點，可超過 1）。
     Hc 高度（含符文刻痕）、emi 自發光（rgb 交錯）、wallGlow 符文光的模糊場（照亮凹槽牆面）、
     opt：amb 環境光色、key 主光色、bump 法線強度、aoK、rimCol/rimK、glowCol、wallK、shadowK */
  function shade(M, Hc, emi, wallGlow, opt) {
    var cov = M.cov, alb = M.alb, spec = M.spec, gloss = M.gloss, metal = M.metal, nov = M.nov, ovw = M.ovw;
    var R = F(), G = F(), B = F();
    var amb = opt.amb, key = opt.key, bump = opt.bump || 1, aoK = opt.aoK === undefined ? 1 : opt.aoK;
    var rim = opt.rimCol || [0, 0, 0], rimK = opt.rimK || 0, glow = opt.glowCol || [1, 1, 1], wallK = opt.wallK || 0, shK = opt.shadowK === undefined ? 1 : opt.shadowK;
    var hb1 = gauss(Hc, 4), hb2 = gauss(Hc, 14);
    var dlx = -LX / Math.hypot(LX, LY), dly = -LY / Math.hypot(LX, LY), slope = LZ / Math.hypot(LX, LY);
    var STEP = 3, NSTEP = 8;
    for (var y = 1; y < N - 1; y++) for (var x = 1; x < N - 1; x++) {
      var i = y * N + x, c = cov[i];
      if (c < 0.004) continue;
      var nx = -(Hc[i + 1] - Hc[i - 1]) * 0.5 * bump, ny = -(Hc[i + N] - Hc[i - N]) * 0.5 * bump, nz = 1;
      var l = 1 / Math.sqrt(nx * nx + ny * ny + 1); nx *= l; ny *= l; nz = l;
      var ow = ovw[i];
      if (ow > 0.001) {
        var ox = nov[i * 3], oy = nov[i * 3 + 1], oz = nov[i * 3 + 2];
        nx = nx * (1 - ow) + ox * ow; ny = ny * (1 - ow) + oy * ow; nz = nz * (1 - ow) + oz * ow;
        l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz); nx *= l; ny *= l; nz *= l;
      }
      /* 自我陰影：朝光源方向步進，被更高的地形擋住就變暗 */
      var h0 = Hc[i], sh = 1;
      if (shK > 0) {
        for (var s = 1; s <= NSTEP; s++) {
          var sx = Math.round(x + dlx * s * STEP), sy = Math.round(y + dly * s * STEP);
          if (sx < 0 || sy < 0 || sx >= N || sy >= N) break;
          var occ = Hc[sy * N + sx] - (h0 + s * STEP * slope);
          if (occ > 0) { var f = 1 - clamp(occ / 5, 0, 1); if (f < sh) sh = f; }
        }
        sh = 1 - (1 - sh) * shK;
      }
      var ao = clamp((hb1[i] - h0) * 0.09 * aoK, 0, 0.7) + clamp((hb2[i] - h0) * 0.03 * aoK, 0, 0.5);
      var aoF = 1 - Math.min(ao, 0.85);
      var ndl = nx * LX + ny * LY + nz * LZ, dif = ndl > 0 ? ndl : 0;
      var dd = dif * sh;
      var ah = 0.55 + 0.45 * nz;
      var r0 = key[0] * dd + amb[0] * ah * aoF, g0 = key[1] * dd + amb[1] * ah * aoF, b0 = key[2] * dd + amb[2] * ah * aoF;
      var ar = alb[i * 3], ag = alb[i * 3 + 1], ab = alb[i * 3 + 2];
      var cr = ar * r0, cg = ag * g0, cb = ab * b0;
      var mt = metal[i];
      if (mt > 0.01) {
        var rxv = 2 * nz * nx, ryv = 2 * nz * ny;
        var tt = 0.5 + 0.5 * (-ryv * 0.9 - rxv * 0.35);
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        var ev = ENV[((tt * 255) | 0) * 3] * (0.4 + 0.6 * aoF) * (0.35 + 0.65 * sh);
        var mg = opt.metalGain || 1.15;
        cr += (ar * ev * mg - cr) * mt; cg += (ag * ev * mg - cg) * mt; cb += (ab * ev * mg - cb) * mt;
      }
      var nh = nx * HX + ny * HY + nz * HZ;
      if (nh > 0) {
        var sp = Math.pow(nh, gloss[i]) * spec[i] * sh;
        var tr = 1 + (ar - 1) * mt, tg = 1 + (ag - 1) * mt, tb = 1 + (ab - 1) * mt;
        cr += key[0] * sp * tr; cg += key[1] * sp * tg; cb += key[2] * sp * tb;
      }
      if (rimK > 0) {
        var rt = nx * 0.7 + ny * 0.7; rt = rt > 0 ? rt : 0;
        var rm = Math.pow(1 - nz, 1.5) * rt * rimK * aoF;
        cr += rim[0] * rm; cg += rim[1] * rm; cb += rim[2] * rm;
      }
      if (wallK > 0) {
        var wgi = wallGlow[i] * Math.pow(1 - nz, 0.7) * wallK;
        cr += glow[0] * wgi; cg += glow[1] * wgi; cb += glow[2] * wgi;
      }
      R[i] = cr + emi[i * 3]; G[i] = cg + emi[i * 3 + 1]; B[i] = cb + emi[i * 3 + 2];
    }
    return { r: R, g: G, b: B };
  }

  root.RSCore = {
    N: N, K: K, NN: NN, F: F, F3: F3, mulberry32: mulberry32, clamp: clamp, lerp: lerp, smoothstep: smoothstep, rr: rr,
    hex01: hex01, rgbCss: rgbCss, mix3: mix3, ramp: ramp, vn: vn, h2: h2, fbm: fbm, ridge: ridge, worley: worley,
    gauss: gauss, distIn: distIn, distOut: distOut, rasterAlpha: rasterAlpha, fillPoly: fillPoly, polyPath: polyPath,
    roughOutline: roughOutline, insetPoly: insetPoly, chaikin: chaikin, Mat: Mat, shade: shade, ENV: ENV
  };
})(typeof window !== 'undefined' ? window : this);
