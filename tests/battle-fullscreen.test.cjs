'use strict';
const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ui = readExpanded(path.join(__dirname, '../js/ui.js'));

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
    document: { fullscreenElement: null, documentElement: {} },
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
  assert.equal(button.attrs['data-tip'], '還原');
  context.setBattleFullscreen(false);
  assert.equal(shell.classList.contains('battle-fullscreen'), false);
  assert.equal(button.textContent, '全螢幕');
  assert.equal(button.attrs['aria-pressed'], 'false');
  assert.deepEqual(events, ['resize', 'resize']);
  assert.equal(button.focusCount, 2);
});

test('Esc 交給遊戲選單處理，戰鬥區保持全螢幕，重複按鍵不二次觸發', () => {
  const { context, shell } = setup();
  let prevented = 0;
  const event = { key: 'Escape', preventDefault() { prevented++; }, stopPropagation() {} };
  context.setBattleFullscreen(true);
  context.escape(event);
  assert.equal(shell.classList.contains('battle-fullscreen'), true);
  assert.equal(context.menuCount, 1);
  assert.equal(prevented, 1);
  context.escape({ ...event, repeat: true });
  assert.equal(context.menuCount, 1);
  context.escape(event);
  assert.equal(context.menuCount, 2);
});

test('戰鬥區全螢幕開啟彈窗時，Esc 優先關最上層，版面保持全螢幕', () => {
  const { context, shell } = setup();
  context.setBattleFullscreen(true);
  context.closeTopmostModalOrOverlay = () => true;
  context.escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.classList.contains('battle-fullscreen'), true);
  assert.equal(context.menuCount, 0);
  context.closeTopmostModalOrOverlay = () => false;
  context.escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(shell.classList.contains('battle-fullscreen'), true);
  assert.equal(context.menuCount, 1);
});

test('網頁全螢幕只鎖定 Esc，允許按鍵處理並於退出時釋放鍵盤', async () => {
  const { context } = setup();
  const calls = [];
  context.navigator = { keyboard: {
    lock: async codes => { calls.push(Array.from(codes)); },
    unlock: () => { calls.push('unlock'); }
  } };
  context.document.fullscreenElement = context.document.documentElement;
  context.syncPageFullscreenKeyboard();
  context.GameMenu.handleEscape = () => false;
  let prevented = false;
  context.escape({ key: 'Escape', preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true);
  context.document.fullscreenElement = null;
  context.syncPageFullscreenKeyboard();
  assert.deepEqual(calls, [['Escape'], 'unlock']);
  context.navigator.keyboard.lock = () => Promise.reject(new Error('permission denied'));
  context.document.fullscreenElement = context.document.documentElement;
  context.syncPageFullscreenKeyboard();
  await Promise.resolve();
});
