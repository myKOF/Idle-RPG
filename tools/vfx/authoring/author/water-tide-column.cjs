'use strict';
/* 怒海狂濤巨型水柱：重用既有動畫／透明貼圖，改成高聳柱體與低密度水花。
   判定半徑由事件傳入，authored.radius只標定底部水環，柱高為獨立視覺比例。 */
const kit = require('../preset-kit.cjs');
const fade = [[0, 0], [.06, 1], [.88, 1], [1, 0]];
const layers = [
  { id: 'foot-ring', type: 'sprite', assetId: 'particle-pack/png-transparent/circle_01.png',
    zIndex: 0, scale: { x: .390625, y: .390625 }, alpha: .16, tint: '#278eb8',
    blendMode: 'normal', projection: { x: 1, y: .5 }, duration: 4, alphaOverLife: fade },
  { id: 'rising-column', type: 'sprite', assetId: 'codex-authored/tornado/water-flow.png',
    zIndex: 1, scale: { x: 1.65, y: 2.4 }, anchor: { x: .5, y: .6875 },
    alpha: .22, tint: '#83dfe8', blendMode: 'normal', duration: 4, alphaOverLife: fade,
    radiusProfile: { centerScale: 1, topRatio: 1.1, bottomRatio: 1.15,
      sourceTopRatio: 2, sourceBottomRatio: 2, topY: .0125, centerY: .4640625, bottomY: .915625 },
    sheet: { columns: 10, rows: 8, count: 80, fps: 20, mode: 'fps', loop: true } },
  { id: 'vertical-flow', type: 'procedural', effect: 'uvScroll', assetId: 'light-masks-1.0/default/cone_composed_f.png',
    zIndex: 2, size: { x: 120, y: 460 }, scrollSpeed: { x: 0, y: -.24 },
    anchor: { x: .5, y: 1 }, alpha: .075, tint: '#67c7dc', blendMode: 'add', duration: 4, alphaOverLife: fade },
  { id: 'foot-foam', type: 'sprite', assetId: 'particle-pack/png-transparent/circle_01.png',
    zIndex: 3, scale: { x: .3359375, y: .3359375 }, alpha: .09, tint: '#91e5e8',
    blendMode: 'normal', projection: { x: 1, y: .5 }, duration: 4,
    rotationOverLife: [[0, 0], [1, -3.141593]], alphaOverLife: fade },
  { id: 'sparse-spray', type: 'particle', assetId: 'particle-pack/png-transparent/spark_01.png',
    zIndex: 4, position: { x: 0, y: -50 }, alpha: .14, tint: '#8dddde', blendMode: 'normal', duration: 4,
    emission: { mode: 'rate', rate: 8 }, maxParticles: 14, lifetime: [.45, .9],
    spawn: { shape: 'box', width: 100, height: 90 }, speed: [25, 50], direction: -90, spread: 28,
    startScale: [.003, .006], alignToVelocity: true,
    alphaOverLife: [[0, 0], [.15, 1], [.7, .7], [1, 0]], scaleOverLife: [[0, .7], [1, .25]] }
];
kit.write({ schemaVersion: 1, id: 'field-water-tide-column', duration: 4, loop: true, layers,
  sizing: { shape: 'circle', radiusM: 30, authored: { radius: 100, width: 200, height: 200 } } });
kit.write({ schemaVersion: 1, id: 'cast-water-tide-merge', duration: 1.5, loop: true,
  sizing: { shape: 'custom', widthM: 20, heightM: 8, authored: { width: 200, height: 80 } },
  layers: [
    { id: 'ice-swirl', type: 'sprite', assetId: 'codex-authored/water-tide/ice-merge-vortex.svg',
      position: { x: 0, y: -205 }, scale: { x: .8, y: .8 }, projection: { x: 1, y: .36 },
      alpha: .55, tint: '#ffffff', blendMode: 'normal', perspective: false, zIndex: 1, duration: 1.5,
      rotationOverLife: [[0, 0], [1, -5.5]], alphaOverLife: [[0, 0], [.12, 1], [.7, 1], [1, 0]],
      scaleOverLife: [[0, .5], [.2, .8], [.75, 1], [1, 1.1]] },
    { id: 'inner-swirl', type: 'sprite', assetId: 'codex-authored/water-tide/ice-merge-vortex.svg',
      position: { x: 0, y: -205 }, scale: { x: .45, y: .45 }, projection: { x: 1, y: .36 },
      alpha: .25, tint: '#85cfff', blendMode: 'normal', perspective: false, zIndex: 2, duration: 1.5,
      rotationOverLife: [[0, 1], [1, 6.5]], alphaOverLife: [[0, 0], [.12, 1], [.75, 1], [1, 0]] },
    { id: 'frost-grains', type: 'particle', assetId: 'particle-pack/png-transparent/spark_01.png',
      position: { x: 0, y: -205 }, alpha: .25, tint: '#99e4ff', blendMode: 'normal', perspective: false,
      zIndex: 3, duration: 1.5, emission: { mode: 'rate', rate: 12 }, maxParticles: 10, lifetime: [.3, .5],
      spawn: { shape: 'box', width: 145, height: 18 }, speed: [10, 24], direction: 90, spread: 28,
      startScale: [.004, .007], alignToVelocity: true, alphaOverLife: [[0, 0], [.2, 1], [1, 0]] }
  ] });
