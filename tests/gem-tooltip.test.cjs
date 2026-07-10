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
    addEventListener() {},
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

function makeGemInventory(gemTypes) {
  const gems = {};
  Object.keys(gemTypes).forEach((type) => {
    gems[type] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0 };
  });
  return gems;
}

test('conversion gem inventory chips expose gem ability values in tooltip text', () => {
  const { context, elements } = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.ruby[3] = 2;
  gems.opal[4] = 1;
  context.G = { player: { gems, fusedGems: [] } };
  context.UI.convertSlots = [];
  context.document.getElementById('gconv-target').value = 'ruby';

  context.renderGemConvert();

  const html = elements.get('gconv-pool').innerHTML;
  assert.match(html, /data-tip="/);
  assert.match(html, /三級紅寶石/);
  assert.match(html, /物理攻擊 \+25/);
  assert.match(html, /四級蛋白石/);
  assert.match(html, /攻擊速度 \+9\.6%/);
});

test('一般寶石庫存顯示神鑄六階寶石並使用方形圖示', () => {
  const { context, elements } = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.garnet[6] = 1;
  context.G = { player: { gems, fusedGems: [] } };
  context.UI.convertSlots = [];

  context.renderGemConvert();

  const html = elements.get('gconv-pool').innerHTML;
  assert.match(html, /六級石榴石/);
  assert.match(html, /gem-inventory-cell/);
  assert.match(html, /gem-chip-emoji/);
  assert.match(html, /gem-chip-count/);
  assert.match(html, /gem-chip-level/);
  assert.doesNotMatch(html, /gem-chip-label/);
});

test('寶石融合素材池使用相同的方形圖示資訊', () => {
  const { context, elements } = loadGameContext();
  const gems = makeGemInventory(context.GEM_TYPES);
  gems.garnet[6] = 1;
  context.G = { player: { gems, fusedGems: [] } };
  context.UI.gemFuseSlots = [null, null];

  context.renderGemFusion();

  const html = elements.get('gfuse-pool').innerHTML;
  assert.match(html, /gem-inventory-cell/);
  assert.match(html, /gem-chip-count/);
  assert.match(html, /gem-chip-emoji/);
  assert.match(html, /gem-chip-level/);
});
