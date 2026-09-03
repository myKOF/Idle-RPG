'use strict';
/* statuses.cjs — 狀態家族（st-*）Preset 製作腳本
   角色：狀態表的 apply／aura（持續）／tick（每跳）。
   原點＝目標腳底，身高 60px（身體在 y ∈ [-60, 0]）；Runtime 直接跟隨實體，不縮放。
   ⚠️ 迴圈型（aura）的 alphaOverLife 兩端必須同值，否則每個週期都會閃一下。
   ⚠️ Core 沒有父子節點，「繞著身體公轉」一律用「本身就畫著一圈物件的素材整片旋轉」表現。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, deg, sprite, particle } = kit;
const PI = Math.PI;

const BODY_Y = -30;                       // 身體中心
const LOOP_A = (a, b) => [[0, a], [0.5, b], [1, a]];
const ONE_A = [[0, 0], [0.15, 1], [0.7, 0.8], [1, 0]];
const RISE_A = [[0, 0], [0.2, 1], [1, 0]];
const FALL_A = [[0, 1], [0.6, 0.9], [1, 0]];

/* 身體呼吸光 */
function bodyGlow(o) {
  return sprite(Object.assign({
    id: 'glow', asset: A.glowSoft, z: 0, sizeX: 52, sizeY: 68, y: BODY_Y,
    alpha: 0.28, blend: 'add', alphaOverLife: LOOP_A(0.24, 0.38), scaleOverLife: LOOP_A(0.97, 1.05)
  }, o));
}
/* 腳底扁環 */
function footRing(o) {
  return sprite(Object.assign({
    id: 'ring', asset: A.ringA, z: 1, sizeX: 46, sizeY: 18, y: -3,
    alpha: 0.5, blend: 'add', alphaOverLife: LOOP_A(0.45, 0.65)
  }, o));
}
/* 從身上升起的粒子 */
function riser(o) {
  return particle(Object.assign({
    id: 'motes', asset: A.dot, z: 3, blend: 'add',
    rate: 4, lifetime: [0.6, 1], spawnBox: [30, 44], y: BODY_Y,
    speed: [18, 40], direction: -90, spread: 40, gravity: { x: 0, y: -30 },
    startPx: [4, 8], alphaOverLife: RISE_A, scaleOverLife: [[0, 1], [1, 0.5]]
  }, o));
}
/* 從身上落下的粒子 */
function faller(o) {
  return particle(Object.assign({
    id: 'drops', asset: A.dot, z: 3, blend: 'normal',
    rate: 4, lifetime: [0.5, 0.8], spawnBox: [30, 40], y: BODY_Y,
    speed: [10, 30], direction: 90, spread: 60, gravity: { x: 0, y: 260 },
    startPx: [4, 7], alphaOverLife: FALL_A, scaleOverLife: [[0, 1], [1, 0.7]]
  }, o));
}
/* 繞身旋轉的一圈物件（素材本身就是一圈） */
function orbitBand(o) {
  return sprite(Object.assign({
    id: 'band', asset: A.runePlanet, z: 2, sizeX: 54, sizeY: 22, y: BODY_Y,
    alpha: 0.75, blend: 'add', alphaOverLife: LOOP_A(0.7, 0.9)
  }, o));
}

const P = {};
const D = {};   // duration/loop
function def(id, dur, loop, layers) { P[id] = layers; D[id] = { dur: dur, loop: loop }; }

/* =============== 持續傷害類 =============== */
def('st-burn', 1, true, o => [
  bodyGlow({ tint: '#ff7a24', alpha: 0.3 }),
  particle({
    id: 'flames', asset: A.flame05, z: 1, blend: 'add', tint: '#ff7a24',
    rate: 12, lifetime: [0.6, 0.8], spawnBox: [26, 40], y: BODY_Y,
    speed: [30, 60], direction: -90, spread: 35, gravity: { x: 0, y: -70 },
    startPx: [12, 22], alphaOverLife: RISE_A, scaleOverLife: [[0, 0.8], [1, 0.4]]
  }),
  riser({ id: 'embers', z: 2, tint: '#ffd447', rate: 8, startPx: [3, 6], speed: [40, 80] })
]);

