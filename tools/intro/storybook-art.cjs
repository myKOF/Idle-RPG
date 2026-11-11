'use strict';
/* =============================================================================
   storybook-art.cjs — 繪本式序章的分件插圖（原創程序生成 SVG，無外部素材）
   -----------------------------------------------------------------------------
   畫風：舊書頁上的墨線插畫——深褐墨線、棕褐淡彩、金色描金、光翼留白。
   每個會動的部位各自一個檔，序章播放器（js/intro-scene.js）分開控制：
     rays.svg          天光放射線（背景，慢轉＋呼吸）
     clouds-far/mid/near.svg  三層雲帶（視差各自漂移）
     wing-upper.svg    上翼（左側；右側由播放器水平翻轉同一張圖）
     wing-lower.svg    下翼
     cape.svg          披風（以肩線為軸擺動）
     body.svg          甲冑本體（含頭盔、雙手手甲）
     sword.svg         劍（握在右手，劍光另外疊）
     halo.svg          光環
     frame.svg         書頁墨線邊框
   天使造型為原創：翼盔、日紋胸甲、白色罩袍、兩對羽毛光翼；刻意不沿用任何既有遊戲角色的特徵
   （例如兜帽空臉、飄帶光翼）。

   用法：node tools/intro/storybook-art.cjs   （輸出到 images/intro-storybook/）
   固定亂數種子，重跑結果相同。
   ============================================================================= */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'images', 'intro-storybook');
const INK = '#2a170a';
const SEPIA = '#7a4d22';
const GOLD = '#b8862c';
const GOLD_L = '#e6c46e';
const LIGHT = '#fff7dc';
const CLOTH = '#f3ead2';

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f = (n) => Math.round(n * 10) / 10;
const pt = (p) => f(p[0]) + ' ' + f(p[1]);

/* 墨線毛邊：小幅位移讓線條不像向量那麼死板。轉成圖片時只算一次，不影響播放。 */
const INK_FILTER = `<filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/>
</filter>`;

