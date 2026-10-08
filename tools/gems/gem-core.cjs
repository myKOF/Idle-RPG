'use strict';
/* ============================================================
   gem-core.cjs — 寶石圖示的程序化渲染核心（純 Node，沒有外部套件、沒有任何第三方素材）

   做法：寶石是「一組平面取最小值」的凸多面體高度場（min of planes）。
     height(x,y) = min_i ( a_i + bx_i·x + by_i·y )，height>0 的地方就是輪廓。
   每個像素落在哪個平面，就是哪個刻面；法線是常數，所以刻面邊界是乾淨的直線。
   上色：法線 → 漫射＋環境反射（幾個軟光箱）＋鏡面 → 色階（暗／基／亮／高光）。
   材質（不透明石的條紋、紋路、閃點…）在刻面色上疊一層程序化紋理。
   最後在 256×256 上疊光暈（6 階起）、核心光、星芒。

   同一階的外形對所有種類一致（碎塊 → 圓石 → 水滴 → 三角 → 方 → 菱 → 五邊 → 六邊），
   種類只改顏色、材質與「家族」（plain／core 發光核心／ward 光暈色與本體色相不同）。
   ============================================================ */

const SS = 2;               // 超取樣倍率
const OUT = 256;            // 母圖解析度
const S = OUT * SS;         // 工作解析度

/* ---------------- 基礎數學 ---------------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function hash2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {            // -1..1
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, s), b = hash2(ix + 1, iy, s), c = hash2(ix, iy + 1, s), d = hash2(ix + 1, iy + 1, s);
  const t = a + (b - a) * fx, u = c + (d - c) * fx;
  return (t + (u - t) * fy) * 2 - 1;
}
function fbm(x, y, s, oct) {          // 約 -1..1
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise(x * f, y * f, s + o * 31); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

/* ---------------- 色彩 ---------------- */
function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  function f(t) { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function scale3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function add3(a, b, k) { return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]; }
/* 四段色階：t=0 暗 → 0.4 基 → 0.75 亮 → 1 高光 */
function ramp(pal, t) {
  if (t < 0.4) return mix3(pal.dark, pal.base, t / 0.4);
  if (t < 0.75) return mix3(pal.base, pal.light, (t - 0.4) / 0.35);
  return mix3(pal.light, pal.hi, Math.min(1, (t - 0.75) / 0.25));
}

/* ---------------- 幾何 ---------------- */
function normalize3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

function regularPolygon(n, rotDeg) {
  const v = [];
  for (let i = 0; i < n; i++) { const a = (rotDeg + 360 * i / n) * Math.PI / 180; v.push({ x: Math.cos(a), y: Math.sin(a) }); }
  return v;
}
/* 削角：每個頂點換成沿兩邊各退 k 的兩個點 */
function cutCorners(v, k) {
  const out = [], n = v.length;
  for (let i = 0; i < n; i++) {
    const p = v[(i + n - 1) % n], c = v[i], q = v[(i + 1) % n];
    out.push({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k });
    out.push({ x: c.x + (q.x - c.x) * k, y: c.y + (q.y - c.y) * k });
  }
  return out;
}
/* 輪廓正規化：外接框置中，最大半徑 = 1 */
function normalizePoly(v) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  v.forEach(function (p) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let m = 0;
  const w = v.map(function (p) { const q = { x: p.x - cx, y: p.y - cy }; m = Math.max(m, Math.hypot(q.x, q.y)); return q; });
  return w.map(function (p) { return { x: p.x / m, y: p.y / m }; });
}
/* 由多邊形＋剖面組出平面。profile=[[t,z],…]：t 是離邊的內縮距離、z 是高度（單位 R），
   斜率逐段遞減（凹屋頂），最後一點之後是平台（table）；cap>0 時改成斜率 cap 的低錐頂（每邊一面，往中心收）。 */
