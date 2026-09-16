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

function flyingRing(id, palette) {
  const grow = radiusCurve();
  const sample = p => {
    for (let i = 1; i < grow.length; i++) {
      if (p <= grow[i][0]) {
        const a = grow[i - 1], b = grow[i];
        return a[1] + (b[1] - a[1]) * (p - a[0]) / (b[0] - a[0]);
      }
    }
    return grow.at(-1)[1];
  };
  const layers = [];
  // 刀弧本身維持厚度，改由位置曲線向外移動；切向長度跟隨圓周展開。
  for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI * 2 / 32;
    const x = [], y = [];
    const points = [...new Set([...Array.from({length:13},(_,j)=>j/12), ...grow.map(k=>k[0])])].sort((a,b)=>a-b);
    for (const p of points) {
      const radius = 80 * sample(p), a = angle + p * 0.7;
      x.push([p, radius * Math.cos(a)]);
      y.push([p, radius * Math.sin(a)]);
    }
    const layer = {
      id: 'wave-blade-' + i, type: 'sprite',
      assetId: 'particle-pack/png-black-background/slash_03.png',
      position: {x:0,y:0}, anchor: {x:0.625,y:0.5}, rotation: angle,
      scale: {x:0.14,y:0.09},
      alpha:0.8, tint:palette[Math.floor(i * palette.length / 32)],
      blendMode:'add', zIndex:1, duration:0.5,
      offsetXOverLife:x, offsetYOverLife:y,
      scaleOverLife:grow,
      scaleXOverLife:[[0,0.25],[0.2,1],[1,1]],
      scaleYOverLife:grow,
      rotationOverLife:[[0,0],[1,0.7]],
      alphaOverLife:[[0,0],[0.005+i*0.0035,0],[0.04+i*0.0035,1],[0.8,0.9],[1,0]]
    };
    layers.push(layer);
  }
  return {schemaVersion:1,id,duration:0.5,loop:false,
    sizing:{shape:'circle',radiusM:8,authored:{radius:80}},layers};
}

function presets() {
  const defaults = [
    make('slash-cleave-ring-warm', ['#ff5426', '#ffc62e', '#ff8e24'], false),
    make('slash-cleave-ring-blue', ['#278dff', '#53c8ff', '#607aff'], false),
    make('proj-cleave-ring-blue', ['#278dff', '#53c8ff', '#607aff'], true),
    make('proj-cleave-ring-tricolor', ['#319eff', '#ffd34d', '#bb60ff'], true)
  ];
  // 已經由編輯器調整的檔案優先，避免重新製作時覆蓋使用者的形狀。
  const current = defaults.map(p => {
    const file = kit.REPO + '/vfx/presets/' + p.id + '.json';
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : p;
  });
  current[2] = flyingRing(current[2].id, ['#278dff','#53c8ff','#607aff']);
  current[3] = flyingRing(current[3].id, ['#319eff','#ffd34d','#bb60ff']);
  return current;
}
if (require.main === module) presets().forEach(p => console.log(kit.write(p)));
module.exports = { make, presets, flyingRing };
