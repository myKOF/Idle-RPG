'use strict';
/* hits.cjs — 受擊家族（hit-*）Preset 製作腳本
   結構共用：光暈 halo（大、飽和、低 α、低 z）→ 細環 ring（半徑 6→18px）→ 中心閃光 flash（小、偏白、高 z）
   → 6 顆加法火花向外飛並受重力下墜；元素差異放在火花素材／行為與額外圖層。
   座標：原點 = 目標身體中心；名目：目標身高 60px、主體約 40px。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, sprite, particle } = kit;
const PI = Math.PI;

/* ---- 共用曲線（attack ≤ 12%、release 55%~ 之後） ---- */
const FLASH_A = [[0, 0], [0.12, 1], [0.5, 0.7], [1, 0]];
const FLASH_S = [[0, 0.5], [0.2, 1], [1, 1.15]];
const RING_A = [[0, 0], [0.08, 1], [0.55, 0.75], [1, 0]];
const RING_S = [[0, 0.33], [0.35, 0.8], [1, 1]];      // 環半徑 6 → 18px（size 46 的環）
const HALO_A = [[0, 0], [0.1, 1], [0.5, 0.6], [1, 0]];
const HALO_S = [[0, 0.6], [0.3, 1], [1, 1.15]];
const SPARK_A = [[0, 1], [0.5, 1], [1, 0]];
const SPARK_S = [[0, 1], [1, 0.4]];
const FLICKER_A = [[0, 1], [0.25, 0.45], [0.45, 1], [0.7, 0.55], [0.85, 0.9], [1, 0]];

/* ---- 共用三件組：halo / ring / flash ---- */
function core(o) {
  const d = o.delay || 0;
  const layers = [];
  if (o.halo !== false) {
    layers.push(sprite({
      id: 'halo', asset: o.haloAsset || A.glowSoft, z: 0, size: o.haloSize || 64,
      alpha: o.haloAlpha === undefined ? 0.5 : o.haloAlpha, tint: o.haloTint, blend: 'add',
      delay: d, duration: o.haloDur || 0.26, alphaOverLife: HALO_A, scaleOverLife: HALO_S
    }));
  }
  layers.push(sprite({
    id: 'ring', asset: o.ringAsset || A.ringThin, z: 1, size: o.ringSize || 46,
    alpha: o.ringAlpha === undefined ? 0.9 : o.ringAlpha, tint: o.ringTint, blend: 'add',
    delay: d, duration: o.ringDur || 0.3, alphaOverLife: RING_A, scaleOverLife: o.ringScale || RING_S
  }));
  layers.push(sprite({
    id: 'flash', asset: o.flashAsset || A.flash, z: 3, size: o.flashSize || 40,
    alpha: 1, tint: o.flashTint, blend: 'add', rotDeg: o.flashRot || 0,
    delay: d, duration: o.flashDur || 0.16, alphaOverLife: FLASH_A, scaleOverLife: FLASH_S
  }));
  return layers;
}

/* ---- 共用火花：6 顆、向外、受重力 ---- */
function sparks(o) {
  return particle(Object.assign({
    id: 'sparks', asset: A.dot, z: 5, blend: 'add',
    burst: 6, lifetime: [0.22, 0.34], spawnRadius: 4,
    speed: [80, 130], direction: -90, spread: 360, gravity: { x: 0, y: 320 },
    startPx: [5, 9], alphaOverLife: SPARK_A, scaleOverLife: SPARK_S
  }, o));
}

const P = {};

/* ---------- hit-phys：暖白方形碎片 ---------- */
P['hit-phys'] = () => ({
  id: 'hit-phys', duration: 0.4, layers: [
    ...core({ haloTint: T.phys.glow, haloAlpha: 0.4, ringTint: T.phys.c1, flashTint: T.phys.c2 }),
    sparks({ asset: A.diamond, tint: T.phys.c1, startPx: [5, 8], rotationStart: [0, PI], rotationSpeed: [-9, 9], speed: [90, 150] })
  ]
});

