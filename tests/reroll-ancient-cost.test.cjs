const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// 太古機制改版（2026-07-23）：洗煉不再消耗太古精華、不再洗出太古詞條。
// 本檔改為驗證「洗煉費用只剩金幣＋附魔精華」與舊消耗機制不復存。

function loadContext() {
  const context = { console, Math, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('洗煉費用不足訊息只檢查金幣與附魔精華', () => {
  const c = loadContext();
  c.G = { player: { gold: 0, essence: 0, ancientEssence: 0 } };
  c.getStats = () => ({ luck: 0 });
  c.markStatsDirty = () => {};
  const it = c.makeEquipment(200, { rarity: 6, level: 200 });
  const err = c.rerollItemAffixes(it);
  assert.ok(err && err.indexOf('資源不足') === 0);
  assert.doesNotMatch(err, /太古精華/);
});

test('舊太古精華洗煉消耗（常數與函式）已移除', () => {
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const item = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');
  assert.doesNotMatch(data, /REROLL_ANCIENT_ESSENCE_COST/);
  assert.doesNotMatch(formula, /rerollAncientEssenceCostFor/);
  assert.doesNotMatch(item, /rerollAncientEssenceCost/);
});
