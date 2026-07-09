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

function item(id, rarity, locked = false) {
  return { id, rarity, locked, sockets: [], affixes: [], level: 1, slot: 'weapon' };
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
      item('locked-rare', 2, true)
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