function planesFromPolygon(verts, profile, stars, R, cap) {
  const planes = [];
  const n = verts.length;
  let cx = 0, cy = 0;
  verts.forEach(function (p) { cx += p.x; cy += p.y; });
  cx /= n; cy /= n;
  for (let i = 0; i < n; i++) {
    const a = verts[i], b = verts[(i + 1) % n];
    let nx = b.y - a.y, ny = -(b.x - a.x);
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    if (nx * ((a.x + b.x) / 2 - cx) + ny * ((a.y + b.y) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const r = (nx * a.x + ny * a.y) * R;
    for (let k = 0; k + 1 < profile.length; k++) {
      const t0 = profile[k][0] * R, z0 = profile[k][1] * R, t1 = profile[k + 1][0] * R, z1 = profile[k + 1][1] * R;
      const s = (z1 - z0) / (t1 - t0), h0 = z0 - s * t0;
      planes.push({ a: h0 + s * r, bx: -s * nx, by: -s * ny });
    }
    if (cap) {
      const last = profile[profile.length - 1], h0 = last[1] * R - cap * last[0] * R;
      planes.push({ a: h0 + cap * r, bx: -cap * nx, by: -cap * ny });
    }
  }
  if (!cap) planes.push({ a: profile[profile.length - 1][1] * R, bx: 0, by: 0 });
  (stars || []).forEach(function (st) {
    for (let i = 0; i < n; i++) {
      const v = verts[i], d = Math.hypot(v.x - cx, v.y - cy), ca = (v.x - cx) / d, sa = (v.y - cy) / d;
      const r = d * st.rf * R;
      planes.push({ a: st.h0 * R + st.slope * r, bx: -st.slope * ca, by: -st.slope * sa, ring: st.ring || 0 });
    }
  });
  return planes;
}

/* ---------------- 階層外形（所有種類共用）----------------
   size＝外接圓半徑（母圖 256 的像素）。外形節奏：斜長薄片 → 斜六邊碎塊 → 斜圓塊 → 正八邊 → 菱形星 →
   長方切角 → 八邊方框 → 星形六邊 → 尖底五邊 → 大圓多邊；階數越高刻面越多、星芒越多、光暈越強。
   poly 是頂點（會依 rot 旋轉後正規化到外接圓半徑 1）；profile 是由邊往中心的凹屋頂剖面。 */
const TIERS = [
  null,
  { name: '薄片', size: 56, rot: -12, poly: [[-0.42, -0.98], [0.70, -0.74], [0.46, 0.98], [-0.72, 0.72]],
    profile: [[0, 0], [0.50, 0.44]], stars: [], glow: 0, spark: 1 },
  { name: '碎塊', size: 62, rot: -22, poly: [[-0.78, -0.14], [-0.30, -0.92], [0.46, -0.84], [0.84, 0.04], [0.30, 0.94], [-0.52, 0.72]],
    profile: [[0, 0], [0.34, 0.30], [0.62, 0.40]], stars: [], glow: 0, spark: 1 },
  { name: '圓塊', size: 70, rot: -20, ngon: [5, -90], cut: 0.18, jitter: [0.05, 0.09, 0.03, 0.08, 0.04],
    profile: [[0, 0], [0.30, 0.30], [0.58, 0.44]], stars: [], glow: 0, spark: 1 },
  { name: '六邊', size: 76, rot: 0, ngon: [6, 0], cut: 0.10, sx: 0.94, jitter: [0.05, 0.06, 0.03, 0.05, 0.06, 0.04],
    profile: [[0, 0], [0.22, 0.28], [0.54, 0.44]], stars: [{ rf: 0.84, h0: 0.18, slope: 0.95, ring: 1 }], glow: 0, spark: 1 },
  { name: '菱形', size: 82, rot: 0, poly: [[0, -1], [0.86, 0], [0, 1], [-0.86, 0]], cut: 0.07, cap: 0.15,
    profile: [[0, 0], [0.22, 0.30], [0.50, 0.46]], stars: [{ rf: 0.80, h0: 0.14, slope: 1.0, ring: 1 }], glow: 0, spark: 2 },
  { name: '長方', size: 84, rot: -8, poly: [[-0.80, -1], [0.80, -1], [0.80, 1], [-0.80, 1]], cut: 0.20,
    profile: [[0, 0], [0.14, 0.20], [0.30, 0.34], [0.54, 0.46]], stars: [{ rf: 0.88, h0: 0.16, slope: 1.0, ring: 1 }], glow: 0.12, spark: 2 },
  { name: '八方', size: 86, rot: 0, ngon: [8, 22.5],
    profile: [[0, 0], [0.12, 0.18], [0.26, 0.32], [0.46, 0.46]], stars: [{ rf: 0.90, h0: 0.14, slope: 1.1, ring: 1 }, { rf: 0.62, h0: 0.30, slope: 0.9, ring: 2 }], glow: 0.24, spark: 3 },
  { name: '星六', size: 88, rot: 0, ngon: [6, -90], cut: 0.12, cap: 0.13,
    profile: [[0, 0], [0.10, 0.16], [0.22, 0.28], [0.40, 0.42]], stars: [{ rf: 0.90, h0: 0.14, slope: 1.1, ring: 1 }, { rf: 0.64, h0: 0.28, slope: 0.9, ring: 2 }], glow: 0.38, spark: 3 },
  { name: '尖底', size: 89, rot: 0, ngon: [5, 90], cut: 0.10, cap: 0.13,
    profile: [[0, 0], [0.09, 0.15], [0.20, 0.27], [0.36, 0.40], [0.52, 0.48]], stars: [{ rf: 0.90, h0: 0.14, slope: 1.15, ring: 1 }, { rf: 0.66, h0: 0.28, slope: 0.95, ring: 2 }], glow: 0.54, spark: 3 },
  { name: '圓多邊', size: 91, rot: 0, ngon: [9, -90], cut: 0.10, cap: 0.12,
    profile: [[0, 0], [0.08, 0.14], [0.18, 0.25], [0.32, 0.37], [0.48, 0.48]], stars: [{ rf: 0.92, h0: 0.12, slope: 1.2, ring: 1 }, { rf: 0.70, h0: 0.24, slope: 1.0, ring: 2 }, { rf: 0.46, h0: 0.38, slope: 0.8, ring: 3 }], glow: 0.72, spark: 4 }
];

function tierVerts(T) {
  let v;
  if (T.poly) v = T.poly.map(function (p) { return { x: p[0], y: p[1] }; });
  else {
    v = regularPolygon(T.ngon[0], T.ngon[1]);
    if (T.sx) v = v.map(function (p) { return { x: p.x * T.sx, y: p.y }; });
    if (T.jitter) v = v.map(function (p, i) { const k = 1 + (T.jitter[i % T.jitter.length] - 0.045); return { x: p.x * k, y: p.y * k }; });
  }
  if (T.cut) v = cutCorners(v, T.cut);
  const a = (T.rot || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  v = v.map(function (p) { return { x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca }; });
  return normalizePoly(v);
}
function tierGeometry(tier, R) {
  const T = TIERS[tier];
  return planesFromPolygon(tierVerts(T), T.profile, T.stars, R, T.cap);
}

/* ---------------- 打光 ---------------- */
const L = normalize3([-0.46, -0.58, 0.67]);
const KEY = normalize3([-0.42, -0.55, 0.72]);
const FILL = normalize3([0.66, 0.30, 0.69]);
const RIM = normalize3([0.20, 0.80, 0.56]);
const HALF = normalize3([L[0], L[1], L[2] + 1]);
function envMap(rx, ry, rz) {
  const k = smoothstep(0.80, 0.97, rx * KEY[0] + ry * KEY[1] + rz * KEY[2]);
  const f = smoothstep(0.86, 0.985, rx * FILL[0] + ry * FILL[1] + rz * FILL[2]) * 0.6;
  const r = smoothstep(0.84, 0.98, rx * RIM[0] + ry * RIM[1] + rz * RIM[2]) * 0.35;
  const amb = 0.30 + 0.20 * (-ry) + 0.10 * (rz - 0.5);
  return clamp(amb + k + f + r, 0, 1.4);
}

/* ---------------- 材質紋理 ----------------
   回傳 {m: 與第二色混合的比例, add: 加亮（白）, tint: 第二色} */
function texture(def, X, Y, R, nx, ny, id, seed) {
  const tx = def.tex;
  if (!tx) return null;
  const u = X / R, v = Y / R;
  switch (tx.kind) {
    case 'bands': {          // 瑪瑙／孔雀石：翹曲的同心帶
      const w = fbm(u * 1.6, v * 1.6, seed + 3, 3) * (tx.warp || 0.9);
      const q = (tx.concentric ? Math.hypot(u * 0.9, v) : (u * (tx.ax || 0.8) + v * (tx.ay || 0.5))) * tx.freq + w * 2.2;
      const b = Math.sin(q * Math.PI * 2);
      return { m: smoothstep(-0.25, 0.25, b) * (tx.amt === undefined ? 1 : tx.amt), tint: tx.alt, add: 0 };
    }
    case 'veins': {          // 綠松石：暗色網紋
      const n = Math.abs(fbm(u * 2.6, v * 2.6, seed + 7, 4));
      const m = smoothstep(0.17, 0.02, n);
      const sp = smoothstep(0.62, 0.9, fbm(u * 5, v * 5, seed + 9, 2) * 0.5 + 0.5) * 0.18;
      return { m: m * 0.72, tint: tx.alt, add: sp };
    }
    case 'flecks': {         // 青金石：金色黃鐵礦斑點＋白色方解石絲
      const cell = 7, gx = Math.floor(u * cell), gy = Math.floor(v * cell);
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx, cy = gy + dy;
        if (hash2(cx, cy, seed + 21) < 0.80) continue;
        const px = (cx + 0.15 + 0.7 * hash2(cx, cy, seed + 22)) / cell, py = (cy + 0.15 + 0.7 * hash2(cx, cy, seed + 23)) / cell;
        const rad = 0.014 + 0.018 * hash2(cx, cy, seed + 24);
        m = Math.max(m, smoothstep(rad * 1.4, rad * 0.6, Math.hypot(u - px, v - py)));
      }
      const vein = smoothstep(0.10, 0.0, Math.abs(fbm(u * 2.2, v * 2.2, seed + 5, 3))) * 0.45;
      return { m: m, tint: tx.alt, add: m * 0.12, veinTint: tx.vein, vein: vein };
    }
    case 'glitter': {        // 日光石：金屬閃點
      const cell = 34, gx = Math.floor(u * cell), gy = Math.floor(v * cell);
      const h = hash2(gx, gy, seed + 31);
      const lit = hash2(gx, gy, seed + 32) * 0.5 + 0.5 * clamp(nx * 1.2 + ny * 0.6 + 0.5, 0, 1);
      const add = h > 0.84 ? (h - 0.84) / 0.16 * (0.35 + 0.65 * lit) : 0;
      return { m: 0, tint: null, add: add * (tx.amt || 0.8) };
    }
    case 'patches': {        // 蛋白石：遊彩（柔和的色斑，不蓋掉刻面）
      const a = fbm(u * 1.8, v * 1.8, seed + 41, 3), b = fbm(u * 3.1 + 5, v * 3.1 - 2, seed + 43, 3);
      const hue = (a * 380 + b * 160 + 200);
      return { m: smoothstep(0.0, 0.5, b + a * 0.4) * 0.5, tint: hsl(hue, 0.7, 0.7), add: 0 };
    }
    case 'sheen': {          // 月光石／珍珠：柔光帶
      const ang = tx.angle || -0.6;
      const d = (u * Math.cos(ang) + v * Math.sin(ang) - (tx.off || 0)) / (tx.w || 0.32);
      const g = Math.exp(-d * d);
      return { m: g * 0.75, tint: tx.alt, add: g * (tx.add || 0.25) };
    }
    case 'slit': {           // 貓眼：細亮縫
      const d = (u * Math.cos(0.12) - v * Math.sin(0.12)) / 0.075;
      const g = Math.exp(-d * d) * smoothstep(1.15, 0.35, Math.abs(v));
      const side = smoothstep(0.15, 0.85, Math.abs(u)) * 0.5;
      return { m: g * 0.9, tint: tx.alt, add: g * 0.55, dark: side };
    }
    case 'mottle': {         // 翡翠：柔霧
      const n = fbm(u * 2.0, v * 2.0, seed + 51, 4);
      return { m: smoothstep(-0.3, 0.4, n) * 0.8, tint: tx.alt, add: 0 };
    }
    case 'chatoyant': {      // 虎眼：平行絲光帶
      const q = (u * 0.35 + v * 1.0) * tx.freq + fbm(u * 2.2, v * 2.2, seed + 71, 3) * 1.2;
      const b = Math.sin(q * Math.PI * 2);
      const sh = Math.exp(-Math.pow((nx * 1.3 + ny * 0.7 + 0.1) * 2.4, 2)) * 0.55;
      return { m: smoothstep(-0.2, 0.3, b) * 0.9, tint: tx.alt, add: sh * smoothstep(-0.2, 0.5, b) * 0.6 };
    }
    case 'fire': {           // 鑽石：色散火彩
      const f = vnoise(id * 1.7, id * 0.9 + 3, seed);
      return { m: Math.abs(f) * 0.30, tint: hsl(f > 0 ? 320 : 195, 0.7, 0.78), add: 0 };
    }
    case 'rainbow': {        // 全屬性：繞中心的連續彩虹
      const hue = Math.atan2(v, u) * 180 / Math.PI + 90 + Math.hypot(u, v) * 50;
      return { m: 0.58, tint: hsl(hue, 0.85, 0.62), add: 0 };
    }
    default: return null;
  }
}

/* ---------------- 單張渲染 ---------------- */
function shadeGem(def, tier, seed) {
  const T = TIERS[tier];
  const R = T.size * SS;
  const planes = tierGeometry(tier, R), P = planes.length;
  const A = new Float32Array(P), BX = new Float32Array(P), BY = new Float32Array(P), GM = new Float32Array(P);
  for (let i = 0; i < P; i++) { A[i] = planes[i].a; BX[i] = planes[i].bx; BY[i] = planes[i].by; GM[i] = Math.hypot(BX[i], BY[i]); }
  const out = new Float32Array(S * S * 4);
  const pal = def.pal, ctr = S / 2;
  const trans = def.trans === undefined ? 1 : def.trans;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const X = x + 0.5 - ctr, Y = y + 0.5 - ctr;
      let m1 = 1e9, m2 = 1e9, i1 = -1, i2 = -1;
      for (let p = 0; p < P; p++) {
        const v = A[p] + BX[p] * X + BY[p] * Y;
        if (v < m1) { m2 = m1; i2 = i1; m1 = v; i1 = p; } else if (v < m2) { m2 = v; i2 = p; }
      }
      if (m1 < -1.5 || i1 < 0) continue;
      const h = m1, id = i1;
      const l = Math.hypot(BX[i1], BY[i1], 1);
      const nx = -BX[i1] / l, ny = -BY[i1] / l, nz = 1 / l, grad = GM[i1];
      const isTable = grad < 0.2;                        // 平台或低錐頂：大面積、接近水平
      const edgeDist = i2 >= 0 && Math.hypot(BX[i2] - BX[i1], BY[i2] - BY[i1]) > 1e-4
        ? (m2 - m1) / Math.hypot(BX[i2] - BX[i1], BY[i2] - BY[i1]) : 99;
      const dist = isTable ? 999 : h / grad;            // 到輪廓的像素距離（輪廓內為正）
      const cover = isTable ? 1 : clamp(dist + 0.5, 0, 1);
      if (cover <= 0) continue;

      // —— 上色 ——
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const env = envMap(2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1);
      const spec = Math.pow(Math.max(0, nx * HALF[0] + ny * HALF[1] + nz * HALF[2]), def.shin || 46);
      const jit = (hash2(id, 5, seed) - 0.5) * (def.jitter === undefined ? 0.20 : def.jitter);
      let tl = -0.04 + 0.44 * diff + (def.envW === undefined ? 0.50 : def.envW) * env + jit;
      const depthN = clamp(h / (R * 0.5), 0, 1);
      tl += 0.08 * depthN * trans;
      // 平台是大平面：加一道由左上往右下的柔和反光，免得像一塊死色
      if (isTable) tl += 0.20 * clamp(0.5 - (X * 0.6 + Y * 0.8) / (R * 0.9), -0.5, 0.9) * trans;
      tl = lerp(def.flat === undefined ? 0.42 : def.flat, tl, 0.55 + 0.45 * trans);
      tl = clamp(tl, 0, 1);

      let col = ramp(pal, clamp(tl, 0, 1));
      if (def.acc) {                                     // 第二色：與主色同一套明暗，只換色相
        const rr = Math.hypot(X, Y) / R;
        let m;
        if (def.accMode === 'center') m = 1 - smoothstep(0.12, 0.72, rr);
        else if (def.accMode === 'rim') m = smoothstep(0.32, 0.86, rr);
        else if (def.accMode === 'facet') m = hash2(id, 17, seed) < (def.accShare || 0.4) ? 1 : 0;
        else {
          const ang = def.accAngle === undefined ? 0.9 : def.accAngle;
          m = smoothstep(0.32, 0.68, (X * Math.cos(ang) + Y * Math.sin(ang)) / R * 0.5 + 0.5 + fbm(X / R * 1.3, Y / R * 1.3, seed + 61, 2) * 0.2);
        }
        col = mix3(col, ramp(def.acc, clamp(tl, 0, 1)), m * (def.accAmt === undefined ? 0.88 : def.accAmt));
      }
      const tex = texture(def, X, Y, R, nx, ny, id, seed);
      if (tex) {
        if (tex.tint && tex.m > 0) col = mix3(col, scale3(tex.tint, 0.55 + 0.7 * clamp(tl, 0, 1)), clamp(tex.m, 0, 1));
        if (tex.vein) col = mix3(col, scale3(tex.veinTint || [0.9, 0.95, 1], 0.45 + tl * 0.6), clamp(tex.vein, 0, 0.7));
        if (tex.dark) col = scale3(col, 1 - tex.dark * 0.45);
        if (tex.add) col = add3(col, pal.hi, tex.add);
      }
      if (spec > 0.02) col = add3(col, pal.hi, spec * (def.specW === undefined ? 0.9 : def.specW));
      // 刻面邊線
      if (edgeDist < 2.2) {
        const e = 1 - smoothstep(0.3, 1.5, edgeDist);
        col = mix3(col, ramp(pal, Math.min(1, tl + 0.42)), e * (def.edgeW === undefined ? 0.6 : def.edgeW));
      }
      // 輪廓：外緣壓暗，內側一圈亮邊（受光側較亮）
      const rimDark = smoothstep(3.4, 0.6, dist);
      col = mix3(col, scale3(pal.dark, 0.55), rimDark * 0.85);
      const rimLight = (smoothstep(1.8, 4.2, dist) * smoothstep(8.5, 4.2, dist)) * clamp(0.25 + diff * 0.55, 0, 0.8);
      col = mix3(col, ramp(pal, 0.9), rimLight * 0.4);

      const o = (y * S + x) * 4;
      out[o] = clamp(col[0], 0, 1) * cover; out[o + 1] = clamp(col[1], 0, 1) * cover; out[o + 2] = clamp(col[2], 0, 1) * cover; out[o + 3] = cover;
    }
  }
  return out;
}

