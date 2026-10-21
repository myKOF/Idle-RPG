'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'js/ui-inventory-skin.js'), 'utf8');

function mount() {
  const frames = [], images = [], canvases = [], classes = new Set(), properties = new Map();
  const sample = { width: 62.5 };
  const box = {
    isConnected: true,
    querySelector: selector => {
      if (sample.dimmed && selector.includes(':not(.dimmed)')) return null;
      return sample;
    },
    classList: { add: n => classes.add(n), remove: n => classes.delete(n) },
    style: { setProperty: (k, v) => properties.set(k, v), removeProperty: k => properties.delete(k) }
  };
  let reads = 0, failRaster = false;
  const c = {
    devicePixelRatio: 2,
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    getComputedStyle(cell, pseudo) {
      reads++;
      if (!pseudo) return { width: cell.width + 'px', height: '58px', borderRadius: '5px' };
      const values = { background: 'linear-gradient(#112233, #aabbcc)',
        'border-image-source': 'url("data:image/svg+xml,%3Csvg%3E%3C/svg%3E")' };
      return { getPropertyValue: n => values[n] || '' };
    },
    Image: function () { images.push(this); },
    document: { createElement(name) {
      assert.equal(name, 'canvas');
      const canvas = { getContext: () => ({ drawImage() {} }), toDataURL() {
        if (failRaster) throw new Error('SecurityError');
        return 'data:image/png;base64,skin' + canvases.length;
      } };
      canvases.push(canvas); return canvas;
    } }
  };
  c.window = c; vm.createContext(c); vm.runInContext(source, c);
  return { c, box, sample, frames, images, canvases, classes, properties,
    flush: () => frames.shift()(), reads: () => reads, fail: on => { failRaster = on; } };
}

