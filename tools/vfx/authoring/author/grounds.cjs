'use strict';
/* grounds.cjs — 地板／場域／環繞體家族（ground-*、orb-*、aura-*、mark-*）Preset 製作腳本
   角色：ground（持續場域，畫在敵人之下的 zone 層）／projectile（orb-* 環繞體）。
   原點：圓形場域＝圓心、矩形場域＝矩形中心、龍捲＝底部著地點、自身光環＝玩家腳底。
   名目：圓形半徑 100px（Runtime scale = area.r/100）、矩形 200×100（scaleX=w/200、scaleY=h/100）、
         龍捲 area.r = 28px、環繞體 orbR = 20px（虛空鋸刃 24px）。

   ⚠️ 迴圈型 preset 的 alphaOverLife 兩端必須同值，否則每個週期會閃一下。
   ⚠️ Core 沒有父子節點，因此「繞著原點公轉」做不到；改用「本身就畫著若干個點的
      環形素材整片旋轉」來表現（runePlanet／ringSegments4／sawRing 等）。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, deg, sprite, particle } = kit;
const PI = Math.PI;

const FLAT = 0.52;          // 地板矩形／落點預警的縱向壓縮
const FLAT_R = 0.62;        // 圓形場域的縱向壓縮
const LOOP_A = (a, b) => [[0, a], [0.5, b], [1, a]];
const IN_OUT = [[0, 0], [0.12, 1], [0.7, 0.85], [1, 0]];

/* ---- 扁橢圓填色／描邊 ---- */
function disc(o) {
  const d = o.d, f = o.flat === undefined ? FLAT_R : o.flat;
  return sprite(Object.assign({ blend: 'add', duration: o.dur }, o,
    { sizeX: d, sizeY: d * f, d: undefined, flat: undefined, dur: undefined }));
}

const P = {};

/* =========================== 泥沼三兄弟 =========================== */
function mire(o) {
  return [
    disc({ id: 'fill', asset: A.splat05, z: 0, d: 200, flat: FLAT, alpha: 0.5, tint: o.fill, blend: 'normal', dur: 2.1, alphaOverLife: LOOP_A(0.5, 0.58) }),
    disc({ id: 'edge', asset: A.ringSoft, z: 1, d: 200, flat: FLAT, alpha: 0.55, tint: o.edge, dur: 2.1, alphaOverLife: LOOP_A(0.55, 0.4) }),
    disc({ id: 'ripple-a', asset: A.ringThin, z: 2, d: 200, flat: FLAT, alpha: 0.45, tint: o.ripple, dur: 2.1, alphaOverLife: [[0, 0], [0.15, 0.45], [0.9, 0], [1, 0]], scaleOverLife: [[0, 0.35], [0.9, 1], [1, 1]] }),
    disc({ id: 'ripple-b', asset: A.ringThin, z: 3, d: 200, flat: FLAT, alpha: 0.4, tint: o.ripple, dur: 2.1, delay: 0.7, alphaOverLife: [[0, 0], [0.15, 0.4], [0.9, 0], [1, 0]], scaleOverLife: [[0, 0.35], [0.9, 1], [1, 1]] }),
    disc({ id: 'ripple-c', asset: A.ringThin, z: 4, d: 200, flat: FLAT, alpha: 0.35, tint: o.ripple, dur: 2.1, delay: 1.4, alphaOverLife: [[0, 0], [0.15, 0.35], [0.9, 0], [1, 0]], scaleOverLife: [[0, 0.35], [0.9, 1], [1, 1]] }),
    particle({
      id: 'bubbles', asset: A.bubble, z: 5, blend: 'normal', tint: o.bubble,
      rate: 3, lifetime: [0.9, 1.4], spawnBox: [180, 90], speed: [4, 14], direction: -90, spread: 60,
      startPx: [7, 13], alphaOverLife: [[0, 0], [0.2, 0.85], [0.8, 0.7], [1, 0]], scaleOverLife: [[0, 0.5], [1, 1.1]]
    })
  ].concat(o.extra || []);
}

P['ground-mire'] = () => ({
  id: 'ground-mire', duration: 2.1, loop: true,
  layers: mire({ fill: '#4a3a20', edge: '#7d6533', ripple: '#a37a48', bubble: '#c49b68' })
});

P['ground-mire-lava'] = () => ({
  id: 'ground-mire-lava', duration: 2.1, loop: true,
  layers: mire({
    fill: '#8a2b0b', edge: '#ff7a2a', ripple: '#ffb347', bubble: '#ffd282',
    extra: [particle({
      id: 'embers', asset: A.dot, z: 6, blend: 'add', tint: '#ffb347',
      rate: 6, lifetime: [0.5, 0.9], spawnBox: [180, 80], speed: [20, 50], direction: -90, spread: 50,
      gravity: { x: 0, y: -40 }, startPx: [3, 6],
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    })]
  })
});