/* 2×2 平均縮到 OUT，並把外接框置中 */
function downAndCenter(buf) {
  const o = new Float32Array(OUT * OUT * 4);
  for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += buf[((y * SS + dy) * S + x * SS + dx) * 4 + c];
      o[(y * OUT + x) * 4 + c] = s / (SS * SS);
    }
  }
  let x0 = OUT, x1 = -1, y0 = OUT, y1 = -1;
  for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) if (o[(y * OUT + x) * 4 + 3] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return o;
  const sx = Math.round(OUT / 2 - (x0 + x1 + 1) / 2), sy = Math.round(OUT / 2 - (y0 + y1 + 1) / 2);
  if (!sx && !sy) return o;
  const r = new Float32Array(OUT * OUT * 4);
  for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
    const nx2 = x + sx, ny2 = y + sy;
    if (nx2 < 0 || ny2 < 0 || nx2 >= OUT || ny2 >= OUT) continue;
    const a = (y * OUT + x) * 4, b = (ny2 * OUT + nx2) * 4;
    r[b] = o[a]; r[b + 1] = o[a + 1]; r[b + 2] = o[a + 2]; r[b + 3] = o[a + 3];
  }
  return r;
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[y * w + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[y * w + x] = s * k; s += src[y * w + clamp(x + r + 1, 0, w - 1)] - src[y * w + clamp(x - r, 0, w - 1)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s * k; s += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x]; }
  }
  return out;
}
function gauss(src, w, h, r) { let a = src; for (let i = 0; i < 3; i++) a = boxBlur(a, w, h, r); return a; }

