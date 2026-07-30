const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const EXPECTED_COUNTS = [
  [1, 0, 1],
  [2, 1, 1],
  [2, 1, 1],
  [3, 1, 2],
  [4, 2, 3],
  [5, 2, 4],
  [6, 2, 5],
  [7, 3, 6],
  [8, 3, 6]
];

test('rarity table uses the specified fixed affix, enchant, and socket counts', () => {
  const context = loadGameContext();

  assert.equal(context.RARITIES.length, EXPECTED_COUNTS.length);
  context.RARITIES.forEach((rarity, index) => {
    assert.equal(rarity.affix[0], EXPECTED_COUNTS[index][0]);
    assert.equal(rarity.affix[1], EXPECTED_COUNTS[index][0]);
    assert.equal(rarity.enchants, EXPECTED_COUNTS[index][1]);
    assert.equal(rarity.sockets, EXPECTED_COUNTS[index][2]);
  });
});

test('generated equipment has a fixed number of affixes and the configured sockets', () => {
  const context = loadGameContext();

  context.RARITIES.forEach((rarity, index) => {
    const item = context.makeEquipment(100, { rarity: index, level: 100, slot: 'chest' });
    assert.equal(item.affixes.length, EXPECTED_COUNTS[index][0], rarity.name);
    assert.equal(item.sockets.length, EXPECTED_COUNTS[index][2], rarity.name);
    assert.equal(context.enchantCapFor(item), EXPECTED_COUNTS[index][1], rarity.name);
  });
});
