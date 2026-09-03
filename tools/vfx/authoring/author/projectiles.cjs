'use strict';
/* projectiles.cjs — 飛行子彈家族（proj-*）Preset 製作腳本
   角色：projectile。原點＝物體中心；**朝 +X 飛**，因此拖尾一律往 -X（direction 180）。
   Runtime 逐幀 setTransform 帶著它移動並依飛行方位旋轉，Preset 本身不做位移。
   名目尺寸見 vfx-catalog.cjs（D＝直徑、L＝長、W＝寬、R＝半徑）。 */
const kit = require('../preset-kit.cjs');
const { A, T, C, deg, sprite, particle } = kit;
const PI = Math.PI;

const BODY_A = [[0, 0], [0.06, 1], [0.9, 1], [1, 0]];      // 出現 → 全程亮著 → 收尾淡出
const GLOW_A = [[0, 0], [0.08, 0.9], [0.9, 0.85], [1, 0]];
const TRAIL_A = [[0, 0.9], [0.5, 0.7], [1, 0]];
const TRAIL_S = [[0, 1], [1, 0.35]];
const PULSE = [[0, 1], [0.25, 1.12], [0.5, 0.95], [0.75, 1.1], [1, 1]];

/* ---- 光暈＋核心：大多數投射物的骨架 ---- */
function orb(o) {
  const layers = [];
  layers.push(sprite({
    id: 'glow', asset: o.glowAsset || A.glowSoft, z: 0, size: o.size * (o.glowRatio || 2.2),
    alpha: o.glowAlpha === undefined ? 0.55 : o.glowAlpha, tint: o.glowTint, blend: 'add',
    duration: o.dur, alphaOverLife: GLOW_A, scaleOverLife: PULSE
  }));
  layers.push(sprite({
    id: 'body', asset: o.bodyAsset || A.dot, z: 1, size: o.size,
    alpha: 1, tint: o.tint, blend: o.bodyBlend || 'add',
    duration: o.dur, alphaOverLife: BODY_A
  }));
  if (o.coreTint) {
    layers.push(sprite({
      id: 'core', asset: o.coreAsset || A.dot, z: 2, size: o.size * (o.coreRatio || 0.5),
      alpha: 1, tint: o.coreTint, blend: 'add', duration: o.dur, alphaOverLife: BODY_A
    }));
  }
  return layers;
}

/* ---- 拖尾：往 -X 灑出去（direction 180） ---- */
function trail(o) {
  return particle(Object.assign({
    id: 'trail', asset: A.dot, z: 4, blend: 'add',
    rate: 26, lifetime: [0.16, 0.3], spawnRadius: 3,
    speed: [10, 40], direction: 180, spread: 40,
    startPx: [4, 8], alphaOverLife: TRAIL_A, scaleOverLife: TRAIL_S
  }, o));
}

const P = {};

/* ---------- proj-swordwave：普攻劍氣 ---------- */
P['proj-swordwave'] = () => ({
  id: 'proj-swordwave', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 44, alpha: 0.35, tint: T.phys.glow, blend: 'add', duration: 1.2, alphaOverLife: GLOW_A }),
    sprite({ id: 'body', asset: A.slash03, z: 1, sizeX: 14, sizeY: 30, alpha: 1, tint: T.phys.c1, blend: 'add', duration: 1.2, alphaOverLife: BODY_A }),
    sprite({ id: 'core', asset: A.slash03, z: 2, sizeX: 8, sizeY: 22, alpha: 1, tint: T.phys.c2, blend: 'add', duration: 1.2, alphaOverLife: BODY_A }),
    trail({ asset: A.trace02H, tint: '#f0e2b8', rate: 22, startPx: [10, 18], speed: [5, 25], alignToVelocity: true, velocityRotationOffset: 0 })
  ]
});

