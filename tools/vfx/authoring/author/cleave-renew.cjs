'use strict';
const kit = require('../preset-kit.cjs');
const fs = require('fs');
const vm = require('vm');

function radiusCurve() {
  // Skills2 是 Excel/CSV 生成的資料列，製作端直接沿用以免兩套擴張曲線分歧。
  const row = fs.readFileSync(kit.REPO + '/js/skills2.js', 'utf8').split('\n').find(line => /^  cleave:/.test(line));
  if (!row) throw new Error('找不到 cleave 配置列');
  return vm.runInNewContext('({' + row + '})').cleave.tiers[0].fx.radiusCurve;
}

// 每份只畫一道刀波；次數與擴張距離由權威技能事件驅動。
function make(id, palette, flying) {
  const duration = flying ? 0.5 : 0.42;
  const grow = radiusCurve();
  const fade = [[0, 0], [0.07, 1], [0.68, 0.9], [1, 0]];
  const layers = [];
  for (let i = 0; i < 3; i++) {
    const rotation = -90 - i * 65;
    const shared = {
      blend: 'add', duration: duration - i * 0.035, delay: i * 0.035, rotDeg: rotation,
      scaleOverLife: grow, alphaOverLife: fade,
      rotationOverLife: [[0, 0], [0.4, Math.PI * 2], [1, Math.PI * 2.6]]
    };
    layers.push(kit.sprite({ ...shared, id: 'blade-glow-' + i, asset: kit.A.slash02,
      size: 226, alpha: 0.38, tint: palette[i % palette.length], z: i }));
    layers.push(kit.sprite({ ...shared, id: 'blade-body-' + i, asset: kit.A.slash01,
      size: 217, alpha: 0.95, tint: palette[i % palette.length], z: 4 + i }));
    layers.push(kit.sprite({ ...shared, id: 'blade-edge-' + i, asset: kit.A.slash01,
      size: 206, alpha: 0.68, tint: '#fff7dc', z: 8 + i }));
    layers.push(kit.sprite({ ...shared, id: 'blade-trail-' + i, asset: kit.A.slash02,
      size: 180, alpha: 0.25, tint: palette[(i + 1) % palette.length], z: 12 + i,
      rotDeg: rotation - 32 }));
  }
  return {
    id, duration, loop: false,
    sizing: { shape: 'circle', radiusM: 8, authored: { radius: 80 } },
    layers
  };
}

function presets() {
  return [
    make('slash-cleave-ring-warm', ['#ff5426', '#ffc62e', '#ff8e24'], false),
    make('slash-cleave-ring-blue', ['#278dff', '#53c8ff', '#607aff'], false),
    make('proj-cleave-ring-blue', ['#278dff', '#53c8ff', '#607aff'], true),
    make('proj-cleave-ring-tricolor', ['#319eff', '#ffd34d', '#bb60ff'], true)
  ];
}
if (require.main === module) presets().forEach(p => console.log(kit.write(p)));
module.exports = { make, presets };
