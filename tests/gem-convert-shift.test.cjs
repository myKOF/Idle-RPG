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
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
    closest() { return null; }
  };
}

function loadUi() {
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
    location: { reload() {} },
    confirm() { return true; }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return { context, elements };
}

test('Shift+left pool action adds exactly one gem and can create a new slot', () => {
  const { context } = loadUi();
  const slots = [{ type: 'ruby', lv: 1, n: 3 }];

  const existing = context.adjustGemConvertPool(slots, 'ruby', 1, 10, true, 1000, 9);
  assert.equal(existing.ok, true);
  assert.equal(existing.amount, 1);
  assert.equal(existing.slots[0].n, 4);
  assert.equal(slots[0].n, 3);

  const created = context.adjustGemConvertPool(slots, 'opal', 2, 10, true, 1000, 9);
  assert.equal(created.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(created.slots)), [
    { type: 'ruby', lv: 1, n: 3 },
    { type: 'opal', lv: 2, n: 1 }
  ]);
});

test('Shift+left grid action removes exactly one gem and removes an empty slot', () => {
  const { context } = loadUi();
  const slots = [{ type: 'ruby', lv: 1, n: 2 }, { type: 'opal', lv: 2, n: 1 }];

  const decremented = context.removeGemConvertSlot(slots, 0, true);
  assert.equal(decremented.ok, true);
  assert.equal(decremented.amount, 1);
  assert.equal(decremented.slots[0].n, 1);

  const removed = context.removeGemConvertSlot(decremented.slots, 0, true);
  assert.equal(removed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(removed.slots)), [
    { type: 'opal', lv: 2, n: 1 }
  ]);
});

test('gem conversion info displays the Shift+left shortcut', () => {
  const { context, elements } = loadUi();
  context.G = { player: { gems: { ruby: { 1: 1 } }, fusedGems: [] } };
  context.UI.convertSlots = [];
  context.renderGemConvert();

  const info = elements.get('gconv-info');
  assert.match(info.textContent + info.innerHTML, /Shift\+左鍵：單顆放入／取下/);
});
