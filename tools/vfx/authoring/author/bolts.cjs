'use strict';
/* bolts.cjs — 天降雷柱／光柱／光束家族（bolt-*、pillar-*、beam-*）Preset 製作腳本
   天降類：原點＝著地點，柱體從 (0,-H) 落到 (0,0)。素材是「滿版直立」的，因此
     anchor y=1（底端釘在原點）＋ sizeY=H 就是整根柱子；分段收窄用多個 sprite 疊。
   光束類：沿 +X 長 200px，anchor x=0（根部在原點）；Runtime 以 scaleX = 距離/200 拉長。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, deg, sprite, particle } = kit;
const PI = Math.PI;

const BOT = { x: 0.5, y: 1 };     // 底端對齊原點（天降柱）
const TOP = { x: 0.5, y: 0 };     // 頂端對齊 position（由上往下伸展的光柱）
const LEFT = { x: 0, y: 0.5 };    // 根部對齊原點（沿 +X 的光束）

/* 兩次快閃後消失 */
const STRIKE_A = [[0, 0], [0.05, 1], [0.2, 0.35], [0.32, 1], [0.6, 0.5], [1, 0]];
const CORE_A = [[0, 0], [0.04, 1], [0.22, 0.5], [0.3, 1], [0.55, 0.4], [1, 0]];
const GLOW_A = [[0, 0], [0.08, 0.8], [0.6, 0.45], [1, 0]];
const RING_A = [[0, 0], [0.1, 0.9], [1, 0]];
const RING_S = [[0, 0.3], [1, 1]];

const P = {};

/* ---------- bolt-sky-lightning：金黃天雷 ---------- */
P['bolt-sky-lightning'] = () => ({
  id: 'bolt-sky-lightning', duration: 0.4, layers: [
    sprite({ id: 'glow', asset: A.barB, z: 0, sizeX: 46, sizeY: 500, anchor: BOT, alpha: 0.45, tint: '#ffd23f', blend: 'add', duration: 0.4, alphaOverLife: GLOW_A }),
    sprite({ id: 'seg-a', asset: A.bolt06, z: 1, sizeX: 13, sizeY: 167, y: -417, alpha: 1, tint: '#f2b705', blend: 'add', duration: 0.4, alphaOverLife: STRIKE_A }),
    sprite({ id: 'seg-b', asset: A.bolt05, z: 2, sizeX: 8, sizeY: 167, y: -250, alpha: 1, tint: '#f2b705', blend: 'add', duration: 0.4, alphaOverLife: STRIKE_A }),
    sprite({ id: 'seg-c', asset: A.bolt06, z: 3, sizeX: 3, sizeY: 167, y: -83, alpha: 1, tint: '#f2b705', blend: 'add', duration: 0.4, alphaOverLife: STRIKE_A }),
    sprite({ id: 'core', asset: A.barA, z: 4, sizeX: 4, sizeY: 500, anchor: BOT, alpha: 1, tint: '#ffffff', blend: 'add', duration: 0.4, alphaOverLife: CORE_A }),
    sprite({ id: 'ground', asset: A.ringA, z: 5, sizeX: 56, sizeY: 22, alpha: 0.9, tint: '#ffd23f', blend: 'add', delay: 0.04, duration: 0.34, alphaOverLife: RING_A, scaleOverLife: RING_S }),
    sprite({ id: 'flash', asset: A.flash, z: 6, size: 42, alpha: 1, tint: '#fff8b0', blend: 'add', delay: 0.03, duration: 0.16, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.2]] })
  ]
});

/* ---------- bolt-sky-purple：紫雷（更粗 + 著地符紋環） ---------- */
P['bolt-sky-purple'] = () => ({
  id: 'bolt-sky-purple', duration: 0.65, layers: [
    sprite({ id: 'glow', asset: A.barB, z: 0, sizeX: 70, sizeY: 500, anchor: BOT, alpha: 0.5, tint: '#9333ea', blend: 'add', duration: 0.65, alphaOverLife: GLOW_A }),
    sprite({ id: 'seg-a', asset: A.bolt06, z: 1, sizeX: 22, sizeY: 167, y: -417, alpha: 1, tint: '#c084fc', blend: 'add', duration: 0.5, alphaOverLife: STRIKE_A }),
    sprite({ id: 'seg-b', asset: A.bolt05, z: 2, sizeX: 15, sizeY: 167, y: -250, alpha: 1, tint: '#c084fc', blend: 'add', duration: 0.5, alphaOverLife: STRIKE_A }),
    sprite({ id: 'seg-c', asset: A.bolt06, z: 3, sizeX: 9, sizeY: 167, y: -83, alpha: 1, tint: '#c084fc', blend: 'add', duration: 0.5, alphaOverLife: STRIKE_A }),
    sprite({ id: 'core', asset: A.barA, z: 4, sizeX: 7, sizeY: 500, anchor: BOT, alpha: 1, tint: '#fdf4ff', blend: 'add', duration: 0.5, alphaOverLife: CORE_A }),
    /* 符紋環：6 rad/s × 0.65s ＝ 3.9 rad */
    sprite({
      id: 'sigil', asset: A.rings3, z: 5, sizeX: 56, sizeY: 26, alpha: 0.9, tint: '#c084fc', blend: 'add',
      delay: 0.04, duration: 0.61, alphaOverLife: [[0, 0], [0.12, 0.95], [0.7, 0.7], [1, 0]],
      scaleOverLife: RING_S, rotationOverLife: [[0, 0], [1, 3.9]]
    }),
    sprite({ id: 'flash', asset: A.flash, z: 6, size: 52, alpha: 1, tint: '#fdf4ff', blend: 'add', delay: 0.03, duration: 0.2, alphaOverLife: C.pop, scaleOverLife: [[0, 0.5], [1, 1.25]] })
  ]
});

