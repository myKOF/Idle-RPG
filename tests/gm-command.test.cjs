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
    TOWER_TRIAL_MAX_FLOOR: 50,
    TOWER_HELL_MAX_FLOOR: 100,
    TOWER_PURGATORY_MAX_FLOOR: 150,
    TOWER_MAX_FLOOR: 150,
    ENCHANTS: { fire: { name: '火焰附魔' } },
    GEM_TYPES: { ruby: {} },
    GEM_FORGE_MAX_LEVEL: 10,
    UI: { dirty: {} }
  };
  context.G.tower = { highest: 0, active: false };
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

test('三個高塔 GM 指令可一鍵推進到各塔區終點', () => {
  const { context, body } = loadGMContext('localhost');
  context.initGM();
  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  input.value = 'tower_trial_clear';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 50);

  input.value = 'tower_hell_clear';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 100);

  input.value = 'tower_purgatory_clear';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 150);
  assert.equal(context.UI.dirty.tower, true);
  assert.equal(context.UI.dirty.header, true);
});

test('高塔戰鬥中不允許執行一鍵通關', () => {
  const { context, body } = loadGMContext('localhost');
  context.initGM();
  context.G.tower.highest = 20;
  context.G.tower.active = true;
  const input = body.children[0].children[0];
  input.value = 'tower_purgatory_clear';
  input.listeners.keydown({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
  assert.equal(context.G.tower.highest, 20);
  assert.equal(body.children[0].children[1].className, 'gm-status bad');
});

test('三個高塔 reset GM 指令只清除指定塔區進度', () => {
  const { context, body } = loadGMContext('localhost');
  context.initGM();
  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  context.G.tower.highest = 150;
  input.value = 'tower_purgatory_reset';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 100);

  input.value = 'tower_hell_reset';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 50);

  input.value = 'tower_trial_reset';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 0);
});

test('tower_jump 指定下一個高塔樓層，並將之前樓層視為通關', () => {
  const { context, body } = loadGMContext('localhost');
  context.initGM();
  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  input.value = 'tower_jump 101';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 100);

  input.value = 'tower_jump 150';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 149);

  input.value = 'tower_jump 151';
  input.listeners.keydown(event);
  assert.equal(context.G.tower.highest, 149);
  assert.equal(body.children[0].children[1].className, 'gm-status bad');
});