/* ---------- hit-fire：火花偏向上飄 + 3 片火舌 ---------- */
P['hit-fire'] = () => ({
  id: 'hit-fire', duration: 0.4, layers: [
    ...core({ haloTint: T.fire.glow, haloAlpha: 0.55, ringTint: T.fire.c1, flashAsset: A.fire01, flashTint: T.fire.c2, flashSize: 44 }),
    sparks({ tint: T.fire.c2, direction: -90, spread: 240, speed: [60, 130], gravity: { x: 0, y: -140 }, lifetime: [0.26, 0.38], startPx: [4, 8] }),
    particle({
      id: 'tongues', asset: A.flame05, z: 4, blend: 'add', tint: T.fire.c1,
      burst: 3, lifetime: [0.22, 0.32], spawnRadius: 8, speed: [30, 70], direction: -90, spread: 90,
      gravity: { x: 0, y: -60 }, startPx: [14, 22], alphaOverLife: [[0, 0], [0.15, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 0.7], [0.4, 1], [1, 0.5]]
    })
  ]
});

/* ---------- hit-ice：菱形冰晶碎片 + 星芒閃點 ---------- */
P['hit-ice'] = () => ({
  id: 'hit-ice', duration: 0.4, layers: [
    ...core({ haloTint: T.ice.glow, ringTint: T.ice.c1, flashAsset: A.star09, flashTint: T.ice.c2, flashSize: 44, flashRot: 15 }),
    sparks({ asset: A.diamond, tint: T.ice.c2, startPx: [6, 10], rotationStart: [0, PI], rotationSpeed: [-7, 7], speed: [90, 160], gravity: { x: 0, y: 380 } }),
    particle({
      id: 'glints', asset: A.star08, z: 6, blend: 'add', tint: T.ice.c1,
      burst: 3, lifetime: [0.18, 0.28], spawnRadius: 12, speed: [10, 30], direction: -90, spread: 360,
      startPx: [10, 16], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.5], [0.5, 1], [1, 0.6]]
    })
  ]
});

/* ---------- hit-lightning：細電弧絲（順速度方向）+ 電弧網閃爍 ---------- */
P['hit-lightning'] = () => ({
  id: 'hit-lightning', duration: 0.4, layers: [
    ...core({ haloTint: T.lightning.glow, haloAlpha: 0.55, ringTint: T.lightning.c1, flashTint: T.lightning.c2, flashDur: 0.14 }),
    sprite({
      id: 'arcweb', asset: A.arc02, z: 2, size: 44, alpha: 0.9, tint: T.lightning.c1, blend: 'add', rotDeg: 20,
      duration: 0.2, alphaOverLife: FLICKER_A, scaleOverLife: [[0, 0.7], [0.3, 1], [1, 1.1]]
    }),
    sparks({
      asset: A.bolt05, tint: T.lightning.c2, alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      lifetime: [0.12, 0.22], speed: [140, 240], gravity: { x: 0, y: 200 }, startPx: [14, 22],
      alphaOverLife: FLICKER_A, scaleOverLife: [[0, 1], [1, 0.6]]
    })
  ]
});

/* ---------- hit-poison：空心毒泡緩慢上浮 + 綠霧 ---------- */
P['hit-poison'] = () => ({
  id: 'hit-poison', duration: 0.4, layers: [
    ...core({ haloTint: T.poison.glow, ringTint: T.poison.c1, flashTint: T.poison.c2, flashSize: 36 }),
    sprite({
      id: 'mist', asset: A.smokeT, z: 2, size: 44, alpha: 0.35, tint: T.poison.c1, blend: 'normal',
      duration: 0.38, alphaOverLife: [[0, 0], [0.15, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.35]], rotationOverLife: [[0, 0], [1, 0.5]]
    }),
    sparks({
      asset: A.bubble, tint: T.poison.c1, burst: 6, lifetime: [0.3, 0.4], spawnRadius: 8,
      speed: [25, 60], direction: -90, spread: 150, gravity: { x: 0, y: -50 }, startPx: [7, 12],
      alphaOverLife: [[0, 0], [0.15, 1], [0.85, 1], [1, 0]], scaleOverLife: [[0, 0.6], [0.7, 1], [1, 1.1]]
    })
  ]
});

