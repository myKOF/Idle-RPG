'use strict';
/* bursts.cjs — 範圍爆發家族（burst-*）Preset 製作腳本
   角色：attack（範圍型攻擊本體）。原點＝範圍中心；名目半徑 100px，
   Runtime 以 scale = area.r / 100 播放。
   地面向的環一律壓成扁橢圓（縱向 0.5～0.62）——戰場是俯視斜角，正圓會浮在半空。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, deg, sprite, particle } = kit;
const PI = Math.PI;

const FLASH_A = [[0, 0], [0.08, 1], [0.4, 0.5], [1, 0]];
const RING_A = [[0, 0], [0.1, 0.95], [0.7, 0.5], [1, 0]];
const RING_S = [[0, 0.15], [0.6, 0.9], [1, 1]];
const FILL_A = [[0, 0], [0.12, 0.9], [0.65, 0.55], [1, 0]];
const SHARD_A = [[0, 1], [0.6, 0.9], [1, 0]];
const SHARD_S = [[0, 1], [1, 0.5]];
const FLAT = 0.56;                       // 地面環的縱向壓縮

/* ---- 中心閃光 ---- */
function flash(o) {
  return sprite(Object.assign({
    id: 'flash', asset: A.flash, z: 5, size: 70, alpha: 1, blend: 'add',
    duration: 0.22, alphaOverLife: FLASH_A, scaleOverLife: [[0, 0.4], [0.35, 1], [1, 1.2]]
  }, o));
}

/* ---- 擴散環：名目直徑 200px（＝半徑 100） ---- */
function ring(o) {
  const d = o.d === undefined ? 200 : o.d;
  return sprite(Object.assign({
    asset: A.ringThin, blend: 'add', alpha: 0.9,
    duration: 0.5, alphaOverLife: RING_A, scaleOverLife: RING_S
  }, o, { sizeX: d, sizeY: d * (o.flat === undefined ? FLAT : o.flat), d: undefined, flat: undefined }));
}

/* ---- 向外飛散的碎片 ---- */
function shards(o) {
  return particle(Object.assign({
    id: 'shards', asset: A.dot, z: 6, blend: 'add',
    burst: 14, lifetime: [0.3, 0.5], spawnRadius: 12,
    speed: [180, 300], direction: 0, spread: 360, gravity: { x: 0, y: 260 },
    startPx: [6, 11], alphaOverLife: SHARD_A, scaleOverLife: SHARD_S
  }, o));
}

const P = {};

/* ---------- burst-fire：火焰爆發 ---------- */
P['burst-fire'] = () => ({
  id: 'burst-fire', duration: 0.9, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 220, alpha: 0.55, tint: '#ff6a2a', blend: 'add', duration: 0.6, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.3], [0.5, 1], [1, 1.1]] }),
    sprite({ id: 'ball', asset: A.flame04, z: 1, size: 200, alpha: 0.95, tint: '#e63924', blend: 'add', duration: 0.62, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.3], [0.55, 0.95], [1, 1]], rotationOverLife: C.spin(0.25) }),
    ring({ id: 'wave-a', z: 2, tint: '#ffb21c', d: 200, duration: 0.5 }),
    ring({ id: 'wave-b', z: 3, tint: '#7d1708', d: 210, delay: 0.1, duration: 0.5, alpha: 0.8 }),
    ring({ id: 'wave-c', z: 4, tint: '#ffb21c', d: 220, delay: 0.22, duration: 0.5, alpha: 0.6 }),
    flash({ tint: '#ffd447' }),
    shards({ id: 'tongues', asset: A.flame05, tint: '#ff8a3d', burst: 18, startPx: [16, 30], lifetime: [0.32, 0.56], speed: [150, 290] })
  ]
});

/* ---------- burst-frost-nova：冰霜新星 ---------- */
P['burst-frost-nova'] = () => ({
  id: 'burst-frost-nova', duration: 0.55, layers: [
    sprite({ id: 'fill', asset: A.discB, z: 0, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.24, tint: '#4da6ff', blend: 'add', duration: 0.5, alphaOverLife: FILL_A, scaleOverLife: RING_S }),
    ring({ id: 'rim', z: 1, tint: '#f2fbff', d: 200, asset: A.ringB, duration: 0.5 }),
    ring({ id: 'rim-inner', z: 2, tint: '#79d8ff', d: 144, duration: 0.5, alpha: 0.85 }),
    flash({ tint: '#f2fbff', size: 60, duration: 0.18 }),
    shards({ asset: A.diamond, tint: '#f2fbff', burst: 12, rotationStart: [0, PI], rotationSpeed: [-6, 6], gravity: { x: 0, y: 320 } })
  ]
});