/* ---------- bolt-chain-lightning：沿 +X 的雷鏈段（200px） ---------- */
P['bolt-chain-lightning'] = () => ({
  id: 'bolt-chain-lightning', duration: 0.32, layers: [
    sprite({ id: 'glow', asset: A.trace06H, z: 0, sizeX: 200, sizeY: 22, anchor: LEFT, alpha: 0.45, tint: '#ffd23f', blend: 'add', duration: 0.32, alphaOverLife: GLOW_A }),
    sprite({ id: 'seg-a', asset: A.bolt07H, z: 1, sizeX: 100, sizeY: 7, anchor: LEFT, alpha: 1, tint: '#f2b705', blend: 'add', duration: 0.32, alphaOverLife: STRIKE_A }),
    sprite({ id: 'seg-b', asset: A.bolt06H, z: 2, sizeX: 100, sizeY: 2.5, x: 100, anchor: LEFT, alpha: 1, tint: '#f2b705', blend: 'add', duration: 0.32, alphaOverLife: STRIKE_A }),
    sprite({ id: 'core', asset: A.trace02H, z: 3, sizeX: 200, sizeY: 2, anchor: LEFT, alpha: 1, tint: '#ffffff', blend: 'add', duration: 0.32, alphaOverLife: CORE_A })
  ]
});

/* ---------- bolt-curtain-lightning：雷幕電柱（loop、持續重抖） ---------- */
P['bolt-curtain-lightning'] = () => ({
  id: 'bolt-curtain-lightning', duration: 0.4, loop: true, layers: [
    sprite({ id: 'glow', asset: A.barB, z: 0, sizeX: 44, sizeY: 450, anchor: BOT, alpha: 0.4, tint: '#2563eb', blend: 'add', duration: 0.4, alphaOverLife: [[0, 0.6], [0.5, 0.9], [1, 0.6]] }),
    sprite({ id: 'column', asset: A.bolt06, z: 1, sizeX: 14, sizeY: 450, anchor: BOT, alpha: 0.95, tint: '#7dd3fc', blend: 'add', duration: 0.4, alphaOverLife: C.flicker }),
    sprite({ id: 'core', asset: A.barA, z: 2, sizeX: 4, sizeY: 450, anchor: BOT, alpha: 1, tint: '#ffffff', blend: 'add', duration: 0.4, alphaOverLife: C.flicker }),
    /* 每 0.07s 重抖一次：壽命 0.07s 的短命電弧以 rate 發射，沿柱體隨機出現 */
    particle({
      id: 'jitter', asset: A.bolt05, z: 3, blend: 'add', tint: '#7dd3fc',
      rate: 14, lifetime: [0.06, 0.08], spawnBox: [10, 450], y: -225,
      speed: [0, 0], direction: 0, spread: 0, startPx: [90, 150],
      alphaOverLife: [[0, 1], [0.6, 0.9], [1, 0]], scaleOverLife: [[0, 1], [1, 1]]
    }),
    sprite({ id: 'ground', asset: A.dot, z: 4, size: 26, alpha: 0.95, tint: '#ffffff', blend: 'add', duration: 0.4, alphaOverLife: [[0, 0.8], [0.5, 1], [1, 0.8]] }),
    sprite({ id: 'ground-glow', asset: A.glowSoft, z: 5, sizeX: 60, sizeY: 26, alpha: 0.55, tint: '#2563eb', blend: 'add', duration: 0.4, alphaOverLife: [[0, 0.6], [0.5, 0.9], [1, 0.6]] })
  ]
});