P['ground-mire-poison'] = () => ({
  id: 'ground-mire-poison', duration: 2.1, loop: true,
  layers: mire({
    fill: '#4a3020', edge: '#5b2b72', ripple: '#7e3f9a', bubble: '#6b2d7c',
    extra: [0, 1, 2].map(i => sprite({
      id: 'fume-' + 'abc'[i], asset: A.smokeDark, z: 6 + i, sizeX: 120, sizeY: 46,
      x: -60 + i * 60, y: -14, alpha: 0.45, tint: '#7e3f9a', blend: 'normal', duration: 2.1,
      delay: i * 0.35, alphaOverLife: LOOP_A(0.35, 0.55),
      scaleXOverLife: [[0, 0.9], [0.5, 1.1], [1, 0.9]], scaleYOverLife: [[0, 1], [0.5, 0.85], [1, 1]]
    }))
  })
});

/* =========================== 火牆／雷幕 =========================== */
P['ground-firewall'] = () => {
  const column = (id, z, x, delay) => sprite({
    id: id, asset: A.fireWallColored, z: z, sizeX: 76, sizeY: 120, x: x, y: -46,
    alpha: 0.95, tint: '#e43b12', blend: 'add', duration: 1.2, delay: delay,
    alphaOverLife: LOOP_A(0.9, 1),
    scaleXOverLife: [[0, 1], [0.3, 1.12], [0.65, 0.9], [1, 1]],
    scaleYOverLife: [[0, 1], [0.35, 1.1], [0.7, 0.92], [1, 1]],
    rotationOverLife: [[0, deg(-4)], [0.5, deg(4)], [1, deg(-4)]]
  });
  return {
    id: 'ground-firewall', duration: 1.2, loop: true, layers: [
      sprite({ id: 'scorch', asset: A.trace06H, z: 0, sizeX: 200, sizeY: 40, alpha: 0.75, tint: '#30231d', blend: 'normal', duration: 1.2, alphaOverLife: LOOP_A(0.75, 0.65) }),
      sprite({ id: 'base', asset: A.trace06H, z: 1, sizeX: 200, sizeY: 26, alpha: 0.8, tint: '#ffa51d', blend: 'add', duration: 1.2, alphaOverLife: LOOP_A(0.7, 0.9) }),
      column('flame-a', 2, -62, 0),
      column('flame-b', 3, 0, 0.28),
      column('flame-c', 4, 62, 0.56),
      sprite({ id: 'core', asset: A.trace06H, z: 5, sizeX: 190, sizeY: 14, y: -12, alpha: 0.9, tint: '#ffd84a', blend: 'add', duration: 1.2, alphaOverLife: LOOP_A(0.8, 1) }),
      particle({
        id: 'smoke', asset: A.smokeT, z: 6, blend: 'normal', tint: '#4a3b33',
        rate: 5, lifetime: [0.7, 1.1], spawnBox: [180, 20], y: -80, speed: [20, 45], direction: -90, spread: 40,
        gravity: { x: 0, y: -30 }, startPx: [26, 46],
        alphaOverLife: [[0, 0], [0.25, 0.45], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.4]]
      }),
      particle({
        id: 'sparks', asset: A.dot, z: 7, blend: 'add', tint: '#ffd84a',
        rate: 12, lifetime: [0.4, 0.7], spawnBox: [190, 16], speed: [40, 90], direction: -90, spread: 45,
        gravity: { x: 0, y: -60 }, startPx: [3, 6],
        alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
      })
    ]
  };
};

P['ground-thunder-curtain'] = () => ({
  id: 'ground-thunder-curtain', duration: 1, loop: true, layers: [
    sprite({ id: 'band', asset: A.trace06H, z: 0, sizeX: 200, sizeY: 20, alpha: 0.22, tint: '#7dd3fc', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.22, 0.32) }),
    sprite({ id: 'band-core', asset: A.trace02H, z: 1, sizeX: 200, sizeY: 6, alpha: 0.5, tint: '#ffffff', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.4, 0.6) }),
    particle({
      id: 'ends', asset: A.bolt05, z: 2, blend: 'add', tint: '#ffffff',
      rate: 10, lifetime: [0.08, 0.16], spawnBox: [200, 14], speed: [0, 20], direction: -90, spread: 360,
      startPx: [10, 20], alphaOverLife: [[0, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.8]]
    })
  ]
});

