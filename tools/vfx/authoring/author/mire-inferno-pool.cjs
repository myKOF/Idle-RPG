'use strict';
const fs = require('node:fs');
const path = require('node:path');
const kit = require('../preset-kit.cjs');

function make() {
  const source = JSON.parse(fs.readFileSync(path.join(kit.REPO, 'vfx/presets/en-toxic-pool.json'), 'utf8'));
  const layers = source.layers.filter(l => ['sludge', 'murk'].includes(l.id));
  const floor = layers.find(l => l.id === 'sludge');
  floor.id = 'burning-ground'; floor.tint = '#ff3b09'; floor.alpha = .62;
  const coal = layers.find(l => l.id === 'murk');
  coal.id = 'red-embers'; coal.tint = '#b42c08'; coal.alpha = .48; coal.blendMode = 'add';
  return { id: 'ground-mire-inferno-pool', duration: 3, loop: true,
    sizing: { shape: 'circle', radiusM: 6, authored: { radius: 60 } }, layers };
}

if (require.main === module) kit.write(make());
module.exports = { make };