/* ---------- burst-ice-blast：寒冰爆裂 ---------- */
P['burst-ice-blast'] = () => ({
  id: 'burst-ice-blast', duration: 0.6, layers: [
    sprite({ id: 'mist', asset: A.smokeT, z: 0, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.4, tint: '#f2fbff', blend: 'normal', duration: 0.6, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.3], [1, 1.15]] }),
    ring({ id: 'rim', z: 1, tint: '#79d8ff', d: 200, duration: 0.55 }),
    flash({ tint: '#4da6ff', size: 90 }),
    shards({ asset: A.diamond, tint: '#4da6ff', burst: 22, startPx: [8, 16], rotationStart: [0, PI], rotationSpeed: [-8, 8], speed: [200, 340] }),
    shards({ id: 'glints', asset: A.star08, z: 7, tint: '#f2fbff', burst: 8, startPx: [10, 18], speed: [90, 190], gravity: { x: 0, y: 80 } })
  ]
});

/* ---------- burst-frost-freeze：凍結（目標身上長出冰塊後碎裂） ----------
   名目＝目標身高 60px；冰晶用多片 mask-shape 疊，定格 0.4s 後碎裂。 */
P['burst-frost-freeze'] = () => {
  const HOLD = [[0, 0], [0.12, 1], [0.62, 1], [0.75, 0.8], [1, 0]];
  const SHELL = (id, z, sx, sy, x, y, rot, tint, alpha) => sprite({
    id: id, asset: A.triangleDown, z: z, sizeX: sx, sizeY: sy, x: x, y: y, rotDeg: rot,
    alpha: alpha, tint: tint, blend: 'normal', duration: 0.8,
    alphaOverLife: HOLD, scaleOverLife: [[0, 0.2], [0.12, 1], [1, 1]]
  });
  return {
    id: 'burst-frost-freeze', duration: 0.8, layers: [
      sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 76, alpha: 0.5, tint: '#79d8ff', blend: 'add', duration: 0.8, alphaOverLife: HOLD }),
      SHELL('ice-a', 1, 40, 62, 0, 0, 180, '#4da6ff', 0.85),
      SHELL('ice-b', 2, 22, 46, -13, 6, 165, '#4da6ff', 0.8),
      SHELL('ice-c', 3, 20, 42, 13, 4, 195, '#4da6ff', 0.8),
      SHELL('ice-hi', 4, 14, 34, -5, -8, 178, '#f2fbff', 0.9),
      sprite({ id: 'gloss', asset: A.star08, z: 5, size: 26, x: -8, y: -14, alpha: 0.9, tint: '#f2fbff', blend: 'add', duration: 0.8, alphaOverLife: HOLD }),
      particle({
        id: 'crack', asset: A.diamond, z: 6, blend: 'normal', tint: '#f2fbff',
        burst: 10, lifetime: [0.18, 0.28], spawnRadius: 16, speed: [90, 170], direction: 0, spread: 360,
        gravity: { x: 0, y: 420 }, startPx: [5, 10], rotationStart: [0, PI], rotationSpeed: [-8, 8],
        delay: 0.62, alphaOverLife: SHARD_A, scaleOverLife: SHARD_S
      })
    ]
  };
};

/* ---------- burst-wind：狂風碎裂（兩道扁橢圓風環） ---------- */
P['burst-wind'] = () => ({
  id: 'burst-wind', duration: 0.34, layers: [
    ring({ id: 'outer', z: 1, tint: T.wind.c1, d: 200, flat: 0.6, duration: 0.34, alpha: 0.95, scaleOverLife: [[0, 0.45], [1, 1.05]] }),
    ring({ id: 'inner', z: 2, tint: '#ffffff', d: 200, flat: 0.6, duration: 0.34, alpha: 0.9, asset: A.ringThin, scaleOverLife: [[0, 0.2], [1, 0.7]] })
  ]
});

/* ---------- burst-blood：死亡屍爆／崩解 ---------- */
P['burst-blood'] = () => ({
  id: 'burst-blood', duration: 0.5, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 170, alpha: 0.5, tint: T.bleed.c1, blend: 'add', duration: 0.4, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.3], [1, 1]] }),
    ring({ id: 'rim', z: 1, tint: T.bleed.c1, d: 200, duration: 0.45 }),
    flash({ tint: T.bleed.c2, size: 80, duration: 0.18 }),
    shards({ id: 'drops', tint: T.bleed.c1, blend: 'normal', burst: 12, startPx: [6, 12], speed: [140, 260], gravity: { x: 0, y: 520 }, lifetime: [0.28, 0.45] })
  ]
});

