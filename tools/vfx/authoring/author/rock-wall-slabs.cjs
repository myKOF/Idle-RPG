'use strict';
/* rock-wall-slabs.cjs — 築牆用的「整面岩壁」素材：每 15° 一張，共 12 張（0°～165°，牆左右對稱所以 180° 以後重複）。

   為什麼每個角度一張：岩塊是立體的，牆斜著放時，畫面上的接縫與側面都不同；用同一張直立圖沿牆排，
   斜向的牆會重疊或留縫（使用者 2026-10-16 退件）。這裡用實際的斜俯視幾何（地面 y 壓成 0.5）算出每個面，
   所以每張圖的三塊岩塊在接縫處是連續的。不做左右鏡像（Chrome 鏡像下 SVG 光照濾鏡會變全黑）。

   座標：畫布 256×200，地面原點在 (128,140)；authored 單位與 en-stone-wall 一致（牆長 200、厚 67、一塊 66.7×67）。
   世界 (x,y) → 畫面 (x, 0.5·y)，高度往上減 y。光從左上來。
   用法：node tools/vfx/authoring/author/rock-wall-slabs.cjs [輸出資料夾]
         預設輸出到素材庫 D:\MyGame\Asset\claude-authored\rock-wall\（repo 之外，要另外提交） */
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.argv[2] || 'D:/MyGame/Asset/claude-authored/rock-wall';
const W = 256, H = 200, OX = 128, OY = 140;
const LEN = 200, THICK = 67, BLOCKS = 3;
const HEIGHTS = [56, 64, 59];       // 三塊高度略有不同，頂緣才不像一條直線
const STEP = 15;

