const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    style: {},
    options: [],
    parentNode: null,
    onclick: null,
    children: [],
    addEventListener() {},
    insertBefore(child) { this.children.unshift(child); child.parentNode = this; },
    removeChild(child) { this.children = this.children.filter((x) => x !== child); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    getAttribute() { return null; }
  };
}

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };

  const context = {
    console,
    setTimeout() {},
    clearTimeout() {},
    document: {
      getElementById,
      querySelectorAll() { return []; },
      addEventListener() {},
      createElement() { return makeElement(); },
      body: makeElement()
    },
    location: { reload() {} }
  };
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return context;
}

function item(id, rarity, level = 1, locked = false) {
  return { id, rarity, level, locked, sockets: [], affixes: [], slot: 'weapon' };
}

test('salvage all with legendary threshold keeps mythic genesis and locked items', () => {
  const context = loadGameContext();
  const salvaged = [];
  context.G = {
    inventory: [
      item('common', 0),
      item('legendary', 5),
      item('mythic', 6),
      item('genesis', 7),
      item('locked-rare', 2, 1, true)
    ]
  };
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };
  context.flog = () => {};

  context.salvageAllUnlocked(5);

  assert.deepEqual(salvaged, ['common', 'legendary']);
  assert.deepEqual(Array.from(context.G.inventory, (it) => it.id), ['mythic', 'genesis', 'locked-rare']);
});

test('salvage all with level threshold only (<= 58)', () => {
  const context = loadGameContext();
  const salvaged = [];
  context.G = {
    inventory: [
      item('lv50-epic', 4, 50),
      item('lv58-legendary', 5, 58),
      item('lv60-rare', 2, 60),
      item('lv50-locked', 1, 50, true)
    ]
  };
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };
  context.flog = () => {};

  context.salvageAllUnlocked(-1, 58); // maxRarity = -1 (any), maxLevel = 58

  assert.deepEqual(salvaged, ['lv50-epic', 'lv58-legendary']);
  assert.deepEqual(Array.from(context.G.inventory, (it) => it.id), ['lv60-rare', 'lv50-locked']);
});

test('salvage all with combined rarity (<= 4 epic) and level (<= 58)', () => {
  const context = loadGameContext();
  const salvaged = [];
  context.G = {
    inventory: [
      item('item-50-epic', 4, 50),       // Pass: rarity 4 <= 4, lv 50 <= 58
      item('item-58-rare', 2, 58),       // Pass: rarity 2 <= 4, lv 58 <= 58
      item('item-50-legendary', 5, 50),  // Fail: rarity 5 > 4
      item('item-60-epic', 4, 60),       // Fail: lv 60 > 58
      item('item-50-locked-rare', 2, 50, true) // Fail: locked
    ]
  };
  context.doSalvage = (it) => {
    salvaged.push(it.id);
    return { scrap: 1 };
  };
  context.flog = () => {};

  context.salvageAllUnlocked(4, 58); // maxRarity = 4 (epic), maxLevel = 58

  assert.deepEqual(salvaged, ['item-50-epic', 'item-58-rare']);
  assert.deepEqual(Array.from(context.G.inventory, (it) => it.id), ['item-50-legendary', 'item-60-epic', 'item-50-locked-rare']);
});