/* =========================== 雷球場域體 =========================== */
P['ground-thunder-orb'] = () => ({
  id: 'ground-thunder-orb', duration: 1, loop: true, layers: [
    sprite({ id: 'outer', asset: A.glowSoft, z: 0, size: 60, alpha: 0.24, tint: '#1d4ed8', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.24, 0.34), scaleOverLife: LOOP_A(1, 1.08) }),
    sprite({ id: 'mid', asset: A.dot, z: 1, size: 44, alpha: 0.8, tint: '#60a5fa', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.75, 0.9) }),
    sprite({ id: 'core', asset: A.dot, z: 2, size: 20, alpha: 1, tint: '#ffffff', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.9, 1), scaleOverLife: LOOP_A(0.95, 1.1) }),
    sprite({ id: 'web', asset: A.arc02, z: 3, size: 56, alpha: 0.75, tint: '#7dd3fc', blend: 'add', duration: 1, alphaOverLife: C.flicker, rotationOverLife: [[0, 0], [1, 9]] }),
    particle({
      id: 'arcs', asset: A.bolt05, z: 4, blend: 'add', tint: '#ffffff',
      rate: 14, lifetime: [0.1, 0.2], spawnRadius: 26, speed: [0, 15], direction: 0, spread: 360,
      startPx: [10, 18], rotationStart: [0, PI * 2],
      alphaOverLife: [[0, 1], [0.6, 0.7], [1, 0]], scaleOverLife: [[0, 1], [1, 0.7]]
    })
  ]
});

/* =========================== 暴風雪 =========================== */
P['ground-blizzard'] = () => ({
  id: 'ground-blizzard', duration: 2.6, loop: true, layers: [
    disc({ id: 'fill', asset: A.discB, z: 0, d: 200, flat: FLAT, alpha: 0.2, tint: '#7dd3fc', dur: 2.6, alphaOverLife: LOOP_A(0.2, 0.28) }),
    disc({ id: 'edge', asset: A.ringThin, z: 1, d: 200, flat: FLAT, alpha: 0.55, tint: '#22d3ee', dur: 2.6, alphaOverLife: LOOP_A(0.55, 0.4) }),
    ...[0, 1, 2].map(i => sprite({
      id: 'cloud-' + 'abc'[i], asset: A.smokeSoft, z: 2 + i, sizeX: 170, sizeY: 34,
      y: -26 + i * 24, alpha: 0.3, tint: '#f0f9ff', blend: 'normal', duration: 2.6, delay: i * 0.4,
      alphaOverLife: LOOP_A(0.25, 0.4), scaleXOverLife: [[0, 0.95], [0.5, 1.08], [1, 0.95]]
    })),
    particle({
      id: 'snow', asset: A.dot, z: 5, blend: 'add', tint: '#ffffff',
      rate: 10, lifetime: [1.1, 1.7], spawnBox: [200, 20], y: -60, speed: [30, 60], direction: 100, spread: 40,
      gravity: { x: -20, y: 30 }, startPx: [3, 6],
      alphaOverLife: [[0, 0], [0.2, 0.95], [0.85, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.7]]
    })
  ]
});

/* =========================== 龍捲三兄弟 =========================== */
function tornado(o) {
  const band = (id, z, delay, tint, w, h, y) => sprite({
    id: id, asset: A.rays7, z: z, sizeX: w, sizeY: h, y: y, anchor: { x: 0.5, y: 1 },
    alpha: 0.75, tint: tint, blend: 'add', duration: 1.2, delay: delay,
    alphaOverLife: LOOP_A(0.7, 0.9),
    scaleXOverLife: [[0, 1], [0.33, 1.14], [0.66, 0.88], [1, 1]],
    rotationOverLife: [[0, deg(-5)], [0.5, deg(5)], [1, deg(-5)]]
  });
  return [
    disc({ id: 'ground', asset: A.ringSoft, z: 0, d: 68, flat: 0.45, alpha: 0.6, tint: o.ground, blend: 'normal', dur: 1.2, alphaOverLife: LOOP_A(0.55, 0.7) }),
    sprite({
      id: 'funnel', asset: A.coneF, z: 1, sizeX: 62, sizeY: 118, anchor: { x: 0.5, y: 1 },
      alpha: 0.9, tint: o.body, blend: 'add', duration: 1.2, alphaOverLife: LOOP_A(0.85, 1),
      scaleXOverLife: [[0, 1], [0.5, 1.08], [1, 1]]
    }),
    band('band-a', 2, 0, o.edge, 54, 104, 0),
    band('band-b', 3, 0.4, o.bandB, 44, 88, 0),
    band('band-c', 4, 0.8, o.edge, 34, 70, 0),
    sprite({
      id: 'core', asset: A.barA, z: 5, sizeX: 14, sizeY: 110, anchor: { x: 0.5, y: 1 },
      alpha: 0.9, tint: o.core, blend: 'add', duration: 1.2, alphaOverLife: LOOP_A(0.8, 1)
    }),
    sprite({
      id: 'cap', asset: A.turbine7, z: 6, sizeX: 66, sizeY: 26, y: -112,
      alpha: 0.8, tint: o.edge, blend: 'add', duration: 1.2,
      alphaOverLife: LOOP_A(0.7, 0.95), rotationOverLife: C.spin(1.5)
    }),
    particle(Object.assign({
      id: 'motes', asset: A.dot, z: 7, blend: 'add', tint: o.core,
      rate: 14, lifetime: [0.5, 0.85], spawnBox: [50, 16], speed: [60, 120], direction: -90, spread: 40,
      gravity: { x: 0, y: -70 }, startPx: [4, 8],
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    }, o.motes || {}))
  ];
}

