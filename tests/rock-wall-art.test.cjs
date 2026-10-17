'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { slab } = require('../tools/vfx/authoring/author/rock-wall-slabs.cjs');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('岩壁全部12個角度均有四塊、透明背景及原畫布，製作結果與正式匯出一致', () => {
  const index = JSON.parse(read('vfx/asset-index.json'));
  const shipped = JSON.parse(read('vfx/shipped-assets.json'));
  for (let deg = 0; deg < 180; deg += 15) {
    const id = 'claude-authored/rock-wall/wall-slab-' + String(deg).padStart(3, '0') + '.svg';
    const svg = read('images/vfx/assets/' + id);
    assert.equal(svg, slab(deg), id + ' 由正式工具重現');
    assert.deepEqual([...svg.matchAll(/data-rock="(\d+)"/g)].map(m => +m[1]).sort(), [0, 1, 2, 3]);
    assert.match(svg, /width="256" height="200" viewBox="0 0 256 200"/);
    assert.match(svg, /data-wall-length="200" data-wall-thickness="67"/);
    assert.doesNotMatch(svg, /NaN|Infinity|<image|<rect|href=/);
    // 真正輪廓座標不得被畫布截斷；陰影／顆粒的裁切範圍另由各石面定義。
    for (const m of svg.matchAll(/<clipPath[^>]*><polygon points="([^"]+)"/g)) {
      for (const point of m[1].split(' ')) {
        const [x, y] = point.split(',').map(Number);
        assert.ok(x >= 0 && x <= 256 && y >= 0 && y <= 200, id + ': ' + point);
      }
    }
    const hash = 'sha256:' + crypto.createHash('sha256').update(svg).digest('hex');
    for (const manifest of [index, shipped]) {
      const entry = manifest.assets.find(a => a.assetId === id);
      assert.equal(entry.contentHash, hash);
      assert.equal(entry.fileSize, Buffer.byteLength(svg));
    }
  }
});

test('四塊岩壁沿原Preset的足跡、角度與腳底錨點播放', () => {
  for (let deg = 0; deg < 180; deg += 15) {
    const preset = JSON.parse(read('vfx/presets/en-stone-wall-' + deg + '.json'));
    const layer = preset.layers.find(l => l.id === 'slab');
    assert.ok(layer);
    assert.equal(layer.assetId, 'claude-authored/rock-wall/wall-slab-' + String(deg).padStart(3, '0') + '.svg');
    assert.equal(layer.followDirection, false);
    assert.deepEqual(layer.anchor, { x: .5, y: .7 });
    assert.equal(preset.sizing.authored.width, 200);
    assert.equal(preset.sizing.authored.height, 67);
  }
});
