'use strict';
/* boss-oni.cjs — 第5隻封魔塔BOSS「鬼面」的戰鬥特效（boss-oni-*）。
   製作目標見 docs/assets/BOSS5_SOURCE.md；播放邏輯在 js/boss-oni-fx.js。
   座標：+X 向右、+Y 向下；原點＝錨點。鬼面本體約 115px 高（NPC 縮放 1.8 時）。
     boss-oni-eye        眼睛紅光（循環，原點＝眼睛中心）
     boss-oni-mist       紅色霧氣拖尾（循環，原點＝腦後；粒子為世界座標，BOSS 移動時自然拖尾）
     boss-oni-ram-hit    攻擊1 撞擊（原點＝目標身體中心）
     boss-oni-spit       攻擊2 吐出小骷髏的口前綠氣
     boss-oni-skull      攻擊2 小骷髏飛行（循環，朝 +X，主體約 46px）
     boss-oni-skull-hit  小骷髏命中／到達爆點
     boss-oni-flame      攻擊3 火焰（循環，沿 +X 長 200px；Runtime 以 scaleX＝距離/200 拉長）
     boss-oni-shatter    死亡碎裂（原點＝身體中心）
   用法：node tools/vfx/authoring/author/boss-oni.cjs */
const kit = require('../preset-kit.cjs');
const { A, RAMP, sprite, particle } = kit;
const SKULL = 'claude-authored/boss5-oni-mask-20261113/vfx/oni-skull-green.png';
const SKULL_BLUE = 'claude-authored/boss5-oni-mask-20261113/vfx/oni-skull-blue.png';
const SKULL_PURPLE = 'claude-authored/boss5-oni-mask-20261113/vfx/oni-skull-purple.png';

/* ---------- 眼睛 ---------- */
kit.write({
  id: 'boss-oni-eye', duration: 0.9, loop: true,
  sizing: { authored: { radius: 18 }, shape: 'circle' },
  layers: [
    sprite({ id: 'halo', asset: A.glowSoft, z: 0, size: 66, alpha: 0.9, tint: '#ff1c0a', blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0.7], [0.2, 1], [0.38, 0.5], [0.6, 1], [0.8, 0.6], [1, 0.7]] }),
    sprite({ id: 'core', asset: A.dot, z: 1, size: 20, alpha: 1, tint: '#ffe2b8', blend: 'add', duration: 0.9,
      alphaOverLife: [[0, 0.8], [0.2, 1], [0.38, 0.6], [0.6, 1], [0.8, 0.7], [1, 0.8]],
      scaleOverLife: [[0, 1], [0.3, 1.2], [0.55, 0.85], [0.8, 1.15], [1, 1]] }),
    particle({ id: 'sparks', asset: A.dot, z: 2, rate: 12, lifetime: [0.4, 0.8], spawnRadius: 5, speed: [8, 30], direction: -90, spread: 90,
      startPx: [4, 8], tint: '#ff7a30', blend: 'add', alpha: 0.9, alphaOverLife: [[0, 0], [0.2, 1], [1, 0]] })
  ]
});

/* ---------- 紅霧拖尾 ---------- */
kit.write({
  id: 'boss-oni-mist', duration: 1.2, loop: true,
  sizing: { authored: { radius: 40 }, shape: 'circle' },
  layers: [
    particle({ id: 'smoke', asset: A.smokeSoft, z: 0, rate: 34, lifetime: [1.0, 1.7], spawnRadius: 14, speed: [2, 14], direction: -90, spread: 360,
      startPx: [40, 72], tint: '#c0141e', blend: 'normal', alpha: 0.75,
      alphaOverLife: [[0, 0], [0.2, 0.9], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.7]], drag: 0.6 }),
    particle({ id: 'wisp', asset: A.glowSoft, z: 1, rate: 10, lifetime: [0.7, 1.2], spawnRadius: 16, speed: [4, 16], direction: -90, spread: 360,
      startPx: [22, 40], tint: '#ff2a1a', blend: 'add', alpha: 0.5, alphaOverLife: [[0, 0], [0.25, 1], [1, 0]] })
  ]
});

