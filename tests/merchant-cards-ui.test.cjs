'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createEngine } = require('../scripts/sim/engine.js');
const root = path.resolve(__dirname, '..');

function renderer() {
  const engine = createEngine({ seed: 17 }).boot();
  const ctx = engine.ctx;
  const nodes = {};
  for (const id of ['gem-shop-grid', 'gem-shop-level', 'shop-upgrade', 'shop-buy-all', 'shop-refresh']) {
    nodes[id] = { innerHTML: '', textContent: '', attrs: {},
      setAttribute(key, value) { this.attrs[key] = String(value); },
      removeAttribute(key) { delete this.attrs[key]; },
      toggleAttribute(key, flag) { if (flag) this.attrs[key] = ''; else delete this.attrs[key]; }
    };
  }
  Object.assign(ctx, {
    $id: id => nodes[id], nodePendingKey: () => 'gem-shop',
    pendingUiButtonAttributes: () => '', syncUiPendingControls: () => {},
    setAttrIfChanged: (node, key, value) => node.setAttribute(key, value)
  });
  const source = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('var GEM_TIER_COLORS ='), source.indexOf('/* ============ 迷你監控視窗')), ctx);
  return { ctx, nodes, render: (items, gold = 1e12, tickets = 1, level = 1) =>
    ctx.renderGemShop({ shop: { items, level }, tickets }, { gold }) };
}

test('商人卡使用實際寶石品質與符文階級，移除屬性數值並保留價格及40格', () => {
  const { ctx, nodes, render } = renderer();
  render([{kind:'gem', type:'garnet', lv:2, price:123, sold:false}, {kind:'rune', runeId:'r33', price:456, sold:false}]);
  const html = nodes['gem-shop-grid'].innerHTML;
  assert.match(html, new RegExp(ctx.STR(1563, 2)));
  assert.match(html, new RegExp(ctx.STR(1563, 33)));
  assert.match(html, /data-shop-buy="0"/);
  assert.match(html, /merchant-gold-icon/);
  assert.doesNotMatch(html, /undefined|NaN| \+/);
  assert.equal((html.match(/class="shop-card/g) || []).length, 40);
});

test('一鍵購買僅顯示文字，tips總額隨售出變動並保留缺金與無券狀態', () => {
  const { ctx, nodes, render } = renderer();
  const items = [{kind:'rune', runeId:'r01', price:123, sold:false}, {kind:'rune', runeId:'r02', price:456, sold:false}];
  render(items);
  assert.equal(nodes['shop-buy-all'].textContent, ctx.STR(1514));
  assert.equal(nodes['shop-buy-all'].attrs['data-tt-desc'], ctx.STR(858, ctx.fmtFull(579)));
  items[0].sold = true;
  render(items, 0, 0, ctx.GEM_SHOP_MAX_LEVEL);
  assert.equal(nodes['shop-buy-all'].attrs['data-tt-desc'], ctx.STR(858, ctx.fmtFull(456)));
  for (const id of ['shop-buy-all', 'shop-refresh', 'shop-upgrade']) assert.ok('data-merchant-unavailable' in nodes[id].attrs);
  assert.match(nodes['gem-shop-grid'].innerHTML, /sold/);
  assert.match(nodes['gem-shop-grid'].innerHTML, /data-merchant-unavailable disabled/);
  assert.match(nodes['gem-shop-level'].innerHTML, /<br>/);
  items[1].sold = true;
  render(items);
  assert.equal(nodes['shop-buy-all'].attrs['data-tt-desc'], ctx.STR(858, ctx.fmtFull(0)));
});
