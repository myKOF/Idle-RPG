'use strict';
// 沿用核准火狩的幾何、粒子節奏與世界座標弧形拖尾，只改伴生配色。
const fs = require('fs');
const path = require('path');
const kit = require('../preset-kit.cjs');

function make() {
  const preset = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../vfx/presets/orb-firehunt.json'), 'utf8'));
  preset.id = 'orb-firehunt-companion';
  const colors = {
    'arc-gold': '#1968ff',
    'arc-crimson': '#f32b19',
    'ember-shell': '#ed2817',
    'molten-heart': '#63a6ff',
    'surface-flames': '#1968ff',
    'trailing-embers': '#ff4225'
  };
  for (const layer of preset.layers) layer.tint = colors[layer.id] || layer.tint;
  return preset;
}

if (require.main === module) kit.write(make());
module.exports = { make };