/* ---------- proj-knife：飛刀（繞自身快轉） ---------- */
P['proj-knife'] = () => ({
  id: 'proj-knife', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 34, alpha: 0.25, tint: '#ff3850', blend: 'add', duration: 1.2, alphaOverLife: GLOW_A }),
    sprite({
      id: 'blade', asset: A.dart, z: 1, sizeX: 28, sizeY: 10, alpha: 1, tint: '#e8eef5', blend: 'normal',
      duration: 1.2, alphaOverLife: BODY_A, rotationOverLife: C.spin(6)
    }),
    trail({ tint: '#ffffff', rate: 18, startPx: [3, 6], lifetime: [0.1, 0.2] })
  ]
});

/* ---------- proj-knife-gold：追魂刃 ---------- */
P['proj-knife-gold'] = () => ({
  id: 'proj-knife-gold', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 40, alpha: 0.9, tint: '#ffd23f', blend: 'add', duration: 1.2, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({
      id: 'blade', asset: A.dart, z: 1, sizeX: 28, sizeY: 10, alpha: 1, tint: '#f2b705', blend: 'add',
      duration: 1.2, alphaOverLife: BODY_A, rotationOverLife: C.spin(6)
    }),
    trail({ asset: A.star04, tint: '#fff8b0', rate: 24, startPx: [5, 10], lifetime: [0.18, 0.32] })
  ]
});

/* ---------- proj-fireball：火球（大） ---------- */
P['proj-fireball'] = () => ({
  id: 'proj-fireball', duration: 1.5, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 72, alpha: 0.6, tint: '#ff6a2a', blend: 'add', duration: 1.5, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({
      id: 'tail', asset: A.muzzle02R, z: 1, sizeX: 60, sizeY: 34, x: -22, alpha: 0.85, tint: '#e63924',
      blend: 'add', duration: 1.5, alphaOverLife: GLOW_A,
      scaleXOverLife: [[0, 1], [0.25, 1.18], [0.5, 0.92], [0.75, 1.14], [1, 1]]
    }),
    sprite({ id: 'body', asset: A.flame04, z: 2, size: 40, alpha: 1, tint: '#e63924', blend: 'add', duration: 1.5, alphaOverLife: BODY_A, rotationOverLife: C.spin(0.6) }),
    sprite({ id: 'core', asset: A.dot, z: 3, size: 20, alpha: 1, tint: '#ffd447', blend: 'add', duration: 1.5, alphaOverLife: BODY_A, scaleOverLife: PULSE }),
    trail({ asset: A.flame05, tint: '#ff8a3d', rate: 20, startPx: [10, 18], lifetime: [0.2, 0.4], speed: [20, 60] })
  ]
});

/* ---------- proj-fire：火屬性通用投射物 ---------- */
P['proj-fire'] = () => ({
  id: 'proj-fire', duration: 1.2, layers: [
    ...orb({ size: 14, dur: 1.2, tint: T.fire.c1, coreTint: T.fire.c2, glowTint: T.fire.glow, glowRatio: 2.6 }),
    trail({ tint: T.fire.c2, rate: 24, startPx: [3, 6], gravity: { x: 0, y: -60 } })
  ]
});

/* ---------- proj-ice-shard：冰箭 ---------- */
P['proj-ice-shard'] = () => ({
  id: 'proj-ice-shard', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 40, alpha: 0.5, tint: T.ice.glow, blend: 'add', duration: 1.2, alphaOverLife: GLOW_A }),
    sprite({ id: 'body', asset: A.diamond, z: 1, sizeX: 22, sizeY: 18, alpha: 1, tint: T.ice.c1, blend: 'normal', duration: 1.2, alphaOverLife: BODY_A }),
    sprite({ id: 'edge', asset: A.diamond, z: 2, sizeX: 14, sizeY: 11, alpha: 1, tint: T.ice.c2, blend: 'add', duration: 1.2, alphaOverLife: BODY_A }),
    trail({ tint: '#ffffff', rate: 20, startPx: [3, 6], lifetime: [0.14, 0.26] })
  ]
});

