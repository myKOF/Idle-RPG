const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} } };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: { books: { fireRes: 1 }, essence: 5 },
    factory: { stats: { enchanted: 0 } }
  };
  context.markStatsDirty = () => {};
  return context;
}

test('空附魔欄的裝備可以正常手動附魔', () => {
  const context = loadGameContext();
  const item = { slot: 'chest', rarity: 1, level: 20, affixes: [], enchants: [] };

  assert.equal(context.manualEnchant(item, 'fireRes'), null);
  assert.equal(item.enchants.length, 1);
  assert.equal(context.G.player.books.fireRes, 0);
  assert.equal(context.G.player.essence, 0);
});

test('副武器與第二戒指沿用武器／戒指的附魔類別', () => {
  const context = loadGameContext();
  assert.equal(context.enchantCatForType('weapon2'), 'atk');
  assert.equal(context.enchantCatForType('ring2'), 'atk');
});
