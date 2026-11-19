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

test('商人卡使用實際寶石品質與符文階級，移除屬性數值並保留價格與三列占位', () => {
  const { ctx, nodes, render } = renderer();
  render([{kind:'gem', type:'garnet', lv:2, price:123, sold:false}, {kind:'rune', runeId:'r33', price:456, sold:false}]);
  const html = nodes['gem-shop-grid'].innerHTML;
  assert.match(html, new RegExp(ctx.STR(1563, 2)));
  assert.match(html, new RegExp(ctx.STR(1563, 33)));
  assert.match(html, /data-shop-buy="0"/);
  assert.match(html, /merchant-gold-icon/);
  assert.doesNotMatch(html, /undefined|NaN| \+/);
  assert.equal((html.match(/class="shop-card/g) || []).length, 12);
  assert.ok(!('data-scrollable-stock' in nodes['gem-shop-grid'].attrs));
});

test('商品十二件內隱藏捲軸，超過十二件才顯示並只補齊最後一列', () => {
  const { nodes, render }=renderer();
  const items=Array.from({length:13},()=>({kind:'rune',runeId:'r01',price:100,sold:false}));
  render(items.slice(0,12));assert.ok(!('data-scrollable-stock' in nodes['gem-shop-grid'].attrs));
  assert.equal((nodes['gem-shop-grid'].innerHTML.match(/class="shop-card/g)||[]).length,12);
  render(items);assert.ok('data-scrollable-stock' in nodes['gem-shop-grid'].attrs);
  assert.equal((nodes['gem-shop-grid'].innerHTML.match(/class="shop-card/g)||[]).length,16);
  render(items.slice(0,6));assert.ok(!('data-scrollable-stock' in nodes['gem-shop-grid'].attrs));
});

test('一鍵購買僅顯示文字，tips總額隨售出變動並保留缺金與無券狀態', () => {
  const { ctx, nodes, render } = renderer();
  const items = [{kind:'rune', runeId:'r01', price:123, sold:false}, {kind:'rune', runeId:'r02', price:456, sold:false}];
  render(items);
  assert.equal(nodes['shop-buy-all'].textContent, ctx.STR(1514));
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], /<img src="images\/icon_gold.png"/);
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], />579<\/span>/);
  assert.doesNotMatch(nodes['shop-buy-all'].attrs['data-tt-desc'], /消耗|金幣/);
  items[0].sold = true;
  render(items, 0, 0, ctx.GEM_SHOP_MAX_LEVEL);
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], />456<\/span>/);
  for (const id of ['shop-buy-all', 'shop-refresh', 'shop-upgrade']) assert.ok('data-merchant-unavailable' in nodes[id].attrs);
  assert.match(nodes['gem-shop-grid'].innerHTML, /sold/);
  assert.match(nodes['gem-shop-grid'].innerHTML, /data-merchant-unavailable disabled/);
  assert.match(nodes['gem-shop-level'].innerHTML, /<br>/);
  items[1].sold = true;
  render(items);
  assert.match(nodes['shop-buy-all'].attrs['data-tt-desc'], />0<\/span>/);
});

test('饋贈以指定說明及金幣完整數字提示，等級變動更新費用，滿級清除費用', () => {
  const { ctx, nodes, render } = renderer();
  render([]);
  const button = nodes['shop-upgrade'];
  assert.equal(button.textContent, '饋贈');
  assert.equal(button.attrs['data-tt-title'], '饋贈');
  assert.equal(button.attrs['data-tt-desc'], ctx.STR(2573, ctx.merchantGoldPriceHTML(4100000, true)));
  assert.match(button.attrs['data-tt-desc'], /^贈與<img .*博取商人的好感，由此提升商店等級$/);
  assert.match(button.attrs['data-tt-desc'], /<img src="images\/icon_gold.png"/);
  assert.match(button.attrs['data-tt-desc'], />4,100,000<\/span>/);
  render([], 1e12, 1, 2);
  assert.ok(button.attrs['data-tt-desc'].includes('>'+ctx.fmtFull(ctx.gemShopUpgradeCost(2))+'</span>'));
  render([], 1e12, 1, ctx.GEM_SHOP_MAX_LEVEL);
  assert.equal(button.textContent, ctx.STR(2504));
  assert.equal(button.attrs['data-tt-desc'], ctx.STR(2504));
  assert.doesNotMatch(button.attrs['data-tt-desc'], /<img/);
  assert.ok('data-merchant-unavailable' in button.attrs);
});

test('商人倒計時以投影截止時間顯示，包含整分鐘與到期邊界', () => {
  const { ctx } = renderer();
  const node = { textContent:'' };
  ctx.$id=id=>id==='merchant-countdown'?node:null;
  let now=ctx.Date.now();ctx.Date.now=()=>now;
  const source=fs.readFileSync(path.join(root,'js/ui.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function renderMerchantCountdown('),source.indexOf('function renderTower()')),ctx);
  const merchant={active:true,expiresAt:now+600000};
  ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'10:00'));
  now+=1000;ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'09:59'));
  merchant.expiresAt=now+1;ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'00:01'));
  now+=2;ctx.renderMerchantCountdown(merchant);assert.equal(node.textContent,ctx.STR(2571,'00:00'));
});