/* ---------- proj-lightning：雷屬性投射物 ---------- */
P['proj-lightning'] = () => ({
  id: 'proj-lightning', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 40, alpha: 0.55, tint: '#ffd23f', blend: 'add', duration: 1.2, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({ id: 'bolt', asset: A.bolt05H, z: 1, sizeX: 26, sizeY: 10, alpha: 1, tint: '#f2b705', blend: 'add', duration: 1.2, alphaOverLife: C.flicker }),
    sprite({ id: 'bolt-b', asset: A.bolt06H, z: 2, sizeX: 20, sizeY: 8, alpha: 0.9, tint: '#fff8b0', blend: 'add', duration: 1.2, alphaOverLife: [[0, 1], [0.15, 0.6], [0.3, 1.1], [0.5, 0.7], [0.7, 1], [1, 0.8]] }),
    trail({ asset: A.bolt05, tint: '#ffd23f', rate: 22, startPx: [6, 11], lifetime: [0.1, 0.2], alignToVelocity: true, velocityRotationOffset: +(PI / 2).toFixed(4) })
  ]
});

/* ---------- proj-poison-drop：毒屬性投射物 ---------- */
P['proj-poison-drop'] = () => ({
  id: 'proj-poison-drop', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 36, alpha: 0.45, tint: T.poison.glow, blend: 'add', duration: 1.2, alphaOverLife: GLOW_A }),
    sprite({ id: 'body', asset: A.lines1, z: 1, sizeX: 15, sizeY: 17, alpha: 1, tint: T.poison.c1, blend: 'normal', duration: 1.2, alphaOverLife: BODY_A }),
    sprite({ id: 'gloss', asset: A.dot, z: 2, size: 7, x: -2, y: -3, alpha: 0.9, tint: T.poison.c2, blend: 'add', duration: 1.2, alphaOverLife: BODY_A }),
    trail({ asset: A.bubble, tint: T.poison.c1, rate: 12, startPx: [5, 9], lifetime: [0.24, 0.4], speed: [10, 30], spread: 90, gravity: { x: 0, y: -40 } })
  ]
});

/* ---------- proj-light-orb：聖光／奧術 ---------- */
P['proj-light-orb'] = () => ({
  id: 'proj-light-orb', duration: 1.2, layers: [
    ...orb({ size: 16, dur: 1.2, tint: T.light.c2, coreTint: '#ffffff', glowTint: T.light.c1, glowRatio: 2.8, glowAlpha: 0.7 }),
    sprite({ id: 'star', asset: A.star08, z: 3, size: 34, alpha: 0.85, tint: T.light.c1, blend: 'add', duration: 1.2, alphaOverLife: GLOW_A, rotationOverLife: C.spin(1.5) }),
    trail({ tint: T.light.c1, rate: 22, startPx: [3, 6] })
  ]
});

/* ---------- proj-dark-orb：暗影 ---------- */
P['proj-dark-orb'] = () => ({
  id: 'proj-dark-orb', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 46, alpha: 0.6, tint: '#913dcc', blend: 'add', duration: 1.2, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({ id: 'swirl', asset: A.twirl03, z: 1, size: 26, alpha: 0.9, tint: T.dark.c1, blend: 'add', duration: 1.2, alphaOverLife: BODY_A, rotationOverLife: C.spin(-2.5) }),
    sprite({ id: 'core', asset: A.dot, z: 2, size: 18, alpha: 1, tint: T.dark.c2, blend: 'normal', duration: 1.2, alphaOverLife: BODY_A }),
    trail({ asset: A.smokeT, tint: '#6f2da8', blend: 'normal', rate: 14, startPx: [10, 18], lifetime: [0.24, 0.4], alphaOverLife: [[0, 0.55], [1, 0]] })
  ]
});

