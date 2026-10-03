/* 程序化浮雕繪圖（2026-10）
   ============================================================
   戰場擺件原本用 Canvas 向量路徑＋線性漸層畫：形狀對了，但表面是平的——沒有石紋、樹皮、切面，
   光也不一致，看起來像剪紙。這支改成「先塑形、再打光」：

     1. 塑形：用幾種立體圖元（橢球、錐形管、直立圓柱、圓錐、斜角方塊、平面切面）往一張
        深度緩衝裡「堆」。每個像素記下最前面那個圖元的材質、法線、深度與細節高度。
        圖元自己算覆蓋率（到邊界的距離），所以外輪廓有反鋸齒，不必超取樣。
     2. 打光：法線 ＋ 細節高度的梯度（石紋、樹皮、晶體裂紋都是雜訊）→ 左上前方的主光、
        環境光、凹處遮蔽（深度模糊後比較）、腳底變暗 → 查材質的色階表（暗部偏冷、亮部偏暖）
        → 外輪廓描深色邊、前後交界描內線。

   參考了 RPG Maker MV 地圖圖塊的「美術手法」（光從左上、色階帶色相偏移、深色描邊、表面有紋理），
   沒有使用任何素材本身（AI_RULES.md 第二原則）。全部是執行期計算，不載入任何圖檔。

   座標：圖元參數是邏輯像素；內部緩衝是邏輯 × scale（= 圖集解析度），一個緩衝像素對應一個圖集像素。
   z 是「朝向鏡頭的深度」（越大越靠前），不是地面高度。 */