def('st-bleed', 1, true, () => [
  bodyGlow({ tint: T.bleed.c1, alpha: 0.2 }),
  faller({ id: 'drops', tint: T.bleed.c1, rate: 4, startPx: [5, 9] })
]);

def('st-poison', 1.2, true, () => [
  bodyGlow({ tint: T.poison.c1, alpha: 0.22 }),
  sprite({ id: 'mist', asset: A.smokeT, z: 1, sizeX: 46, sizeY: 40, y: BODY_Y, alpha: 0.25, tint: T.poison.c1, blend: 'normal', alphaOverLife: LOOP_A(0.2, 0.32), scaleOverLife: LOOP_A(0.95, 1.08) }),
  particle({
    id: 'bubbles', asset: A.bubble, z: 2, blend: 'normal', tint: T.poison.c1,
    rate: 5, lifetime: [0.8, 1.2], spawnBox: [28, 40], y: BODY_Y,
    speed: [12, 30], direction: -90, spread: 55, gravity: { x: 0, y: -28 },
    startPx: [6, 11], alphaOverLife: RISE_A, scaleOverLife: [[0, 0.6], [1, 1.1]]
  })
]);

def('st-corrode', 1.5, true, () => [
  sprite({ id: 'shadow', asset: A.glowSoft, z: 0, sizeX: 50, sizeY: 66, y: BODY_Y, alpha: 0.3, tint: '#1a0c2e', blend: 'normal', alphaOverLife: LOOP_A(0.25, 0.42), scaleOverLife: LOOP_A(0.97, 1.06) }),
  particle({
    id: 'wisps', asset: A.smokeDark, z: 1, blend: 'normal', tint: '#6f2da8',
    rate: 5, lifetime: [0.9, 1.4], spawnBox: [30, 44], y: BODY_Y,
    speed: [12, 30], direction: -90, spread: 60, gravity: { x: 0, y: -20 },
    startPx: [14, 26], alphaOverLife: [[0, 0], [0.25, 0.6], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.2]]
  })
]);

def('st-frostbite', 1.2, true, () => [
  bodyGlow({ tint: '#f2fbff', alpha: 0.25 }),
  sprite({ id: 'mist', asset: A.smokeT, z: 1, sizeX: 48, sizeY: 42, y: BODY_Y, alpha: 0.28, tint: '#79d8ff', blend: 'add', alphaOverLife: LOOP_A(0.24, 0.36), scaleOverLife: LOOP_A(0.96, 1.06) }),
  particle({
    id: 'flakes', asset: A.diamond, z: 2, blend: 'normal', tint: '#f2fbff',
    rate: 5, lifetime: [0.8, 1.2], spawnBox: [34, 30], y: -46,
    speed: [8, 22], direction: 90, spread: 50, gravity: { x: 0, y: 40 },
    startPx: [4, 8], rotationStart: [0, PI], rotationSpeed: [-3, 3],
    alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 0.8]]
  })
]);

def('st-frost-stacks', 2, true, () => [
  bodyGlow({ tint: '#4da6ff', alpha: 0.24 }),
  particle({
    id: 'flakes', asset: A.snowflake, z: 1, blend: 'add', tint: '#f2fbff',
    rate: 4, lifetime: [1.4, 2], spawnRadius: 26, y: BODY_Y,
    speed: [4, 12], direction: 0, spread: 360, rotationStart: [0, PI], rotationSpeed: [-1.5, 1.5],
    startPx: [8, 14], alphaOverLife: [[0, 0], [0.2, 0.85], [0.8, 0.7], [1, 0]], scaleOverLife: LOOP_A(1, 1.1)
  })
]);