/* ---------- hit-light：白金塵點 + 星芒閃光 ---------- */
P['hit-light'] = () => ({
  id: 'hit-light', duration: 0.4, layers: [
    ...core({ haloTint: T.light.c1, haloAlpha: 0.55, haloSize: 70, ringTint: T.light.c1, flashAsset: A.star09, flashTint: T.light.c2, flashSize: 46 }),
    sprite({
      id: 'cross', asset: A.star02, z: 4, size: 34, alpha: 0.9, tint: T.light.c2, blend: 'add', rotDeg: 45,
      duration: 0.22, alphaOverLife: FLASH_A, scaleOverLife: [[0, 0.6], [0.25, 1], [1, 1.2]], rotationOverLife: [[0, 0], [1, 0.6]]
    }),
    sparks({ asset: A.star04, tint: T.light.c2, startPx: [6, 11], speed: [70, 130], gravity: { x: 0, y: 240 }, lifetime: [0.26, 0.38] })
  ]
});

/* ---------- hit-dark：內縮漩渦（0~0.16s）→ 暗核 → 0.14s 後爆開 ---------- */
P['hit-dark'] = () => ({
  id: 'hit-dark', duration: 0.4, layers: [
    sprite({
      id: 'vortex', asset: A.twirl02, z: 2, size: 64, alpha: 0.95, tint: T.dark.c1, blend: 'add',
      duration: 0.17, alphaOverLife: [[0, 0], [0.15, 1], [0.8, 1], [1, 0.5]],
      scaleOverLife: [[0, 1.25], [1, 0.3]], rotationOverLife: [[0, 0], [1, -3.8]]
    }),
    sprite({
      id: 'darkcore', asset: A.smokeT, z: 4, size: 30, alpha: 0.85, tint: T.dark.c2, blend: 'normal',
      duration: 0.32, alphaOverLife: [[0, 0], [0.35, 1], [0.7, 0.8], [1, 0]],
      scaleOverLife: [[0, 0.3], [0.4, 1], [1, 1.5]], rotationOverLife: [[0, 0], [1, 1.2]]
    }),
    ...core({ delay: 0.14, haloTint: T.dark.glow, haloAlpha: 0.6, ringTint: T.dark.c1, ringDur: 0.26, flashTint: T.dark.bright, flashSize: 36, flashDur: 0.14 }),
    sparks({ tint: T.dark.bright, delay: 0.14, lifetime: [0.18, 0.26], speed: [110, 180], gravity: { x: 0, y: 300 }, startPx: [4, 8] })
  ]
});

/* ---------- hit-earth：方形碎石（不透明）+ 塵土 ---------- */
P['hit-earth'] = () => ({
  id: 'hit-earth', duration: 0.4, layers: [
    ...core({ haloTint: T.earth.glow, haloAlpha: 0.4, ringTint: T.earth.c1, flashTint: T.earth.glow, flashSize: 38 }),
    particle({
      id: 'dust', asset: A.smokeT, z: 2, blend: 'normal', tint: T.earth.c2, alpha: 0.5,
      burst: 3, lifetime: [0.3, 0.38], spawnRadius: 6, speed: [20, 45], direction: -90, spread: 360,
      startPx: [16, 24], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.5]]
    }),
    sparks({
      asset: A.diamond, tint: T.earth.c1, blend: 'normal', startPx: [6, 10],
      rotationStart: [0, PI], rotationSpeed: [-8, 8], speed: [70, 130], gravity: { x: 0, y: 440 },
      lifetime: [0.22, 0.32], scaleOverLife: [[0, 1], [1, 0.7]], alphaOverLife: [[0, 1], [0.7, 1], [1, 0]]
    })
  ]
});