P['ground-tornado-fire'] = () => ({
  id: 'ground-tornado-fire', duration: 1.2, loop: true,
  layers: tornado({ ground: '#7d1708', body: '#d93413', edge: '#ffa51d', bandB: '#ff761c', core: '#ffdf4d' })
});

P['ground-tornado-water'] = () => ({
  id: 'ground-tornado-water', duration: 1.2, loop: true,
  layers: tornado({
    ground: '#0369a1', body: '#0284c7', edge: '#38bdf8', bandB: '#7dd3fc', core: '#f0f9ff',
    motes: { gravity: { x: 0, y: 140 }, direction: -90, spread: 70, speed: [70, 130] }
  })
});

P['ground-tornado-wind'] = () => ({
  id: 'ground-tornado-wind', duration: 1.2, loop: true,
  layers: tornado({
    ground: '#166534', body: '#22c55e', edge: '#86efac', bandB: '#bbf7d0', core: '#ffffff',
    motes: { asset: A.leaf, blend: 'normal', tint: '#86efac', startPx: [8, 14], rotationStart: [0, PI * 2], rotationSpeed: [-6, 6] }
  })
});

/* =========================== 追擊本體（場域型飛行物） =========================== */
P['ground-homing-ice-shard'] = () => ({
  id: 'ground-homing-ice-shard', duration: 0.55, loop: true, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 78, alpha: 0.45, tint: '#79d8ff', blend: 'add', duration: 0.55, alphaOverLife: LOOP_A(0.4, 0.55), scaleOverLife: LOOP_A(1, 1.08) }),
    sprite({ id: 'body', asset: A.diamond, z: 1, sizeX: 60, sizeY: 44, alpha: 1, tint: '#4da6ff', blend: 'normal', duration: 0.55, alphaOverLife: LOOP_A(0.95, 1) }),
    sprite({ id: 'core', asset: A.diamond, z: 2, sizeX: 36, sizeY: 26, alpha: 1, tint: '#f2fbff', blend: 'add', duration: 0.55, alphaOverLife: LOOP_A(0.9, 1) }),
    particle({
      id: 'dust', asset: A.dot, z: 3, blend: 'add', tint: '#f2fbff',
      rate: 16, lifetime: [0.2, 0.35], spawnRadius: 8, speed: [20, 50], direction: 180, spread: 50,
      startPx: [4, 8], alphaOverLife: [[0, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    })
  ]
});

P['ground-homing-wind-crescent'] = () => ({
  id: 'ground-homing-wind-crescent', duration: 0.55, loop: true, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, sizeX: 56, sizeY: 78, alpha: 0.35, tint: T.wind.glow, blend: 'add', duration: 0.55, alphaOverLife: LOOP_A(0.3, 0.45) }),
    sprite({ id: 'body', asset: A.slash03, z: 1, sizeX: 26, sizeY: 60, alpha: 1, tint: T.wind.c1, blend: 'add', duration: 0.55, alphaOverLife: LOOP_A(0.95, 1), scaleOverLife: LOOP_A(1, 1.06) }),
    sprite({ id: 'core', asset: A.slash03, z: 2, sizeX: 16, sizeY: 44, alpha: 1, tint: '#ffffff', blend: 'add', duration: 0.55, alphaOverLife: LOOP_A(0.9, 1) }),
    particle({
      id: 'wisp', asset: A.dot, z: 3, blend: 'add', tint: '#ffffff',
      rate: 12, lifetime: [0.18, 0.3], spawnRadius: 8, speed: [20, 50], direction: 180, spread: 40,
      startPx: [3, 6], alphaOverLife: [[0, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    })
  ]
});

/* =========================== 環繞體 =========================== */
P['orb-firehunt'] = () => ({
  id: 'orb-firehunt', duration: 0.5, loop: true, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 60, alpha: 0.55, tint: '#ff6a2a', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.5, 0.65), scaleOverLife: LOOP_A(1, 1.1) }),
    sprite({ id: 'tail', asset: A.muzzle02R, z: 1, sizeX: 44, sizeY: 24, x: -18, alpha: 0.75, tint: '#e63924', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.7, 0.85) }),
    sprite({ id: 'body', asset: A.flame04, z: 2, size: 40, alpha: 1, tint: '#e63924', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.95, 1), rotationOverLife: C.spin(0.5) }),
    sprite({ id: 'core', asset: A.dot, z: 3, size: 18, alpha: 1, tint: '#ffd447', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.9, 1), scaleOverLife: LOOP_A(0.95, 1.12) }),
    particle({
      id: 'embers', asset: A.dot, z: 4, blend: 'add', tint: '#ffd447',
      rate: 10, lifetime: [0.25, 0.4], spawnRadius: 12, speed: [25, 55], direction: -90, spread: 70,
      gravity: { x: 0, y: -60 }, startPx: [3, 6],
      alphaOverLife: [[0, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    })
  ]
});