def('st-frozen', 1.5, true, () => {
  const SHELL = (id, z, sx, sy, x, y, rot, tint, a) => sprite({
    id: id, asset: A.triangleDown, z: z, sizeX: sx, sizeY: sy, x: x, y: y, rotDeg: rot,
    alpha: a, tint: tint, blend: 'normal', alphaOverLife: LOOP_A(a, a * 1.06)
  });
  return [
    bodyGlow({ tint: '#79d8ff', alpha: 0.3 }),
    SHELL('ice-a', 1, 42, 62, 0, -30, 180, '#4da6ff', 0.75),
    SHELL('ice-b', 2, 22, 46, -14, -22, 165, '#4da6ff', 0.7),
    SHELL('ice-c', 3, 20, 42, 14, -24, 195, '#4da6ff', 0.7),
    SHELL('ice-hi', 4, 14, 34, -5, -38, 178, '#f2fbff', 0.8),
    /* 表面反光緩慢掃過：細長高光條左右來回 */
    sprite({
      id: 'sheen', asset: A.trace02, z: 5, sizeX: 10, sizeY: 56, y: -30, alpha: 0.5, tint: '#ffffff', blend: 'add',
      alphaOverLife: LOOP_A(0.35, 0.6), rotationOverLife: [[0, deg(-14)], [0.5, deg(14)], [1, deg(-14)]]
    })
  ];
});

def('st-windcut', 0.8, true, () => [
  bodyGlow({ tint: T.wind.c1, alpha: 0.2 }),
  sprite({ id: 'blades', asset: A.needles16, z: 1, sizeX: 56, sizeY: 30, y: BODY_Y, alpha: 0.6, tint: T.wind.c1, blend: 'add', alphaOverLife: LOOP_A(0.55, 0.75), rotationOverLife: C.spin(1) }),
  sprite({ id: 'trace', asset: A.slash01, z: 2, sizeX: 46, sizeY: 34, y: BODY_Y, alpha: 0.5, tint: '#ffffff', blend: 'add', alphaOverLife: LOOP_A(0.4, 0.7), rotationOverLife: C.spin(-1) })
]);

/* =============== 控場類 =============== */
def('st-stun', 1.2, true, () => [
  sprite({ id: 'orbit', asset: A.magicPenta, z: 0, sizeX: 46, sizeY: 18, y: -64, alpha: 0.85, tint: '#ffe47a', blend: 'add', alphaOverLife: LOOP_A(0.8, 1), rotationOverLife: C.spin(1) }),
  sprite({ id: 'star', asset: A.star08, z: 1, size: 18, y: -64, alpha: 0.9, tint: '#fffef4', blend: 'add', alphaOverLife: LOOP_A(0.7, 1), rotationOverLife: C.spin(-0.5) })
]);

def('st-slow', 1.6, true, () => [
  footRing({ tint: '#4da6ff', alpha: 0.55, sizeX: 50, sizeY: 20, alphaOverLife: LOOP_A(0.45, 0.7), scaleOverLife: LOOP_A(0.94, 1.06) }),
  faller({ id: 'drips', tint: '#79d8ff', blend: 'add', rate: 3, startPx: [4, 7], gravity: { x: 0, y: 90 }, speed: [5, 15] })
]);

def('st-petrify', 2, true, () => [
  sprite({ id: 'stone', asset: A.discNoise, z: 0, sizeX: 46, sizeY: 62, y: BODY_Y, alpha: 0.5, tint: '#8a7a6a', blend: 'normal', alphaOverLife: LOOP_A(0.45, 0.58) }),
  faller({ id: 'dust', tint: '#a89886', rate: 3, startPx: [3, 6], gravity: { x: 0, y: 70 }, speed: [3, 10], lifetime: [0.9, 1.4] })
]);