/* premultiplied over：dst ← src(color,a) over dst */
function overPx(d, o, col, a) {
  const ia = 1 - a;
  d[o] = col[0] * a + d[o] * ia; d[o + 1] = col[1] * a + d[o + 1] * ia; d[o + 2] = col[2] * a + d[o + 2] * ia; d[o + 3] = a + d[o + 3] * ia;
}
function addPx(d, o, col, a) {
  d[o] += col[0] * a; d[o + 1] += col[1] * a; d[o + 2] += col[2] * a;
  d[o + 3] = Math.max(d[o + 3], Math.min(1, a));
}

function drawStar(d, cx, cy, len, thick, col, amt) {
  const r = Math.ceil(len) + 2;
  for (let y = Math.floor(cy) - r; y <= Math.floor(cy) + r; y++) for (let x = Math.floor(cx) - r; x <= Math.floor(cx) + r; x++) {
    if (x < 0 || y < 0 || x >= OUT || y >= OUT) continue;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const along1 = Math.exp(-Math.pow(dy / thick, 2)) * Math.pow(Math.max(0, 1 - Math.abs(dx) / len), 1.6);
    const along2 = Math.exp(-Math.pow(dx / thick, 2)) * Math.pow(Math.max(0, 1 - Math.abs(dy) / len), 1.6);
    const dd = Math.hypot(dx, dy), core = Math.exp(-Math.pow(dd / (thick * 2.4), 2)) * 0.9;
    const a = clamp((along1 + along2) * 0.9 + core, 0, 1) * amt;
    if (a > 0.004) addPx(d, (y * OUT + x) * 4, col, a);
  }
}