function svg(w, h, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
<defs>${INK_FILTER}${defs || ''}</defs>
${body}
</svg>
`;
}

/* ---------- 羽毛與翅膀 ---------- */
// 一根羽毛：從 base 指向角度 ang（度）、長 len、最寬 wid；bend 讓羽軸微彎
function feather(base, ang, len, wid, bend, r) {
  const a = ang * Math.PI / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const nx = -dy, ny = dx;
  const tip = [base[0] + dx * len + nx * bend, base[1] + dy * len + ny * bend];
  const mid = (t, side) => [
    base[0] + dx * len * t + nx * (bend * t * t + side * wid * Math.sin(Math.PI * Math.pow(t, 0.8))),
    base[1] + dy * len * t + ny * (bend * t * t + side * wid * Math.sin(Math.PI * Math.pow(t, 0.8)))
  ];
  const l1 = mid(0.35, 1), l2 = mid(0.8, 1.05), r1 = mid(0.35, -1), r2 = mid(0.8, -1.05);
  const outline = `M${pt(base)} C${pt(l1)} ${pt(l2)} ${pt(tip)} C${pt(r2)} ${pt(r1)} ${pt(base)}Z`;
  const shaft = `M${pt(base)} Q${pt(mid(0.5, 0))} ${pt(tip)}`;
  // 羽枝細線：只畫一側幾條，像版畫刻線
  let barbs = '';
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const t = 0.3 + i * (0.55 / n) + r() * 0.04;
    const s = mid(t, 0), e = mid(Math.min(0.98, t + 0.12), 0.85);
    barbs += `M${pt(s)} L${pt(e)} `;
  }
  return { outline, shaft, barbs };
}

/* 翅膀：以「臂骨」為骨架——肩→腕一條弧線，次級飛羽沿臂骨往下垂、初級飛羽從腕部向外張開，
   上面再蓋兩排覆羽與前緣羽帶。這樣輪廓才像翅膀，而不是從一點放射的光芒。 */
function wing(opts) {
  const r = rng(opts.seed);
  const { w, h, shoulder, ctrl, wrist } = opts;
  const arm = (u) => [
    (1 - u) * (1 - u) * shoulder[0] + 2 * (1 - u) * u * ctrl[0] + u * u * wrist[0],
    (1 - u) * (1 - u) * shoulder[1] + 2 * (1 - u) * u * ctrl[1] + u * u * wrist[1]
  ];
  const groups = [];   // [{ fill, items: [feather] }]，由後往前畫
  const row = (spec) => {
    const items = [];
    for (let i = 0; i < spec.count; i++) {
      const t = spec.count === 1 ? 0.5 : i / (spec.count - 1);
      const u = spec.u0 + (spec.u1 - spec.u0) * t;
      const base = arm(u);
      const ang = spec.a0 + (spec.a1 - spec.a0) * t + (r() - 0.5) * 3;
      const len = spec.len(t) * (0.94 + r() * 0.12);
      items.push(feather([base[0] + (spec.dx || 0), base[1] + (spec.dy || 0)], ang, len, spec.wid(t), spec.bend, r));
    }
    // 後面的羽毛先畫：讓靠肩的羽毛壓在外側之上
    groups.push({ fill: spec.fill, items: spec.reverse ? items.reverse() : items });
  };
  opts.rows.forEach(row);
  // 前緣羽帶：沿臂骨的粗帶，下緣扇貝狀
  const band = [];
  const N = 22;
  for (let i = 0; i <= N; i++) { const p = arm(i / N); band.push([p[0], p[1] - opts.band * 0.55]); }
  let edge = `M${pt(band[0])} `;
  for (let i = 1; i <= N; i++) edge += `L${pt(band[i])} `;
  for (let i = N; i >= 0; i--) {
    const p = arm(i / N), q = arm(Math.max(0, (i - 1) / N));
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + opts.band * 0.95];
    edge += `L${pt([p[0], p[1] + opts.band * 0.45])} `;
    if (i > 0) edge += `Q${pt(mid)} ${pt([q[0], q[1] + opts.band * 0.45])} `;
  }
  edge += 'Z';

  let body = '';
  groups.forEach((g) => {
    g.items.forEach((fe) => {
      body += `<path d="${fe.outline}" fill="url(#${g.fill})"/>` +
        `<path filter="url(#ink)" d="${fe.outline}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
        `<path filter="url(#ink)" d="${fe.shaft} ${fe.barbs}" fill="none" stroke="${SEPIA}" stroke-width="1.3" stroke-linecap="round" opacity="0.85"/>`;
    });
  });
  const defs = `
<linearGradient id="featherLight" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fffdf3"/>
  <stop offset="0.6" stop-color="${LIGHT}"/>
  <stop offset="1" stop-color="${GOLD_L}"/>
</linearGradient>
<linearGradient id="featherShade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f6e9c4"/>
  <stop offset="1" stop-color="#cfa75a"/>
</linearGradient>
<linearGradient id="featherWarm" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${GOLD_L}"/>
  <stop offset="1" stop-color="${GOLD}"/>
</linearGradient>`;
  return svg(w, h, defs, `${body}
<path d="${edge}" fill="url(#featherWarm)"/>
<path filter="url(#ink)" d="${edge}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`);
}

// 上翼（左側；翻轉後當右翼）：肩胛在右，臂骨往左上揚到腕部，初級飛羽向左張開
function wingUpper() {
  return wing({
    w: 900, h: 780, shoulder: [840, 470], ctrl: [590, 190], wrist: [330, 150], seed: 11, band: 16,
    rows: [
      { count: 9, u0: 0.82, u1: 1.0, a0: 150, a1: 200, fill: 'featherLight', bend: -16, reverse: true,
        len: (t) => 380 - 50 * t, wid: () => 42 },
      { count: 10, u0: 0.06, u1: 0.8, a0: 112, a1: 146, fill: 'featherShade', bend: 12,
        len: (t) => 240 + 150 * t, wid: () => 44 },
      { count: 12, u0: 0.04, u1: 0.98, a0: 118, a1: 165, fill: 'featherLight', bend: 6, dy: 10,
        len: (t) => 150 + 40 * t, wid: () => 34 },
      { count: 13, u0: 0.03, u1: 0.96, a0: 120, a1: 170, fill: 'featherWarm', bend: 4, dy: 4,
        len: () => 110, wid: () => 32 }
    ]
  });
}

