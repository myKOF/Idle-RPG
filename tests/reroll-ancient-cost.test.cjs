const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('太古精華洗煉消耗依裝備品質（普通~傳說 1、神話 2、創世 3、神鑄創世 4）', () => {
  const c = loadContext();
  // vm-context 陣列原型與 host 不同，改以值比較（JSON）
  assert.equal(JSON.stringify(c.REROLL_ANCIENT_ESSENCE_COST), JSON.stringify([1, 1, 1, 1, 1, 1, 2, 3, 4]));
  assert.equal(c.rerollAncientEssenceCostFor(0), 1); // 普通
  assert.equal(c.rerollAncientEssenceCostFor(5), 1); // 傳說
  assert.equal(c.rerollAncientEssenceCostFor(6), 2); // 神話
  assert.equal(c.rerollAncientEssenceCostFor(7), 3); // 創世
  assert.equal(c.rerollAncientEssenceCostFor(8), 4); // 神鑄創世
});

test('rerollAncientEssenceCostFor 邊界安全（越界稀有度不崩、夾在有效範圍）', () => {
  const c = loadContext();
  assert.equal(c.rerollAncientEssenceCostFor(-1), 1);   // 夾到最低
  assert.equal(c.rerollAncientEssenceCostFor(99), 4);   // 夾到最高
  assert.equal(c.rerollAncientEssenceCostFor(undefined), 1);
});

test('item.js 洗煉消耗改依裝備品質（傳入 it、非寫死 1）', () => {
  const item = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');
  assert.match(item, /function rerollAncientEssenceCost\(it\)/);
  assert.match(item, /rerollAncientEssenceCostFor\(it\.rarity\)/);
  // 兩處呼叫都傳入 it
  const calls = item.match(/rerollAncientEssenceCost\(it\)/g) || [];
  assert.ok(calls.length >= 2, '兩處洗煉呼叫都應傳入 it');
  // 單詞條洗煉 UI 不再寫死 1 顆太古精華
  assert.doesNotMatch(item, /res-icon">1<\/span>/);
});