/* 全流程：回傳 straight RGBA 的 Uint8ClampedArray（OUT×OUT） */
function renderGem(def, tier, seed) {
  const T = TIERS[tier];
  seed = seed || 1;
  const layer = downAndCenter(shadeGem(def, tier, seed));
  const N = OUT * OUT;
  const d = new Float32Array(N * 4);
  const ctr = OUT / 2;
  const rGem = T.size;

  // 光暈：1～5 階沒有，6 階起淡淡出現，隨階數加濃，10 階最濃（強度表在 TIERS.glow）
  const mask = new Float32Array(N);
  for (let i = 0; i < N; i++) mask[i] = layer[i * 4 + 3];
  const glowK = T.glow * (def.glowW === undefined ? 1 : def.glowW);
  if (glowK > 0.005) {
    const g1 = gauss(mask, OUT, OUT, 7), g2 = gauss(mask, OUT, OUT, 20);
    const gc = def.glow || def.pal.glow, rainbow = !!(def.tex && def.tex.kind === 'rainbow');
    for (let i = 0; i < N; i++) {
      const a = clamp((g1[i] * 0.9 + g2[i] * 1.5) * glowK, 0, 0.92);
      if (a > 0.003) {
        const hot = clamp((a - 0.45) * 1.4, 0, 0.55);
        const base = rainbow ? hsl(Math.atan2(((i / OUT) | 0) - ctr, (i % OUT) - ctr) * 180 / Math.PI + 90, 0.85, 0.68) : gc;
        overPx(d, i * 4, mix3(base, def.pal.hi, hot), a);
      }
    }
  }
  // 寶石本體
  for (let i = 0; i < N; i++) {
    const a = layer[i * 4 + 3];
    if (a <= 0) continue;
    const o = i * 4, ia = 1 - a;
    d[o] = layer[o] + d[o] * ia; d[o + 1] = layer[o + 1] + d[o + 1] * ia; d[o + 2] = layer[o + 2] + d[o + 2] * ia; d[o + 3] = a + d[o + 3] * ia;
  }
  // 核心光（core 家族）：在寶石內部發亮
  if (def.family === 'core') {
    const cc = def.pal.core || mix3(def.pal.hi, [1, 1, 1], 0.5);
    const sig = rGem * 0.42;
    for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
      const o = (y * OUT + x) * 4, a = layer[o + 3];
      if (a <= 0) continue;
      const dx = x + 0.5 - ctr, dy = y + 0.5 - ctr, dd = Math.hypot(dx, dy);
      const core = Math.exp(-Math.pow(dd / (sig * 0.55), 2)) * 0.95 + Math.exp(-Math.pow(dd / sig, 2)) * 0.45;
      const ray = (Math.exp(-Math.pow(dx / 3.2, 2)) + Math.exp(-Math.pow(dy / 3.2, 2))) * Math.exp(-Math.pow(dd / (rGem * 0.8), 2)) * 0.22;
      const k = clamp(core + ray, 0, 1) * a;
      d[o] += cc[0] * k; d[o + 1] += cc[1] * k; d[o + 2] += cc[2] * k;
    }
  }
  // 星芒與環繞光點
  const spots = [[-0.46, -0.50, 1.0], [0.50, 0.42, 0.55], [0.12, -0.78, 0.45], [-0.66, 0.34, 0.4]];
  for (let k = 0; k < (T.spark || 0); k++) {
    const sp = spots[k];
    drawStar(d, ctr + sp[0] * rGem, ctr + sp[1] * rGem, (9 + tier * 1.8) * sp[2], 0.9 + sp[2] * 0.7, mix3(def.pal.hi, [1, 1, 1], 0.6), 0.95);
  }

  // 貼邊淡出：光暈的尾巴不能被圖片邊界截斷，否則深色格子裡會露出一圈方形的淡邊
  const FADE = 22;
  for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
    const e = Math.min(x, y, OUT - 1 - x, OUT - 1 - y);
    if (e >= FADE) continue;
    const k = smoothstep(0, FADE, e), o = (y * OUT + x) * 4;
    d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; d[o + 3] *= k;
  }

  // 轉成 straight RGBA 8-bit（加一點抖動避免光暈斷階）
  const px = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    const a = clamp(d[i * 4 + 3], 0, 1);
    if (a <= 0.002) continue;
    const dith = (hash2(i % OUT, (i / OUT) | 0, 99) - 0.5) / 255;
    px[i * 4] = clamp(d[i * 4] / a + dith, 0, 1) * 255 + 0.5;
    px[i * 4 + 1] = clamp(d[i * 4 + 1] / a + dith, 0, 1) * 255 + 0.5;
    px[i * 4 + 2] = clamp(d[i * 4 + 2] / a + dith, 0, 1) * 255 + 0.5;
    px[i * 4 + 3] = clamp(a + dith, 0, 1) * 255 + 0.5;
  }
  return px;
}
/* 面積平均縮圖（straight RGBA，以 alpha 加權） */
function resizeRGBA(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const kx = sw / dw, ky = sh / dh;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const x0 = x * kx, x1 = (x + 1) * kx, y0 = y * ky, y1 = (y + 1) * ky;
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
      const w = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy));
      const o = (yy * sw + xx) * 4, sa = src[o + 3] / 255;
      r += src[o] * sa * w; g += src[o + 1] * sa * w; b += src[o + 2] * sa * w; a += sa * w; wsum += w;
    }
    const o2 = (y * dw + x) * 4;
    if (a > 0) { out[o2] = r / a + 0.5; out[o2 + 1] = g / a + 0.5; out[o2 + 2] = b / a + 0.5; out[o2 + 3] = a / wsum * 255 + 0.5; }
  }
  return out;
}

module.exports = { OUT, TIERS, renderGem, resizeRGBA, hsl, mix3, mulberry32, hash2, clamp };
