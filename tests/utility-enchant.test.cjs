const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDataContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('項鏈與鞋子共有至少七種可用附魔', () => {
  const context = loadDataContext();
  const utilKeys = Object.keys(context.ENCHANTS).filter((key) => context.ENCHANTS[key].cat === 'util');
  assert.ok(utilKeys.length >= 7);
  ['loot', 'haste', 'vigor', 'clarity', 'focus', 'fortune', 'wisdom'].forEach((key) => {
    assert.ok(context.ENCHANTS[key]);
  });
  assert.equal(context.ENCHANT_SLOTS.util.includes('amulet'), true);
  assert.equal(context.ENCHANT_SLOTS.util.includes('boots'), true);
});