/* ---------- proj-earth-rock：土屬性投射物 ---------- */
P['proj-earth-rock'] = () => ({
  id: 'proj-earth-rock', duration: 1.2, layers: [
    sprite({ id: 'shadow', asset: A.diamond, z: 0, size: 19, rotDeg: 12, alpha: 0.9, tint: T.earth.c2, blend: 'normal', duration: 1.2, alphaOverLife: BODY_A, rotationOverLife: C.spin(0.8) }),
    sprite({ id: 'rock', asset: A.diamond, z: 1, size: 16, rotDeg: 12, alpha: 1, tint: T.earth.c1, blend: 'normal', duration: 1.2, alphaOverLife: BODY_A, rotationOverLife: C.spin(0.8) }),
    trail({ asset: A.smokeT, tint: '#c9a06a', blend: 'normal', rate: 12, startPx: [8, 14], lifetime: [0.2, 0.36], alphaOverLife: [[0, 0.5], [1, 0]] })
  ]
});

/* ---------- proj-wind-crescent：風刃（寬 40、深 16，尖端朝 +X） ---------- */
P['proj-wind-crescent'] = () => ({
  id: 'proj-wind-crescent', duration: 1.5, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, sizeX: 30, sizeY: 56, alpha: 0.35, tint: T.wind.glow, blend: 'add', duration: 1.5, alphaOverLife: GLOW_A }),
    sprite({ id: 'body', asset: A.slash03, z: 1, sizeX: 16, sizeY: 40, alpha: 1, tint: T.wind.c1, blend: 'add', duration: 1.5, alphaOverLife: BODY_A }),
    sprite({ id: 'core', asset: A.slash03, z: 2, sizeX: 10, sizeY: 30, alpha: 1, tint: '#ffffff', blend: 'add', duration: 1.5, alphaOverLife: BODY_A }),
    trail({ tint: '#ffffff', rate: 16, startPx: [3, 5], lifetime: [0.1, 0.2], spread: 20 })
  ]
});

/* ---------- proj-arcane-missile：奧術飛彈 ---------- */
P['proj-arcane-missile'] = () => ({
  id: 'proj-arcane-missile', duration: 1.2, layers: [
    ...orb({ size: 12, dur: 1.2, tint: T.magic.c1, coreTint: T.magic.c2, glowTint: T.magic.glow, glowRatio: 3 }),
    trail({ asset: A.trace02H, tint: '#ffffff', rate: 20, startPx: [8, 14], lifetime: [0.12, 0.22], speed: [5, 20], alignToVelocity: true, velocityRotationOffset: 0 })
  ]
});

/* ---------- proj-waterball：水流彈 ---------- */
P['proj-waterball'] = () => ({
  id: 'proj-waterball', duration: 1.2, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 42, alpha: 0.45, tint: T.water.glow, blend: 'add', duration: 1.2, alphaOverLife: GLOW_A }),
    sprite({ id: 'body', asset: A.dot, z: 1, size: 18, alpha: 1, tint: T.water.c1, blend: 'normal', duration: 1.2, alphaOverLife: BODY_A, scaleOverLife: PULSE }),
    sprite({ id: 'gloss', asset: A.dot, z: 2, size: 7, x: -3, y: -4, alpha: 0.95, tint: T.water.c2, blend: 'add', duration: 1.2, alphaOverLife: BODY_A }),
    trail({ tint: T.water.c2, rate: 18, startPx: [3, 6], lifetime: [0.18, 0.3], gravity: { x: 0, y: 200 }, spread: 70 })
  ]
});

/* ---------- proj-firehunt-ring：火神星環（翻滾 2.6 轉／秒） ---------- */
P['proj-firehunt-ring'] = () => ({
  id: 'proj-firehunt-ring', duration: 1.5, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 40, alpha: 0.6, tint: '#ff6a2a', blend: 'add', duration: 1.5, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({
      id: 'ring', asset: A.ringThin, z: 1, size: 22, alpha: 1, tint: '#ffd447', blend: 'add',
      duration: 1.5, alphaOverLife: BODY_A, rotationYOverLife: [[0, 0], [1, +(PI * 2 * 2.6 * 1.5).toFixed(4)]]
    }),
    sprite({
      id: 'gloss', asset: A.slash01, z: 2, size: 18, rotDeg: -30, alpha: 0.9, tint: '#ffffff', blend: 'add',
      duration: 1.5, alphaOverLife: BODY_A, rotationYOverLife: [[0, 0], [1, +(PI * 2 * 2.6 * 1.5).toFixed(4)]]
    }),
    trail({ asset: A.flame05, tint: '#ff8a3d', rate: 14, startPx: [6, 11], lifetime: [0.14, 0.26] })
  ]
});