/* ---------- hit-wind：細長風刃碎片（順速度方向）淺綠 + 白 ---------- */
P['hit-wind'] = () => ({
  id: 'hit-wind', duration: 0.4, layers: [
    ...core({ haloTint: T.wind.glow, haloAlpha: 0.35, ringTint: T.wind.c1, flashTint: T.wind.c2, flashSize: 34, flashDur: 0.14 }),
    sparks({
      asset: A.trace02, tint: T.wind.c1, alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      lifetime: [0.16, 0.26], speed: [110, 190], gravity: { x: 0, y: 120 }, startPx: [16, 26], scaleOverLife: [[0, 1], [1, 0.5]]
    }),
    particle({
      id: 'sparks-white', asset: A.trace02, z: 6, blend: 'add', tint: T.wind.c2,
      burst: 4, lifetime: [0.12, 0.2], spawnRadius: 4, speed: [140, 220], direction: -90, spread: 360,
      gravity: { x: 0, y: 80 }, startPx: [10, 16], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: SPARK_A, scaleOverLife: [[0, 1], [1, 0.4]]
    })
  ]
});

/* ---------- hit-bleed：暗紅閃光 + 血濺貼花 + 亮粉紅血滴向下濺落（無震動） ---------- */
P['hit-bleed'] = () => ({
  id: 'hit-bleed', duration: 0.45, layers: [
    ...core({ haloTint: T.bleed.c1, haloAlpha: 0.45, haloSize: 60, ringTint: T.bleed.c1, ringAlpha: 0.6, ringSize: 40, flashTint: T.bleed.c1, flashSize: 36 }),
    sprite({
      id: 'splat', asset: A.spatterCenter, z: 2, size: 36, alpha: 0.85, tint: T.bleed.c1, blend: 'normal', rotDeg: 30,
      duration: 0.42, alphaOverLife: [[0, 0], [0.08, 1], [0.5, 0.9], [1, 0]], scaleOverLife: [[0, 0.4], [0.12, 1], [1, 1.1]]
    }),
    particle({
      id: 'drops', asset: A.lines1, z: 5, blend: 'normal', tint: T.bleed.c2,
      burst: 6, lifetime: [0.24, 0.32], spawnRadius: 5, speed: [30, 90], direction: 90, spread: 150,
      gravity: { x: 0, y: 400 }, startPx: [12, 18], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: [[0, 1], [0.6, 1], [1, 0]], scaleOverLife: [[0, 0.8], [0.3, 1], [1, 0.8]]
    }),
    particle({
      id: 'mist', asset: A.dot, z: 6, blend: 'add', tint: T.bleed.c2,
      burst: 4, lifetime: [0.18, 0.28], spawnRadius: 6, speed: [40, 90], direction: 90, spread: 220,
      gravity: { x: 0, y: 300 }, startPx: [3, 6], alphaOverLife: SPARK_A, scaleOverLife: SPARK_S
    })
  ]
});

