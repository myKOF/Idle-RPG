'use strict';
/* casts.cjs — 施放家族（cast-*）與敵身詛咒家族（curse-*）Preset 製作腳本
   cast-*：原點＝玩家腳底，身高 60px（身體在 y ∈ [-60, 0]）。收縮的光環＋上升的光點。
   curse-*：原點＝目標身體中心，符號緩慢上升並淡出。
   ⚠️ Core 的圖層不能位移，「上升＋擺動的符號」一律用 burst:1 的粒子表現。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, deg, sprite, particle } = kit;
const PI = Math.PI;

const CAST_DUR = 0.9;
const RING_A = [[0, 0], [0.1, 0.9], [0.75, 0.6], [1, 0]];
const RING_S = [[0, 1.45], [0.78, 0.7], [1, 0.7]];      // 1.45 → 0.7 倍（0.7s）
const MOTE_A = [[0, 0], [0.2, 1], [1, 0]];
const CURSE_A = [[0, 0], [0.12, 1], [0.75, 0.8], [1, 0]];

/* ---- 施放共用：收縮光環 + 上升光點 + 白閃 ---- */
function cast(o) {
  return [
    sprite({
      id: 'ring', asset: A.ringThin, z: 0, sizeX: 66, sizeY: 30, y: -4,
      alpha: 0.85, tint: o.tint, blend: 'add', duration: CAST_DUR,
      alphaOverLife: RING_A, scaleOverLife: RING_S
    }),
    sprite({
      id: 'ring-inner', asset: A.ringA, z: 1, sizeX: 52, sizeY: 24, y: -4,
      alpha: 0.6, tint: o.tint, blend: 'add', duration: CAST_DUR, delay: 0.08,
      alphaOverLife: RING_A, scaleOverLife: RING_S
    }),
    sprite({
      id: 'glow', asset: A.glowSoft, z: 2, sizeX: 56, sizeY: 72, y: -30,
      alpha: 0.35, tint: o.tint, blend: 'add', duration: CAST_DUR,
      alphaOverLife: [[0, 0], [0.15, 0.5], [0.7, 0.35], [1, 0]]
    }),
    sprite({
      id: 'flash', asset: A.flash, z: 3, size: 44, y: -30, alpha: 1, tint: '#ffffff', blend: 'add',
      duration: 0.2, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.2]]
    }),
    particle(Object.assign({
      id: 'motes', asset: A.dot, z: 4, blend: 'add', tint: o.mote || o.tint,
      burst: 4, lifetime: [0.45, 0.7], spawnBox: [40, 12], speed: [35, 70], direction: -90, spread: 45,
      gravity: { x: 0, y: -40 }, startPx: [5, 9],
      alphaOverLife: MOTE_A, scaleOverLife: [[0, 0.8], [1, 0.4]]
    }, o.motes || {}))
  ];
}

const P = {};

P['cast-buff-def'] = () => ({ id: 'cast-buff-def', duration: CAST_DUR, layers: cast({ tint: '#4ade80', mote: '#bbf7d0' }) });
P['cast-buff-phys'] = () => ({ id: 'cast-buff-phys', duration: CAST_DUR, layers: cast({ tint: T.phys.c1, mote: T.phys.c2 }) });
P['cast-buff-special'] = () => ({
  id: 'cast-buff-special', duration: CAST_DUR,
  layers: cast({ tint: '#8ea2ff', mote: '#e6ecff', motes: { asset: A.star08, startPx: [8, 14] } })
});
P['cast-buff-light'] = () => ({
  id: 'cast-buff-light', duration: CAST_DUR,
  layers: cast({ tint: '#ffe47a', mote: '#fffef4', motes: { asset: A.star02, startPx: [7, 13] } })
});
P['cast-buff-dark'] = () => ({
  id: 'cast-buff-dark', duration: CAST_DUR,
  layers: cast({
    tint: '#6f2da8', mote: '#913dcc',
    motes: { asset: A.smokeDark, blend: 'normal', startPx: [14, 24], speed: [20, 45], alphaOverLife: [[0, 0], [0.25, 0.6], [1, 0]] }
  })
});
P['cast-buff-poison'] = () => ({
  id: 'cast-buff-poison', duration: CAST_DUR,
  layers: cast({
    tint: '#4caf2b', mote: '#d8ff8a',
    motes: { asset: A.bubble, blend: 'normal', startPx: [7, 13], speed: [20, 45], gravity: { x: 0, y: -25 } }
  })
});

/* ---------- cast-magic：手部魔法圈閃光 ---------- */
P['cast-magic'] = () => ({
  id: 'cast-magic', duration: 0.35, layers: [
    sprite({
      id: 'circle', asset: A.runeMaze, z: 0, sizeX: 48, sizeY: 48, alpha: 0.9, tint: '#8ea2ff', blend: 'add',
      duration: 0.3, alphaOverLife: [[0, 0], [0.15, 1], [1, 0]],
      scaleOverLife: [[0, 0.4], [1, 1.25]], rotationOverLife: C.spin(0.75)
    }),
    sprite({
      id: 'glow', asset: A.glowSoft, z: 1, size: 40, alpha: 0.6, tint: '#a9b8ff', blend: 'add',
      duration: 0.3, alphaOverLife: [[0, 0], [0.15, 0.7], [1, 0]], scaleOverLife: [[0, 0.5], [1, 1.2]]
    }),
    particle({
      id: 'glints', asset: A.star04, z: 2, blend: 'add', tint: '#e6ecff',
      burst: 4, lifetime: [0.16, 0.28], spawnRadius: 14, speed: [40, 90], direction: 0, spread: 360,
      startPx: [7, 12], alphaOverLife: MOTE_A, scaleOverLife: [[0, 1], [1, 0.5]]
    })
  ]
});