/* ---------- proj-enemy-bolt：敵方魔法彈 ---------- */
P['proj-enemy-bolt'] = () => ({
  id: 'proj-enemy-bolt', duration: 1.2, layers: [
    ...orb({ size: 13, dur: 1.2, tint: T.enemy.c1, coreTint: T.enemy.c2, glowTint: T.enemy.glow, glowRatio: 2.6, glowAlpha: 0.5 }),
    trail({ tint: T.enemy.c2, rate: 16, startPx: [3, 5] })
  ]
});

/* ---- 隕石共用：火焰團 + 持續噴出的拖尾火焰 ---- */
function meteor(o) {
  return [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: o.d * 1.7, alpha: 0.6, tint: '#f89800', blend: 'add', duration: o.dur, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({ id: 'shell', asset: A.flame04, z: 1, size: o.d, alpha: 0.95, tint: '#f83600', blend: 'add', duration: o.dur, alphaOverLife: BODY_A, rotationOverLife: C.spin(0.4) }),
    sprite({ id: 'body', asset: A.fire01, z: 2, size: o.d * 0.78, alpha: 1, tint: '#f89800', blend: 'add', duration: o.dur, alphaOverLife: BODY_A, rotationOverLife: C.spin(-0.6) }),
    sprite({ id: 'core', asset: A.dot, z: 3, size: o.d * 0.34, alpha: 1, tint: '#facc22', blend: 'add', duration: o.dur, alphaOverLife: BODY_A, scaleOverLife: PULSE }),
    sprite({ id: 'rim', asset: A.ringSoft, z: 4, size: o.d * 1.05, alpha: 0.5, tint: '#9f0404', blend: 'normal', duration: o.dur, alphaOverLife: GLOW_A }),
    particle({
      id: 'tail', asset: A.flame05, z: 5, blend: 'add', tint: '#f89800',
      rate: o.rate, lifetime: [o.tailSec * 0.7, o.tailSec], spawnRadius: o.d * 0.25,
      speed: [o.tailPx / o.tailSec * 0.7, o.tailPx / o.tailSec], direction: 180, spread: 26,
      startPx: [o.d * 0.3, o.d * 0.55],
      alphaOverLife: [[0, 0.9], [0.4, 0.7], [1, 0]], scaleOverLife: [[0, 1], [1, 0.35]]
    })
  ];
}

/* ---------- proj-meteor：隕石（直徑 110、拖尾 240、13 顆／秒） ---------- */
P['proj-meteor'] = () => ({
  id: 'proj-meteor', duration: 2.5, layers: meteor({ d: 110, dur: 2.5, rate: 13, tailPx: 240, tailSec: 2.4 })
});

/* ---------- proj-meteor-small：小隕石 ---------- */
P['proj-meteor-small'] = () => ({
  id: 'proj-meteor-small', duration: 2, layers: meteor({ d: 35, dur: 2, rate: 7, tailPx: 125, tailSec: 1.6 })
});