/* ---------- hit-fire-explosion：大型火球爆炸（環半徑 6→60px、0.62s；18 顆火花 + 6 火舌 + 煙） ---------- */
P['hit-fire-explosion'] = () => ({
  id: 'hit-fire-explosion', duration: 0.7, layers: [
    sprite({
      id: 'halo', asset: A.glowSoft, z: 0, size: 150, alpha: 0.6, tint: T.fire.glow, blend: 'add',
      duration: 0.45, alphaOverLife: HALO_A, scaleOverLife: [[0, 0.5], [0.3, 1], [1, 1.2]]
    }),
    particle({
      id: 'smoke', asset: A.smokeT, z: 1, blend: 'normal', tint: '#3a2a24', alpha: 0.55,
      burst: 4, lifetime: [0.45, 0.6], spawnRadius: 10, speed: [30, 70], direction: -90, spread: 360,
      gravity: { x: 0, y: -40 }, startPx: [30, 50], delay: 0.08,
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.6]], rotationStart: [0, PI], rotationSpeed: [-1.5, 1.5]
    }),
    sprite({
      id: 'ring', asset: A.ringThin, z: 2, size: 150, alpha: 0.95, tint: T.fire.glow, blend: 'add',
      duration: 0.62, alphaOverLife: [[0, 0], [0.06, 1], [0.6, 0.6], [1, 0]], scaleOverLife: [[0, 0.1], [0.4, 0.72], [1, 1]]
    }),
    sprite({
      id: 'ring-lens', asset: A.impactRingLens, z: 3, size: 136, alpha: 0.8, tint: '#ffb21c', blend: 'add', delay: 0.05,
      duration: 0.5, alphaOverLife: [[0, 0], [0.1, 1], [0.55, 0.5], [1, 0]], scaleOverLife: [[0, 0.15], [0.45, 0.8], [1, 1]]
    }),
    sprite({
      id: 'fireball', asset: A.flame04, z: 4, size: 96, alpha: 1, tint: '#c51e0d', blend: 'add',
      duration: 0.5, alphaOverLife: [[0, 0], [0.1, 1], [0.5, 0.8], [1, 0]], scaleOverLife: [[0, 0.3], [0.25, 1], [1, 1.3]], rotationOverLife: [[0, 0], [1, 0.5]]
    }),
    sprite({
      id: 'core', asset: A.fire01, z: 5, size: 64, alpha: 1, tint: T.fire.c2, blend: 'add',
      duration: 0.3, alphaOverLife: FLASH_A, scaleOverLife: [[0, 0.4], [0.15, 1], [1, 1.25]]
    }),
    sprite({
      id: 'hot', asset: A.discB, z: 6, size: 34, alpha: 1, tint: '#fff1c0', blend: 'add',
      duration: 0.14, alphaOverLife: C.pop, scaleOverLife: [[0, 0.6], [0.2, 1], [1, 1.3]]
    }),
    particle({
      id: 'sparks', asset: A.dot, z: 7, blend: 'add', tint: T.fire.c2,
      burst: 18, lifetime: [0.28, 0.42], spawnRadius: 8, speed: [120, 220], direction: -90, spread: 360,
      gravity: { x: 0, y: 360 }, startPx: [6, 11], alphaOverLife: [[0, 1], [0.5, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    }),
    particle({
      id: 'tongues', asset: A.flame05, z: 8, blend: 'add', tint: T.fire.glow,
      burst: 6, lifetime: [0.24, 0.36], spawnRadius: 10, speed: [90, 170], direction: -90, spread: 360,
      gravity: { x: 0, y: 280 }, startPx: [18, 28], alignToVelocity: true, velocityRotationOffset: -+(PI / 2).toFixed(4),
      alphaOverLife: [[0, 0.6], [0.15, 1], [0.6, 0.8], [1, 0]], scaleOverLife: [[0, 0.8], [0.3, 1], [1, 0.5]]
    })
  ]
});