/* ---------- 攻擊1：撞擊 ---------- */
kit.write({
  id: 'boss-oni-ram-hit', duration: 0.55,
  sizing: { authored: { radius: 55 }, shape: 'circle' },
  layers: [
    sprite({ id: 'halo', asset: A.glowSoft, z: 0, size: 90, alpha: 0.7, tint: '#ff2a10', blend: 'screen', duration: 0.4,
      alphaOverLife: [[0, 0], [0.1, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.2]] }),
    sprite({ id: 'ring', asset: A.impactRingOut, z: 1, size: 40, alpha: 0.95, tint: '#ff5a2a', blend: 'add', duration: 0.38,
      alphaOverLife: [[0, 0], [0.08, 1], [1, 0]], scaleOverLife: [[0, 0.5], [1, 2.6]] }),
    sprite({ id: 'face', asset: SKULL, z: 3, size: 70, alpha: 0.85, tint: '#ff4630', blend: 'add', duration: 0.3,
      alphaOverLife: [[0, 0], [0.15, 1], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.35]] }),
    sprite({ id: 'flash', asset: A.flash, z: 4, size: 56, alpha: 1, tint: '#ffe0c0', blend: 'add', duration: 0.18,
      alphaOverLife: [[0, 0], [0.2, 1], [1, 0]] }),
    sprite({ id: 'scratchA', asset: A.scratch, z: 2, size: 80, rotDeg: -35, alpha: 0.9, tint: '#ff7040', blend: 'add', duration: 0.25,
      alphaOverLife: [[0, 0], [0.15, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.1]] }),
    particle({ id: 'sparks', asset: A.star08, z: 2, burst: 14, lifetime: [0.3, 0.6], spawnRadius: 4, speed: [90, 220], direction: -90, spread: 360,
      startPx: [6, 12], tint: '#ffb060', blend: 'add', alpha: 1, gravity: { x: 0, y: 260 }, alphaOverLife: [[0, 1], [0.6, 1], [1, 0]] })
  ]
});

/* ---------- 攻擊2 吐骷髏、攻擊3 噴火：三個貼圖版本各一套顏色（紅版＝綠骷髏＋橘火，藍版＝青藍，紫版＝紫） ---------- */
const PALETTES = {
  '': { skull: SKULL, puff: '#40ff60', mist: '#2fd05a', spark: '#a8ffb0', glow: '#30ff50', trail: '#38ff5a', haze: '#1c9a3c', ring: '#80ff90',
    muzzle: '#ff9a40', ramp: RAMP.fireCore, core: '#ffe9b0', smoke: '#3a1810', ember: '#ffb04a' },
  '-blue': { skull: SKULL_BLUE, puff: '#40b8ff', mist: '#2a78d0', spark: '#b0e4ff', glow: '#30a8ff', trail: '#38b0ff', haze: '#1c5a9a', ring: '#80d0ff',
    muzzle: '#6ab8ff', ramp: [[0, '#ffffff'], [0.18, '#c4ecff'], [0.45, '#3d9bff'], [0.75, '#1a3fc0'], [1, '#080d3a']], core: '#d6f0ff', smoke: '#102040', ember: '#7ac8ff' },
  '-purple': { skull: SKULL_PURPLE, puff: '#c050ff', mist: '#8a2fd0', spark: '#e0b0ff', glow: '#b030ff', trail: '#c038ff', haze: '#601c9a', ring: '#d080ff',
    muzzle: '#d070ff', ramp: [[0, '#ffffff'], [0.18, '#f2ccff'], [0.45, '#b04aff'], [0.75, '#5a1ab0'], [1, '#1a0838']], core: '#f4d6ff', smoke: '#220a3a', ember: '#e08aff' }
};
function skullAndFlame(sfx, P) {
/* ---------- 攻擊2：吐骷髏 ---------- */
kit.write({
  id: 'boss-oni-spit' + sfx, duration: 0.5,
  sizing: { authored: { radius: 30 }, shape: 'circle' },
  layers: [
    sprite({ id: 'puff', asset: A.glowSoft, z: 0, size: 60, alpha: 0.8, tint: P.puff, blend: 'add', duration: 0.4,
      alphaOverLife: [[0, 0], [0.15, 1], [1, 0]], scaleOverLife: [[0, 0.4], [1, 1.4]] }),
    particle({ id: 'mist', asset: A.smokeSoft, z: 1, burst: 8, lifetime: [0.4, 0.7], spawnRadius: 5, speed: [20, 70], direction: 0, spread: 70,
      startPx: [22, 36], tint: P.mist, blend: 'normal', alpha: 0.5, alphaOverLife: [[0, 0.8], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.5]] }),
    particle({ id: 'sparks', asset: A.dot, z: 2, burst: 10, lifetime: [0.3, 0.5], spawnRadius: 3, speed: [60, 160], direction: 0, spread: 60,
      startPx: [4, 8], tint: P.spark, blend: 'add', alpha: 1, alphaOverLife: [[0, 1], [1, 0]] })
  ]
});

