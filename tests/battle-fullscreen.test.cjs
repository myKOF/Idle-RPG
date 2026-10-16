'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = fs.readFileSync(path.join(__dirname, '../js/ui.js'), 'utf8');

function setup() {
  const classes = new Set();
  const shell = { classList: {
    contains: name => classes.has(name),
    toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
  } };
  const button = { attrs: {}, textContent: '全螢幕', focusCount: 0,
    setAttribute(name, value) { this.attrs[name] = value; },
    focus() { this.focusCount++; }
  };
  const events = [];
  const context = vm.createContext({
    $id: id => ({ 'ui-shell': shell, 'btn-battle-fullscreen': button }[id]),
    window: { dispatchEvent: event => events.push(event.type) }, Event: class { constructor(type) { this.type = type; } },
    closeTopmostModalOrOverlay: () => false,
    GameMenu: { handleEscape() { context.menuCount++; return true; } }, menuCount: 0
  });
  vm.runInContext(ui.slice(ui.indexOf('function setBattleFullscreen('), ui.indexOf('function initUI()')), context);
  const esc = ui.match(/window\.addEventListener\('keydown', function \(e\) \{([\s\S]*?)\n    \}\);/);
  context.escape = vm.runInContext('(function(e) {' + esc[1] + '})', context);
  return { context, shell, button, events };
}

test('戰鬥區切換可還原、更新無障礙狀態並通知既有 resize 路徑', () => {
  const { context, shell, button, events } = setup();
  context.setBattleFullscreen(true);
  assert.equal(shell.classList.contains('battle-fullscreen'), true);
  assert.equal(button.textContent, '還原');
  assert.equal(button.attrs['aria-pressed'], 'true');
  context.setBattleFullscreen(false);
  assert.equal(shell.classList.contains('battle-fullscreen'), false);
  assert.equal(button.textContent, '全螢幕');
  assert.equal(button.attrs['aria-pressed'], 'false');
  assert.deepEqual(events, ['resize', 'resize']);
  assert.equal(button.focusCount, 2);
});

test('Esc 還原戰鬥區且不開遊戲菜單，重複按鍵不二次觸發', () => {
  const { context, shell } = setup();
  let prevented = 0;
  const event = { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() {} };
  context.setBattleFullscreen(true);
  context.escape(event);
  assert.equal(shell.classList.contains('battle-fullscreen'), false);
  assert.equal(context.menuCount, 0);
  assert.equal(prevented, 1);
  context.escape({ ...event, repeat: true });
  assert.equal(context.menuCount, 0);
  context.escape(event);
  assert.equal(context.menuCount, 1);
});

test('戰鬥全螢幕中開啟彈窗時，Esc 先關最上層再還原版面', () => {
  const { context, shell } = setup();
  context.setBattleFullscreen(true);
  context.closeTopmostModalOrOverlay = () => true;
  context.escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.classList.contains('battle-fullscreen'), true);
  assert.equal(context.menuCount, 0);
  context.closeTopmostModalOrOverlay = () => false;
  context.escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.classList.contains('battle-fullscreen'), false);
});
