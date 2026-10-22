'use strict';
// 原創冰箭切面的專用中性底圖；彈身／外暈共用同一色值，不殘留原PNG的藍調。
const ICICLE = require('./missile-crystal-shape.cjs').ASSET;
const COLORS = {
  white: '#ffffff', blue: '#469fff', purple: '#bd69ff', yellow: '#ffd342'
};
function make(color) {
  if (!COLORS[color]) throw new Error('Unknown missile color: ' + color);
  const head = COLORS[color], halo = head;
  return {
    id: 'en-missile-' + color, duration: 4, loop: true,
    sizing: { shape: 'projectile-circle', authored: { radius: 8 } },
    layers: [
      { id: 'glow', type: 'sprite', assetId: 'particle-pack/png-black-background/light_03.png',
        zIndex: 0, scale: { x: .0781, y: .0469 }, alpha: .28, tint: halo,
        blendMode: 'add', duration: 4 },
      { id: 'body', type: 'sprite', assetId: ICICLE, zIndex: 2,
        scale: { x: .07, y: .09 }, alpha: 1, tint: head, blendMode: 'normal', duration: 4 },
      { id: 'tail-cone', type: 'sprite', assetId: 'light-masks-1.0/default/cone_composed_c.png',
        zIndex: -1, position: { x: -9, y: 0 }, anchor: { x: .5, y: 1 }, rotation: -Math.PI / 2,
        scale: { x: .0273, y: .0508 }, alpha: .18, tint: halo, blendMode: 'add', duration: .35,
        alphaOverLife: [[0, 0], [.15, .8], [.5, .5], [1, 0]] },
      { id: 'trail', type: 'particle', assetId: 'particle-pack/png-black-background/smoke_04.png',
        zIndex: -2, position: { x: -10, y: 0 }, alpha: .55, tint: halo, blendMode: 'add',
        duration: .35, emission: { mode: 'rate', rate: 18 }, maxParticles: 6,
        lifetime: [.14, .24], spawn: { shape: 'circle', radius: .6 }, speed: [0, .8],
        direction: 180, spread: 70, startScale: [.003, .006], worldSpace: true,
        alphaOverLife: [[0, .6], [.35, .45], [1, 0]], scaleOverLife: [[0, 1], [1, .25]] }
    ]
  };
}
module.exports = { ICICLE, COLORS, make };
if (require.main === module) {
  require('./missile-crystal-shape.cjs').bake();
  const kit = require('../preset-kit.cjs');
  for (const color of Object.keys(COLORS)) kit.write(make(color));
}
