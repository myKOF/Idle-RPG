const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('洗煉精華消耗符合神話、創世與神鑄創世規則', () => {
  const context = loadGameContext();
  assert.equal(context.rerollCost({ rarity: 6, level: 50 }).essence, 9);
  assert.equal(context.rerollCost({ rarity: 7, level: 50 }).essence, 14);
  assert.equal(context.rerollCost({ rarity: 8, level: 50 }).essence, 20);
});

test('其他品質洗煉精華消耗維持原本公式', () => {
  const context = loadGameContext();
  assert.equal(context.rerollCost({ rarity: 0, level: 50 }).essence, 1);
  assert.equal(context.rerollCost({ rarity: 5, level: 50 }).essence, 6);
});

test('洗煉精華消耗依裝備等級除數縮放並無條件捨去', () => {
  const context = loadGameContext();
  assert.equal(context.REROLL_ESSENCE_LEVEL_DIVISOR, 50);
  assert.equal(context.rerollCost({ rarity: 0, level: 49 }).essence, 0);
  assert.equal(context.rerollCost({ rarity: 0, level: 50 }).essence, 1);
  assert.equal(context.rerollCost({ rarity: 6, level: 75 }).essence, 13);
  assert.equal(context.rerollCost({ rarity: 7, level: 100 }).essence, 28);
  assert.equal(context.rerollCost({ rarity: 9, level: 50 }).essence, 27);
});
