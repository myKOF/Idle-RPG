const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { gold: 0, gems: {}, gemShop: { level: 1, items: [], refreshCount: 0, hourStart: Date.now() } } };
  context.randomGemType = () => 'garnet';
  context.flog = () => {};
  context.blog = () => {};
  return context;
}

test('寶石商店機率表與價格符合 20 級規格', () => {
  const context = loadGameContext();
  assert.equal(context.GEM_SHOP_COUNT_TABLE.length, 20);
  assert.equal(context.GEM_SHOP_TIER_TABLE.length, 20);
  context.GEM_SHOP_COUNT_TABLE.forEach((pairs) => assert.equal(pairs.reduce((sum, pair) => sum + pair[1], 0), 100));
  context.GEM_SHOP_TIER_TABLE.forEach((pairs) => assert.equal(pairs.reduce((sum, pair) => sum + pair[1], 0), 100));
  assert.equal(context.gemShopPrice(1), 5000);
  assert.equal(context.gemShopPrice(6), 800000);
  assert.equal(context.gemShopPrice(10), 8000000000);
});

test('商店升級費用與等級上限正確', () => {
  const context = loadGameContext();
  assert.equal(context.gemShopUpgradeCost(1), 4010000);
  assert.equal(context.gemShopUpgradeCost(19), 27436010000);
  assert.equal(context.gemShopUpgradeCost(20), 0);
});

test('商店依等級刷出對應數量與高階寶石', () => {
  const context = loadGameContext();
  context.wpick = (pairs) => pairs[pairs.length - 1][0];
  context.G.player.gemShop.level = 20;
  context.rollGemShop();
  assert.equal(context.G.player.gemShop.items.length, 20);
  assert.ok(context.G.player.gemShop.items.every((item) => item.lv === 10));
});

test('金幣足夠時升級商店並立即重刷，金幣不足時維持原狀', () => {
  const context = loadGameContext();
  context.wpick = (pairs) => pairs[0][0];
  context.G.player.gold = context.gemShopUpgradeCost(1);
  context.G.player.gemShop.items = [{ type: 'garnet', lv: 1, sold: false }];
  assert.equal(context.upgradeGemShop(), null);
  assert.equal(context.G.player.gemShop.level, 2);
  assert.equal(context.G.player.gold, 0);
  assert.equal(context.G.player.gemShop.items.length, 5);

  assert.match(context.upgradeGemShop(), /金幣不足/);
  assert.equal(context.G.player.gemShop.level, 2);
});