test('大量同格背景只量測／點陣化一次，成功前沿用原CSS，DPR與邏輯格尺寸正確', () => {
  const m = mount();
  for (let i = 0; i < 100; i++) m.c.InventorySkin.prepare(m.box, 1080);
  assert.equal(m.frames.length, 1); assert.equal(m.reads(), 0);
  m.flush(); assert.equal(m.images.length, 1); assert.equal(m.reads(), 3);
  assert.equal(m.classes.size, 0);
  const svg = decodeURIComponent(m.images[0].src.split(',').slice(1).join(','));
  assert.match(svg, /width="62.5" height="58"/);
  assert.match(svg, /linear-gradient\(#112233, #aabbcc\)/);
  assert.match(svg, /&quot;data:image\/svg\+xml/);
  assert.doesNotMatch(svg, /item-icon|ancient-star|data-id/);
  m.images[0].onload();
  assert.equal(m.canvases[0].width, 125); assert.equal(m.canvases[0].height, 116);
  assert.ok(m.classes.has('inventory-mythic-skin-ready'));
  for (let i = 0; i < 100; i++) m.c.InventorySkin.prepare(m.box, 1080);
  assert.equal(m.frames.length, 0); assert.equal(m.reads(), 3); assert.equal(m.canvases.length, 1);
});

test('Resize及DPR變更重建；舊非同步結果與A→B→A不覆蓋目前快取', () => {
  const m = mount();
  m.c.InventorySkin.prepare(m.box, 1080); m.flush(); m.images[0].onload();
  const initial = m.properties.get('--inventory-mythic-skin');
  m.c.InventorySkin.prepare(m.box, 900); m.flush();
  m.c.InventorySkin.prepare(m.box, 1080); m.images[1].onload();
  assert.equal(m.properties.get('--inventory-mythic-skin'), initial);
  m.sample.width = 54;
  m.c.InventorySkin.prepare(m.box, 900); m.flush();
  m.c.devicePixelRatio = 3;
  m.c.InventorySkin.prepare(m.box, 900); m.flush();
  m.images[2].onload(); assert.equal(m.canvases.length, 1);
  m.images[3].onload(); assert.equal(m.canvases.length, 2);
  assert.equal(m.canvases[1].width, 162);
});

test('暫時性解碼或Canvas失敗在同尺寸後續渲染可恢復', () => {
  const m = mount();
  m.c.InventorySkin.prepare(m.box, 1080); m.flush(); m.images[0].onload();
  m.c.InventorySkin.prepare(m.box, 900); m.flush(); m.fail(true); m.images[1].onload();
  assert.equal(m.classes.size, 0); assert.equal(m.properties.size, 0);
  m.c.InventorySkin.prepare(m.box, 900); m.flush(); m.images[2].onerror();
  assert.equal(m.classes.size, 0);
  m.fail(false);
  m.c.InventorySkin.prepare(m.box, 900); m.flush(); m.images[3].onload();
  assert.ok(m.classes.has('inventory-mythic-skin-ready'));
});

test('永久不支援時每尺寸最多三次，停止反覆生成；Resize後可重新嘗試', () => {
  const m = mount();
  for (let i = 0; i < 3; i++) {
    m.c.InventorySkin.prepare(m.box, 1080); m.flush(); m.images[i].onerror();
  }
  for (let i = 0; i < 100; i++) m.c.InventorySkin.prepare(m.box, 1080);
  assert.equal(m.frames.length, 0); assert.equal(m.images.length, 3);
  assert.equal(m.classes.size, 0); assert.equal(m.properties.size, 0);
  m.c.InventorySkin.prepare(m.box, 900); m.flush(); m.images[3].onload();
  assert.ok(m.classes.has('inventory-mythic-skin-ready'));
});

test('所有神話格因選取部位置灰時仍可生成底圖，恢復選取不重複生成', () => {
  const m = mount(); m.sample.dimmed = true;
  m.c.InventorySkin.prepare(m.box, 1080); m.flush();
  assert.equal(m.images.length, 1);
  m.images[0].onload(); assert.ok(m.classes.has('inventory-mythic-skin-ready'));
  m.sample.dimmed = false;
  m.c.InventorySkin.prepare(m.box, 1080);
  assert.equal(m.frames.length, 0); assert.equal(m.canvases.length, 1);
});

test('空格、未顯示與移除的容器不建立背景，重新掛載後正常恢復', () => {
  const m = mount(); m.box.querySelector = () => null;
  m.c.InventorySkin.prepare(m.box, 1080); m.flush(); assert.equal(m.images.length, 0);
  m.box.querySelector = () => m.sample; m.sample.width = 0;
  m.c.InventorySkin.prepare(m.box, 1080); m.flush(); assert.equal(m.images.length, 0);
  m.sample.width = 62.5; m.box.isConnected = false;
  m.c.InventorySkin.prepare(m.box, 1080); m.flush(); assert.equal(m.images.length, 0);
  m.box.isConnected = true; m.c.InventorySkin.prepare(m.box, 1080); m.flush();
  m.box.isConnected = false; m.images[0].onload(); assert.equal(m.classes.size, 0);
  m.box.isConnected = true; m.c.InventorySkin.prepare(m.box, 1080); m.flush(); m.images[1].onload();
  assert.ok(m.classes.has('inventory-mythic-skin-ready'));
});

test('快取只作用背包神話格，選取置灰共用底圖，關鍵字不符合格沿用隱藏底圖', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const rules = css.match(/#inventory-grid\.inventory-mythic-skin-ready[^}]+}/g);
  assert.equal(rules.length, 2);
  for (const rule of rules) {
    assert.match(rule, /\.item-cell\.eff-mythic:not\(\.item-cell-dimmed\)/);
    assert.doesNotMatch(rule, /:not\(\.dimmed\)/);
    assert.doesNotMatch(rule, /\.eq-slot|#sk-tooltip|\.selected/);
  }
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(index.indexOf('src="js/ui-inventory-skin.js') < index.indexOf('src="js/ui.js'));
});
