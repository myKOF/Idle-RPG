'use strict';
const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function setup() {
  const nodes = {}, handlers = {}, events = [], timers = [];
  const doc = { activeElement: null, getElementById: id => nodes[id] || null, addEventListener(name, fn) { handlers[name] = fn; } };
  for (const id of ['game-menu-title', 'game-menu', 'settings-modal', 'game-menu-reload', 'game-menu-exit', 'game-menu-save', 'game-menu-settings', 'game-menu-close', 'settings-modal-close', 'game-menu-status']) {
    nodes[id] = { style: { display: 'none' }, disabled: false, textContent: '', tabIndex: 0, isConnected: true, listeners: {},
      setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; },
      focus() { doc.activeElement = this; }, getClientRects: () => [1], querySelectorAll: () => [] };
  }
  nodes['game-menu'].querySelectorAll = () => ['reload', 'exit', 'save', 'settings', 'close'].map(n => nodes['game-menu-' + n]);
  nodes['settings-modal'].querySelectorAll = () => [nodes['settings-modal-close']];
  const ctx = { document: doc, Promise, setTimeout(fn) { timers.push(fn); },
    window: { close() { events.push('close'); }, closed: false },
    location: { reload() { events.push('reload'); }, replace(url) { events.push(url); } },
    closeTopmostModalOrOverlay() { return false; }, refreshSettingsPanel() { events.push('refresh-settings'); }, renderSaveList() {},
    WorkerBridge: { saveAutoNow: () => Promise.resolve(true), stop() { events.push('stop'); } } };
  vm.createContext(ctx); vm.runInContext(readExpanded(path.join(root, 'js/game-menu.js')), ctx);
  ctx.GameMenu.init(); return { ctx, nodes, handlers, events, timers, doc };
}

test('Esc開關菜單、設置彈窗返回菜單，保留原焦點', () => {
  const s = setup(); const original = { focus() { s.events.push('restore-focus'); } }; s.doc.activeElement = original;
  s.ctx.GameMenu.handleEscape(); assert.equal(s.nodes['game-menu'].style.display, 'flex');
  assert.equal(s.doc.activeElement, s.nodes['game-menu-title']);
  s.ctx.GameMenu.openSettings(); assert.equal(s.nodes['settings-modal'].style.display, 'flex');
  assert.equal(s.nodes['game-menu'].style.display, 'none');
  s.ctx.GameMenu.handleEscape(); assert.equal(s.nodes['settings-modal'].style.display, 'none');
  assert.equal(s.nodes['game-menu'].style.display, 'flex');
  s.ctx.GameMenu.handleEscape(); assert.ok(s.events.includes('restore-focus'));
});

test('重啟先保存暫停快照再刷新，不呼叫重新開局／寫入新角色', async () => {
  const s = setup(); let finish;
  s.ctx.WorkerBridge.saveAutoNow = () => new Promise(resolve => { finish = resolve; });
  const action = s.ctx.GameMenu.runAction('reload'); await Promise.resolve();
  assert.deepEqual(s.events, []); finish(true);
  assert.equal(await action, true); assert.deepEqual(s.events, ['reload']);
});

test('離開先等落地，等待時重複按鍵／點擊不能關閉或重複保存', async () => {
  const s = setup(); let resolve, saves = 0;
  s.ctx.WorkerBridge.saveAutoNow = () => { saves++; return new Promise(r => { resolve = r; }); };
  s.ctx.GameMenu.open(); const action = s.ctx.GameMenu.runAction('exit'); await Promise.resolve();
  assert.equal(saves, 1); assert.deepEqual(s.events, []); s.ctx.GameMenu.handleEscape();
  assert.equal(s.nodes['game-menu'].style.display, 'flex');
  assert.equal(await s.ctx.GameMenu.runAction('exit'), false);
  resolve(true); assert.equal(await action, true); assert.deepEqual(s.events, ['stop', 'close']);
  s.timers[0](); assert.equal(s.events.at(-1), 'about:blank');
});

test('離開存檔失敗保留遊戲、解除鎖定，允許重試', async () => {
  const s = setup(); s.ctx.WorkerBridge.saveAutoNow = () => Promise.reject(Error('disk full'));
  assert.equal(await s.ctx.GameMenu.runAction('exit'), false); assert.deepEqual(s.events, []);
  assert.match(s.nodes['game-menu-status'].textContent, /disk full/); assert.equal(s.nodes['game-menu-exit'].disabled, false);
  s.ctx.WorkerBridge.saveAutoNow = () => Promise.resolve(true);
  assert.equal(await s.ctx.GameMenu.runAction('save'), true); assert.match(s.nodes['game-menu-status'].textContent, /自動存檔/);
});

test('Tab與Shift+Tab循環，避免焦點離開對話框', () => {
  const s = setup(); s.ctx.GameMenu.open(); s.nodes['game-menu-close'].focus();
  let prevented = 0;
  s.handlers.keydown({ key: 'Tab', preventDefault() { prevented++; } });
  assert.equal(s.doc.activeElement, s.nodes['game-menu-reload']);
  s.handlers.keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(s.doc.activeElement, s.nodes['game-menu-close']); assert.equal(prevented, 2);
});
test('菜單與設置共用暫停，返回菜單不恢復，完全關閉才恢復；預設焦點不在重啟', () => {
  const s=setup(), clock=[], worker=[];
  s.ctx.GameClock={setPaused:v=>clock.push(v)};
  s.ctx.WorkerBridge.setMenuPaused=v=>worker.push(v);
  s.ctx.GameMenu.open(); assert.equal(s.doc.activeElement,s.nodes['game-menu-title']);
  s.ctx.GameMenu.openSettings();s.ctx.GameMenu.closeSettings();assert.deepEqual(clock,[true]);assert.deepEqual(worker,[true]);
  s.ctx.GameMenu.close();assert.deepEqual(clock,[true,false]);assert.deepEqual(worker,[true,false]);
});

test('主側欄移除設定，設定區位於獨立dialog內，菜單四項順序固定', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  assert.doesNotMatch(html.match(/<nav id="tabs"[\s\S]*?<\/nav>/)[0], /data-tab="settings"/);
  assert.match(html, /id="settings-modal"[\s\S]*?role="dialog"[\s\S]*?id="tab-settings" class="system-settings-content"/);
  const menu = html.match(/id="game-menu"[\s\S]*?id="game-menu-status"/)[0];
  const order = [...menu.matchAll(/id="game-menu-(reload|exit|save|settings)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['reload', 'exit', 'save', 'settings']);
});
