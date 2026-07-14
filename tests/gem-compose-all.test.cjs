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
  return context;
}

function makeGemInventory(gemTypes) {
  const gems = {};
  Object.keys(gemTypes).forEach((type) => {
    gems[type] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  });
  return gems;
}

test('寶石合成選單提供全部類型寶石，且不會混合不同種類', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(ui, /fillGemTypeSelect\(\$id\('fuse-type'\), true\)/);
  assert.match(ui, /GEM_TYPE_ALL/);
  assert.match(index, /id="fuse-type"/);

  const context = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.ruby[1] = 2;
  gems.sapphire[1] = 2;
  context.G = { player: { gold: context.FUSE_GOLD_COST[1], gems } };

  assert.equal(context.composeGems(context.GEM_TYPE_ALL, 1), null);
  assert.equal(gems.ruby[1], 0);
  assert.equal(gems.ruby[2], 1);
  assert.equal(gems.sapphire[1], 2);
  assert.equal(gems.sapphire[2], 0);
});

test('寶石合成選單將全部類型寶石置頂、標黃並預設選中', () => {
  const root = path.resolve(__dirname, '..');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const fillBody = ui.match(/function fillGemTypeSelect\(sel, includeAll\) \{([\s\S]*?)\n\}/);
  assert.ok(fillBody, '找不到 fillGemTypeSelect');

  const body = fillBody[1];
  const allOption = body.indexOf('GEM_TYPE_ALL');
  const gemTypeLoop = body.indexOf('for (var t in GEM_TYPES)');
  assert.ok(allOption >= 0, '找不到全部類型寶石選項');
  assert.ok(allOption < gemTypeLoop, '全部類型寶石應排在所有寶石種類前面');
  assert.match(body, /style="color:#f5c542;font-weight:bold"/);
  assert.match(body, /selected>💎 全部類型寶石/);
});

test('全部類型寶石全部合成時會逐種類處理可合成庫存', () => {
  const context = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.ruby[1] = 4;
  gems.sapphire[1] = 2;
  context.G = { player: { gold: context.FUSE_GOLD_COST[1] * 3, gems } };

  let made = 0;
  let err = null;
  while (made < 500 && !(err = context.composeGems(context.GEM_TYPE_ALL, 1))) made++;

  assert.equal(err, '沒有任何種類的寶石足夠合成');
  assert.equal(made, 3);
  assert.equal(gems.ruby[1], 0);
  assert.equal(gems.ruby[2], 2);
  assert.equal(gems.sapphire[1], 0);
  assert.equal(gems.sapphire[2], 1);
});
