'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { extractFunction } = require('./helpers/battle-scene.cjs');
const png = require('../tools/vfx/vfx-image-facts.cjs')._internal;
const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'images/sprites/npc/npc.json')));
function image(stem, folder = path.join(root, 'images/sprites/npc')) {
  const chunks = png.readPngChunks(fs.readFileSync(path.join(folder, stem + '.png')));
  const header = png.parseIhdr(chunks.ihdr);
  return { ...header, data: png.decodeToRgba(header, chunks) };
}
function bounds(im, frame, cellW, cellH) {
  let left = cellW, right = 0, top = cellH, bottom = 0;
  for (let y = 0; y < cellH; y++) for (let x = 0; x < cellW; x++) {
    if (im.data[(y * im.width + frame * cellW + x) * 4 + 3] <= 40) continue;
    left = Math.min(left, x); right = Math.max(right, x + 1);
    top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
  }
  return { left, right, top, bottom };
}

test('毒蚊群四動作共用飛行錨點，可見本體離地且命中特效對準空中本體', () => {
  const key = 'plague_flies', meta = manifest.chars[key];
  const c = { console, performance, setTimeout, clearTimeout, navigator: { userAgent: 'node' } };
  vm.createContext(c); vm.runInContext(fs.readFileSync(path.join(root, 'js/vendor/pixi.min.js'), 'utf8'), c);
  const P = c.PIXI, anims = {}, defs = {}, speeds = {};
  for (const action of ['idle', 'walk', 'attack', 'die']) {
    const stem = key + '_' + action, def = manifest.stems[stem], im = image(stem);
    assert.equal(def.char, key); defs[action] = def; speeds[action] = def.fps / 60;
    anims[action] = Array.from({ length: def.frames }, () => new P.Texture({ source: P.Texture.EMPTY.source,
      frame: new P.Rectangle(0, 0, meta.cellW, meta.cellH) }));
    for (let i = 0; i < def.frames; i++) {
      const b = bounds(im, i, meta.cellW, meta.cellH);
      const gap = (meta.anchorY * meta.cellH - b.bottom) * meta.scale;
      assert.ok(gap > 10, stem + ' frame ' + i + ' must be above ground');
    }
  }
  c.S = { sheets: { flies: { manifest: { ...meta, anims: defs }, anims, speeds } } };
  const im = image(key + '_idle'), b = bounds(im, 0, meta.cellW, meta.cellH);
  c.textureContentRows = () => ({ top: b.top, bot: b.bottom });
  vm.runInContext(['makeAnimSprite', 'animFrames', 'playAnim', 'spriteHitBox'].map(n => extractFunction(renderer, n)).join('\n'), c);
  const body = c.makeAnimSprite('flies', 'idle'), e = { body, sheetName: 'flies', curAnim: 'idle', baseAnim: 'idle' };
  for (const rankScale of [1, 1.28, 2, 3]) {
    body.scale.set(meta.scale * rankScale);
    const hit = c.spriteHitBox(body);
    assert.ok(Math.abs(hit.center - (meta.anchorY * meta.cellH - (b.top + b.bottom) / 2) * body.scale.y) < 1e-6);
    for (const action of ['walk', 'attack', 'die']) {
      c.playAnim(e, action); assert.equal(body.anchor.y, meta.anchorY);
    }
  }
  body.destroy();
});

test('嵐翼飛蛇低伏貼地，六幀身體蜿蜒循環，死亡最後一幀攤平', () => {
  const key = 'npc_thunder_peak_4', meta = manifest.chars[key], baseline = meta.anchorY * meta.cellH;
  const outline = JSON.parse(fs.readFileSync(path.join(root, 'images/sprites/npc/outline.json')));
  assert.ok(outline.radius > 0 && outline.radius <= 2);
  for (const action of ['idle', 'walk', 'attack', 'die']) {
    const stem = key + '_' + action, def = manifest.stems[stem], im = image(stem), boxes = [];
    const original = image(stem, path.join(__dirname, 'fixtures/npc-ground-air'));
    assert.equal(def.frames, 6);
    for (let i = 0; i < def.frames; i++) {
      const visible = bounds(im, i, meta.cellW, meta.cellH);
      const b = bounds(original, i, meta.cellW, meta.cellH); boxes.push(b);
      // 對原本體保留原有貼地／比例斷言，再獨立檢查描邊擴張及原像素沒有移動。
      assert.ok(Math.abs(b.bottom - baseline) <= 1, stem + ' frame ' + i + ' belly must touch ground');
      assert.ok(b.right - b.left > (b.bottom - b.top) * 1.8, stem + ' low horizontal body');
      assert.ok(b.left >= 3 && b.right <= meta.cellW - 3 && b.top >= 3, stem + ' complete silhouette');
      assert.ok(visible.left >= b.left - outline.radius && visible.left <= b.left);
      assert.ok(visible.right <= b.right + outline.radius && visible.right >= b.right);
      assert.ok(visible.top >= b.top - outline.radius && visible.top <= b.top);
      assert.ok(visible.bottom <= b.bottom + outline.radius && visible.bottom >= b.bottom);
      for (let y = 0; y < meta.cellH; y++) for (let x = 0; x < meta.cellW; x++) {
        const at = (y * im.width + i * meta.cellW + x) * 4, a = original.data.subarray(at, at + 4), z = im.data.subarray(at, at + 4);
        if (a[3] < 128) continue;
        assert.ok(z[3] >= a[3], stem + ' original body pixel remains in place');
        const dark = Math.max(a[0], a[1], a[2]) <= 48 && a[0] * .2126 + a[1] * .7152 + a[2] * .0722 <= 32;
        if (!dark) assert.deepEqual(z, a, stem + ' original colored body detail unchanged');
      }
    }
    if (action === 'walk') {
      for (let i = 0; i < 6; i++) {
        let difference = 0;
        for (let y = baseline - 12; y < baseline; y++) for (let x = 0; x < meta.cellW; x++) {
          const a = im.data[(y * im.width + i * meta.cellW + x) * 4 + 3] > 40;
          const b = im.data[(y * im.width + ((i + 1) % 6) * meta.cellW + x) * 4 + 3] > 40;
          if (a !== b) difference++;
        }
        assert.ok(difference >= 10, 'belly/tail must change between phases including 6 to 1');
      }
    }
    if (action === 'die') {
      assert.ok(boxes[5].bottom - boxes[5].top < (boxes[0].bottom - boxes[0].top) * .6);
      assert.equal(def.hold, true); assert.equal(def.loop, false);
    }
  }
});
