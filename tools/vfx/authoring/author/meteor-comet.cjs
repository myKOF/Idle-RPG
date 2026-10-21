'use strict';
// 殞石術：自製粒子組合，參考使用者的白熱火球與長煙火尾跡；不匯入參考圖。
const k = require('../preset-kit.cjs');
const { A, sprite, particle } = k;

function make() {
  const fade = [[0, 0], [.12, .9], [.5, .75], [1, 0]];
  const p = {
    id: 'proj-meteor-inferno', duration: 1, loop: true,
    // 沿用正式彈體的製作尺寸與米制契約，只重新安排光焰與尾跡。
    sizing: { shape: 'custom', widthM: 14, heightM: 14, authored: { width: 60, height: 60 } },
    layers: [
      particle({ id: 'smoke-wake', asset: A.smokeT, rate: 18, duration: 1,
        lifetime: [.65, 1.05], x: -55, spawnBox: [30, 23], speed: [210, 320],
        direction: 180, spread: 10, startPx: [38, 65], rotationStart: [0, 6.28],
        rotationSpeed: [-.3, .3], tint: '#b7b2ac', alpha: .62, blend: 'normal',
        alphaOverLife: [[0, 0], [.18, .65], [.65, .5], [1, 0]],
        scaleOverLife: [[0, .45], [.45, 1], [1, 1.5]] }),
      sprite({ id: 'comet-tail-envelope', asset: A.flame04, x: -90,
        sizeX: 250, sizeY: 66, tint: '#ff5a16', alpha: .68, blend: 'add',
        alphaOverLife: [[0, .85], [.35, 1], [.7, .85], [1, .85]] }),
      particle({ id: 'rolling-flame-tail', asset: A.flame04, rate: 32, duration: 1,
        lifetime: [.4, .75], x: -24, spawnBox: [16, 22], speed: [210, 330],
        direction: 180, spread: 10, startPx: [38, 64], rotationStart: [-.4, .4],
        rotationSpeed: [-.6, .6], tint: '#ff951e', alpha: .85, blend: 'add',
        alphaOverLife: fade, scaleOverLife: [[0, .8], [.3, 1], [1, .18]] }),
      sprite({ id: 'golden-tail-stream', asset: A.fire01, x: -55,
        sizeX: 210, sizeY: 59, tint: '#ffbd4b', alpha: .65, blend: 'add' }),
      sprite({ id: 'white-tail-thread', asset: A.flame04, x: -48, y: -2,
        sizeX: 165, sizeY: 31, tint: '#fff1cb', alpha: .45, blend: 'add' }),
      particle({ id: 'trailing-embers', asset: k.alphaTwin(A.dot), rate: 18, duration: 1,
        lifetime: [.3, .65], x: -20, spawnBox: [16, 35], speed: [160, 280],
        direction: 180, spread: 18, startPx: [1.5, 3.5], tint: '#ffd478', alpha: .85,
        blend: 'add', alphaOverLife: [[0, 1], [.4, .85], [1, 0]] }),
      sprite({ id: 'meteor-flame-halo', asset: k.alphaTwin(A.fire01), x: -4,
        sizeX: 125, sizeY: 111, tint: '#e86d16', alpha: .85, blend: 'normal',
        rotationSpeed: .25, alphaOverLife: [[0, .9], [.35, 1], [.7, .9], [1, .9]] }),
      sprite({ id: 'cracked-meteor-core', asset: 'new_materials/orb/sphere_23.png',
        sizeX: 71, sizeY: 64, tint: '#ffbb63', alpha: .55, blend: 'add' }),
      sprite({ id: 'meteor-halo-gold-rim', asset: A.fire01, x: 7,
        sizeX: 103, sizeY: 94, tint: '#ffcf6d', alpha: .65, blend: 'add', rotation: 1.1 }),
      sprite({ id: 'white-hot-leading-face', asset: A.fire01, x: 13,
        sizeX: 91, sizeY: 85, tint: '#fff4d4', alpha: .45, blend: 'add', rotation: -.7 }),
      sprite({ id: 'leading-hot-core', asset: A.fire01, x: 21,
        sizeX: 61, sizeY: 62, tint: '#ffffed', alpha: .45, blend: 'add', rotation: 2.1 })
    ]
  };
  // 三束表面火舌向後剝離，亮前端與火尾相連，不增加第二個發射／命中事件。
  for (const [i, x, y] of [[0, -16, -17], [1, 10, -12], [2, 0, 15]]) {
    p.layers.push(particle({ id: 'lava-flow-' + i, asset: A.flame04, x, y,
      rate: 8, duration: 1, lifetime: [.18, .38], spawnBox: [7, 5], speed: [65, 110],
      direction: 180, spread: 14, startPx: [22, 37], rotationStart: [-.5, .5],
      rotationSpeed: [-.7, .7], tint: '#ffe19a', alpha: .85, blend: 'add',
      alphaOverLife: fade, scaleOverLife: [[0, .6], [.3, 1], [1, .15]] }));
  }
  p.layers.forEach((l, i) => { l.zIndex = i; });
  return p;
}

if (require.main === module) console.log(k.write(make()));
module.exports = { make };