def('st-water-prison', 1.5, true, () => [
  bodyGlow({ tint: '#38bdf8', alpha: 0.26 }),
  orbitBand({ id: 'water', asset: A.ringSegments4, sizeX: 52, sizeY: 22, tint: '#38bdf8', alpha: 0.8, rotationOverLife: C.spin(1) }),
  riser({ id: 'drops', tint: '#f0f9ff', rate: 5, startPx: [4, 7], speed: [10, 26] })
]);

/* =============== 增益類 =============== */
def('st-invuln', 1.5, true, () => [
  sprite({ id: 'dome', asset: A.discB, z: 0, sizeX: 56, sizeY: 72, y: BODY_Y, alpha: 0.25, tint: '#ffe47a', blend: 'add', alphaOverLife: LOOP_A(0.22, 0.34), scaleOverLife: LOOP_A(0.97, 1.05) }),
  footRing({ tint: '#ffe47a', alpha: 0.65, sizeX: 52, sizeY: 20 }),
  particle({
    id: 'glints', asset: A.star02, z: 2, blend: 'add', tint: '#fffef4',
    rate: 4, lifetime: [0.4, 0.7], spawnRadius: 28, y: BODY_Y, speed: [0, 12], direction: 0, spread: 360,
    startPx: [7, 13], alphaOverLife: [[0, 0], [0.3, 1], [1, 0]], scaleOverLife: [[0, 0.6], [0.5, 1], [1, 0.6]]
  })
]);

def('st-shield', 2, true, () => [
  sprite({ id: 'bubble', asset: A.discB, z: 0, sizeX: 58, sizeY: 74, y: BODY_Y, alpha: 0.3, tint: '#4da6ff', blend: 'add', alphaOverLife: LOOP_A(0.26, 0.4), scaleOverLife: LOOP_A(0.97, 1.05) }),
  sprite({ id: 'rim', asset: A.ringA, z: 1, sizeX: 58, sizeY: 74, y: BODY_Y, alpha: 0.7, tint: '#79d8ff', blend: 'add', alphaOverLife: LOOP_A(0.6, 0.85) }),
  sprite({ id: 'gloss', asset: A.caustics, z: 2, sizeX: 54, sizeY: 70, y: BODY_Y, alpha: 0.3, tint: '#f0f9ff', blend: 'add', alphaOverLife: LOOP_A(0.24, 0.4), rotationOverLife: C.spin(0.5) })
]);

def('st-regen', 1.2, true, () => [
  bodyGlow({ tint: '#4ade80', alpha: 0.24 }),
  riser({ id: 'crosses', asset: A.cross, tint: '#4ade80', rate: 4, startPx: [10, 16], speed: [22, 45] })
]);

def('st-buff', 1.5, true, () => [
  footRing({ tint: '#ffe47a', alpha: 0.45 }),
  riser({ id: 'motes', tint: '#fffef4', rate: 3, startPx: [5, 9] })
]);

def('st-debuff', 1.5, true, () => [
  footRing({ tint: '#913dcc', alpha: 0.45 }),
  particle({
    id: 'wisps', asset: A.smokeDark, z: 3, blend: 'normal', tint: '#913dcc',
    rate: 3, lifetime: [0.8, 1.3], spawnBox: [30, 30], y: -46,
    speed: [8, 22], direction: 90, spread: 50, gravity: { x: 0, y: 40 },
    startPx: [12, 22], alphaOverLife: [[0, 0], [0.25, 0.55], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.15]]
  })
]);

def('st-atk-up', 1, true, () => [
  footRing({ tint: '#ff6a2a', alpha: 0.5 }),
  riser({ id: 'sparks', tint: '#ff6a2a', rate: 10, startPx: [4, 7], speed: [40, 85], gravity: { x: 0, y: -70 } })
]);

