'use strict';
/* slash-wind-spin：真空迴旋。
   2 層氣旋底色 + 3 道旋轉刀光，每道刀光 2 層：
     halo    藍色光暈（screen）——外緣顏色
     core    白熱核心（add，縮小 10%）——亮度對比才是輪廓清晰的來源
   刀光只用單一藍色系；三色（藍／青／綠）疊加在深綠地圖上亮度與色相都接近，輪廓會糊成一圈霧。
   （曾試過再墊一層 png-transparent 版的深色底影，邊緣更硬；但該素材尚未匯出到 shipped-assets，
   export-assets 目前被素材庫 svg 大小不符擋住，故未採用。）
   duration、位置、旋轉速度、透視壓扁沿用美術在 Editor 手調後的值（commit 1cc8eb7a）。 */
const k = require('../preset-kit.cjs');

const DURATION = 1.5;
const POSITION = { x: -6.5175, y: -8.1783 };
const PROJECTION = { x: 1, y: 0.5 };
const ROTATION_SPEED = 12.566370614359172;
const ANCHOR = { x: 0.31076681064521183, y: 0.510697036318065 };
const BLADE_SCALE = { x: 0.8852, y: 0.8318 };
const ORBIT_SCALE = [1, 0.82, 1.1624];
const ORBIT_ROTATION = [-0.2094, 1.8406, 4.2906];
const SLASH_GLOW = 'particle-pack/png-black-background/slash_03.png';

const ALPHA_OVER_LIFE = [[0, 0], [0.12, 1], [0.65, 0.85], [1, 0]];
const SCALE_OVER_LIFE = [[0, 0.65], [0.28, 1], [1, 1.16]];
const ROTATION_OVER_LIFE = [[0, -0.65], [1, 5.633185307179586]];

function cyclone(n) {
  const strong = n === 0;
  const s = strong ? 0.6994 : 0.6249;
  return {
    id: 'cyclone-flow-' + n, type: 'sprite', assetId: k.A.twirl03,
    position: POSITION, rotation: strong ? 0 : 2.4, scale: { x: s, y: s }, anchor: { x: 0.5, y: 0.5 },
    alpha: strong ? 0.14 : 0.2, tint: strong ? '#229ff5' : '#51efd1', blendMode: 'add',
    duration: DURATION, rotationSpeed: ROTATION_SPEED,
    alphaOverLife: ALPHA_OVER_LIFE, scaleOverLife: [[0, 0.55], [0.3, 1], [1, 1.18]],
    rotationOverLife: [[0, 0], [1, 7.5]], projection: PROJECTION
  };
}

function blade(id, assetId, blendMode, tint, alpha, orbit, size) {
  const f = ORBIT_SCALE[orbit] * size;
  return {
    id, type: 'sprite', assetId, position: POSITION, rotation: ORBIT_ROTATION[orbit],
    scale: { x: +(BLADE_SCALE.x * f).toFixed(4), y: +(BLADE_SCALE.y * f).toFixed(4) },
    anchor: ANCHOR, alpha, tint, blendMode, delay: 0, duration: DURATION, rotationSpeed: ROTATION_SPEED,
    alphaOverLife: ALPHA_OVER_LIFE, scaleOverLife: SCALE_OVER_LIFE, rotationOverLife: ROTATION_OVER_LIFE,
    projection: PROJECTION
  };
}

function make() {
  const layers = [cyclone(1), cyclone(0)];
  for (let n = 0; n < 3; n++) {
    layers.push(blade('orbit-' + n + '-halo', SLASH_GLOW, 'screen', '#1e7dff', 0.8, n, 1));
    layers.push(blade('orbit-' + n + '-core', SLASH_GLOW, 'add', '#d8f4ff', 0.7, n, 0.9));
  }
  layers.forEach((l, i) => { l.zIndex = i; });
  return { schemaVersion: 1, id: 'slash-wind-spin', duration: DURATION, loop: false,
    sizing: { shape: 'circle', radiusM: 6, authored: { radius: 272 } }, layers };
}
if (require.main === module) k.write(make());
module.exports = { make };
