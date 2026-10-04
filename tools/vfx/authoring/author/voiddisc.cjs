'use strict';
/* orb-void-disc：虛空斬（第七階 projectile）。
   一個青色圓盤（spiky_15）＋青白亮邊，外圍是綠藍氣旋，中心是白色內核。
   輪廓清晰的做法：
   - 圓盤外緣加一圈細亮邊（ring_a，半徑對齊 spiky_15 外緣）——圓盤自己的邊緣偏軟，亮邊讓它有明確的界線。
   - 外圍氣旋降低不透明度。這些層全是 add，疊在一起亮度會蓋過圓盤；但不能降太多，否則失去旋風感。
   層與層之間的角度、寬窄、錨點差異是美術在 Editor 手調的結果（讓旋轉輪廓不規則），原樣保留。
   所有圖層都是 add，所以繪製順序不影響畫面。 */
const k = require('../preset-kit.cjs');

const TURN_2 = -12.566370614359172;   // 每秒 2 圈（逆時針）
const TURN_3 = -18.84955592153876;    // 每秒 3 圈
const ORB = 'new_materials/orb/';
const SQUASH = { x: 1, y: 0.6 };      // 地面透視壓扁

/* [id, 素材, 旋轉, scaleX, scaleY, tint, alpha, 圈數(rad/s 終點)] */
const SPIN_LAYERS = [
  ['outer-green-flow',        k.A.twirl03,           4.712389,  0.538,  0.5017, '#30e982', 0.646, TURN_2],
  ['blue-edge-current',       k.A.twirl03,           2.356194,  0.7756, 0.7379, '#559fff', 0.238, TURN_2],
  ['return-green-flow',       k.A.twirl03,           Math.PI,   0.3537, 0.3719, '#65ffc0', 0.51,  TURN_2],
  ['outer-green-flow-copy-2', ORB + 'energyball_5.png', 4.712389, 1.4315, 1.3351, '#30e982', 0.17,  TURN_2],
  ['blue-edge-current-copy-2', k.A.twirl03,         -0.785398,  0.7756, 0.7379, '#559fff', 0.238, TURN_2],
  ['outer-green-flow-copy',   ORB + 'spiky_15.png',  4.712389,  0.4516, 0.4516, '#2fcae9', 0.8,   TURN_2],  // 圓盤本體
  ['rim',                     null],
  ['white-cutting-current',   k.A.twirl02,           0.8,       0.3326, 0.3196, '#eaffee', 0.88,  TURN_2],
  ['inner-green-vortex',      k.A.twirl03,           2.3,       0.243,  0.2312, '#5bff91', 0.8,   TURN_3],
  ['inner-white-current',     k.A.twirl02,           4.5,       0.1887, 0.1869, '#f1fff4', 0.8,   TURN_3]
];

function make() {
  const layers = SPIN_LAYERS.map(([id, assetId, rotation, sx, sy, tint, alpha, turn], i) => {
    if (id === 'rim') {
      return { id: 'disc-rim', type: 'sprite', assetId: 'light-masks-1.0/default/ring_a.png', zIndex: i,
        position: { x: 0, y: 0 }, rotation: 0, scale: { x: 0.55, y: 0.55 }, anchor: { x: 0.5, y: 0.5 },
        alpha: 0.9, tint: '#d8fffb', blendMode: 'add', delay: 0, duration: 1,
        outerScale: SQUASH, followDirection: false };
    }
    return { id, type: 'sprite', assetId, zIndex: i, position: { x: 0, y: 0 }, rotation,
      scale: { x: sx, y: sy }, anchor: { x: 0.5, y: 0.5 }, alpha, tint, blendMode: 'add', duration: 1,
      rotationOverLife: [[0, 0], [1, turn]], outerScale: SQUASH, followDirection: false };
  });
  return { schemaVersion: 1, id: 'orb-void-disc', duration: 1, loop: true,
    sizing: { shape: 'projectile-circle', radiusM: 3, authored: { radius: 240 } }, layers };
}
if (require.main === module) k.write(make());
module.exports = { make };