def('st-def-up', 1.5, true, () => [
  sprite({ id: 'hex', asset: A.reticleHex, z: 0, sizeX: 44, sizeY: 50, y: BODY_Y, alpha: 0.55, tint: '#93c5fd', blend: 'add', alphaOverLife: LOOP_A(0.45, 0.72), scaleOverLife: LOOP_A(0.96, 1.05) }),
  footRing({ tint: '#93c5fd', alpha: 0.45 })
]);

def('st-aspd-up', 0.6, true, () => [
  footRing({ tint: '#f2b705', alpha: 0.5 }),
  particle({
    id: 'lines', asset: A.trace02H, z: 2, blend: 'add', tint: '#f2b705',
    rate: 14, lifetime: [0.2, 0.32], spawnBox: [16, 44], y: BODY_Y,
    speed: [90, 160], direction: 180, spread: 12, startPx: [16, 28],
    alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 0.6]]
  })
]);

def('st-crit-up', 0.8, true, () => [
  footRing({ id: 'ring', tint: '#ff4a08', alpha: 0.55, sizeX: 46, sizeY: 18 }),
  footRing({ id: 'ring-outer', z: 2, tint: '#ff4a08', alpha: 0.35, sizeX: 58, sizeY: 22, alphaOverLife: LOOP_A(0.3, 0.5) }),
  riser({ id: 'sparks', tint: '#ff4a08', rate: 12, startPx: [4, 8], speed: [50, 100], gravity: { x: 0, y: -60 }, spread: 70 })
]);

/* =============== 減益類 =============== */
def('st-armor-break', 1.2, true, () => [
  sprite({ id: 'crack', asset: A.flash, z: 0, sizeX: 42, sizeY: 50, y: BODY_Y, alpha: 0.4, tint: '#ad7444', blend: 'add', alphaOverLife: LOOP_A(0.3, 0.55) }),
  faller({
    id: 'chips', asset: A.diamond, tint: '#ad7444', rate: 3, startPx: [6, 11],
    rotationStart: [0, PI], rotationSpeed: [-5, 5], gravity: { x: 0, y: 340 }
  })
]);

def('st-wind-rend', 1, true, () => [
  sprite({ id: 'cut-a', asset: A.slash01, z: 0, sizeX: 44, sizeY: 32, y: -36, rotDeg: -35, alpha: 0.7, tint: T.wind.c1, blend: 'add', alphaOverLife: LOOP_A(0.35, 0.85) }),
  sprite({ id: 'cut-b', asset: A.slash01, z: 1, sizeX: 40, sizeY: 28, y: -22, rotDeg: 40, alpha: 0.65, tint: T.wind.c1, blend: 'add', alphaOverLife: [[0, 0.75], [0.5, 0.3], [1, 0.75]] }),
  faller({ id: 'shards', tint: T.wind.c1, blend: 'add', rate: 5, startPx: [3, 6], gravity: { x: 0, y: 150 } })
]);

def('st-mark-dark', 2, true, () => [
  sprite({ id: 'rune', asset: A.runeSpiky, z: 0, sizeX: 40, sizeY: 40, y: -68, alpha: 0.8, tint: '#c084fc', blend: 'add', alphaOverLife: LOOP_A(0.7, 0.95), rotationOverLife: C.spin(0.5) }),
  riser({ id: 'flames', asset: A.flame05, tint: '#6f2da8', rate: 4, startPx: [8, 14], speed: [15, 35], y: -46 })
]);

def('st-fire-amp', 1, true, () => [
  sprite({ id: 'ring', asset: A.ringSoft, z: 0, sizeX: 52, sizeY: 66, y: BODY_Y, alpha: 0.5, tint: '#ff6a2a', blend: 'add', alphaOverLife: LOOP_A(0.4, 0.7), scaleOverLife: LOOP_A(0.96, 1.06) }),
  riser({ id: 'sparks', tint: '#ffd447', rate: 5, startPx: [3, 6], speed: [35, 70], gravity: { x: 0, y: -60 } })
]);