kit.write({
  id: 'boss-oni-skull' + sfx + '', duration: 0.6, loop: true,
  sizing: { authored: { radius: 26 }, shape: 'circle' },
  layers: [
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 78, alpha: 0.7, tint: P.glow, blend: 'add', duration: 0.6,
      alphaOverLife: [[0, 0.6], [0.5, 1], [1, 0.6]] }),
    sprite({ id: 'skull', asset: P.skull, z: 2, size: 46, alpha: 1, blend: 'normal', duration: 0.6,
      rotationOverLife: [[0, -0.1], [0.5, 0.1], [1, -0.1]] }),
    particle({ id: 'trail', asset: A.glowSoft, z: 1, rate: 46, lifetime: [0.3, 0.5], spawnRadius: 6, speed: [0, 14], direction: 180, spread: 120,
      startPx: [18, 30], tint: P.trail, blend: 'add', alpha: 0.6, alphaOverLife: [[0, 0.8], [1, 0]], scaleOverLife: [[0, 1], [1, 0.3]] }),
    particle({ id: 'haze', asset: A.smokeSoft, z: 1, rate: 22, lifetime: [0.5, 0.8], spawnRadius: 8, speed: [0, 10], direction: 180, spread: 100,
      startPx: [24, 38], tint: P.haze, blend: 'normal', alpha: 0.35, alphaOverLife: [[0, 0.8], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.4]] })
  ]
});

kit.write({
  id: 'boss-oni-skull-hit' + sfx, duration: 0.55,
  sizing: { authored: { radius: 50 }, shape: 'circle' },
  layers: [
    sprite({ id: 'halo', asset: A.glowSoft, z: 0, size: 100, alpha: 0.7, tint: P.glow, blend: 'screen', duration: 0.4,
      alphaOverLife: [[0, 0], [0.12, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.2]] }),
    sprite({ id: 'ring', asset: A.impactRingOut, z: 1, size: 36, alpha: 0.9, tint: P.ring, blend: 'add', duration: 0.4,
      alphaOverLife: [[0, 0], [0.1, 1], [1, 0]], scaleOverLife: [[0, 0.5], [1, 2.4]] }),
    sprite({ id: 'ghost', asset: P.skull, z: 3, size: 54, alpha: 0.9, blend: 'normal', duration: 0.35,
      alphaOverLife: [[0, 1], [1, 0]], scaleOverLife: [[0, 1], [1, 1.6]] }),
    particle({ id: 'sparks', asset: A.star08, z: 2, burst: 12, lifetime: [0.3, 0.6], spawnRadius: 4, speed: [70, 200], direction: -90, spread: 360,
      startPx: [6, 11], tint: P.spark, blend: 'add', alpha: 1, gravity: { x: 0, y: 200 }, alphaOverLife: [[0, 1], [0.6, 1], [1, 0]] })
  ]
});

