'use strict';
// 暴風亂舞：地板半徑與粒子上升高度以世界座標製作（每米10單位）。
const kit = require('../preset-kit.cjs');
const radius = 100, height = 30, lifetime = 1.2, floorProjection = 0.38;
const layers = [];
// 取素材上半圈，前半圈沿Y鏡射。遠側低亮度、近側清楚，避免透視反轉。
function halfRing(id, front, size, y, tint, alpha, z) {
  return kit.sprite({ id, asset: kit.A.ringThin,
    sizeX: size, sizeY: size * floorProjection * (front ? -1 : 1),
    y, anchor: { x: 0.5, y: 1 }, tint, alpha, blend: 'add', z,
    sheet: { columns: 1, rows: 2, count: 1, mode: 'life', loop: false } });
}
for (const front of [false, true]) {
  const side = front ? 'front' : 'back';
  for (let j = 0; j < 3; j++) layers.push(halfRing('wall-' + side + '-' + j,
    front, radius * 3 * (1 - j * 0.0625), -height * j / 2, '#62ffa0',
    front ? 0.14 : 0.035, front ? 22 + j : 2 + j));
  layers.push(halfRing('floor-green-rim-' + side, front, radius * 3, 0,
    '#66ffa0', front ? 0.6 : 0.16, front ? 20 : 0));
  layers.push(halfRing('floor-white-core-' + side, front, radius * 2.93, 0,
    '#eefff3', front ? 0.3 : 0.07, front ? 21 : 1));
}
// 素材原本尖端朝下，旋轉後從圓周地板寬底逐漸收束到上方尖端。
for (let i = 0; i < 8; i++) {
  const a = (i + 0.5) * Math.PI * 2 / 8;
  layers.push(kit.sprite({ id: 'tapered-cone-' + i, asset: kit.A.coneC,
    x: Math.cos(a) * radius, y: Math.sin(a) * radius * floorProjection - height / 2,
    sizeX: 24, sizeY: height, rotation: Math.PI,
    tint: i % 2 ? '#b6ffd4' : '#7dffae', alpha: Math.sin(a) > 0 ? 0.7 : 0.4, blend: 'add', z: Math.sin(a) > 0 ? 25 : 6,
    alphaOverLife: [[0,0.65],[0.25,1],[0.7,0.8],[1,0.65]] }));
}
// 沿圓周分散發射，而非填滿整個圓盤；局部座標使已出生粒子隨角色移動。
for (let i = 0; i < 12; i++) {
  const a = i * Math.PI * 2 / 12;
  const layer = kit.particle({ id: 'rising-light-' + i, asset: kit.A.dot,
    x: Math.cos(a) * radius, y: Math.sin(a) * radius * floorProjection, z: 7,
    rate: 20, maxParticles: 25, lifetime, speed: height / lifetime,
    direction: -90, spread: 0, startPx: [7, 14], spawnBox: [12, 0], delay: i % 5 * 0.025,
    tint: i % 3 === 0 ? '#f0fff6' : '#6dffa1', alpha: Math.sin(a) > 0 ? 0.55 : 0.3, blend: 'add',
    alphaOverLife: [[0, 0], [0.12, 1], [0.7, 0.8], [1, 0]],
    scaleOverLife: [[0, 1.2], [0.25, 0.9], [1, 0.05]] });
  layer.worldSpace = false;
  layers.push(layer);
}
kit.write({ id: 'ground-storm-dance', duration: 2.4, loop: true,
  sizing: { shape: 'custom', widthM: 20, heightM: 10.6, authored: { width: 200, height: 106 } }, layers });
console.log('ground-storm-dance.json：俯視收尖光壁，半徑10米、高3米，最多300顆粒子');