// 下翼：較小，臂骨往左下伸
function wingLower() {
  return wing({
    w: 700, h: 620, shoulder: [650, 90], ctrl: [470, 150], wrist: [270, 320], seed: 23, band: 12,
    rows: [
      { count: 7, u0: 0.8, u1: 1.0, a0: 128, a1: 172, fill: 'featherLight', bend: 12, reverse: true,
        len: (t) => 250 - 40 * t, wid: () => 34 },
      { count: 8, u0: 0.06, u1: 0.78, a0: 96, a1: 124, fill: 'featherShade', bend: 8,
        len: (t) => 170 + 60 * t, wid: () => 34 },
      { count: 10, u0: 0.04, u1: 0.96, a0: 100, a1: 140, fill: 'featherWarm', bend: 4, dy: 4,
        len: () => 100, wid: () => 30 }
    ]
  });
}

/* ---------- 天光放射線 ---------- */
function rays() {
  const r = rng(5);
  const S = 1400, c = S / 2;
  let wash = '', lines = '';
  const n = 44;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.04;
    const half = (i % 2 ? 0.018 : 0.034) * (0.8 + r() * 0.4);
    const len = 520 + r() * 170;
    const p1 = [c + Math.cos(a - half) * len, c + Math.sin(a - half) * len];
    const p2 = [c + Math.cos(a + half) * len, c + Math.sin(a + half) * len];
    wash += `<path d="M${c} ${c} L${pt(p1)} L${pt(p2)}Z"/>`;
    if (i % 2 === 0) {
      const s = [c + Math.cos(a) * 150, c + Math.sin(a) * 150];
      const e = [c + Math.cos(a) * (len * 0.8), c + Math.sin(a) * (len * 0.8)];
      lines += `<path d="M${pt(s)} L${pt(e)}" stroke-dasharray="${f(18 + r() * 30)} ${f(8 + r() * 14)}"/>`;
    }
  }
  const defs = `<radialGradient id="rayFade" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0.08" stop-color="${GOLD_L}" stop-opacity="0.5"/>
  <stop offset="0.55" stop-color="${GOLD}" stop-opacity="0.16"/>
  <stop offset="1" stop-color="${GOLD}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="rayInk" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0.1" stop-color="${SEPIA}" stop-opacity="0.7"/>
  <stop offset="1" stop-color="${SEPIA}" stop-opacity="0"/>
</radialGradient>`;
  return svg(S, S, defs, `
<g fill="url(#rayFade)">${wash}</g>
<g filter="url(#ink)" stroke="url(#rayInk)" stroke-width="2" fill="none">${lines}</g>`);
}