/* ---- 光柱共用：由上往下伸展（anchor 頂端），著地閃光＋塵粒上浮 ---- */
function pillar(o) {
  return [
    sprite({
      id: 'glow', asset: A.barB, z: 0, sizeX: 74, sizeY: 400, anchor: TOP, y: -400,
      alpha: 0.4, tint: o.edge, blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0], [0.2, 0.8], [0.7, 0.6], [1, 0]],
      scaleYOverLife: [[0, 0.05], [0.22, 1], [1, 1]]
    }),
    sprite({
      id: 'body', asset: A.beamD, z: 1, sizeX: 40, sizeY: 400, anchor: TOP, y: -400,
      alpha: 0.95, tint: o.edge, blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0], [0.15, 1], [0.7, 0.9], [1, 0]],
      scaleYOverLife: [[0, 0.05], [0.22, 1], [1, 1]]
    }),
    sprite({
      id: 'core', asset: A.beamB, z: 2, sizeX: 16, sizeY: 400, anchor: TOP, y: -400,
      alpha: 1, tint: o.core, blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0], [0.12, 1], [0.7, 0.95], [1, 0]],
      scaleYOverLife: [[0, 0.05], [0.2, 1], [1, 1]]
    }),
    sprite({
      id: 'land', asset: A.flare30, z: 3, size: 70, alpha: 1, tint: o.core, blend: 'add',
      delay: 0.2, duration: 0.36, alphaOverLife: C.pop, scaleOverLife: [[0, 0.4], [0.35, 1], [1, 1.15]]
    }),
    sprite({
      id: 'ring', asset: A.ringA, z: 4, sizeX: 90, sizeY: 34, alpha: 0.8, tint: o.edge, blend: 'add',
      delay: 0.2, duration: 0.5, alphaOverLife: RING_A, scaleOverLife: RING_S
    }),
    particle(Object.assign({
      id: 'motes', asset: A.dot, z: 5, blend: 'add', tint: o.edge,
      burst: 5, lifetime: [0.4, 0.6], spawnRadius: 22, speed: [30, 60], direction: -90, spread: 70,
      gravity: { x: 0, y: -50 }, startPx: [5, 9],
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]], scaleOverLife: [[0, 0.7], [1, 0.4]]
    }, o.motes || {}))
  ];
}

/* ---------- pillar-light：聖光柱 ---------- */
P['pillar-light'] = () => ({ id: 'pillar-light', duration: 0.9, layers: pillar({ core: '#fffef4', edge: '#ffe47a' }) });

/* ---------- pillar-earth：大地再造光柱（塵土向外散開） ---------- */
P['pillar-earth'] = () => ({
  id: 'pillar-earth', duration: 0.9,
  layers: pillar({
    core: '#c48a55', edge: '#ad7444',
    motes: { asset: A.smokeT, blend: 'normal', burst: 7, direction: 0, spread: 360, speed: [50, 110], gravity: { x: 0, y: 60 }, startPx: [10, 18], alphaOverLife: [[0, 0], [0.2, 0.7], [1, 0]] }
  })
});

/* ---- 光束共用：沿 +X、根部在原點 ---- */
function beam(o) {
  const A_IN_OUT = [[0, 0], [0.25, 1], [0.7, 0.9], [1, 0]];
  return [
    sprite({ id: 'glow', asset: A.trace06H, z: 0, sizeX: 200, sizeY: o.w * 3, anchor: LEFT, alpha: 0.5, tint: o.glow, blend: 'add', duration: 0.45, alphaOverLife: A_IN_OUT }),
    sprite({ id: 'body', asset: A.trace06H, z: 1, sizeX: 200, sizeY: o.w, anchor: LEFT, alpha: 0.95, tint: o.body, blend: 'add', duration: 0.45, alphaOverLife: A_IN_OUT }),
    sprite({ id: 'core', asset: A.trace02H, z: 2, sizeX: 200, sizeY: o.w * 0.5, anchor: LEFT, alpha: 1, tint: o.core, blend: 'add', duration: 0.45, alphaOverLife: A_IN_OUT })
  ];
}

/* ---------- beam-light：聖光光束 ---------- */
P['beam-light'] = () => ({
  id: 'beam-light', duration: 0.45,
  layers: beam({ w: 10, body: '#fffef4', core: '#ffffff', glow: '#ffe47a' })
});

/* ---------- beam-ice：寒冰槍光束（帶白色斜紋） ---------- */
P['beam-ice'] = () => ({
  id: 'beam-ice', duration: 0.45, layers: [
    ...beam({ w: 8, body: '#4da6ff', core: '#f2fbff', glow: '#79d8ff' }),
    /* 斜紋：uvScroll 讓條紋沿光束流動（Core 目前唯一的程序化效果） */
    kit.procedural({
      id: 'streaks', asset: A.lines4, z: 3, effect: 'uvScroll', sizePx: [200, 8],
      anchor: LEFT, alpha: 0.7, tint: '#f2fbff', blend: 'add',
      scrollSpeed: { x: -2.4, y: 0 }, duration: 0.45,
      alphaOverLife: [[0, 0], [0.25, 0.8], [0.7, 0.7], [1, 0]]
    })
  ]
});

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['bolt-sky-lightning', 'bolt-sky-purple', 'bolt-chain-lightning', 'bolt-curtain-lightning',
  'pillar-light', 'pillar-earth', 'beam-light', 'beam-ice'];
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