def('st-thorns', 2, true, () => [
  sprite({ id: 'spikes', asset: A.needles16, z: 0, sizeX: 58, sizeY: 58, y: BODY_Y, alpha: 0.6, tint: '#76d83b', blend: 'add', alphaOverLife: LOOP_A(0.5, 0.72), rotationOverLife: C.spin(1) }),
  footRing({ tint: '#76d83b', alpha: 0.35 })
]);

def('st-lightning', 0.5, true, () => [
  bodyGlow({ tint: '#f2b705', alpha: 0.24 }),
  particle({
    id: 'arcs', asset: A.bolt05, z: 1, blend: 'add', tint: '#f2b705',
    rate: 10, lifetime: [0.1, 0.3], spawnBox: [30, 46], y: BODY_Y,
    speed: [0, 20], direction: 0, spread: 360, startPx: [12, 22], rotationStart: [0, PI * 2],
    alphaOverLife: [[0, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.7]]
  })
]);

def('st-storm', 1, true, () => [
  orbitBand({ id: 'ring', asset: A.ringSegments4, sizeX: 54, sizeY: 22, tint: T.wind.c1, alpha: 0.75, rotationOverLife: C.spin(1) }),
  sprite({ id: 'trace', asset: A.slash01, z: 3, sizeX: 44, sizeY: 30, y: BODY_Y, alpha: 0.5, tint: '#ffffff', blend: 'add', alphaOverLife: LOOP_A(0.4, 0.65), rotationOverLife: C.spin(-1) })
]);

/* =============== 每跳（一次性） =============== */
def('st-tick-fire', 0.45, false, () => [
  particle({
    id: 'flames', asset: A.flame05, z: 0, blend: 'add', tint: '#ff7a24',
    burst: 3, lifetime: [0.3, 0.4], spawnBox: [20, 26], y: BODY_Y,
    speed: [40, 80], direction: -90, spread: 40, gravity: { x: 0, y: -90 },
    startPx: [16, 26], alphaOverLife: ONE_A, scaleOverLife: [[0, 0.8], [1, 0.4]]
  }),
  particle({
    id: 'embers', asset: A.dot, z: 1, blend: 'add', tint: '#ffd447',
    burst: 2, lifetime: [0.25, 0.4], spawnRadius: 10, y: BODY_Y,
    speed: [50, 100], direction: -90, spread: 70, gravity: { x: 0, y: -70 },
    startPx: [3, 6], alphaOverLife: ONE_A, scaleOverLife: [[0, 1], [1, 0.4]]
  })
]);

def('st-tick-poison', 0.6, false, () => [
  particle({
    id: 'bubbles', asset: A.bubble, z: 0, blend: 'normal', tint: T.poison.c1,
    burst: 3, lifetime: [0.4, 0.6], spawnBox: [18, 24], y: BODY_Y,
    speed: [18, 45], direction: -90, spread: 55, gravity: { x: 0, y: -50 },
    startPx: [7, 13], alphaOverLife: [[0, 0], [0.2, 0.95], [0.85, 0.85], [1, 0]], scaleOverLife: [[0, 0.6], [0.8, 1.1], [1, 1.3]]
  })
]);

def('st-tick-bleed', 0.45, false, () => [
  sprite({ id: 'flash', asset: A.flash, z: 0, sizeX: 34, sizeY: 40, y: BODY_Y, alpha: 0.7, tint: T.bleed.c2, blend: 'add', duration: 0.18, alphaOverLife: C.pop }),
  particle({
    id: 'drops', asset: A.dot, z: 1, blend: 'normal', tint: T.bleed.c1,
    burst: 3, lifetime: [0.3, 0.45], spawnBox: [18, 22], y: BODY_Y,
    speed: [30, 70], direction: 90, spread: 90, gravity: { x: 0, y: 420 },
    startPx: [5, 9], alphaOverLife: FALL_A, scaleOverLife: [[0, 1], [1, 0.7]]
  })
]);

