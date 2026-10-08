'use strict';
/* 寶石顏色距離：取寶石本體（不透明）的像素，轉 CIELAB 後做 3 群聚類，兩張圖的距離＝
   3 個色群以最佳配對的 ΔE 加權平均（群大小加權）。gem-audit.cjs 與 tests/gem-icons.test.cjs 共用。
   低於 PALETTE_MIN_DISTANCE 視為「兩種寶石看起來一樣」。 */
const PALETTE_MIN_DISTANCE = 12;

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  function f(t) { return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; }
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
function de(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

/* px：straight RGBA（每像素 4 個 byte）；width 給了就扣掉貼近輪廓的像素（寬度的 1/40，80px 圖＝2px）。
   低階寶石本體只有一點點像素，一圈深色輪廓就占了大半，不扣的話兩顆明明不同的寶石會因為輪廓都是暗色而被量成很近。 */
function signature(px, width) {
  const pts = [];
  const e = width ? Math.max(1, Math.round(width / 40)) : 0, h = width ? px.length / 4 / width : 0;
  function solid(x, y) { return x >= 0 && y >= 0 && x < width && y < h && px[(y * width + x) * 4 + 3] > 250; }
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] <= 250) continue;
    if (e) {
      const x = (i / 4) % width, y = Math.floor(i / 4 / width);
      let inner = true;
      for (let dy = -e; dy <= e && inner; dy++) for (let dx = -e; dx <= e; dx++) if (!solid(x + dx, y + dy)) { inner = false; break; }
      if (!inner) continue;
    }
    pts.push(lab(px[i], px[i + 1], px[i + 2]));
  }
  if (!pts.length) throw new Error('沒有寶石本體的像素可以量');
  const mean = [0, 0, 0];
  pts.forEach(function (p) { mean[0] += p[0]; mean[1] += p[1]; mean[2] += p[2]; });
  mean[0] /= pts.length; mean[1] /= pts.length; mean[2] /= pts.length;
  const sorted = pts.slice().sort(function (a, b) { return a[0] - b[0]; });
  let cs = [sorted[Math.floor(sorted.length * 0.2)], sorted[Math.floor(sorted.length * 0.5)], sorted[Math.floor(sorted.length * 0.85)]].map(function (p) { return p.slice(); });
  let cnt = [0, 0, 0];
  for (let it = 0; it < 8; it++) {
    const sum = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; cnt = [0, 0, 0];
    pts.forEach(function (p) {
      let k = 0, best = 1e9;
      for (let j = 0; j < 3; j++) { const d = de(p, cs[j]); if (d < best) { best = d; k = j; } }
      sum[k][0] += p[0]; sum[k][1] += p[1]; sum[k][2] += p[2]; cnt[k]++;
    });
    cs = cs.map(function (c, j) { return cnt[j] ? [sum[j][0] / cnt[j], sum[j][1] / cnt[j], sum[j][2] / cnt[j]] : c; });
  }
  return { mean: mean, cs: cs, w: cnt.map(function (n) { return n / pts.length; }) };
}

const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
function distance(a, b) {
  let best = 1e9;
  PERMS.forEach(function (p) {
    let s = 0;
    for (let i = 0; i < 3; i++) s += (a.w[i] + b.w[p[i]]) / 2 * de(a.cs[i], b.cs[p[i]]);
    if (s < best) best = s;
  });
  return best;
}

/* sigs＝{key: signature}；回傳距離由小到大的兩兩配對 */
function closestPairs(sigs) {
  const keys = Object.keys(sigs), pairs = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    pairs.push({ a: keys[i], b: keys[j], d: distance(sigs[keys[i]], sigs[keys[j]]), m: de(sigs[keys[i]].mean, sigs[keys[j]].mean) });
  }
  return pairs.sort(function (x, y) { return x.d - y.d; });
}

module.exports = { PALETTE_MIN_DISTANCE, signature, distance, closestPairs };