/* ---------- burst-zero-infection：零日感染 ---------- */
P['burst-zero-infection'] = () => ({
  id: 'burst-zero-infection', duration: 0.6, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 216, alpha: 0.45, tint: T.poison.glow, blend: 'add', duration: 0.5, alphaOverLife: FILL_A, scaleOverLife: RING_S }),
    ring({ id: 'rim', z: 1, tint: '#d8ff8a', d: 200, duration: 0.5, asset: A.ringSoft }),
    ring({ id: 'rim-core', z: 2, tint: T.poison.c1, d: 200, duration: 0.5, alpha: 1 }),
    flash({ tint: '#d8ff8a', size: 70 }),
    particle({
      id: 'bubbles', asset: A.bubble, z: 6, blend: 'add', tint: T.poison.c1,
      burst: 10, lifetime: [0.35, 0.6], spawnRadius: 30, speed: [30, 80], direction: -90, spread: 200,
      gravity: { x: 0, y: -70 }, startPx: [9, 17],
      alphaOverLife: [[0, 0], [0.15, 1], [0.8, 0.9], [1, 0]], scaleOverLife: [[0, 0.6], [0.7, 1], [1, 1.1]]
    })
  ]
});

/* ---------- burst-rock-petrify：石化 ---------- */
P['burst-rock-petrify'] = () => ({
  id: 'burst-rock-petrify', duration: 0.8, layers: [
    sprite({ id: 'crack', asset: A.splat20, z: 0, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.85, tint: T.earth.c2, blend: 'normal', duration: 0.8, alphaOverLife: [[0, 0], [0.1, 1], [0.7, 0.9], [1, 0]], scaleOverLife: RING_S }),
    ring({ id: 'rim', z: 1, tint: T.earth.c1, d: 200, duration: 0.6 }),
    sprite({ id: 'dust', asset: A.smokeT, z: 2, sizeX: 190, sizeY: 190 * FLAT, alpha: 0.45, tint: '#c9a06a', blend: 'normal', duration: 0.8, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.35], [1, 1.2]] }),
    shards({ asset: A.diamond, tint: T.earth.c1, blend: 'normal', burst: 14, startPx: [8, 16], rotationStart: [0, PI], rotationSpeed: [-5, 5], gravity: { x: 0, y: 420 }, lifetime: [0.35, 0.6] })
  ]
});

/* ---------- burst-gravity：超重力場（內縮漩渦） ---------- */
P['burst-gravity'] = () => ({
  id: 'burst-gravity', duration: 0.8, layers: [
    sprite({ id: 'swirl-a', asset: A.twirl02, z: 0, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.8, tint: T.earth.c2, blend: 'normal', duration: 0.8, alphaOverLife: FILL_A, scaleOverLife: [[0, 1.3], [1, 0.4]], rotationOverLife: C.spin(1.2) }),
    sprite({ id: 'swirl-b', asset: A.twirl03, z: 1, sizeX: 170, sizeY: 170 * FLAT, alpha: 0.75, tint: '#6f2da8', blend: 'add', duration: 0.8, alphaOverLife: FILL_A, scaleOverLife: [[0, 1.3], [1, 0.4]], rotationOverLife: C.spin(-1.5) }),
    sprite({ id: 'core', asset: A.dot, z: 2, size: 46, alpha: 0.9, tint: T.dark.c2, blend: 'normal', duration: 0.8, alphaOverLife: [[0, 0], [0.3, 1], [0.85, 1], [1, 0]], scaleOverLife: [[0, 0.4], [0.7, 1], [1, 0.6]] }),
    ring({ id: 'rim', z: 3, tint: '#913dcc', d: 200, duration: 0.6, alpha: 0.7, scaleOverLife: [[0, 1], [1, 0.35]] }),
    particle({
      id: 'pull', asset: A.dot, z: 4, blend: 'add', tint: '#913dcc',
      burst: 12, lifetime: [0.4, 0.6], spawnRadius: 96, speed: [-170, -110], direction: 0, spread: 360,
      startPx: [5, 9], alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    })
  ]
});