def('st-tick-ice', 0.45, false, () => [
  sprite({ id: 'flash', asset: A.star08, z: 0, size: 30, y: BODY_Y, alpha: 1, tint: '#79d8ff', blend: 'add', duration: 0.2, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.2]] }),
  particle({
    id: 'shards', asset: A.diamond, z: 1, blend: 'normal', tint: '#f2fbff',
    burst: 3, lifetime: [0.3, 0.45], spawnRadius: 10, y: BODY_Y,
    speed: [60, 120], direction: 0, spread: 360, gravity: { x: 0, y: 380 },
    startPx: [5, 9], rotationStart: [0, PI], rotationSpeed: [-6, 6],
    alphaOverLife: FALL_A, scaleOverLife: [[0, 1], [1, 0.7]]
  })
]);

def('st-tick-dark', 0.5, false, () => [
  sprite({ id: 'flash', asset: A.flash, z: 0, sizeX: 34, sizeY: 40, y: BODY_Y, alpha: 0.8, tint: '#913dcc', blend: 'add', duration: 0.2, alphaOverLife: C.pop }),
  particle({
    id: 'wisp', asset: A.smokeDark, z: 1, blend: 'normal', tint: '#6f2da8',
    burst: 2, lifetime: [0.35, 0.5], spawnRadius: 8, y: BODY_Y,
    speed: [18, 40], direction: -90, spread: 40, gravity: { x: 0, y: -30 },
    startPx: [16, 26], alphaOverLife: [[0, 0], [0.25, 0.7], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.2]]
  })
]);

def('st-tick-wind', 0.35, false, () => [
  sprite({ id: 'cut-a', asset: A.slash01, z: 0, sizeX: 44, sizeY: 32, y: -34, rotDeg: -40, alpha: 0.9, tint: T.wind.c1, blend: 'add', duration: 0.3, alphaOverLife: ONE_A }),
  sprite({ id: 'cut-b', asset: A.slash01, z: 1, sizeX: 40, sizeY: 28, y: -24, rotDeg: 42, alpha: 0.85, tint: T.wind.c1, blend: 'add', delay: 0.06, duration: 0.28, alphaOverLife: ONE_A })
]);

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['st-burn', 'st-bleed', 'st-poison', 'st-corrode', 'st-frostbite', 'st-frost-stacks',
  'st-frozen', 'st-windcut', 'st-stun', 'st-slow', 'st-invuln', 'st-shield', 'st-regen', 'st-buff',
  'st-debuff', 'st-atk-up', 'st-def-up', 'st-aspd-up', 'st-crit-up', 'st-armor-break', 'st-wind-rend',
  'st-petrify', 'st-mark-dark', 'st-fire-amp', 'st-thorns', 'st-lightning', 'st-water-prison', 'st-storm',
  'st-tick-fire', 'st-tick-poison', 'st-tick-bleed', 'st-tick-ice', 'st-tick-dark', 'st-tick-wind'];
const written = [];
const assets = new Set();
for (const id of ORDER) {
  const meta = D[id];
  if (!meta) throw new Error('沒有定義：' + id);
  const layers = P[id]().map(l => {
    /* 迴圈型圖層一律吃滿整個週期；一次性的則沿用各自寫死的 duration。 */
    if (meta.loop && l.duration === undefined) l.duration = meta.dur;
    return l;
  });
  const preset = { id: id, duration: meta.dur, loop: meta.loop, layers: layers };
  const zs = new Set();
  preset.layers.forEach(l => { const z = l.zIndex || 0; if (zs.has(z)) throw new Error(id + ' zIndex 重複：' + z); zs.add(z); });
  preset.layers.forEach(l => assets.add(l.assetId));
  written.push(kit.write(preset));
}
const probes = ORDER.map(id => kit.probe(id));
console.log(JSON.stringify({ written, probes, assetsUsed: [...assets].sort() }, null, 1));
