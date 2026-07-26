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
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('洗煉精華消耗符合神話、創世與神鑄創世規則', () => {
  const context = loadGameContext();
  assert.equal(context.rerollCost({ rarity: 6, level: 1 }).essence, 9);
  assert.equal(context.rerollCost({ rarity: 7, level: 1 }).essence, 14);
  assert.equal(context.rerollCost({ rarity: 8, level: 1 }).essence, 20);
});

test('其他品質洗煉精華消耗維持原本公式', () => {
  const context = loadGameContext();
  assert.equal(context.rerollCost({ rarity: 0, level: 1 }).essence, 1);
  assert.equal(context.rerollCost({ rarity: 5, level: 1 }).essence, 6);
});