/* ---------- 攻擊3：火焰（沿 +X 名目 200px：速度 420px/s × 壽命約 0.5s） ---------- */
kit.write({
  id: 'boss-oni-flame' + sfx, duration: 0.8, loop: true,
  sizing: { authored: { width: 200, height: 70 }, shape: 'rectangle' },
  layers: [
    sprite({ id: 'muzzle', asset: A.muzzle02, z: 4, size: 46, alpha: 0.95, tint: P.muzzle, blend: 'add', duration: 0.8,
      alphaOverLife: [[0, 0.8], [0.25, 1], [0.5, 0.75], [0.75, 1], [1, 0.8]], scaleOverLife: [[0, 0.9], [0.5, 1.15], [1, 0.9]] }),
    particle({ id: 'fire', asset: A.flame04, z: 2, rate: 64, lifetime: [0.4, 0.55], spawnRadius: 4, speed: [380, 440], direction: 0, spread: 5,
      startPx: [22, 38], tint: '#ffffff', blend: 'add', alpha: 0.85, tintOverLife: P.ramp,
      alphaOverLife: [[0, 0.7], [0.4, 1], [1, 0]], scaleOverLife: [[0, 0.5], [0.5, 1], [1, 1.6]], rotationSpeed: [-2, 2] }),
    particle({ id: 'core', asset: A.flame01, z: 3, rate: 40, lifetime: [0.25, 0.38], spawnRadius: 2, speed: [400, 460], direction: 0, spread: 2,
      startPx: [12, 20], tint: P.core, blend: 'add', alpha: 0.9, alphaOverLife: [[0, 1], [0.6, 0.8], [1, 0]] }),
    particle({ id: 'smoke', asset: A.smokeDark, z: 1, rate: 18, lifetime: [0.5, 0.8], spawnRadius: 6, speed: [160, 250], direction: 0, spread: 14,
      startPx: [30, 46], tint: P.smoke, blend: 'normal', alpha: 0.4, alphaOverLife: [[0, 0], [0.3, 0.8], [1, 0]], scaleOverLife: [[0, 0.7], [1, 1.7]] }),
    particle({ id: 'embers', asset: A.star08, z: 3, rate: 16, lifetime: [0.4, 0.8], spawnRadius: 8, speed: [180, 380], direction: 0, spread: 20,
      startPx: [5, 9], tint: P.ember, blend: 'add', alpha: 1, gravity: { x: 0, y: 90 }, alphaOverLife: [[0, 1], [0.7, 0.8], [1, 0]] })
  ]
});

}
Object.keys(PALETTES).forEach(sfx => skullAndFlame(sfx, PALETTES[sfx]));

/* ---------- 死亡：碎裂 ---------- */
kit.write({
  id: 'boss-oni-shatter', duration: 1.4,
  sizing: { authored: { radius: 90 }, shape: 'circle' },
  layers: [
    sprite({ id: 'flash', asset: A.flash, z: 4, size: 110, alpha: 1, tint: '#ffd8c0', blend: 'add', duration: 0.25,
      alphaOverLife: [[0, 0], [0.15, 1], [1, 0]], scaleOverLife: [[0, 0.5], [1, 1.3]] }),
    sprite({ id: 'ring', asset: A.impactRingOut, z: 2, size: 60, alpha: 0.9, tint: '#ff3a24', blend: 'add', duration: 0.55,
      alphaOverLife: [[0, 0], [0.08, 1], [1, 0]], scaleOverLife: [[0, 0.4], [1, 3.2]] }),
    sprite({ id: 'glow', asset: A.glowSoft, z: 0, size: 150, alpha: 0.7, tint: '#ff2a14', blend: 'screen', duration: 0.7,
      alphaOverLife: [[0, 0], [0.12, 1], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.3]] }),
    particle({ id: 'smoke', asset: A.smokeSoft, z: 1, burst: 22, lifetime: [0.9, 1.4], spawnRadius: 14, speed: [40, 130], direction: -90, spread: 360,
      startPx: [44, 70], tint: '#a00e18', blend: 'normal', alpha: 0.5, drag: 1.6,
      alphaOverLife: [[0, 0.8], [1, 0]], scaleOverLife: [[0, 0.6], [1, 1.8]] }),
    particle({ id: 'embers', asset: A.star08, z: 3, burst: 34, lifetime: [0.6, 1.1], spawnRadius: 8, speed: [90, 300], direction: -90, spread: 360,
      startPx: [6, 12], tint: '#ffb060', blend: 'add', alpha: 1, gravity: { x: 0, y: 320 }, alphaOverLife: [[0, 1], [0.7, 0.9], [1, 0]] }),
    particle({ id: 'debris', asset: A.dirt01, z: 2, burst: 16, lifetime: [0.7, 1.2], spawnRadius: 10, speed: [80, 240], direction: -90, spread: 360,
      startPx: [8, 16], tint: '#7a0c14', blend: 'add', alpha: 0.9, gravity: { x: 0, y: 380 }, rotationSpeed: [-6, 6], alphaOverLife: [[0, 1], [0.7, 0.9], [1, 0]] })
  ]
});

['boss-oni-eye', 'boss-oni-mist', 'boss-oni-ram-hit', 'boss-oni-shatter'].concat(['', '-blue', '-purple'].reduce((l, x) => l.concat(['boss-oni-spit' + x, 'boss-oni-skull' + x, 'boss-oni-skull-hit' + x, 'boss-oni-flame' + x]), []))
  .forEach(id => console.log(JSON.stringify(kit.probe(id))));
