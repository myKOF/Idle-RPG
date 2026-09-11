'use strict';
// Runtime components reconstructed from the original v10 geometry, with no atlas.
const kit = require('../preset-kit.cjs');
const parts = require('../../../../js/vfx-water-tornado.js').PARTS.filter(part => !part.startsWith('cyclone-'));
const profile = { centerScale: 1, topRatio: 2, bottomRatio: 2, sourceTopRatio: 2,
  sourceBottomRatio: 2, topY: .0125, centerY: .4640625, bottomY: .915625 };
const preset = { schemaVersion: 1, id: 'field-water-tornado', duration: 4, loop: true,
  layers: parts.filter(part => !['halo', 'dust', 'spray'].includes(part)).map((part, i) => ({ id: part, enabled: true, type: 'procedural', effect: 'waterTornado',
    water: { part, speed: 1, ...(['dust', 'spray'].includes(part) ? { density: 1 } : {}) },
    zIndex: parts.indexOf(part), scale: { x: .4, y: .4 }, anchor: { x: .5, y: .9296875 },
    alpha: 1, tint: '#ffffff', blendMode: ['bloom', 'spray'].includes(part) ? 'add' : 'normal',
    duration: 4, radiusProfile: { ...profile } })).concat([
    { id: 'halo', type: 'sprite', assetId: 'particle-pack/png-transparent/light_01.png', zIndex: 0,
      position: { x: 0, y: -58 }, scale: { x: .18, y: .28 }, alpha: .20, tint: '#219dff', blendMode: 'add', duration: 4 },
    { id: 'dust', type: 'particle', assetId: 'particle-pack/png-transparent/smoke_01.png', zIndex: 9,
      position: { x: 0, y: 0 }, alpha: .12, tint: '#6c869a', blendMode: 'normal', duration: 4,
      emission: { mode: 'rate', rate: 22 }, maxParticles: 32, lifetime: [.7, 1.2],
      spawn: { shape: 'box', width: 48, height: 4 }, speed: [8, 18], direction: -90, spread: 180,
      startScale: [.025, .055], rotationStart: [0, 360], rotationSpeed: [-23, 23],
      alphaOverLife: [[0, 0], [.25, 1], [1, 0]], scaleOverLife: [[0, .5], [1, 1.7]] },
    { id: 'spray', type: 'particle', assetId: 'particle-pack/png-transparent/spark_01.png', zIndex: 10,
      position: { x: 0, y: -58 }, alpha: .6, tint: '#69d2ff', blendMode: 'add', duration: 4,
      emission: { mode: 'rate', rate: 55 }, maxParticles: 60, lifetime: [.35, .8],
      spawn: { shape: 'box', width: 58, height: 110 }, speed: [12, 26], direction: -90, spread: 180,
      startScale: [.004, .009], alignToVelocity: true,
      alphaOverLife: [[0, 0], [.18, 1], [1, 0]], scaleOverLife: [[0, .7], [.3, 1], [1, .2]] }
  ]).sort((a,b)=>a.zIndex-b.zIndex),
  sizing: { shape: 'custom', widthM: 10, heightM: 21,
    authored: { radius: 28, width: 56, height: 115.6 } }
};
kit.write(require('./water-tornado-polish.cjs')(preset));