/* ---------- proj-starfall：地爆天星（直徑 350、底部弓形震波） ---------- */
P['proj-starfall'] = () => ({
  id: 'proj-starfall', duration: 3, layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 560, alpha: 0.5, tint: '#e0451a', blend: 'add', duration: 3, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
    sprite({ id: 'shell', asset: A.flame04, z: 1, size: 350, alpha: 0.95, tint: '#a11208', blend: 'add', duration: 3, alphaOverLife: BODY_A, rotationOverLife: C.spin(0.3) }),
    sprite({ id: 'body', asset: A.fire01, z: 2, size: 275, alpha: 1, tint: '#5c0a06', blend: 'normal', duration: 3, alphaOverLife: BODY_A, rotationOverLife: C.spin(-0.4) }),
    sprite({ id: 'core', asset: A.flame04, z: 3, size: 150, alpha: 1, tint: '#e0451a', blend: 'add', duration: 3, alphaOverLife: BODY_A, scaleOverLife: PULSE }),
    sprite({ id: 'rim', asset: A.ringSoft, z: 4, size: 356, alpha: 0.6, tint: '#260302', blend: 'normal', duration: 3, alphaOverLife: GLOW_A }),
    /* 底部弓形震波：壓扁的橢圓環，半徑約 138px，隨飛行脈動 */
    sprite({
      id: 'bow', asset: A.ringThin, z: 5, sizeX: 276, sizeY: 120, y: 96, alpha: 0.75, tint: '#ffb257', blend: 'add',
      duration: 3, alphaOverLife: [[0, 0], [0.1, 0.85], [0.9, 0.7], [1, 0]],
      scaleOverLife: [[0, 0.9], [0.25, 1.08], [0.5, 0.94], [0.75, 1.06], [1, 0.95]]
    }),
    particle({
      id: 'tail', asset: A.flame05, z: 6, blend: 'add', tint: '#e0451a',
      rate: 18, lifetime: [1.6, 2.4], spawnRadius: 90, speed: [180, 300], direction: 180, spread: 26,
      startPx: [110, 190], alphaOverLife: [[0, 0.9], [0.4, 0.6], [1, 0]], scaleOverLife: [[0, 1], [1, 0.4]]
    })
  ]
});

/* ---------- proj-thunder-orb-fall：雷殞天落的落體 ---------- */
P['proj-thunder-orb-fall'] = () => {
  const SPIN = [[0, 0], [1, +(7 * 1.5).toFixed(4)]];   // 7 rad/s × 1.5s
  return {
    id: 'proj-thunder-orb-fall', duration: 1.5, layers: [
      sprite({ id: 'outer', asset: A.glowSoft, z: 0, size: 58, alpha: 0.34, tint: '#1d4ed8', blend: 'add', duration: 1.5, alphaOverLife: GLOW_A, scaleOverLife: PULSE }),
      sprite({ id: 'mid', asset: A.dot, z: 1, size: 40, alpha: 0.85, tint: '#60a5fa', blend: 'add', duration: 1.5, alphaOverLife: BODY_A }),
      sprite({ id: 'core', asset: A.dot, z: 2, size: 20, alpha: 1, tint: '#ffffff', blend: 'add', duration: 1.5, alphaOverLife: BODY_A, scaleOverLife: PULSE }),
      sprite({ id: 'chord-a', asset: A.bolt07H, z: 3, sizeX: 58, sizeY: 10, alpha: 0.9, tint: '#ffffff', blend: 'add', duration: 1.5, alphaOverLife: BODY_A, rotationOverLife: SPIN }),
      sprite({ id: 'chord-b', asset: A.bolt07H, z: 4, sizeX: 58, sizeY: 10, rotDeg: 60, alpha: 0.9, tint: '#ffffff', blend: 'add', duration: 1.5, alphaOverLife: BODY_A, rotationOverLife: SPIN }),
      sprite({ id: 'chord-c', asset: A.bolt07H, z: 5, sizeX: 58, sizeY: 10, rotDeg: 120, alpha: 0.9, tint: '#ffffff', blend: 'add', duration: 1.5, alphaOverLife: BODY_A, rotationOverLife: SPIN })
    ]
  };
};

/* ---------- 寫出 + 驗證 ---------- */
const ORDER = ['proj-swordwave', 'proj-knife', 'proj-knife-gold', 'proj-fireball', 'proj-fire',
  'proj-ice-shard', 'proj-lightning', 'proj-poison-drop', 'proj-light-orb', 'proj-dark-orb',
  'proj-earth-rock', 'proj-wind-crescent', 'proj-arcane-missile', 'proj-waterball',
  'proj-firehunt-ring', 'proj-enemy-bolt', 'proj-meteor', 'proj-meteor-small', 'proj-starfall',
  'proj-thunder-orb-fall'];
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