P['orb-thunder'] = () => ({
  id: 'orb-thunder', duration: 0.5, loop: true, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 60, alpha: 0.55, tint: '#ffd23f', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.5, 0.7), scaleOverLife: LOOP_A(1, 1.1) }),
    sprite({ id: 'body', asset: A.dot, z: 1, size: 40, alpha: 0.95, tint: '#f2b705', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.9, 1) }),
    sprite({ id: 'core', asset: A.dot, z: 2, size: 18, alpha: 1, tint: '#fff8b0', blend: 'add', duration: 0.5, alphaOverLife: LOOP_A(0.9, 1), scaleOverLife: LOOP_A(0.95, 1.12) }),
    sprite({ id: 'web', asset: A.arc03, z: 3, size: 46, alpha: 0.8, tint: '#fff8b0', blend: 'add', duration: 0.5, alphaOverLife: C.flicker, rotationOverLife: C.spin(0.8) })
  ]
});

P['orb-void-disc'] = () => {
  const SPIN = C.spin(3);                       // 3 圈／秒 × 1s
  const ghost = (id, z, a, rot) => sprite({
    id: id, asset: A.sawSmall, z: z, sizeX: 48, sizeY: 48 * 0.72, rotDeg: rot,
    alpha: a, tint: T.wind.c1, blend: 'add', duration: 1,
    alphaOverLife: LOOP_A(a, a * 1.15), rotationOverLife: SPIN
  });
  return {
    id: 'orb-void-disc', duration: 1, loop: true, layers: [
      ghost('ghost-d', 0, 0.12, -36),
      ghost('ghost-c', 1, 0.2, -27),
      ghost('ghost-b', 2, 0.3, -18),
      ghost('ghost-a', 3, 0.45, -9),
      sprite({ id: 'disc', asset: A.sawSmall, z: 4, sizeX: 48, sizeY: 48 * 0.72, alpha: 0.95, tint: T.wind.c1, blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.9, 1), rotationOverLife: SPIN }),
      sprite({ id: 'rim', asset: A.serratedRing, z: 5, sizeX: 48, sizeY: 48 * 0.72, alpha: 0.85, tint: '#ffffff', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.8, 1), rotationOverLife: SPIN }),
      sprite({ id: 'hub', asset: A.dot, z: 6, size: 12, alpha: 1, tint: '#ffffff', blend: 'add', duration: 1, alphaOverLife: LOOP_A(0.9, 1) })
    ]
  };
};

/* =========================== 軌道環 =========================== */
function orbitRing(o) {
  return [
    disc({ id: 'ring', asset: A.ringA, z: 0, d: 200, flat: FLAT_R, alpha: o.alpha, tint: o.tint, dur: 2, alphaOverLife: LOOP_A(o.alpha, o.alpha * 1.4) }),
    particle(Object.assign({
      id: 'motes', asset: A.dot, z: 1, blend: 'add', tint: o.tint,
      rate: 6, lifetime: [0.5, 0.9], spawnRadius: 96, speed: [15, 40], direction: -90, spread: 60,
      gravity: { x: 0, y: -40 }, startPx: [3, 6],
      alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    }, o.motes || {}))
  ];
}
P['ground-orbit-ring-fire'] = () => ({ id: 'ground-orbit-ring-fire', duration: 2, loop: true, layers: orbitRing({ tint: '#e63924', alpha: 0.18 }) });
P['ground-orbit-ring-lightning'] = () => ({ id: 'ground-orbit-ring-lightning', duration: 2, loop: true, layers: orbitRing({ tint: '#f2b705', alpha: 0.18, motes: { asset: A.bolt05, startPx: [8, 14], rate: 8, lifetime: [0.12, 0.22], gravity: { x: 0, y: 0 }, speed: [0, 10] } }) });
P['ground-orbit-ring-wind'] = () => ({ id: 'ground-orbit-ring-wind', duration: 2, loop: true, layers: orbitRing({ tint: '#86efac', alpha: 0.16 }) });

/* =========================== 暴風屏障／神體／撕裂 =========================== */
function stormShield(o) {
  /* 三層扁橢圓風環：rx 30、ry 9，y = -6/+10/+26（原點＝腳底上方 24px 由 Runtime 決定）。
     「3 顆白點繞行」用本身就帶著分段的環形素材整片旋轉表現。 */
  const band = (id, z, y, tint, a) => sprite({
    id: id, asset: A.ringThin, z: z, sizeX: 60, sizeY: 18, y: y,
    alpha: a, tint: tint, blend: 'add', duration: o.dur,
    alphaOverLife: LOOP_A(a, a * 1.25), scaleOverLife: LOOP_A(0.96, 1.06)
  });
  return [
    band('band-a', 0, -6, o.rim, o.alpha),
    band('band-b', 1, 10, o.mid, o.alpha),
    band('band-c', 2, 26, o.rim, o.alpha),
    sprite({
      id: 'dots', asset: A.ringSegments4, z: 3, sizeX: 62, sizeY: 19, y: 10,
      alpha: o.alpha, tint: '#ffffff', blend: 'add', duration: o.dur,
      alphaOverLife: LOOP_A(o.alpha, o.alpha * 1.3), rotationOverLife: [[0, 0], [1, o.spin * o.dur]]
    })
  ].concat(o.extra || []);
}