/* ---------- cast-drain：汲取回流（粒子被吸向中心） ---------- */
P['cast-drain'] = () => ({
  id: 'cast-drain', duration: 0.6, layers: [
    sprite({
      id: 'glow', asset: A.glowSoft, z: 0, sizeX: 56, sizeY: 70, y: -30, alpha: 0.6, tint: '#4ade80', blend: 'add',
      duration: 0.5, alphaOverLife: [[0, 0], [0.35, 0.8], [1, 0]], scaleOverLife: [[0, 0.6], [0.6, 1], [1, 0.9]]
    }),
    /* 負速度＝朝生成點內縮（Core 的 speed 允許負值＝反向） */
    particle({
      id: 'inflow', asset: A.dot, z: 1, blend: 'add', tint: '#6f2da8',
      burst: 14, lifetime: [0.35, 0.55], spawnRadius: 54, speed: [-150, -100], direction: 0, spread: 360,
      startPx: [5, 9], y: -30,
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    }),
    particle({
      id: 'inflow-green', asset: A.dot, z: 2, blend: 'add', tint: '#4ade80',
      burst: 10, lifetime: [0.3, 0.5], spawnRadius: 40, speed: [-130, -90], direction: 0, spread: 360,
      startPx: [4, 8], y: -30, delay: 0.08,
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    }),
    sprite({
      id: 'flash', asset: A.flash, z: 3, size: 40, y: -30, alpha: 1, tint: '#bbf7d0', blend: 'add',
      delay: 0.3, duration: 0.24, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.2]]
    })
  ]
});

/* ---- 詛咒共用：符號緩慢上升（burst:1 粒子）＋光暈 ---- */
function curse(o) {
  return [
    sprite({
      id: 'glow', asset: A.glowSoft, z: 0, size: 52, alpha: 0.4, tint: o.tint, blend: 'add',
      duration: 1, alphaOverLife: CURSE_A
    }),
    sprite({
      id: 'ring', asset: o.ring || A.runeSpiky, z: 1, sizeX: 48, sizeY: 48, alpha: 0.85, tint: o.tint,
      blend: 'add', duration: 1, alphaOverLife: CURSE_A, rotationOverLife: C.spin(o.spin === undefined ? 0.5 : o.spin)
    }),
    particle({
      id: 'sigil', asset: o.sigil, z: 2, blend: o.sigilBlend || 'add', tint: o.sigilTint || o.tint,
      burst: 1, lifetime: [0.9, 0.9], spawnRadius: 2, speed: [16, 16], direction: -90, spread: 0,
      startPx: [o.sigilPx || 22, o.sigilPx || 22],
      alphaOverLife: CURSE_A, scaleOverLife: [[0, 0.7], [0.3, 1], [1, 0.9]]
    })
  ].concat(o.extra || []);
}

P['curse-dark'] = () => ({
  id: 'curse-dark', duration: 1,
  layers: curse({ tint: '#c084fc', sigil: A.magicOcta, sigilTint: '#1a0c2e', sigilBlend: 'normal', sigilPx: 20, spin: 0.6 })
});

P['curse-bleed'] = () => ({
  id: 'curse-bleed', duration: 1,
  layers: curse({
    tint: T.bleed.c1, ring: A.ringSegments4, sigil: A.lines1, sigilPx: 18, spin: 0.3,
    extra: [particle({
      id: 'drops', asset: A.dot, z: 3, blend: 'normal', tint: T.bleed.c1,
      burst: 4, lifetime: [0.4, 0.6], spawnRadius: 14, speed: [20, 50], direction: 90, spread: 80,
      gravity: { x: 0, y: 380 }, startPx: [4, 7],
      alphaOverLife: [[0, 1], [0.6, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 0.7]]
    })]
  })
});

P['curse-poison'] = () => ({
  id: 'curse-poison', duration: 1,
  layers: curse({
    tint: T.poison.c1, ring: A.biohazard, sigil: A.bubble, sigilPx: 18, spin: 0.4,
    extra: [particle({
      id: 'bubbles', asset: A.bubble, z: 3, blend: 'normal', tint: T.poison.c1,
      burst: 4, lifetime: [0.5, 0.85], spawnRadius: 14, speed: [15, 40], direction: -90, spread: 90,
      gravity: { x: 0, y: -40 }, startPx: [6, 11],
      alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.1]]
    })]
  })
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['cast-buff-def', 'cast-buff-phys', 'cast-buff-special', 'cast-buff-light',
  'cast-buff-dark', 'cast-buff-poison', 'cast-magic', 'cast-drain',
  'curse-dark', 'curse-bleed', 'curse-poison'];
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
