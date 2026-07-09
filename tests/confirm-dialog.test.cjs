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
    location: { reload() {} }
  };
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/ui.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  return { context, elements };
}

test('ui confirmations use shared custom modal instead of native confirm', () => {
  const ui = fs.readFileSync(path.resolve(__dirname, '..', 'js/ui.js'), 'utf8');

  assert.doesNotMatch(ui, /\bconfirm\s*\(/);
  assert.match(ui, /function showConfirmDialog/);
  assert.match(ui, /showConfirmDialog\('確定刪除此融合技/);
  assert.match(ui, /showConfirmDialog\('確定拆解「'/);
  assert.match(ui, /showConfirmDialog\('確定要重新開局嗎/);
  assert.match(ui, /title: '融合技刪除確認'/);
  assert.match(ui, /title: '寶石拆解確認'/);
  assert.match(ui, /title: '重新開局確認'/);
});

test('confirm modal actions are centered and evenly spaced', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '..', 'css/style.css'), 'utf8');

  assert.match(css, /\.confirm-actions\s*{[\s\S]*display:\s*grid/);
  assert.match(css, /\.confirm-actions\s*{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(72px,\s*96px\)\)/);
  assert.match(css, /\.confirm-actions\s*{[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.confirm-actions\s*{[\s\S]*column-gap:\s*80px/);
});

test('shared confirm modal shows message and runs callback only on confirm', () => {
  const { context, elements } = loadGameContext();
  let confirmed = 0;

  context.showConfirmDialog('第一行\n第二行', () => { confirmed += 1; }, { title: '寶石拆解確認' });

  assert.equal(elements.get('confirm-modal').style.display, 'flex');
  assert.equal(elements.get('confirm-title').textContent, '寶石拆解確認');
  assert.equal(elements.get('confirm-message').textContent, '第一行\n第二行');
  assert.equal(confirmed, 0);

  elements.get('confirm-cancel').onclick();
  assert.equal(elements.get('confirm-modal').style.display, 'none');
  assert.equal(confirmed, 0);

  context.showConfirmDialog('再次確認', () => { confirmed += 1; });
  elements.get('confirm-ok').onclick();
  assert.equal(elements.get('confirm-modal').style.display, 'none');
  assert.equal(confirmed, 1);
});
