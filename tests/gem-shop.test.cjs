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
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { gold: 0, gems: {}, gemShop: { level: 1, items: [] } } };
  context.randomGemType = () => 'garnet';
  context.MERCHANT_CATEGORY_TABLE = Array.from({ length: 20 }, () => [['gem', 100]]);
  context.MYSTERY_MERCHANT_OPEN = true;
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
  // CSV: config/CSV/Store.csv。
  assert.equal(context.gemShopPrice(1), 10000);
  assert.equal(context.gemShopPrice(6), 50000000);
  assert.equal(context.gemShopPrice(10), 1000000000000);
});

/* 期望值＝目前設定算出來的實際值（js/formula.js gemShopUpgradeCost）。

   這裡刻意寫死數字，不重寫一次公式——重寫公式的話，公式本身被改動時測試會跟著一起變，
   等於什麼都沒守到。測試是唯一該釘住數值的地方（AI_RULES.md 9.1 的例外）。

   這條原本長期是紅的：公式的指數改過，但期望值沒有同步更新。 */
test('商店升級費用與等級上限正確', () => {
  const context = loadGameContext();
  assert.equal(context.gemShopUpgradeCost(1), 4100000);
  assert.equal(context.gemShopUpgradeCost(5), 1118133988.7498949);
  assert.equal(context.gemShopUpgradeCost(10), 12649210640.673517);
  assert.equal(context.gemShopUpgradeCost(19), 119590851414.98192);
  assert.equal(context.gemShopUpgradeCost(20), 0);
});

test('手動刷新扣一張券，無券保留原貨，商品上限四十件', () => {
  const context = loadGameContext();
  const player = context.G.player;
  player.consumables = { mystery_invitation: 1 };
  context.GEM_SHOP_COUNT_TABLE[0] = [[60, 100]];
  assert.equal(context.refreshGemShop(), null);
  assert.equal(player.consumables.mystery_invitation, 0);
  assert.equal(player.gold, 0);
  assert.equal(player.gemShop.items.length, 40);
  const stock = player.gemShop.items;
  assert.match(context.refreshGemShop(), /邀請券/);
  assert.equal(player.gemShop.items, stock);
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