/* ---------- 雲帶 ---------- */
function clouds(opts) {
  const r = rng(opts.seed);
  const { w, h, top, rMin, rMax, curls } = opts;
  const circles = [];
  let x = -rMax;
  while (x < w + rMax) {
    const rad = rMin + r() * (rMax - rMin);
    const y = top + rad + r() * (h - top - rad) * 0.25;
    circles.push([x, y, rad]);
    x += rad * (0.9 + r() * 0.5);
  }
  // 底下再墊一排把雲身補滿
  for (let xx = -rMax; xx < w + rMax; xx += rMax) circles.push([xx, h - rMax * 0.3, rMax * 1.2]);
  const circ = (c, grow) => `<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(c[2] + grow)}"/>`;
  let curl = '';
  for (let i = 0; i < curls; i++) {
    const c = circles[Math.floor(r() * circles.length * 0.7)];
    const cx = c[0], cy = c[1] - c[2] * 0.35, rr = c[2] * 0.45;
    curl += `<path d="M${f(cx - rr)} ${f(cy)} A${f(rr)} ${f(rr)} 0 1 1 ${f(cx + rr * 0.3)} ${f(cy + rr * 0.6)} A${f(rr * 0.5)} ${f(rr * 0.5)} 0 1 1 ${f(cx - rr * 0.1)} ${f(cy + rr * 0.1)}"/>`;
  }
  let hatch = '';
  for (let i = 0; i < w / 14; i++) {
    const hx = i * 14 + r() * 6, hy = h - 30 - r() * 60;
    hatch += `M${f(hx)} ${f(hy)} l${f(10 + r() * 14)} ${f(-14 - r() * 10)} `;
  }
  const defs = `<linearGradient id="cloudShade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${opts.fillTop}"/>
  <stop offset="1" stop-color="${opts.fillBottom}"/>
</linearGradient>`;
  return svg(w, h, defs, `
<g filter="url(#ink)" fill="${INK}">${circles.map((c) => circ(c, opts.stroke)).join('')}</g>
<g fill="url(#cloudShade)">${circles.map((c) => circ(c, 0)).join('')}</g>
<g filter="url(#ink)" fill="none" stroke="${SEPIA}" stroke-width="2" stroke-linecap="round" opacity="0.75">${curl}</g>
<path filter="url(#ink)" d="${hatch}" stroke="${SEPIA}" stroke-width="1.4" opacity="0.45" fill="none"/>`);
}

/* ---------- 天使本體（600×840，中線 x=300） ---------- */
// 左半邊的路徑，鏡射出右半邊
function mirror(d) {
  return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (m, x, y) => f(600 - Number(x)) + ' ' + y);
}
function sym(d) { return d + ' ' + mirror(d); }