/* ---------- burst-holy：神聖爆發 ---------- */
P['burst-holy'] = () => ({
  id: 'burst-holy', duration: 0.6, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 220, alpha: 0.6, tint: T.light.c1, blend: 'add', duration: 0.5, alphaOverLife: FILL_A, scaleOverLife: RING_S }),
    sprite({ id: 'rays', asset: A.flare28, z: 1, size: 200, alpha: 0.9, tint: T.light.c1, blend: 'add', duration: 0.5, alphaOverLife: FILL_A, scaleOverLife: RING_S, rotationOverLife: C.spin(0.25) }),
    ring({ id: 'rim', z: 2, tint: T.light.c1, d: 200, duration: 0.55 }),
    flash({ tint: T.light.c2, size: 96 }),
    shards({ asset: A.star02, tint: T.light.c2, burst: 10, startPx: [10, 18], speed: [130, 240], gravity: { x: 0, y: 60 } })
  ]
});

/* ---------- burst-earth：大地爆發 ---------- */
P['burst-earth'] = () => ({
  id: 'burst-earth', duration: 0.8, layers: [
    ring({ id: 'rim', z: 0, tint: T.earth.glow, d: 200, duration: 0.6, asset: A.ringSoft }),
    sprite({ id: 'dust', asset: A.smokeT, z: 1, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.5, tint: '#c9a06a', blend: 'normal', duration: 0.8, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.3], [1, 1.2]] }),
    flash({ tint: T.earth.glow, size: 70, duration: 0.2 }),
    shards({ id: 'rocks', asset: A.diamond, tint: T.earth.c1, blend: 'normal', burst: 12, startPx: [10, 20], speed: [120, 210], direction: -90, spread: 200, gravity: { x: 0, y: 520 }, lifetime: [0.4, 0.65], rotationStart: [0, PI], rotationSpeed: [-6, 6] })
  ]
});

/* ---------- burst-detonate-phys：斷罪引爆 ---------- */
P['burst-detonate-phys'] = () => ({
  id: 'burst-detonate-phys', duration: 0.7, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 230, alpha: 0.6, tint: T.phys.glow, blend: 'add', duration: 0.5, alphaOverLife: FILL_A, scaleOverLife: RING_S }),
    ring({ id: 'rim-glow', z: 1, tint: T.phys.glow, d: 216, duration: 0.55, alpha: 0.6, asset: A.ringSoft }),
    ring({ id: 'rim', z: 2, tint: T.phys.c1, d: 200, duration: 0.55, asset: A.ringDouble }),
    flash({ tint: T.phys.c2, size: 110 }),
    shards({ asset: A.diamond, tint: T.phys.c1, burst: 7, startPx: [14, 24], speed: [200, 330], rotationStart: [0, PI], rotationSpeed: [-7, 7] })
  ]
});

/* ---------- burst-detonate-dark：碎印湮滅／虛空裂隙 ---------- */
P['burst-detonate-dark'] = () => ({
  id: 'burst-detonate-dark', duration: 0.7, layers: [
    /* 先內縮再爆開：scaleOverLife 前段收到 0.35，後段衝到 1；rotationOverLife 600° */
    sprite({
      id: 'swirl', asset: A.twirl03, z: 0, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.9, tint: '#6f2da8', blend: 'add',
      duration: 0.7, alphaOverLife: [[0, 0], [0.12, 0.95], [0.75, 0.8], [1, 0]],
      scaleOverLife: [[0, 0.9], [0.35, 0.35], [0.6, 1], [1, 1.05]], rotationOverLife: [[0, 0], [1, deg(600)]]
    }),
    sprite({ id: 'core', asset: A.dot, z: 1, size: 60, alpha: 1, tint: T.dark.c2, blend: 'normal', duration: 0.7, alphaOverLife: [[0, 0], [0.2, 1], [0.7, 0.9], [1, 0]], scaleOverLife: [[0, 0.8], [0.35, 0.3], [0.6, 1], [1, 0.7]] }),
    ring({ id: 'rim', z: 2, tint: '#913dcc', d: 200, delay: 0.24, duration: 0.46 }),
    flash({ tint: '#913dcc', size: 90, delay: 0.24, duration: 0.24 })
  ]
});

