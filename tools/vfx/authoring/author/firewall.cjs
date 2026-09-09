'use strict';
const fs = require('node:fs');
const path = require('node:path');
const kit = require('../preset-kit.cjs');
function build() {
  const source = JSON.parse(fs.readFileSync(path.join(kit.REPO, 'vfx/presets/fire-tornado-inferno.json')));
  const layers = [];
  for (let i = 0; i < 3; i++) {
    for (const original of source.layers) {
      const layer = JSON.parse(JSON.stringify(original));
      layer.zIndex = layers.length;
      layer.id = 'column-' + i + '-' + layer.id;
      layer.position = { x: (i - 1) * 96 + (layer.position?.x || 0), y: layer.position?.y || 0 };
      layers.push(layer);
    }
  }
  return { id: 'ground-firewall', duration: source.duration, loop: true,
    sizing: { shape: 'custom', widthM: 18, heightM: 12, authored: { width: 360, height: 240 } }, layers };
}
function author() { return kit.write(build()); }
if (require.main === module) console.log(author());
module.exports = { author, build };
