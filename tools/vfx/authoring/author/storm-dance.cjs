'use strict';
// 暴風亂舞：地板半徑與粒子上升高度以世界座標製作（每米10單位）。
const kit = require('../preset-kit.cjs');
const radius = 100, height = 30, lifetime = 1.2, floorProjection = 0.38;
const layers = [];
// 重疊的柔光帶構成連續光壁，不使用星芒或分立柱狀光點。
for (let j = 0; j < 6; j++) layers.push(kit.sprite({
  id: 'wall-band-' + j, asset: kit.A.ringThin,
  sizeX: radius * 3 * (1 - j * 0.025), sizeY: radius * 3 * floorProjection * (1 - j * 0.025), y: -height * j / 5,
  tint: '#62ffa0', alpha: 0.11, blend: 'add', z: j,
  alphaOverLife: [[0,0.85],[0.5,1],[1,0.85]]
}));
layers.push(kit.sprite({ id: 'floor-green-rim', asset: kit.A.ringThin,
  sizeX: radius * 3, sizeY: radius * 3 * floorProjection,
  tint: '#66ffa0', alpha: 0.8, blend: 'add', z: 10 }));
layers.push(kit.sprite({ id: 'floor-white-core', asset: kit.A.ringThin,
  sizeX: radius * 2.93, sizeY: radius * 2.93 * floorProjection,
  tint: '#eefff3', alpha: 0.65, blend: 'add', z: 11 }));
// 素材原本尖端朝下，旋轉後從圓周地板寬底逐漸收束到上方尖端。
for (let i = 0; i < 8; i++) {
  const a = (i + 0.5) * Math.PI * 2 / 8;
  layers.push(kit.sprite({ id: 'tapered-cone-' + i, asset: kit.A.coneC,
    x: Math.cos(a) * radius, y: Math.sin(a) * radius * floorProjection - height / 2,
    sizeX: 24, sizeY: height, rotation: Math.PI,
    tint: i % 2 ? '#b6ffd4' : '#7dffae', alpha: 0.75, blend: 'add', z: 8,
    alphaOverLife: [[0,0.65],[0.25,1],[0.7,0.8],[1,0.65]] }));
}
// 沿圓周分散發射，而非填滿整個圓盤；局部座標使已出生粒子隨角色移動。
for (let i = 0; i < 16; i++) {
  const a = i * Math.PI * 2 / 16;
  const layer = kit.particle({ id: 'rising-light-' + i, asset: kit.A.dot,
    x: Math.cos(a) * radius, y: Math.sin(a) * radius * floorProjection, z: 7,
    rate: 15, maxParticles: 19, lifetime, speed: height / lifetime,
    direction: -90, spread: 0, startPx: [7, 14], spawnBox: [12, 0], delay: i % 5 * 0.025,
    tint: i % 3 === 0 ? '#f0fff6' : '#6dffa1', alpha: 0.65, blend: 'add',
    alphaOverLife: [[0, 0], [0.12, 1], [0.7, 0.8], [1, 0]],
    scaleOverLife: [[0, 1.2], [0.25, 0.9], [1, 0.05]] });
  layer.worldSpace = false;
  layers.push(layer);
}
kit.write({ id: 'ground-storm-dance', duration: 2.4, loop: true,
  sizing: { shape: 'custom', widthM: 20, heightM: 10.6, authored: { width: 200, height: 106 } }, layers });
console.log('ground-storm-dance.json：半徑10米，高3米的收尖光壁，最多304顆粒子');
