'use strict';
// Runtime components reconstructed from the original v10 geometry, with no atlas.
const kit = require('../preset-kit.cjs');
const parts = require('../../../../js/vfx-water-tornado.js').PARTS;
const profile = { centerScale: 1, topRatio: 2, bottomRatio: 2, sourceTopRatio: 2,
  sourceBottomRatio: 2, topY: .0125, centerY: .4640625, bottomY: .915625 };
kit.write({ schemaVersion: 1, id: 'field-water-tornado', duration: 4, loop: true,
  layers: parts.map((part, i) => ({ id: part, enabled: true, type: 'procedural', effect: 'waterTornado',
    water: { part, speed: 1, ...(['dust', 'spray'].includes(part) ? { density: 1 } : {}) },
    zIndex: i, scale: { x: .4, y: .4 }, anchor: { x: .5, y: .9296875 },
    alpha: 1, tint: '#ffffff', blendMode: ['bloom', 'spray'].includes(part) ? 'add' : 'normal',
    duration: 4, radiusProfile: { ...profile } })),
  sizing: { shape: 'custom', widthM: 10, heightM: 21,
    authored: { radius: 28, width: 56, height: 115.6 } }
});