P['ground-storm-barrier'] = () => ({
  id: 'ground-storm-barrier', duration: 1.5, loop: true,
  layers: stormShield({ dur: 1.5, rim: '#86efac', mid: '#ffffff', alpha: 0.6, spin: 4.2 })
});

P['ground-storm-god'] = () => ({
  id: 'ground-storm-god', duration: 0.9, loop: true,
  layers: stormShield({
    dur: 0.9, rim: '#86efac', mid: '#ffe9a3', alpha: 0.9, spin: 7,
    extra: [sprite({
      id: 'halo', asset: A.glowSoft, z: 4, sizeX: 40, sizeY: 46, y: 6,
      alpha: 0.5, tint: '#ffe9a3', blend: 'add', duration: 0.9,
      alphaOverLife: LOOP_A(0.45, 0.65), scaleOverLife: LOOP_A(1, 1.08)
    })]
  })
});

P['ground-storm-rip'] = () => ({
  id: 'ground-storm-rip', duration: 0.5, layers: [
    /* 6 片小風刃由半徑 26 擴到 60：Core 沒有父節點可以做橢圓公轉，
       改用粒子往外飛（速度＝(60-26)/0.5），朝向由 alignToVelocity 對齊。 */
    particle({
      id: 'blades', asset: A.slash01, z: 0, blend: 'add', tint: '#ffffff',
      burst: 6, lifetime: [0.5, 0.5], spawnRadius: 26, speed: [68, 68], direction: 0, spread: 360,
      startPx: [9, 9], alignToVelocity: true, velocityRotationOffset: 0,
      alphaOverLife: [[0, 0.7], [1, 0]], scaleOverLife: [[0, 1], [1, 1]]
    }),
    disc({ id: 'ring', asset: A.ringThin, z: 1, d: 120, flat: 0.5, alpha: 0.5, tint: '#ffffff', dur: 0.5, alphaOverLife: [[0, 0.5], [1, 0]], scaleOverLife: [[0, 0.43], [1, 1]] })
  ]
});

/* =========================== 領域（圓形場域） =========================== */
function domain(o) {
  return [
    disc({ id: 'fill', asset: A.discB, z: 0, d: 200, alpha: 0.1, tint: o.fill, dur: 1.85, alphaOverLife: LOOP_A(0.1, 0.14), scaleOverLife: LOOP_A(0.96, 1.04) }),
    disc({ id: 'edge', asset: A.ringThin, z: 1, d: 200, alpha: 0.75, tint: o.edge, dur: 1.85, alphaOverLife: LOOP_A(0.7, 0.9), scaleOverLife: LOOP_A(0.96, 1.04) }),
    disc({ id: 'inner', asset: A.ringA, z: 2, d: 150, alpha: 0.55, tint: o.inner, dur: 1.85, alphaOverLife: LOOP_A(0.5, 0.7), scaleOverLife: LOOP_A(1.04, 0.96) }),
    particle(Object.assign({
      id: 'motes', asset: A.dot, z: 3, blend: 'add', tint: o.inner,
      rate: 10, lifetime: [0.7, 1.1], spawnRadius: 98, speed: [20, 50], direction: -90, spread: 50,
      gravity: { x: 0, y: -50 }, startPx: [4, 8],
      alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    }, o.motes || {}))
  ];
}

P['ground-domain-fire'] = () => ({
  id: 'ground-domain-fire', duration: 1.85, loop: true,
  layers: domain({ fill: '#ffd447', edge: '#e63924', inner: '#ff6a2a' })
});
P['ground-domain-earth'] = () => ({
  id: 'ground-domain-earth', duration: 1.85, loop: true,
  layers: domain({ fill: '#5b3a27', edge: '#ad7444', inner: '#c48a55', motes: { asset: A.smokeT, blend: 'normal', startPx: [12, 22], rate: 7, alphaOverLife: [[0, 0], [0.25, 0.5], [1, 0]] } })
});
P['ground-domain-ice'] = () => ({
  id: 'ground-domain-ice', duration: 1.85, loop: true,
  layers: domain({ fill: '#f2fbff', edge: '#4da6ff', inner: '#79d8ff', motes: { asset: A.star08, startPx: [6, 12] } })
});