function body() {
  const defs = `
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#f4da92"/>
  <stop offset="0.45" stop-color="${GOLD}"/>
  <stop offset="1" stop-color="#6b4510"/>
</linearGradient>
<linearGradient id="goldV" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#f4da92"/>
  <stop offset="1" stop-color="#7d5418"/>
</linearGradient>
<linearGradient id="cloth" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="${CLOTH}"/>
  <stop offset="1" stop-color="#d4c08f"/>
</linearGradient>
<linearGradient id="visor" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#ffffff"/>
  <stop offset="1" stop-color="${GOLD_L}"/>
</linearGradient>
<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
  <line x1="0" y1="0" x2="0" y2="7" stroke="${INK}" stroke-width="1.6"/>
</pattern>
<linearGradient id="shadeGrad" gradientUnits="userSpaceOnUse" x1="290" y1="0" x2="460" y2="0">
  <stop offset="0" stop-color="#fff" stop-opacity="0"/>
  <stop offset="1" stop-color="#fff" stop-opacity="1"/>
</linearGradient>
<mask id="shade" maskUnits="userSpaceOnUse" x="0" y="0" width="600" height="840">
  <rect x="0" y="0" width="600" height="840" fill="url(#shadeGrad)"/>
</mask>`;

  // 英雄比例（約 8.5 頭身）：頭盔 40–152、肩線 ~175、窄腰 ~360、膝 ~566、腳尖 ~822
  const helm = 'M300 40 C334 40 352 66 352 100 L348 124 C340 140 322 150 300 152 C278 150 260 140 252 124 L248 100 C248 66 266 40 300 40Z';
  const visorT = 'M266 90 L334 90 L334 101 L305 101 L305 138 L295 138 L295 101 L266 101Z';
  const helmRidge = 'M300 46 L300 88 M258 112 C270 118 282 120 292 120 M308 120 C318 120 330 118 342 112';
  const fin = 'M300 46 C290 30 291 16 300 4 C309 16 310 30 300 46Z';
  const helmWing = 'M254 96 C230 78 212 56 202 28 C222 44 238 56 252 68 C238 48 232 28 234 10 C250 34 262 58 266 82Z';
  const gorget = 'M268 142 L332 142 L346 174 L254 174Z';
  const gorgetLines = 'M262 158 L338 158';
  const pauldron = 'M262 170 C232 148 176 150 150 182 C136 200 138 232 150 250 C176 238 214 232 240 222 C256 210 266 190 262 170Z';
  const pauldronLines = 'M156 214 C186 194 226 186 258 194 M150 250 C172 268 206 264 232 246 M154 266 C176 284 206 280 228 264';
  const chest = 'M256 170 L344 170 C366 200 370 250 356 300 C350 330 340 352 334 362 L266 362 C260 352 250 330 244 300 C230 250 234 200 256 170Z';
  const chestLines = 'M300 176 L300 360 M258 236 C278 258 294 256 300 244 C306 256 322 258 342 236 M270 300 C290 308 310 308 330 300 M276 332 C292 338 308 338 324 332';
  const sun = '<circle cx="300" cy="212" r="15"/><circle cx="300" cy="212" r="7"/>';
  let sunRays = '';
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    sunRays += `M${f(300 + Math.cos(a) * 18)} ${f(212 + Math.sin(a) * 18)} L${f(300 + Math.cos(a) * (i % 2 ? 24 : 30))} ${f(212 + Math.sin(a) * (i % 2 ? 24 : 30))} `;
  }
  const belt = 'M262 358 L338 358 L342 380 L258 380Z';
  const buckle = '<rect x="290" y="360" width="20" height="18" rx="3"/>';
  const faulds = 'M258 378 L342 378 C356 404 364 428 368 448 L232 448 C236 428 244 404 258 378Z';
  const fauldLines = 'M250 402 L350 402 M240 426 L360 426';
  const tabard = 'M283 380 L317 380 C321 470 327 560 335 690 L317 674 L300 702 L283 674 L265 690 C273 560 279 470 283 380Z';
  const tabardTrim = 'M287 388 L278 560 L270 680 M313 388 L322 560 L330 680';
  const tabardMark = 'M300 470 L310 490 L300 510 L290 490Z';
  const leg = 'M250 446 L292 446 C294 500 292 540 288 556 L292 598 C292 650 288 700 284 742 L280 770 C276 790 272 806 268 822 C264 806 260 790 258 770 L256 742 C252 700 248 650 252 598 L256 556 C250 540 246 500 250 446Z';
  const knee = 'M250 566 C250 550 294 550 294 566 C294 582 250 582 250 566Z';
  const legLines = 'M256 640 L290 640 M258 700 L288 700 M262 752 L282 752';
  const upperArm = 'M166 240 L214 234 C218 270 216 310 210 338 L174 342 C170 310 166 270 166 240Z';
  const elbow = 'M166 340 C172 324 214 322 220 338 C214 356 172 358 166 340Z';
  const forearm = 'M172 352 L212 350 C210 388 204 420 200 446 L170 448 C168 420 168 388 172 352Z';
  const armLines = 'M170 280 L212 276 M174 400 L208 398 M172 424 L204 422';
  // 握劍的拳（畫面左）與自然下垂的手（畫面右）
  const fist = 'M164 444 L206 442 C210 460 208 482 198 494 C188 504 170 502 164 490 C158 476 160 460 164 444Z';
  const fistLines = 'M168 470 L204 468 M170 482 L200 480';
  const hand = 'M394 442 L436 444 C440 460 440 478 436 494 L430 512 M436 494 L422 516 M426 490 L412 514 M414 486 L404 506 C398 496 394 474 394 442Z';
  const goldPart = (d) => `<path d="${d}" fill="url(#gold)"/>`;
  const all = `${sym(leg)} ${sym(knee)} ${faulds} ${tabard} ${chest} ${belt} ${sym(upperArm)} ${sym(elbow)} ${sym(forearm)} ${fist} ${hand} ${sym(pauldron)} ${gorget} ${helm} ${sym(helmWing)} ${visorT} ${fin}`;
  return svg(600, 840, defs, `
<g>
  ${goldPart(sym(leg))}
  <path d="${sym(knee)}" fill="url(#goldV)"/>
  ${goldPart(faulds)}
  <path d="${tabard}" fill="url(#cloth)"/>
  ${goldPart(sym(upperArm) + ' ' + sym(forearm))}
  <path d="${sym(elbow)}" fill="url(#goldV)"/>
  ${goldPart(chest)}
  ${goldPart(belt)}
  <path d="${fist} ${hand}" fill="url(#goldV)"/>
  ${goldPart(sym(pauldron))}
  ${goldPart(gorget)}
  <path d="${sym(helmWing)}" fill="${LIGHT}"/>
  ${goldPart(helm)}
  <path d="${fin}" fill="url(#gold)"/>
  <path d="${visorT}" fill="url(#visor)"/>
  <path d="${tabardMark}" fill="${GOLD}"/>
</g>
<g mask="url(#shade)" opacity="0.5">
  <path d="${sym(leg)} ${faulds} ${chest} ${sym(upperArm)} ${sym(forearm)} ${sym(pauldron)} ${gorget} ${helm} ${hand}" fill="url(#hatch)"/>
</g>
<g filter="url(#ink)" fill="none" stroke="${SEPIA}" stroke-width="1.7" stroke-linecap="round">
  <path d="${fauldLines} ${chestLines} ${sym(pauldronLines)} ${helmRidge} ${gorgetLines} ${sym(legLines)} ${sym(armLines)} ${fistLines} ${sunRays}"/>
</g>
<path d="${tabardTrim}" fill="none" stroke="${GOLD}" stroke-width="3" opacity="0.8"/>
<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round">
  <path d="${all}"/>${buckle}${sun}<path d="${tabardMark}"/>
</g>`);
}