function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const f1 = v => Math.round(v * 10) / 10;
function mix(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const TOP = [196, 188, 166], LIT = [142, 134, 114], DARK = [62, 58, 46];

function slab(deg) {
  const th = deg * Math.PI / 180, co = Math.cos(th), si = Math.sin(th);
  const R = rnd(7919 + deg * 31);
  const scr = (u, v, h) => { const x = u * co - v * si, y = u * si + v * co; return [OX + x, OY + y * 0.5 - (h || 0)]; };
  const pts = a => a.map(p => f1(p[0]) + ',' + f1(p[1])).join(' ');
  const bw = LEN / BLOCKS;
  const blocks = [];
  for (let i = 0; i < BLOCKS; i++) {
    const u0 = -LEN / 2 + i * bw, u1 = u0 + bw, v0 = -THICK / 2, v1 = THICK / 2, h = HEIGHTS[i];
    blocks.push({ u0, u1, v0, v1, h, key: scr((u0 + u1) / 2, 0, 0)[1] });
  }
  blocks.sort((a, b) => a.key - b.key);             // 畫面上靠後（y 小）的先畫
  /* 頂面四角各自抖一下（共用角在相鄰岩塊上抖得一樣是做不到的，因為高度不同；抖動很小，接縫靠頂面下方的側面蓋住） */
  let body = '', cracks = '';
  blocks.forEach(b => {
    const jit = () => (R() - 0.5) * 5.5;
    const corner = (u, v) => { const p = scr(u, v, b.h); return [p[0] + jit(), p[1] + jit() * 0.6]; };
    const g = (u, v) => scr(u, v, 0);
    const edges = [  // [世界法線(牆座標), 兩端點(牆座標)]
      [[0, -1], [b.u0, b.v0], [b.u1, b.v0]],
      [[0, 1], [b.u0, b.v1], [b.u1, b.v1]],
      [[-1, 0], [b.u0, b.v0], [b.u0, b.v1]],
      [[1, 0], [b.u1, b.v0], [b.u1, b.v1]]
    ];
    const tops = {};
    const tp = (u, v) => { const k = u + ',' + v; return tops[k] || (tops[k] = corner(u, v)); };
    edges.forEach(e => {
      const nx = e[0][0] * co - e[0][1] * si, ny = e[0][0] * si + e[0][1] * co;
      if (ny <= 1e-6) return;                         // 背向畫面（朝上方）的面看不到
      const a = g(e[1][0], e[1][1]), c = g(e[2][0], e[2][1]);
      const ta = tp(e[1][0], e[1][1]), tc = tp(e[2][0], e[2][1]);
      const lam = -(nx * -0.6 + ny * -0.8);   // 光從左上（-0.6,-0.8）來：法線朝向光源越多越亮，背向越暗
      const col = lam > 0 ? mix(LIT, TOP, lam) : mix(LIT, DARK, Math.min(1, -lam * 1.2));
      body += '<polygon points="' + pts([a, c, tc, ta]) + '" fill="' + hex(col) + '" stroke="#2c281c" stroke-opacity=".45" stroke-width="1" stroke-linejoin="round"/>\n';
      // 側面的裂紋與缺角
      for (let k = 0; k < 2; k++) {
        const t = 0.15 + R() * 0.7, x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t;
        const top = ta[1] + (tc[1] - ta[1]) * t;
        const y0 = top + (y - top) * (0.1 + R() * 0.3), y1 = top + (y - top) * (0.5 + R() * 0.4);
        const xt = a[0] + (c[0] - a[0]) * t;
        cracks += '<polyline points="' + f1(xt) + ',' + f1(y0) + ' ' + f1(xt + (R() - 0.5) * 8) + ',' + f1((y0 + y1) / 2) + ' ' + f1(xt + (R() - 0.5) * 8) + ',' + f1(y1) + '" fill="none" stroke="#2a2619" stroke-opacity=".5" stroke-width="1.1" stroke-linecap="round"/>\n';
      }
    });
    const top = [tp(b.u0, b.v0), tp(b.u1, b.v0), tp(b.u1, b.v1), tp(b.u0, b.v1)];
    body += '<polygon points="' + pts(top) + '" fill="' + hex(TOP) + '" stroke="#2c281c" stroke-opacity=".35" stroke-width="1" stroke-linejoin="round"/>\n';
    // 頂面上的碎裂線
    const c0 = scr((b.u0 + b.u1) / 2 + (R() - 0.5) * 20, (R() - 0.5) * 30, b.h);
    cracks += '<polyline points="' + f1(c0[0] - 10) + ',' + f1(c0[1] + 1) + ' ' + f1(c0[0]) + ',' + f1(c0[1] - 2) + ' ' + f1(c0[0] + 12) + ',' + f1(c0[1] + 2) + '" fill="none" stroke="#3a3425" stroke-opacity=".4" stroke-width="1" stroke-linecap="round"/>\n';
  });
  // 腳下碎石
  let rubble = '';
  for (let i = 0; i < 16; i++) {
    const u = (R() - 0.5) * (LEN + 24), side = R() < 0.5 ? -1 : 1, v = side * (THICK / 2 + 1 + R() * 6);
    const p = scr(u, v, 0), r = 1.6 + R() * 3.2;
    rubble += '<ellipse cx="' + f1(p[0]) + '" cy="' + f1(p[1] + 1) + '" rx="' + f1(r) + '" ry="' + f1(r * 0.6) + '" fill="' + hex(mix(LIT, DARK, R())) + '" stroke="#2c281c" stroke-opacity=".4" stroke-width=".8"/>\n';
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- 築牆：朝 ${deg}° 的整面岩壁（三塊 6×6 米岩塊，斜俯視幾何）。原創繪製，岩石表面用雜訊光照。 -->
  <defs>
    <filter id="rock" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.02 0.03" numOctaves="3" seed="${11 + deg % 7}" result="n1"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="n2"/>
      <feComposite in="n1" in2="n2" operator="arithmetic" k1="0" k2="0.8" k3="0.2" k4="0" result="n0"/>
      <feGaussianBlur in="n0" stdDeviation="0.9" result="n"/>
      <feDiffuseLighting in="n" surfaceScale="7" diffuseConstant="1" lighting-color="#ffffff" result="lit">
        <feDistantLight azimuth="235" elevation="55"/>
      </feDiffuseLighting>
      <feComponentTransfer in="lit" result="lit2">
        <feFuncR type="linear" slope="0.8" intercept="0.22"/><feFuncG type="linear" slope="0.8" intercept="0.22"/><feFuncB type="linear" slope="0.8" intercept="0.22"/>
      </feComponentTransfer>
      <feBlend in="SourceGraphic" in2="lit2" mode="multiply" result="m0"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.12 0.14" numOctaves="3" seed="21" result="g0"/>
      <feColorMatrix in="g0" type="saturate" values="0" result="g1"/>
      <feComponentTransfer in="g1" result="grain">
        <feFuncR type="linear" slope="0.4" intercept="0.7"/><feFuncG type="linear" slope="0.4" intercept="0.7"/><feFuncB type="linear" slope="0.4" intercept="0.7"/>
      </feComponentTransfer>
      <feBlend in="m0" in2="grain" mode="multiply" result="m"/>
      <feComposite in="m" in2="SourceAlpha" operator="in"/>
    </filter>
  </defs>
  <g filter="url(#rock)">
${body}  </g>
${cracks}${rubble}</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for (let deg = 0; deg < 180; deg += STEP) {
  const name = 'wall-slab-' + String(deg).padStart(3, '0') + '.svg';
  const svg = slab(deg);
  fs.writeFileSync(path.join(OUT, name), svg);
  console.log(name, Buffer.byteLength(svg));
}