/* ---------- hit-thunder-purple：紫環 R 6→24 + 10 顆電花 + 紫外暈 + 電弧網 ---------- */
P['hit-thunder-purple'] = () => ({
  id: 'hit-thunder-purple', duration: 0.45, layers: [
    sprite({
      id: 'halo', asset: A.glowSoft, z: 0, size: 96, alpha: 0.6, tint: T.purple.glow, blend: 'add',
      duration: 0.32, alphaOverLife: HALO_A, scaleOverLife: HALO_S
    }),
    sprite({
      id: 'ring', asset: A.ringThin, z: 1, size: 60, alpha: 0.95, tint: T.purple.c1, blend: 'add',
      duration: 0.34, alphaOverLife: RING_A, scaleOverLife: [[0, 0.25], [0.4, 0.8], [1, 1]]
    }),
    sprite({
      id: 'arcweb-a', asset: A.arc02, z: 2, size: 66, alpha: 0.9, tint: T.purple.c1, blend: 'add', rotDeg: 15,
      duration: 0.22, alphaOverLife: FLICKER_A, scaleOverLife: [[0, 0.7], [0.3, 1], [1, 1.1]]
    }),
    sprite({
      id: 'arcweb-b', asset: A.arc01, z: 3, size: 58, alpha: 0.8, tint: T.purple.glow, blend: 'add', rotDeg: -70, delay: 0.05,
      duration: 0.2, alphaOverLife: FLICKER_A, scaleOverLife: [[0, 0.8], [1, 1.15]]
    }),
    sprite({
      id: 'flash', asset: A.star09, z: 4, size: 46, alpha: 1, tint: T.purple.c2, blend: 'add', rotDeg: 10,
      duration: 0.16, alphaOverLife: FLASH_A, scaleOverLife: FLASH_S
    }),
    particle({
      id: 'sparks', asset: A.bolt05, z: 5, blend: 'add', tint: T.purple.c2,
      burst: 10, lifetime: [0.14, 0.26], spawnRadius: 6, speed: [160, 280], direction: -90, spread: 360,
      gravity: { x: 0, y: 220 }, startPx: [16, 26], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4),
      alphaOverLife: FLICKER_A, scaleOverLife: [[0, 1], [1, 0.6]]
    }),
    particle({
      id: 'glints', asset: A.star08, z: 6, blend: 'add', tint: T.purple.c2,
      burst: 4, lifetime: [0.2, 0.3], spawnRadius: 14, speed: [40, 90], direction: -90, spread: 360,
      startPx: [8, 14], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.5], [0.5, 1], [1, 0.5]]
    })
  ]
});

/* ---------- hit-enemy：紅色小環 + 4 顆淡紅塵點（輕量） ---------- */
P['hit-enemy'] = () => ({
  id: 'hit-enemy', duration: 0.3, layers: [
    sprite({
      id: 'ring', asset: A.ringA, z: 1, size: 38, alpha: 0.9, tint: T.enemy.c1, blend: 'add',
      duration: 0.26, alphaOverLife: [[0, 0], [0.1, 0.95], [0.6, 0.6], [1, 0]], scaleOverLife: [[0, 0.35], [1, 1]]
    }),
    sprite({
      id: 'flash', asset: A.dot, z: 2, size: 24, alpha: 1, tint: T.enemy.c2, blend: 'add',
      duration: 0.12, alphaOverLife: C.pop, scaleOverLife: [[0, 0.6], [0.2, 1], [1, 1.2]]
    }),
    particle({
      id: 'dust', asset: A.dot, z: 3, blend: 'add', tint: T.enemy.c2,
      burst: 4, lifetime: [0.18, 0.26], spawnRadius: 4, speed: [60, 110], direction: -90, spread: 360,
      gravity: { x: 0, y: 220 }, startPx: [4, 7], alphaOverLife: [[0, 1], [0.4, 1], [1, 0]], scaleOverLife: SPARK_S
    })
  ]
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['hit-phys', 'hit-fire', 'hit-ice', 'hit-lightning', 'hit-poison', 'hit-light', 'hit-dark', 'hit-earth', 'hit-wind', 'hit-bleed', 'hit-fire-explosion', 'hit-thunder-purple', 'hit-enemy'];
const written = [];
const assets = new Set();
for (const id of ORDER) {
  const preset = P[id]();
  if (preset.id !== id) throw new Error('id 不符：' + id);
  // z 唯一性檢查
  const zs = new Set();
  preset.layers.forEach(l => { const z = l.zIndex || 0; if (zs.has(z)) throw new Error(id + ' zIndex 重複：' + z); zs.add(z); });
  preset.layers.forEach(l => assets.add(l.assetId));
  written.push(kit.write(preset));
}
const probes = ORDER.map(id => kit.probe(id));
console.log(JSON.stringify({ written, probes, assetsUsed: [...assets].sort() }, null, 1));