/* ---------- burst-venom：劇毒雲霧／疫爆（殘留 2.5s 毒霧） ---------- */
P['burst-venom'] = () => ({
  id: 'burst-venom', duration: 2.6, layers: [
    ring({ id: 'rim', z: 0, tint: T.poison.c2, d: 200, duration: 0.5 }),
    flash({ tint: T.poison.c2, size: 80, duration: 0.22 }),
    sprite({
      id: 'cloud', asset: A.smokeT, z: 1, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.6, tint: T.poison.c1,
      blend: 'normal', duration: 2.6,
      alphaOverLife: [[0, 0], [0.08, 1], [0.6, 0.75], [1, 0]],
      scaleOverLife: [[0, 0.35], [0.35, 1], [1, 1.15]], rotationOverLife: C.spin(0.15)
    }),
    sprite({
      id: 'cloud-b', asset: A.smokeSoft, z: 2, sizeX: 176, sizeY: 176 * FLAT, alpha: 0.45, tint: T.poison.glow,
      blend: 'normal', duration: 2.6, delay: 0.15,
      alphaOverLife: [[0, 0], [0.1, 1], [0.6, 0.7], [1, 0]],
      scaleOverLife: [[0, 0.4], [0.4, 1], [1, 1.1]], rotationOverLife: C.spin(-0.12)
    }),
    particle({
      id: 'bubbles', asset: A.bubble, z: 3, blend: 'add', tint: T.poison.c2,
      burst: 5, lifetime: [1.2, 2], spawnRadius: 55, speed: [10, 35], direction: -90, spread: 120,
      gravity: { x: 0, y: -30 }, startPx: [10, 18],
      alphaOverLife: [[0, 0], [0.2, 0.9], [0.85, 0.7], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.15]]
    })
  ]
});

/* ---------- burst-fire-shockwave：烈焰衝擊／炎爆 ---------- */
P['burst-fire-shockwave'] = () => ({
  id: 'burst-fire-shockwave', duration: 0.9, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 240, alpha: 0.6, tint: '#ff6a2a', blend: 'add', duration: 0.62, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.3], [0.5, 1], [1, 1.1]] }),
    sprite({ id: 'ball', asset: A.fire01, z: 1, size: 210, alpha: 1, tint: '#c51e0d', blend: 'add', duration: 0.62, alphaOverLife: FILL_A, scaleOverLife: [[0, 0.25], [0.55, 1], [1, 1.05]], rotationOverLife: C.spin(0.3) }),
    ring({ id: 'wave-a', z: 2, tint: '#ffb21c', d: 220, duration: 0.55 }),
    ring({ id: 'wave-b', z: 3, tint: '#7d1708', d: 220, delay: 0.12, duration: 0.55, alpha: 0.85 }),
    ring({ id: 'wave-c', z: 4, tint: '#ffb21c', d: 220, delay: 0.26, duration: 0.55, alpha: 0.6 }),
    flash({ tint: '#ffd447', size: 120 }),
    shards({ id: 'tongues', asset: A.flame05, tint: '#ffd447', burst: 18, startPx: [18, 34], speed: [180, 330], lifetime: [0.34, 0.6] }),
    shards({ id: 'smoke', asset: A.smokeT, z: 7, blend: 'normal', tint: '#5b4436', burst: 6, startPx: [30, 54], speed: [70, 140], gravity: { x: 0, y: -40 }, lifetime: [0.5, 0.85], alphaOverLife: [[0, 0], [0.2, 0.55], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.3]] })
  ]
});

/* ---------- burst-cyclone-phys：旋風斬（三道弧刃、9 rad/s） ----------
   catalog 標 loop：目的是「屏障存在期間一直轉」，因此**不做尾段淡出**——
   會循環的 preset 每 1.6s 淡到 0 再亮起來，看起來是閃爍而不是持續旋轉。
   淡出交給 Runtime 停止時處理。 */
P['burst-cyclone-phys'] = () => {
  const SPIN = [[0, 0], [1, +(9 * 1.6).toFixed(4)]];   // 9 rad/s × 1.6s
  const blade = (id, z, rot) => sprite({
    id: id, asset: A.twirl01, z: z, sizeX: 128, sizeY: 128 * FLAT, rotDeg: rot,
    alpha: 0.85, tint: T.phys.c1, blend: 'add', duration: 1.6,
    alphaOverLife: [[0, 0.85], [0.5, 1], [1, 0.85]], rotationOverLife: SPIN
  });
  return {
    id: 'burst-cyclone-phys', duration: 1.6, loop: true, layers: [
      sprite({ id: 'haze', asset: A.glowSoft, z: 0, sizeX: 200, sizeY: 200 * FLAT, alpha: 0.25, tint: T.phys.glow, blend: 'add', duration: 1.6, alphaOverLife: [[0, 0.8], [0.5, 1], [1, 0.8]] }),
      blade('blade-a', 1, 0),
      blade('blade-b', 2, 120),
      blade('blade-c', 3, 240)
    ]
  };
};

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['burst-fire', 'burst-frost-nova', 'burst-ice-blast', 'burst-frost-freeze',
  'burst-wind', 'burst-blood', 'burst-zero-infection', 'burst-rock-petrify', 'burst-gravity',
  'burst-holy', 'burst-earth', 'burst-detonate-phys', 'burst-detonate-dark', 'burst-venom',
  'burst-fire-shockwave', 'burst-cyclone-phys'];
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