function cape() {
  const d = 'M224 168 C188 240 166 380 150 520 C138 640 126 740 110 812 L160 788 L200 826 L246 794 L300 832 L354 794 L400 826 L440 788 L490 812 C474 740 462 640 450 520 C434 380 412 240 376 168Z';
  const folds = 'M244 200 C228 380 212 580 200 820 M300 190 L300 826 M356 200 C372 380 388 580 400 820 M270 260 C258 460 250 640 246 790 M330 260 C342 460 350 640 354 790';
  const defs = `<linearGradient id="capeShade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#7a2d1c"/>
  <stop offset="1" stop-color="#4a1a10"/>
</linearGradient>`;
  return svg(600, 840, defs, `
<path d="${d}" fill="url(#capeShade)"/>
<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-linejoin="round">
  <path d="${d}" stroke-width="2.8"/>
  <path d="${folds}" stroke-width="1.6" opacity="0.7"/>
</g>`);
}

// 劍：劍柄在右上（握在手中），劍刃往左下
function sword() {
  const W = 300, H = 460;
  const grip = [250, 40], dir = [-0.42, 0.91];
  const n = [dir[1], -dir[0]];
  const at = (t, side) => [grip[0] + dir[0] * t + n[0] * side, grip[1] + dir[1] * t + n[1] * side];
  const blade = `M${pt(at(60, 9))} L${pt(at(400, 6))} L${pt(at(440, 0))} L${pt(at(400, -6))} L${pt(at(60, -9))}Z`;
  const fuller = `M${pt(at(70, 0))} L${pt(at(380, 0))}`;
  const guard = `M${pt(at(48, 40))} C${pt(at(56, 20))} ${pt(at(56, -20))} ${pt(at(48, -40))} L${pt(at(60, -38))} C${pt(at(66, -16))} ${pt(at(66, 16))} ${pt(at(60, 38))}Z`;
  const gripPath = `M${pt(at(-30, 5))} L${pt(at(48, 5))} L${pt(at(48, -5))} L${pt(at(-30, -5))}Z`;
  const pommel = at(-38, 0);
  const defs = `<linearGradient id="steel" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="#fffdf2"/>
  <stop offset="0.5" stop-color="#f1e6c6"/>
  <stop offset="1" stop-color="#cdbb8e"/>
</linearGradient>`;
  return svg(W, H, defs, `
<path d="${blade}" fill="url(#steel)"/>
<path d="${guard} ${gripPath}" fill="${GOLD}"/>
<circle cx="${f(pommel[0])}" cy="${f(pommel[1])}" r="10" fill="${GOLD_L}"/>
<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round">
  <path d="${blade} ${guard} ${gripPath}"/><circle cx="${f(pommel[0])}" cy="${f(pommel[1])}" r="10"/>
</g>
<path filter="url(#ink)" d="${fuller}" stroke="${SEPIA}" stroke-width="1.6" fill="none"/>`);
}