var DecorSculpt = (function () {
  'use strict';

  /* ============ 雜訊表（全域共用，第一次用到才建） ============ */
  var T = 256, TM = 255;
  var FBM = null;          // 可平鋪的分形值雜訊 0..1
  var CELL_ID = null;      // Voronoi 細胞編號 0..255
  var CELL_EDGE = null;    // F2 − F1（0 在細胞交界，越大越靠中心），已正規化 0..1
  var TILT_X = null, TILT_Y = null;   // 每個細胞編號對應的隨機傾斜（岩石切面）

  function mulberry(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function initTables() {
    if (FBM) return;
    var r = mulberry(0x5eed1234);
    FBM = new Float32Array(T * T);
    var amp = 1, total = 0;
    for (var o = 0; o < 5; o++) {
      var G = 4 << o, cell = T / G;
      var lat = new Float32Array(G * G);
      for (var i = 0; i < lat.length; i++) lat[i] = r();
      for (var y = 0; y < T; y++) {
        var fy = y / cell, iy = fy | 0, ty = fy - iy;
        ty = ty * ty * (3 - 2 * ty);
        var r0 = (iy % G) * G, r1 = ((iy + 1) % G) * G;
        for (var x = 0; x < T; x++) {
          var fx = x / cell, ix = fx | 0, tx = fx - ix;
          tx = tx * tx * (3 - 2 * tx);
          var x0 = ix % G, x1 = (ix + 1) % G;
          var a = lat[r0 + x0], b = lat[r0 + x1], c = lat[r1 + x0], d = lat[r1 + x1];
          FBM[y * T + x] += amp * ((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty);
        }
      }
      total += amp;
      amp *= 0.5;
    }
    var lo = 1e9, hi = -1e9, k;
    for (k = 0; k < FBM.length; k++) { FBM[k] /= total; if (FBM[k] < lo) lo = FBM[k]; if (FBM[k] > hi) hi = FBM[k]; }
    for (k = 0; k < FBM.length; k++) FBM[k] = (FBM[k] - lo) / (hi - lo);

    // Voronoi：8×8 格、每格一個特徵點，可平鋪；只查 3×3 鄰格
    var GC = 8, CS = T / GC;
    var px = new Float32Array(GC * GC), py = new Float32Array(GC * GC);
    for (var c2 = 0; c2 < GC * GC; c2++) { px[c2] = r() * CS; py[c2] = r() * CS; }
    CELL_ID = new Uint8Array(T * T);
    CELL_EDGE = new Float32Array(T * T);
    var emax = 0;
    for (var yy = 0; yy < T; yy++) {
      var gy = (yy / CS) | 0;
      for (var xx = 0; xx < T; xx++) {
        var gx = (xx / CS) | 0;
        var f1 = 1e9, f2 = 1e9, id = 0;
        for (var oy = -1; oy <= 1; oy++) {
          for (var ox = -1; ox <= 1; ox++) {
            var cx = gx + ox, cy = gy + oy;
            var wx = (cx + GC) % GC, wy = (cy + GC) % GC;
            var idx = wy * GC + wx;
            var fxp = cx * CS + px[idx] - xx, fyp = cy * CS + py[idx] - yy;
            var dd = fxp * fxp + fyp * fyp;
            if (dd < f1) { f2 = f1; f1 = dd; id = idx; } else if (dd < f2) f2 = dd;
          }
        }
        var e = Math.sqrt(f2) - Math.sqrt(f1);
        CELL_ID[yy * T + xx] = (id * 37) & 255;
        CELL_EDGE[yy * T + xx] = e;
        if (e > emax) emax = e;
      }
    }
    for (k = 0; k < CELL_EDGE.length; k++) CELL_EDGE[k] = Math.min(1, CELL_EDGE[k] / (emax * 0.5));
    TILT_X = new Float32Array(256); TILT_Y = new Float32Array(256);
    for (var t = 0; t < 256; t++) {
      var ang = r() * Math.PI * 2, mag = 0.35 + r() * 0.65;
      TILT_X[t] = Math.cos(ang) * mag;
      TILT_Y[t] = Math.sin(ang) * mag;
    }
  }

  // 雙線性取樣（u、v 是雜訊表像素單位，會自動平鋪）
  function fbm(u, v) {
    var x = Math.floor(u), y = Math.floor(v);
    var tx = u - x, ty = v - y;
    var x0 = x & TM, y0 = y & TM, x1 = (x + 1) & TM, y1 = (y + 1) & TM;
    var a = FBM[(y0 << 8) | x0], b = FBM[(y0 << 8) | x1], c = FBM[(y1 << 8) | x0], d = FBM[(y1 << 8) | x1];
    var top = a + (b - a) * tx;
    return top + ((c + (d - c) * tx) - top) * ty;
  }
  function cellIndex(u, v) { return ((Math.floor(v) & TM) << 8) | (Math.floor(u) & TM); }

  /* ============ 色階（暗部偏冷、亮部偏暖） ============ */
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, h = 0, s = 0;
    if (mx !== mn) {
      var d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s <= 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    function f(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // 色相往目標轉，最多轉 maxDeg 度
  function hueToward(h, target, maxDeg) {
    var d = ((target - h + 540) % 360) - 180;
    return h + Math.max(-maxDeg, Math.min(maxDeg, d));
  }
  var LUT_N = 64;
  /* 材質色階：t=0 最暗（陰影深處）→ t=0.55 原色 → t=1 高光。
     shift：色相偏移強度（度）；sat：飽和度係數 */
  function buildLut(m) {
    var base = rgbToHsl(hexToRgb(m.color));
    var shift = m.shift === undefined ? 22 : m.shift;
    var lut = new Uint8ClampedArray(LUT_N * 3);
    for (var i = 0; i < LUT_N; i++) {
      var t = i / (LUT_N - 1);
      var h, s, l;
      if (t < 0.55) {
        var k = 1 - t / 0.55;          // 1＝最暗
        // 灰色（飽和度很低）的色相沒有意義（預設 0＝紅），直接用目標色相，否則暗部會偏洋紅
        h = base[1] < 0.12 ? (m.coolHue === undefined ? 250 : m.coolHue) : hueToward(base[0], m.coolHue === undefined ? 250 : m.coolHue, shift * k);
        s = Math.min(1, base[1] * (1 + 0.25 * k) + 0.04 * k);
        l = base[2] * (1 - 0.78 * k);
      } else {
        var k2 = (t - 0.55) / 0.45;    // 1＝最亮
        h = base[1] < 0.12 ? (m.warmHue === undefined ? 48 : m.warmHue) : hueToward(base[0], m.warmHue === undefined ? 48 : m.warmHue, shift * 0.7 * k2);
        s = base[1] * (1 - 0.3 * k2);
        l = base[2] + (1 - base[2]) * (m.hiLift === undefined ? 0.62 : m.hiLift) * k2;
      }
      var c = hslToRgb(h, s, l);
      lut[i * 3] = c[0]; lut[i * 3 + 1] = c[1]; lut[i * 3 + 2] = c[2];
    }
    return lut;
  }
  function lutOf(m) {
    if (!m._lut) m._lut = buildLut(m);
    return m._lut;
  }

  /* ============ 塑形緩衝 ============ */
  // 主光：左上前方；觀看方向 (0,0,1)
  var LX = -0.5, LY = -0.72, LZ = 0.48;
  (function () { var n = Math.sqrt(LX * LX + LY * LY + LZ * LZ); LX /= n; LY /= n; LZ /= n; })();
  var HX = LX, HY = LY, HZ = LZ + 1;
  (function () { var n = Math.sqrt(HX * HX + HY * HY + HZ * HZ); HX /= n; HY /= n; HZ /= n; })();

  function Sculpt(w, h, scale, mats) {
    initTables();
    this.lw = w; this.lh = h; this.s = scale;
    this.W = Math.max(1, Math.ceil(w * scale));
    this.H = Math.max(1, Math.ceil(h * scale));
    var n = this.W * this.H;
    this.z = new Float32Array(n).fill(-1e9);
    this.a = new Float32Array(n);
    this.m = new Uint8Array(n);
    this.nx = new Float32Array(n);
    this.ny = new Float32Array(n);
    this.nz = new Float32Array(n);
    this.det = new Float32Array(n);
    this.glow = new Float32Array(n);
    this.bx0 = this.W; this.by0 = this.H; this.bx1 = -1; this.by1 = -1;
    this.mats = [null];
    this.matIndex = new Map();
    if (mats) for (var k in mats) this.mat(mats[k]);
  }

  // 圖元掃過的範圍（打光只處理這個框，空白處不必逐像素跑）
  Sculpt.prototype.touch = function (x0, y0, x1, y1) {
    if (x0 < this.bx0) this.bx0 = x0;
    if (y0 < this.by0) this.by0 = y0;
    if (x1 > this.bx1) this.bx1 = x1;
    if (y1 > this.by1) this.by1 = y1;
  };

  // 材質要先登記才有編號（同一個物件只登記一次）
  Sculpt.prototype.mat = function (m) {
    if (!m) return 0;
    var i = this.matIndex.get(m);
    if (i) return i;
    this.mats.push(m);
    i = this.mats.length - 1;
    this.matIndex.set(m, i);
    return i;
  };

  /* 寫入一個像素：覆蓋率高的、或比較靠前的才換掉材質與法線；不透明度取聯集。
     （前後兩個圖元的交界不做真正的混色——交界處會再描一條內線，看不出鋸齒） */
  Sculpt.prototype.put = function (i, z, cov, mi, nx, ny, nz, det) {
    if (cov <= 0.002) return;
    var a0 = this.a[i];
    var take = a0 < 0.5 ? (cov >= a0 || z > this.z[i]) : (cov >= 0.5 && z > this.z[i]);
    if (take) {
      this.z[i] = z; this.m[i] = mi;
      this.nx[i] = nx; this.ny[i] = ny; this.nz[i] = nz;
      this.det[i] = det;
    }
    if (cov > a0) this.a[i] = cov;
  };

  // 細節雜訊：tex = { kind, scale, amp, ox, oy, sx, sy }
  function texValue(tex, u, v) {
    if (!tex) return 0;
    var s = tex.scale || 1;
    var uu = u * s * (tex.sx || 1) + (tex.ox || 0), vv = v * s * (tex.sy || 1) + (tex.oy || 0);
    var amp = tex.amp === undefined ? 1 : tex.amp;
    switch (tex.kind) {
      case 'cell': return (CELL_EDGE[cellIndex(uu, vv)] - 0.5) * amp;
      case 'crack': {
        // 只有部分細胞交界會裂（另一層低頻雜訊當遮罩），不然整面會變成均勻的馬賽克
        var e = CELL_EDGE[cellIndex(uu, vv)];
        var crack = (e < 0.1 && fbm(uu * 0.45 + 70, vv * 0.45 + 40) > 0.52) ? -(0.1 - e) * 10 : 0;
        return crack * amp + (fbm(uu * 2, vv * 2) - 0.5) * amp * 0.45;
      }
      case 'strata': return (Math.sin(vv * 0.9 + fbm(uu * 0.6, vv * 0.3) * 6) * 0.5 + (fbm(uu * 2, vv * 2) - 0.5) * 0.6) * amp;
      case 'bark': return ((fbm(uu * 0.35, vv * 3) - 0.5) * 1.6 + (fbm(uu * 3, vv * 3) - 0.5) * 0.4) * amp;
      case 'grain': return (fbm(uu * 3, vv * 3) - 0.5) * amp;
      default: return (fbm(uu, vv) - 0.5) * amp + (fbm(uu * 3.1 + 17, vv * 3.1 + 31) - 0.5) * amp * 0.45;
    }
  }

  // 岩石切面：依 Voronoi 細胞把法線往隨機方向扳
  function facetTilt(opt, u, v) {
    var fs = opt.facet || 0;
    if (!fs) return null;
    var c = CELL_ID[cellIndex(u * (opt.facetScale || 1) + (opt.fox || 0), v * (opt.facetScale || 1) + (opt.foy || 0))];
    return [TILT_X[c] * fs, TILT_Y[c] * fs];
  }

  /* 上表面換材質（積雪、苔蘚）：法線朝上超過門檻、且雜訊遮罩通過 */
  function topSwap(self, opt, mi, ny, u, v) {
    if (!opt.top) return mi;
    var thr = opt.topThr === undefined ? -0.42 : opt.topThr;
    if (ny > thr) return mi;
    if (opt.topNoise && fbm(u * 1.7 + 9, v * 1.7 + 3) < opt.topNoise) return mi;
    return self.mat(opt.top);
  }

  /* ---------- 圖元 ---------- */
  // 橢球（正面看的圓頂）。opt.cutY：此 y 以下切掉（立在地上）；opt.zScale：前後厚度
  Sculpt.prototype.ellipsoid = function (cx, cy, rx, ry, zc, mat, opt) {
    opt = opt || {};
    var s = this.s, mi = this.mat(mat);
    var rz = opt.rz || Math.min(rx, ry);
    var cut = opt.cutY === undefined ? 1e9 : opt.cutY;
    var above = opt.cutAbove === undefined ? -1e9 : opt.cutAbove;   // 此 y 以上切掉（碗）
    var grow = 1 + (opt.wobble || 0) * 1.4;                          // 輪廓雜訊會把半徑往外推，掃描範圍要跟著放大
    var x0 = Math.max(0, Math.floor((cx - rx * grow - 1) * s)), x1 = Math.min(this.W - 1, Math.ceil((cx + rx * grow + 1) * s));
    var y0 = Math.max(0, Math.floor((Math.max(cy - ry * grow, above) - 1) * s)), y1 = Math.min(this.H - 1, Math.ceil(Math.min(cy + ry * grow + 1, cut + 1) * s));
    this.touch(x0, y0, x1, y1);
    var minR = Math.min(rx, ry) * s;
    var wob = opt.wobble || 0, wseed = opt.wseed || 0;
    // 不規則輪廓：沿角度的半徑縮放先做成 256 格的表（逐像素只剩 atan2＋查表）
    var WT = null;
    if (wob) {
      WT = new Float32Array(257);
      for (var wi = 0; wi <= 256; wi++) {
        var th0 = wi / 256 * Math.PI * 2 - Math.PI;
        WT[wi] = 1 + wob * ((fbm(th0 * 9 + wseed, wseed * 0.37) - 0.5) * 1.6 + (fbm(th0 * 26 + wseed, 7 + wseed) - 0.5) * 0.7);
      }
    }
    // 參數先取出來：逐像素讀 opt 的屬性會讓迴圈變慢（不同呼叫的 opt 形狀不同）
    var fs = opt.facet || 0, fsc = opt.facetScale || 1, fox = opt.fox || 0, foy = opt.foy || 0;
    var creaseK = opt.crease === undefined ? 1 : opt.crease;
    var topMi = opt.top ? this.mat(opt.top) : 0;
    var topThr = opt.topThr === undefined ? -0.42 : opt.topThr, topNoise = opt.topNoise || 0;
    var tex = opt.tex || null, W = this.W;
    for (var py = y0; py <= y1; py++) {
      var ly = (py + 0.5) / s, dy0 = (ly - cy) / ry;
      for (var px = x0; px <= x1; px++) {
        var lx = (px + 0.5) / s, dx = (lx - cx) / rx, dy = dy0;
        var d2 = dx * dx + dy * dy;
        var d = Math.sqrt(d2);
        if (WT) {
          var kq = WT[((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2) * 256 + 0.5) | 0];
          d /= kq; d2 = d * d;
          dx /= kq; dy /= kq;
        }
        var cov = 0.5 - (d - 1) * minR;
        if (cov > 1) cov = 1;
        if (ly > cut) { var cc = 0.5 - (ly - cut) * s; if (cc < cov) cov = cc; }
        if (ly < above) { var ca = 0.5 - (above - ly) * s; if (ca < cov) cov = ca; }
        if (cov <= 0) continue;
        var zz = d2 < 1 ? Math.sqrt(1 - d2) : 0;
        var nx = dx / rx, ny = dy / ry, nz = (zz + 0.02) / rz;
        var crease = 0;
        if (fs) {
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
          var ci = cellIndex(lx * fsc + fox, ly * fsc + foy);
          var cid = CELL_ID[ci];
          nx = nx / nl + TILT_X[cid] * fs; ny = ny / nl + TILT_Y[cid] * fs; nz = nz / nl;
          // 切面交界壓出一道折痕（打光時變成清楚的稜線）
          var ce = CELL_EDGE[ci];
          if (ce < 0.14) crease = -(0.14 - ce) * 9 * creaseK;
        }
        var nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= nn; ny /= nn; nz /= nn;
        var m2 = mi;
        if (topMi && ny < topThr && !(topNoise && fbm(lx * 1.7 + 9, ly * 1.7 + 3) < topNoise)) m2 = topMi;
        this.put(py * W + px, zc + zz * rz, cov, m2, nx, ny, nz, (tex ? texValue(tex, lx, ly) : 0) + crease);
      }
    }
  };

  // 錐形管（兩端半徑不同的膠囊）：樹枝、骨頭、仙人掌。紋理座標沿著管軸
  Sculpt.prototype.capsule = function (ax, ay, ar, bx, by, br, zc, mat, opt) {
    opt = opt || {};
    var s = this.s, mi = this.mat(mat);
    var vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy, len = Math.sqrt(len2) || 1;
    var rmax = Math.max(ar, br);
    var x0 = Math.max(0, Math.floor((Math.min(ax, bx) - rmax - 1) * s)), x1 = Math.min(this.W - 1, Math.ceil((Math.max(ax, bx) + rmax + 1) * s));
    var y0 = Math.max(0, Math.floor((Math.min(ay, by) - rmax - 1) * s)), y1 = Math.min(this.H - 1, Math.ceil((Math.max(ay, by) + rmax + 1) * s));
    this.touch(x0, y0, x1, y1);
    var cut = opt.cutY === undefined ? 1e9 : opt.cutY;
    var tx = vx / len, ty = vy / len;
    var ribs = opt.ribs || 0;
    for (var py = y0; py <= y1; py++) {
      var ly = (py + 0.5) / s;
      for (var px = x0; px <= x1; px++) {
        var lx = (px + 0.5) / s;
        var wx = lx - ax, wy = ly - ay;
        var t = len2 > 0 ? (wx * vx + wy * vy) / len2 : 0;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        var cxp = ax + vx * t, cyp = ay + vy * t;
        var r = ar + (br - ar) * t;
        var ddx = lx - cxp, ddy = ly - cyp;
        var d = Math.sqrt(ddx * ddx + ddy * ddy);
        var cov = Math.min(1, Math.max(0, 0.5 - (d - r) * s));
        if (ly > cut) cov = Math.min(cov, Math.max(0, 0.5 - (ly - cut) * s));
        if (cov <= 0) continue;
        var q = Math.min(1, d / r);
        var zz = Math.sqrt(Math.max(0, 1 - q * q));
        var nx = ddx / r, ny = ddy / r, nz = zz;
        // 縱向稜（仙人掌）：繞軸的角度上做波紋
        var around = (ddx * -ty + ddy * tx) / r;   // -1..1
        if (ribs) {
          var wave = Math.sin(Math.asin(Math.max(-1, Math.min(1, around))) * ribs) * 0.35;
          nx += -ty * wave; ny += tx * wave;
        }
        var nn = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nn; ny /= nn; nz /= nn;
        var along = t * len;
        var m2 = topSwap(this, opt, mi, ny, lx, ly);
        this.put(py * this.W + px, zc + zz * r, cov, m2, nx, ny, nz,
          texValue(opt.tex, along + (opt.uOff || 0), around * r * 2 + (opt.vOff || 0)));
      }
    }
  };

  // 直立圓柱（柱身）：opt.flutes 凹槽數、opt.topY(x) 回傳此 x 的上緣（斷柱鋸齒）
  Sculpt.prototype.column = function (cx, yTop, yBot, r, zc, mat, opt) {
    opt = opt || {};
    var s = this.s, mi = this.mat(mat);
    var x0 = Math.max(0, Math.floor((cx - r - 1) * s)), x1 = Math.min(this.W - 1, Math.ceil((cx + r + 1) * s));
    var y0 = Math.max(0, Math.floor((yTop - 12) * s)), y1 = Math.min(this.H - 1, Math.ceil(yBot * s));
    this.touch(x0, y0, x1, y1);
    var fl = opt.flutes || 0;
    var taper = opt.taper || 0;
    // 斷面法線只跟「橫向位置／半徑」有關：先做一張 257 格的表，逐像素查表（省掉 asin／sin／cos）
    var LN = 256, tNX = new Float32Array(LN + 1), tNZ = new Float32Array(LN + 1), tZZ = new Float32Array(LN + 1);
    for (var k = 0; k <= LN; k++) {
      var qk = k / LN * 2 - 1, zk = Math.sqrt(Math.max(0, 1 - qk * qk));
      var nxk = qk, nzk = zk;
      if (fl) {
        var ang = Math.asin(qk);
        nxk += Math.sin(ang * fl * 2) * 0.25 * zk;
        nzk -= Math.cos(ang * fl * 2) * 0.06;
      }
      var nk = Math.sqrt(nxk * nxk + nzk * nzk) || 1;
      tNX[k] = nxk / nk; tNZ[k] = nzk / nk; tZZ[k] = zk;
    }
    // 上緣（斷柱鋸齒）也只跟 x 有關
    var tops = new Float32Array(x1 - x0 + 1);
    for (var tx = x0; tx <= x1; tx++) tops[tx - x0] = opt.topY ? opt.topY((tx + 0.5) / s) : yTop;
    for (var py = y0; py <= y1; py++) {
      var ly = (py + 0.5) / s;
      var rr = r * (1 - taper * (yBot - ly) / Math.max(1, yBot - yTop));
      for (var px = x0; px <= x1; px++) {
        var lx = (px + 0.5) / s;
        var top = tops[px - x0];
        if (ly < top - 1) continue;
        var dx = (lx - cx) / rr;
        var cov = Math.min(1, Math.max(0, 0.5 - (Math.abs(dx) - 1) * rr * s));
        cov = Math.min(cov, Math.max(0, 0.5 + (ly - top) * s));
        if (cov <= 0) continue;
        var q = dx < -1 ? -1 : (dx > 1 ? 1 : dx);
        var ti = ((q + 1) * 0.5 * LN + 0.5) | 0;
        this.put(py * this.W + px, zc + tZZ[ti] * rr, cov, mi, tNX[ti], 0, tNZ[ti], texValue(opt.tex, lx, ly));
      }
    }
  };

  // 圓錐（石筍、冰柱、尖塔）：底部 (cx, by)，底半徑 rb，高 ht；opt.bend 尖端偏移
  Sculpt.prototype.cone = function (cx, by, rb, ht, zc, mat, opt) {
    opt = opt || {};
    var s = this.s, mi = this.mat(mat);
    var bend = opt.bend || 0, pw = opt.power || 1;
    var x0 = Math.max(0, Math.floor((cx - rb - Math.abs(bend) - 1) * s)), x1 = Math.min(this.W - 1, Math.ceil((cx + rb + Math.abs(bend) + 1) * s));
    var y0 = Math.max(0, Math.floor((by - ht - 1) * s)), y1 = Math.min(this.H - 1, Math.ceil(by * s));
    this.touch(x0, y0, x1, y1);
    var slope = rb / ht;
    for (var py = y0; py <= y1; py++) {
      var ly = (py + 0.5) / s;
      var k = (by - ly) / ht;                       // 0 底 → 1 尖
      if (k > 1) continue;
      var rr = rb * Math.pow(Math.max(0, 1 - k), pw);
      var ccx = cx + bend * k * k;
      for (var px = x0; px <= x1; px++) {
        var lx = (px + 0.5) / s;
        var dx = (lx - ccx) / Math.max(0.3, rr);
        var cov = Math.min(1, Math.max(0, 0.5 - (Math.abs(dx) - 1) * Math.max(0.3, rr) * s));
        if (cov <= 0) continue;
        var q = Math.max(-1, Math.min(1, dx));
        var zz = Math.sqrt(1 - q * q);
        var nx = q, ny = -slope * 0.8 * zz, nz = zz;
        var tilt = facetTilt(opt, lx, ly);
        if (tilt) { nx += tilt[0]; ny += tilt[1] * 0.5; }
        var nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
        this.put(py * this.W + px, zc + zz * rr, cov, mi, nx / nn, ny / nn, nz / nn, texValue(opt.tex, lx, ly));
      }
    }
  };

  /* 凸多邊形平面：法線固定（晶體切面、磚塊頂面）。pts 為邏輯座標，順時針或逆時針皆可。
     opt.zTilt：沿法線方向的深度變化，讓相鄰切面交界的內線畫得出來 */
  Sculpt.prototype.facet = function (pts, zc, nx, ny, nz, mat, opt) {
    opt = opt || {};
    var s = this.s, mi = this.mat(mat);
    var nn = Math.sqrt(nx * nx + ny * ny + nz * nz);
    nx /= nn; ny /= nn; nz /= nn;
    var n = pts.length, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9, cxs = 0, cys = 0;
    for (var i = 0; i < n; i++) {
      minx = Math.min(minx, pts[i][0]); maxx = Math.max(maxx, pts[i][0]);
      miny = Math.min(miny, pts[i][1]); maxy = Math.max(maxy, pts[i][1]);
      cxs += pts[i][0]; cys += pts[i][1];
    }
    cxs /= n; cys /= n;
    // 邊的內向法線（讓重心在內側）
    var edges = [];
    for (var e = 0; e < n; e++) {
      var p = pts[e], q = pts[(e + 1) % n];
      var ex = q[0] - p[0], ey = q[1] - p[1], el = Math.sqrt(ex * ex + ey * ey) || 1;
      var inx = -ey / el, iny = ex / el;
      if ((cxs - p[0]) * inx + (cys - p[1]) * iny < 0) { inx = -inx; iny = -iny; }
      edges.push([p[0], p[1], inx, iny]);
    }
    var x0 = Math.max(0, Math.floor((minx - 1) * s)), x1 = Math.min(this.W - 1, Math.ceil((maxx + 1) * s));
    var y0 = Math.max(0, Math.floor((miny - 1) * s)), y1 = Math.min(this.H - 1, Math.ceil((maxy + 1) * s));
    this.touch(x0, y0, x1, y1);
    var bev = opt.bevel || 0;
    // 上表面換材質（積雪、苔蘚）：這一面朝上，且雜訊遮罩通過的像素
    var topMi = (opt.top && ny < (opt.topThr === undefined ? -0.42 : opt.topThr)) ? this.mat(opt.top) : 0, topNoise = opt.topNoise || 0;
    for (var py = y0; py <= y1; py++) {
      var ly = (py + 0.5) / s;
      for (var px = x0; px <= x1; px++) {
        var lx = (px + 0.5) / s;
        var dmin = 1e9, bi = -1;
        for (var k = 0; k < edges.length; k++) {
          var E = edges[k];
          var dd = (lx - E[0]) * E[2] + (ly - E[1]) * E[3];
          if (dd < dmin) { dmin = dd; bi = k; }
        }
        var cov = Math.min(1, Math.max(0, 0.5 + dmin * s));
        if (cov <= 0) continue;
        var fx = nx, fy = ny, fz = nz;
        if (bev && dmin < bev && bi >= 0) {
          // 斜角：靠邊處法線往外扳
          var w = 1 - Math.max(0, dmin) / bev;
          fx -= edges[bi][2] * w * 0.9; fy -= edges[bi][3] * w * 0.9;
          var fl = Math.sqrt(fx * fx + fy * fy + fz * fz); fx /= fl; fy /= fl; fz /= fl;
        }
        var zt = opt.zTilt ? ((lx - cxs) * -nx + (ly - cys) * -ny) * opt.zTilt : 0;
        var m2 = mi;
        if (topMi && !(topNoise && fbm(lx * 1.7 + 9, ly * 1.7 + 3) < topNoise)) m2 = topMi;
        this.put(py * this.W + px, zc + zt + (bev ? Math.min(dmin, bev) * 0.5 : 0), cov, m2, fx, fy, fz, texValue(opt.tex, lx, ly));
      }
    }
  };

  // 斜角方塊：正面矩形＋（可選）上方頂面（3/4 俯視，頂面高 = depth）
  Sculpt.prototype.block = function (x0, y0, x1, y1, zc, mat, opt) {
    opt = opt || {};
    var bev = opt.bevel === undefined ? 2 : opt.bevel;
    this.facet([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], zc, opt.nx || 0, 0, 1, mat, { bevel: bev, tex: opt.tex });
    if (opt.depth) {
      var d = opt.depth, sk = opt.skew === undefined ? 0 : opt.skew;
      this.facet([[x0 + sk, y0 - d], [x1 + sk, y0 - d], [x1, y0], [x0, y0]], zc - 1, 0, -0.85, 0.53, opt.topMat || mat, { bevel: bev * 0.6, tex: opt.tex });
    }
  };

  // 在已塑形的區域上「刻」凹痕（墓碑字、符文、骨縫）：直接壓低細節高度
  Sculpt.prototype.carve = function (ax, ay, bx, by, width, depth, glow) {
    var s = this.s;
    var r = width / 2;
    var x0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - 1) * s)), x1 = Math.min(this.W - 1, Math.ceil((Math.max(ax, bx) + r + 1) * s));
    var y0 = Math.max(0, Math.floor((Math.min(ay, by) - r - 1) * s)), y1 = Math.min(this.H - 1, Math.ceil((Math.max(ay, by) + r + 1) * s));
    var vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy || 1;
    for (var py = y0; py <= y1; py++) {
      var ly = (py + 0.5) / s;
      for (var px = x0; px <= x1; px++) {
        var i = py * this.W + px;
        if (this.a[i] < 0.5) continue;
        var lx = (px + 0.5) / s;
        var t = ((lx - ax) * vx + (ly - ay) * vy) / len2;
        if (t < 0) t = 0; else if (t > 1) t = 1;
        var dx = lx - (ax + vx * t), dy = ly - (ay + vy * t);
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > r + 0.6) continue;
        var k = Math.max(0, Math.min(1, (r + 0.6 - d) / 1.2));
        this.det[i] -= depth * k;
        if (glow) this.glow[i] = Math.max(this.glow[i], glow * k);
      }
    }
  };

  // 發光遮罩：圓形（火盆煤炭、晶體核心）
  Sculpt.prototype.glowDisc = function (cx, cy, rx, ry, amount) {
    var s = this.s;
    var x0 = Math.max(0, Math.floor((cx - rx) * s)), x1 = Math.min(this.W - 1, Math.ceil((cx + rx) * s));
    var y0 = Math.max(0, Math.floor((cy - ry) * s)), y1 = Math.min(this.H - 1, Math.ceil((cy + ry) * s));
    for (var py = y0; py <= y1; py++) {
      var dy = ((py + 0.5) / s - cy) / ry;
      for (var px = x0; px <= x1; px++) {
        var i = py * this.W + px;
        if (this.a[i] <= 0) continue;
        var dx = ((px + 0.5) / s - cx) / rx;
        var d = dx * dx + dy * dy;
        if (d >= 1) continue;
        this.glow[i] = Math.max(this.glow[i], amount * (1 - d));
      }
    }
  };

  /* ============ 打光與輸出 ============ */
  // 圖集與暫存畫布都放在 CPU 端：逐張 putImageData＋drawImage 若走 GPU 畫布，每次都要同步回讀（實測佔建圖時間一半）
  var CPU_CTX = { willReadFrequently: true };
  var _tmpCanvas = null;
  function tmpCanvas(w, h) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    if (!_tmpCanvas) _tmpCanvas = document.createElement('canvas');
    if (_tmpCanvas.width < w) _tmpCanvas.width = w;
    if (_tmpCanvas.height < h) _tmpCanvas.height = h;
    return _tmpCanvas;
  }

  /* opt.footY：腳底的邏輯 y（越靠近越暗）；opt.footAO：變暗範圍（邏輯像素）
     opt.ao：凹處遮蔽強度；opt.outline：外輪廓強度；opt.inner：前後交界內線強度 */
  Sculpt.prototype.render = function (g, opt) {
    opt = opt || {};
    var W = this.W, H = this.H, s = this.s;
    if (this.bx1 < this.bx0 || this.by1 < this.by0) return null;
    var z = this.z, a = this.a;
    var aoK = opt.ao === undefined ? 0.55 : opt.ao;
    var R = Math.max(2, Math.round(2.2 * s));
    // 只處理圖元掃過的框（外擴 1 像素給描邊、外擴 R 給遮蔽模糊）
    var X0 = Math.max(0, this.bx0 - 1), X1 = Math.min(W - 1, this.bx1 + 1);
    var Y0 = Math.max(0, this.by0 - 1), Y1 = Math.min(H - 1, this.by1 + 1);
    var BW = X1 - X0 + 1, BH = Y1 - Y0 + 1, BN = BW * BH;
    var i, x, y, k2;
    // 凹處遮蔽：框內深度做兩次盒狀模糊，比自己高的鄰居越多越暗
    var zb = null;
    if (aoK > 0) {
      var zf = new Float32Array(BN), tmp = new Float32Array(BN);
      zb = new Float32Array(BN);
      var zmin = 1e9;
      for (y = Y0; y <= Y1; y++) for (x = X0; x <= X1; x++) { i = y * W + x; if (a[i] > 0 && z[i] < zmin) zmin = z[i]; }
      for (y = 0; y < BH; y++) for (x = 0; x < BW; x++) { i = (y + Y0) * W + x + X0; zf[y * BW + x] = a[i] > 0.01 ? z[i] : zmin - 4; }
      var span = 2 * R + 1;
      for (y = 0; y < BH; y++) {
        var row = y * BW, acc = 0;
        for (k2 = -R; k2 <= R; k2++) acc += zf[row + Math.min(BW - 1, Math.max(0, k2))];
        for (x = 0; x < BW; x++) {
          tmp[row + x] = acc / span;
          acc += zf[row + Math.min(BW - 1, x + R + 1)] - zf[row + Math.max(0, x - R)];
        }
      }
      for (x = 0; x < BW; x++) {
        var acc2 = 0;
        for (k2 = -R; k2 <= R; k2++) acc2 += tmp[Math.min(BH - 1, Math.max(0, k2)) * BW + x];
        for (y = 0; y < BH; y++) {
          zb[y * BW + x] = acc2 / span;
          acc2 += tmp[Math.min(BH - 1, y + R + 1) * BW + x] - tmp[Math.max(0, y - R) * BW + x];
        }
      }
    }
    // 材質參數攤平成陣列（避免逐像素查物件屬性）
    var mats = this.mats, NM = mats.length;
    var luts = [], mAmb = new Float32Array(NM), mWrap = new Float32Array(NM), mBump = new Float32Array(NM), mCav = new Float32Array(NM);
    var mSpec = new Float32Array(NM), mSh16 = new Uint8Array(NM), mEmit = new Float32Array(NM);
    var mER = new Float32Array(NM), mEG = new Float32Array(NM), mEB = new Float32Array(NM), mHasE = new Uint8Array(NM);
    var mOR = new Float32Array(NM), mOG = new Float32Array(NM), mOB = new Float32Array(NM);
    var bumpScale = (opt.bump === undefined ? 1 : opt.bump) * s * 0.5;
    luts.push(null);
    for (var mm = 1; mm < NM; mm++) {
      var M = mats[mm], lut = lutOf(M);
      luts.push(lut);
      mAmb[mm] = M.amb === undefined ? 0.3 : M.amb;
      mWrap[mm] = M.wrap === undefined ? 0.25 : M.wrap;
      mBump[mm] = bumpScale * (M.bump === undefined ? 1 : M.bump);
      mCav[mm] = M.cavity === undefined ? 0.04 : M.cavity;
      mSpec[mm] = (M.spec || 0) * 255;
      mSh16[mm] = (M.shin || 16) > 12 ? 1 : 0;
      mEmit[mm] = M.emit || 0;
      if (M.emitColor) { var ec = hexToRgb(M.emitColor); mER[mm] = ec[0]; mEG[mm] = ec[1]; mEB[mm] = ec[2]; mHasE[mm] = 1; }
      mOR[mm] = lut[0] * 0.55; mOG[mm] = lut[1] * 0.55; mOB[mm] = lut[2] * 0.55;
    }
    var cv = tmpCanvas(BW, BH);
    var tctx = cv ? cv.getContext('2d', CPU_CTX) : null;
    var img = tctx && tctx.createImageData ? tctx.createImageData(BW, BH) : null;
    var data = (img && img.data) ? img.data : new Uint8ClampedArray(BN * 4);
    var footY = opt.footY === undefined ? this.lh : opt.footY;
    var footAO = opt.footAO === undefined ? 10 : opt.footAO;
    var outK = opt.outline === undefined ? 0.8 : opt.outline;
    var innerK = opt.inner === undefined ? 0.55 : opt.inner;
    var det = this.det, mA = this.m, NX = this.nx, NY = this.ny, NZ = this.nz, GL = this.glow;
    var zEdge = (opt.zEdge || 3);
    for (var py = Y0; py <= Y1; py++) {
      var ly = (py + 0.5) / s;
      var foot = footAO > 0 ? Math.min(1, Math.max(0, (footY - ly) / footAO)) : 1;
      var footMul = 0.62 + 0.38 * foot;
      var noiseRow = ((py * 7) & TM) << 8;
      for (var px = X0; px <= X1; px++) {
        var idx = py * W + px;
        var al = a[idx];
        if (al <= 0.002) continue;
        var mi = mA[idx];
        if (!mi) continue;
        var dc = det[idx];
        var aL = px > 0 ? a[idx - 1] : 0, aR = px < W - 1 ? a[idx + 1] : 0, aU = py > 0 ? a[idx - W] : 0, aD = py < H - 1 ? a[idx + W] : 0;
        var dl = aL > 0.3 ? det[idx - 1] : dc, dr = aR > 0.3 ? det[idx + 1] : dc;
        var du = aU > 0.3 ? det[idx - W] : dc, dd = aD > 0.3 ? det[idx + W] : dc;
        var bk = mBump[mi];
        var nx = NX[idx] - (dr - dl) * bk, ny = NY[idx] - (dd - du) * bk, nz = NZ[idx];
        var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        var wr = mWrap[mi];
        var dif = (nx * LX + ny * LY + nz * LZ + wr) / (1 + wr);
        if (dif < 0) dif = 0;
        var amb = mAmb[mi];
        var v = amb + (1 - amb) * dif + dc * mCav[mi];
        if (zb) {
          var cav = (zb[(py - Y0) * BW + px - X0] - z[idx]) / 3;
          if (cav > 0) v *= 1 - (cav > 1 ? 1 : cav) * aoK;
        }
        v = v * footMul + (FBM[noiseRow | ((px * 13) & TM)] - 0.5) * 0.05;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        var li = ((v * (LUT_N - 1)) | 0) * 3;
        var lut2 = luts[mi];
        var r = lut2[li], gg = lut2[li + 1], b = lut2[li + 2];
        var sp0 = mSpec[mi];
        if (sp0) {
          var hd = nx * HX + ny * HY + nz * HZ;
          if (hd > 0) {
            var sp = hd * hd; sp *= sp; sp *= sp;
            if (mSh16[mi]) sp *= sp;
            sp *= sp0;
            r += sp; gg += sp; b += sp;
          }
        }
        if (mHasE[mi]) {
          var gw = GL[idx] + mEmit[mi];
          if (gw > 0) { r += mER[mi] * gw; gg += mEG[mi] * gw; b += mEB[mi] * gw; }
        }
        var edge = 0;
        if (outK > 0 && al > 0.5) {
          var lo = aL < aR ? aL : aR;
          if (aU < lo) lo = aU;
          if (aD < lo) lo = aD;
          if (lo < 0.5) edge = outK * (1 - lo);
        }
        if (innerK > 0 && !edge) {
          var zi = z[idx], zd = 0, zt;
          if (aR > 0.5) { zt = z[idx + 1] - zi; if (zt > zd) zd = zt; }
          if (aL > 0.5) { zt = z[idx - 1] - zi; if (zt > zd) zd = zt; }
          if (aU > 0.5) { zt = z[idx - W] - zi; if (zt > zd) zd = zt; }
          if (aD > 0.5) { zt = z[idx + W] - zi; if (zt > zd) zd = zt; }
          if (zd > zEdge) { edge = innerK * ((zd - zEdge) / zEdge + 0.5); if (edge > innerK) edge = innerK; }
        }
        if (edge) {
          r += (mOR[mi] - r) * edge; gg += (mOG[mi] - gg) * edge; b += (mOB[mi] - b) * edge;
        }
        var o = ((py - Y0) * BW + px - X0) * 4;
        data[o] = r; data[o + 1] = gg; data[o + 2] = b;
        data[o + 3] = al * 255;
      }
    }
    if (img && tctx && tctx.putImageData && g && g.drawImage) {
      tctx.clearRect(0, 0, BW, BH);
      tctx.putImageData(img, 0, 0);
      g.drawImage(cv, 0, 0, BW, BH, X0 / s, Y0 / s, BW / s, BH / s);
    }
    // 回傳打光結果（只有圖元掃過的框）：預覽與測試用
    return { data: data, x: X0, y: Y0, w: BW, h: BH };
  };

  /* ============ 地面用：俯視的有機斑塊（per-pixel 雜訊遮罩） ============ */
  // 在 g 上畫一塊不規則的斑塊：fbm 門檻＋放射衰減，邊緣柔和但不是圓形光暈
  function patch(g, w, h, scale, opt) {
    initTables();
    var W = Math.max(1, Math.ceil(w * scale)), H = Math.max(1, Math.ceil(h * scale));
    var cv = tmpCanvas(W, H);
    var tctx = cv ? cv.getContext('2d', CPU_CTX) : null;
    var img = tctx && tctx.createImageData ? tctx.createImageData(W, H) : null;
    var data = (img && img.data) ? img.data : new Uint8ClampedArray(W * H * 4);
    var c = hexToRgb(opt.color), c2 = hexToRgb(opt.color2 || opt.color);
    var ns = opt.noiseScale || 0.9, ox = opt.ox || 0, oy = opt.oy || 0;
    var thr = opt.threshold === undefined ? 0.45 : opt.threshold;
    var soft = opt.soft || 0.12;
    var alpha = opt.alpha === undefined ? 0.5 : opt.alpha;
    for (var py = 0; py < H; py++) {
      var ly = (py + 0.5) / scale, dy = (ly - h / 2) / (h / 2);
      for (var px = 0; px < W; px++) {
        var lx = (px + 0.5) / scale, dx = (lx - w / 2) / (w / 2);
        var rad = Math.sqrt(dx * dx + dy * dy);
        if (rad >= 1) continue;
        var nv = fbm(lx * ns + ox, ly * ns + oy);
        var fall = 1 - rad * rad;
        var m = (nv * 0.75 + fall * 0.55) - 0.55 - thr * 0.3;
        var k = Math.max(0, Math.min(1, (m + soft) / (2 * soft)));
        if (k <= 0) continue;
        var t2 = fbm(lx * ns * 3.3 + 50, ly * ns * 3.3 + 70);
        var o = (py * W + px) * 4;
        data[o] = c[0] + (c2[0] - c[0]) * t2;
        data[o + 1] = c[1] + (c2[1] - c[1]) * t2;
        data[o + 2] = c[2] + (c2[2] - c[2]) * t2;
        data[o + 3] = 255 * alpha * k * (0.75 + 0.5 * (t2 - 0.5));
      }
    }
    if (img && tctx && tctx.putImageData && g && g.drawImage) {
      tctx.clearRect(0, 0, cv.width, cv.height);
      tctx.putImageData(img, 0, 0);
      g.drawImage(cv, 0, 0, W, H, 0, 0, w, h);
    }
  }

  return {
    Sculpt: Sculpt,
    patch: patch,
    fbm: function (u, v) { initTables(); return fbm(u, v); },
    initTables: initTables,
    // 測試用
    _internals: { buildLut: buildLut, hexToRgb: hexToRgb }
  };
})();
