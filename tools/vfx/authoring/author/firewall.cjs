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
      if (original.id !== 'dust') {
        const rgb = (layer.tint || '#ffffff').slice(1).match(/../g).map(v => parseInt(v, 16));
        layer.tint = '#' + rgb.map((v, channel) => Math.round(v * [1, .702, .585][channel]).toString(16).padStart(2, '0')).join('');
      }
      layer.zIndex = layers.length;
      layer.id = 'column-' + i + '-' + layer.id;
      layer.position = { x: (i - 1) * source.sizing.authored.width * .8 + (layer.position?.x || 0), y: layer.position?.y || 0 };
      layers.push(layer);
    }
  }
  return { id: 'ground-firewall', duration: source.duration, loop: true,
    sizing: { shape: 'custom', widthM: 18, heightM: 12, authored: { width: source.sizing.authored.width * 3, height: source.sizing.authored.height } }, layers };
}
function author() { return kit.write(build()); }
if (require.main === module) console.log(author());
module.exports = { author, build };
