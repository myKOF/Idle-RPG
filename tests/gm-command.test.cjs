const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    id: '',
    value: '',
    textContent: '',
    innerHTML: '',
    style: {},
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, handler) { this.listeners = this.listeners || {}; this.listeners[type] = handler; },
    focus() { this.focused = true; },
    setAttribute() {},
    removeAttribute() {}
  };
}

function loadGMContext(hostname) {
  const root = path.resolve(__dirname, '..');
  const body = makeElement('body');
  const document = {
    body,
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    createElement(tagName) { return makeElement(tagName); },
    getElementById() { return null; }
  };
  const context = {
    console,
    document,
    location: { hostname },
    window: null,
    G: { player: { gold: 100, scrap: 10, essence: 10, dust: 10, books: { fire: 3 } }, inventory: [], factory: { parts: [] } },
    ENCHANTS: { fire: { name: '火焰附魔' } },
    GEM_TYPES: { ruby: {} },
    GEM_FORGE_MAX_LEVEL: 10,
    UI: { dirty: {} }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/gm.js'), 'utf8'), context, { filename: 'js/gm.js' });
  return { context, document, body };
}

test('外部環境不會初始化 GM 輸入框或鍵盤事件', () => {
  const { context, document, body } = loadGMContext('game.example.com');
  context.initGM();
  assert.equal(document.listeners.keydown, undefined);
  assert.equal(body.children.length, 0);
});

test('本機 GM Enter/Escape 行為符合需求', () => {
  const { context, document, body } = loadGMContext('localhost');
  context.initGM();
  assert.equal(typeof document.listeners.keydown, 'function');
  assert.equal(body.children.length, 1);
  const panel = body.children[0];
  const input = panel.children[0];
  const event = (key) => ({ key, preventDefault() {}, stopPropagation() {} });

  document.listeners.keydown(event('Enter'));
  assert.equal(panel.style.display, 'block');
  input.value = 'gold 100';
  input.listeners.keydown(event('Enter'));
  assert.equal(context.G.player.gold, 200);
  assert.equal(panel.style.display, 'block');
  assert.equal(input.value, 'gold 100');
  input.listeners.keydown(event('Escape'));
  assert.equal(panel.style.display, 'none');
});

test('金幣與材料允許負數扣減，但物品負數不會發放', () => {
  const { context, body } = loadGMContext('localhost');
  context.initGM();
  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  input.value = 'gold -40';
  input.listeners.keydown(event);
  assert.equal(context.G.player.gold, 60);

  input.value = 'mat scrap -5';
  input.listeners.keydown(event);
  assert.equal(context.G.player.scrap, 5);

  input.value = 'book fire -2';
  input.listeners.keydown(event);
  assert.equal(context.G.player.books.fire, 3);
  assert.equal(body.children[0].children[1].className, 'gm-status bad');
});
