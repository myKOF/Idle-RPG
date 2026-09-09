'use strict';
// Approved v10: rising blue water, white sheet crests, pale ribbons and dust.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../../../..');
const library = require('../../vfx-library-root.cjs').resolveLibraryRoot().root;
const assetId = 'codex-authored/water-tornado/water-tornado-v10.png';
const data = fs.readFileSync(path.join(library, assetId));
const indexPath = path.join(root, 'vfx/asset-index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const entry = { assetId, package: 'codex-authored', relativePath: assetId, format: 'png',
  fileSize: data.length, contentHash: 'sha256:' + crypto.createHash('sha256').update(data).digest('hex'),
  facts: { dimensions: { width: 2560, height: 3200 }, hasAlphaChannel: true },
  tags: ['water', 'tornado', 'sequence', 'blue', 'original'] };
index.assets = index.assets.filter(a => a.assetId !== assetId).concat(entry);
index.assetCount = index.assets.length;
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
const kit = require('../preset-kit.cjs');
kit.write({ schemaVersion: 1, id: 'field-water-tornado', duration: 4, loop: true,
  layers: [{ id: 'water-column', type: 'sprite', assetId, zIndex: 0,
    scale: { x: 0.4, y: 0.4 }, anchor: { x: 0.5, y: 0.9296875 },
    alpha: 1, tint: '#ffffff', blendMode: 'normal', duration: 4,
    sheet: { columns: 8, rows: 10, count: 80, mode: 'fps', fps: 20, loop: true },
    radiusProfile: { centerScale: 1, topRatio: 2, bottomRatio: 2, sourceTopRatio: 2,
      sourceBottomRatio: 2, topY: 0.0125, centerY: 0.4640625, bottomY: 0.915625 } }],
  sizing: { shape: 'custom', widthM: 10, heightM: 21,
    authored: { radius: 28, width: 56, height: 115.6 } }
});