function halo() {
  return svg(240, 80, `<linearGradient id="haloG" x1="0" y1="0" x2="1" y2="0">
  <stop offset="0" stop-color="${GOLD}"/><stop offset="0.5" stop-color="${LIGHT}"/><stop offset="1" stop-color="${GOLD}"/>
</linearGradient>`, `
<ellipse cx="120" cy="40" rx="100" ry="22" fill="none" stroke="url(#haloG)" stroke-width="9"/>
<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-width="1.8">
  <ellipse cx="120" cy="40" rx="105" ry="26"/><ellipse cx="120" cy="40" rx="95" ry="18"/>
</g>`);
}

// 書頁邊框：雙線外框＋四角卷草
function frame() {
  const W = 1920, H = 1080, o = 70, i = 84;
  const corner = (x, y, sx, sy) => {
    const p = (dx, dy) => f(x + dx * sx) + ' ' + f(y + dy * sy);
    return `M${p(0, 70)} C${p(0, 30)} ${p(10, 10)} ${p(40, 6)} C${p(70, 2)} ${p(80, 30)} ${p(56, 40)} C${p(40, 46)} ${p(30, 30)} ${p(42, 24)} ` +
      `M${p(70, 0)} C${p(30, 0)} ${p(10, 10)} ${p(6, 40)} C${p(2, 70)} ${p(30, 80)} ${p(40, 56)} C${p(46, 40)} ${p(30, 30)} ${p(24, 42)}`;
  };
  const corners = [corner(o, o, 1, 1), corner(W - o, o, -1, 1), corner(o, H - o, 1, -1), corner(W - o, H - o, -1, -1)].join(' ');
  return svg(W, H, '', `
<g filter="url(#ink)" fill="none" stroke="${INK}" stroke-linecap="round" opacity="0.78">
  <rect x="${o}" y="${o}" width="${W - o * 2}" height="${H - o * 2}" stroke-width="3"/>
  <rect x="${i}" y="${i}" width="${W - i * 2}" height="${H - i * 2}" stroke-width="1.3"/>
  <path d="${corners}" stroke-width="2.2"/>
</g>`);
}

const files = {
  'rays.svg': rays(),
  'clouds-far.svg': clouds({ w: 2400, h: 360, top: 40, rMin: 50, rMax: 110, curls: 10, stroke: 3, seed: 31, fillTop: '#efe2bd', fillBottom: '#d8c08d' }),
  'clouds-mid.svg': clouds({ w: 2400, h: 400, top: 50, rMin: 60, rMax: 130, curls: 12, stroke: 3.2, seed: 37, fillTop: '#f3e8c8', fillBottom: '#d3b882' }),
  'clouds-near.svg': clouds({ w: 2600, h: 460, top: 60, rMin: 80, rMax: 160, curls: 14, stroke: 3.6, seed: 41, fillTop: '#f6eed6', fillBottom: '#cfb37c' }),
  'wing-upper.svg': wingUpper(),
  'wing-lower.svg': wingLower(),
  'cape.svg': cape(),
  'body.svg': body(),
  'sword.svg': sword(),
  'halo.svg': halo(),
  'frame.svg': frame()
};
fs.mkdirSync(OUT, { recursive: true });
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log(name, content.length);
}