/* =========================== 舊技能地板 =========================== */
P['ground-field-fire'] = () => ({
  id: 'ground-field-fire', duration: 1.6, loop: true, layers: [
    disc({ id: 'fill', asset: A.discB, z: 0, d: 200, alpha: 0.14, tint: '#e63924', dur: 1.6, alphaOverLife: LOOP_A(0.14, 0.2) }),
    disc({ id: 'edge', asset: A.ringThin, z: 1, d: 200, alpha: 0.7, tint: '#ffd447', dur: 1.6, alphaOverLife: LOOP_A(0.65, 0.85) }),
    particle({
      id: 'flames', asset: A.flame05, z: 2, blend: 'add', tint: '#e63924',
      rate: 12, lifetime: [0.5, 0.9], spawnRadius: 92, speed: [30, 70], direction: -90, spread: 40,
      gravity: { x: 0, y: -80 }, startPx: [14, 26],
      alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 0.8], [1, 0.4]]
    }),
    particle({
      id: 'sparks', asset: A.dot, z: 3, blend: 'add', tint: '#ffd447',
      rate: 10, lifetime: [0.4, 0.7], spawnRadius: 92, speed: [40, 90], direction: -90, spread: 50,
      gravity: { x: 0, y: -70 }, startPx: [3, 6],
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    })
  ]
});

P['ground-swordfield'] = () => ({
  id: 'ground-swordfield', duration: 5, loop: true, layers: [
    disc({ id: 'fill', asset: A.discB, z: 0, d: 200, alpha: 0.12, tint: T.phys.c1, dur: 5, alphaOverLife: LOOP_A(0.12, 0.16) }),
    disc({ id: 'dashes', asset: A.reticleDashed, z: 1, d: 200, alpha: 0.6, tint: T.phys.c1, dur: 5, alphaOverLife: LOOP_A(0.55, 0.75), rotationOverLife: C.spin(1) }),
    disc({ id: 'edge', asset: A.ringA, z: 2, d: 200, alpha: 0.5, tint: T.phys.c2, dur: 5, alphaOverLife: LOOP_A(0.45, 0.6) }),
    particle({
      id: 'blades', asset: A.trace02, z: 3, blend: 'add', tint: T.phys.c2,
      rate: 8, lifetime: [0.8, 1.3], spawnRadius: 92, speed: [25, 55], direction: -90, spread: 25,
      gravity: { x: 0, y: -30 }, startPx: [16, 30],
      alphaOverLife: [[0, 0], [0.2, 0.85], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.1]]
    })
  ]
});

P['ground-cyclone-avatar'] = () => {
  const SPIN = [[0, 0], [1, +(9 * 1.6).toFixed(4)]];
  const blade = (id, z, rot) => sprite({
    id: id, asset: A.twirl01, z: z, sizeX: 128, sizeY: 128 * FLAT_R, rotDeg: rot,
    alpha: 0.85, tint: T.phys.c1, blend: 'add', duration: 1.6,
    alphaOverLife: LOOP_A(0.8, 1), rotationOverLife: SPIN
  });
  return {
    id: 'ground-cyclone-avatar', duration: 1.6, loop: true, layers: [
      blade('blade-a', 0, 0), blade('blade-b', 1, 120), blade('blade-c', 2, 240),
      particle({
        id: 'sparks', asset: A.dot, z: 3, blend: 'add', tint: T.phys.c2,
        rate: 10, lifetime: [0.5, 0.8], spawnRadius: 60, speed: [40, 80], direction: -90, spread: 50,
        gravity: { x: 0, y: -70 }, startPx: [3, 6],
        alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
      })
    ]
  };
};

/* =========================== 自身光環 =========================== */
P['aura-rock-armor'] = () => ({
  id: 'aura-rock-armor', duration: 3, loop: true, layers: [
    disc({ id: 'ring', asset: A.ringA, z: 0, d: 70, flat: 0.45, alpha: 0.6, tint: '#c48a55', dur: 3, alphaOverLife: LOOP_A(0.55, 0.75) }),
    /* runePlanet 本身就畫著「一圈上的 4 顆環繞物」，整片旋轉即為岩石繞行 */
    sprite({ id: 'rocks', asset: A.runePlanet, z: 1, sizeX: 76, sizeY: 34, y: -22, alpha: 0.9, tint: '#ad7444', blend: 'normal', duration: 3, alphaOverLife: LOOP_A(0.85, 1), rotationOverLife: C.spin(1) }),
    sprite({ id: 'rocks-hi', asset: A.runePlanet, z: 2, sizeX: 62, sizeY: 28, y: -38, alpha: 0.75, tint: '#c48a55', blend: 'normal', duration: 3, alphaOverLife: LOOP_A(0.7, 0.9), rotationOverLife: C.spin(-1) }),
    particle({
      id: 'dust', asset: A.smokeT, z: 3, blend: 'normal', tint: '#c9a06a',
      rate: 4, lifetime: [0.8, 1.3], spawnRadius: 26, speed: [10, 30], direction: -90, spread: 80,
      gravity: { x: 0, y: -20 }, startPx: [10, 18],
      alphaOverLife: [[0, 0], [0.25, 0.5], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.2]]
    })
  ]
});

P['aura-bloodrage'] = () => ({
  id: 'aura-bloodrage', duration: 0.8, loop: true, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, sizeX: 64, sizeY: 76, y: -30, alpha: 0.3, tint: T.bleed.c1, blend: 'add', duration: 0.8, alphaOverLife: LOOP_A(0.25, 0.42), scaleOverLife: LOOP_A(0.95, 1.08) }),
    disc({ id: 'ring', asset: A.ringA, z: 1, d: 68, flat: 0.45, alpha: 0.6, tint: T.bleed.c1, dur: 0.8, alphaOverLife: LOOP_A(0.55, 0.8) }),
    particle({
      id: 'sparks', asset: A.dot, z: 2, blend: 'add', tint: T.bleed.c2,
      rate: 14, lifetime: [0.35, 0.6], spawnRadius: 22, speed: [40, 90], direction: -90, spread: 55,
      gravity: { x: 0, y: -80 }, startPx: [3, 6],
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    })
  ]
});

P['aura-lightning-relay'] = () => ({
  id: 'aura-lightning-relay', duration: 0.35, layers: [
    sprite({ id: 'flash', asset: A.flash, z: 0, sizeX: 56, sizeY: 70, y: -30, alpha: 1, tint: '#fff8b0', blend: 'add', duration: 0.2, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.2]] }),
    sprite({ id: 'web', asset: A.arc01, z: 1, sizeX: 62, sizeY: 74, y: -30, alpha: 0.9, tint: '#f2b705', blend: 'add', duration: 0.3, alphaOverLife: C.flicker }),
    particle({
      id: 'arcs', asset: A.bolt05, z: 2, blend: 'add', tint: '#ffd23f',
      burst: 8, lifetime: [0.12, 0.24], spawnRadius: 16, speed: [120, 220], direction: -90, spread: 360,
      startPx: [12, 22], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: [[0, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.6]]
    })
  ]
});

/* =========================== 落點預警 =========================== */
function mark(o) {
  return [
    disc({ id: 'fill', asset: A.discB, z: 0, d: 200, flat: FLAT, alpha: 0.16, tint: o.fill, dur: 1.14, alphaOverLife: LOOP_A(0.16, 0.2), scaleOverLife: LOOP_A(0.975, 1.025) }),
    disc({ id: 'edge', asset: A.ringThin, z: 1, d: 200, flat: FLAT, alpha: 0.8, tint: o.edge, dur: 1.14, alphaOverLife: LOOP_A(0.75, 0.95), scaleOverLife: LOOP_A(0.975, 1.025) })
  ];
}
P['mark-red'] = () => ({ id: 'mark-red', duration: 1.14, loop: true, layers: mark({ fill: '#dc2626', edge: '#f87171' }) });
P['mark-blue'] = () => ({ id: 'mark-blue', duration: 1.14, loop: true, layers: mark({ fill: '#2563eb', edge: '#60a5fa' }) });

/* =========================== 地爆天星陰影 =========================== */
P['ground-starfall-shadow'] = () => ({
  id: 'ground-starfall-shadow', duration: 5, layers: [
    disc({
      id: 'shadow', asset: A.discWhite, z: 0, d: 200, flat: FLAT, alpha: 1, tint: '#000000', blend: 'normal', dur: 5,
      /* ease-in：前段慢、後段快，與殞石逼近的速度感一致 */
      alphaOverLife: [[0, 0.1], [0.5, 0.21], [0.8, 0.36], [1, 0.55]],
      scaleOverLife: [[0, 0.04], [0.5, 0.28], [0.8, 0.62], [1, 1]]
    })
  ]
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['ground-mire', 'ground-mire-lava', 'ground-mire-poison', 'ground-firewall',
  'ground-thunder-curtain', 'ground-thunder-orb', 'ground-blizzard',
  'ground-tornado-fire', 'ground-tornado-water', 'ground-tornado-wind',
  'ground-homing-ice-shard', 'ground-homing-wind-crescent',
  'orb-firehunt', 'orb-thunder', 'orb-void-disc',
  'ground-orbit-ring-fire', 'ground-orbit-ring-lightning', 'ground-orbit-ring-wind',
  'ground-storm-barrier', 'ground-storm-god', 'ground-storm-rip',
  'ground-domain-fire', 'ground-domain-earth', 'ground-domain-ice',
  'ground-field-fire', 'ground-swordfield', 'ground-cyclone-avatar',
  'aura-rock-armor', 'aura-bloodrage', 'aura-lightning-relay',
  'mark-red', 'mark-blue', 'ground-starfall-shadow'];
const written = [];
const assets = new Set();
for (const id of ORDER) {
  const preset = P[id]();
  if (preset.id !== id) throw new Error('id 不符：' + id);
  const zs = new Set();
  preset.layers.forEach(l => { const z = l.zIndex || 0; if (zs.has(z)) throw new Error(id + ' zIndex 重複：' + z); zs.add(z); });
  preset.layers.forEach(l => assets.add(l.assetId));
  written.push(kit.write(preset));
}
const probes = ORDER.map(id => kit.probe(id));
console.log(JSON.stringify({ written, probes, assetsUsed: [...assets].sort() }, null, 1));
