'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '../js/quest-guide.js'), 'utf8');
const highlightClass = 'quest-guide-highlight';

function button() {
  const classes = new Set();
  return {
    classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
    get glowing() { return classes.has(highlightClass); },
    getClientRects: () => [{}],
    matches: () => false,
    closest: () => null,
    scrollIntoView() {},
    focus() {}
  };
}

function setup() {
  let target = button();
  let observer;
  const scope = { hidden: false, querySelectorAll: () => [target] };
  const input = new Map();
  const timers = [];
  const window = {
    addEventListener(type, listener, options) {
      assert.equal(options.capture, true);
      input.set(type, listener);
    },
    removeEventListener(type, listener, capture) {
      assert.equal(capture, true);
      assert.equal(input.get(type), listener);
      input.delete(type);
    }
  };
  class MutationObserver {
    constructor(update) { this.update = update; observer = this; }
    observe(element) { assert.equal(element, scope); }
    disconnect() { this.disconnected = true; }
  }
  const context = {
    window, MutationObserver,
    document: { querySelector: () => button() },
    $id: id => id === 'tab-equip' ? scope : { classList: { contains: () => false } },
    getComputedStyle: () => ({ visibility: 'visible' }),
    closeQuestModal() {},
    switchTab() { context.QuestGuide.clearHighlight(); },
    setTimeout(callback, ms) { timers.push({ callback, ms }); return timers.length; },
    clearTimeout(id) { if (id) timers[id - 1].callback = null; }
  };
  vm.runInNewContext(script, context);
  return {
    input,
    open() { context.QuestGuide.follow({ type: 'upgradeCount' }); },
    send(type, event = {}) { input.get(type)?.({ isTrusted: true, ...event }); },
    get target() { return target; },
    get observer() { return observer; },
    replaceTarget() { target = button(); observer.update(); },
    advance(ms) { for (const timer of timers) if (timer.ms <= ms) timer.callback?.(); }
  };
}

test('任務按鈕閃爍不限時間，重繪後仍指向新的按鈕', () => {
  const page = setup();
  page.open();
  const oldTarget = page.target;
  assert.equal(oldTarget.glowing, true);
  page.advance(60_000);
  assert.equal(oldTarget.glowing, true);
  page.replaceTarget();
  assert.equal(oldTarget.glowing, false);
  assert.equal(page.target.glowing, true);
});

test('視窗內的玩家輸入會收起導引並移除監聽，重複開啟可再次提示', () => {
  const page = setup();
  for (const [type, event] of [
    ['pointerdown', { pointerType: 'mouse' }],
    ['pointerdown', { pointerType: 'touch' }],
    ['click', {}],
    ['keydown', { key: 'Tab' }],
    ['wheel', { deltaY: 100 }]
  ]) {
    page.open();
    assert.equal(page.target.glowing, true);
    page.send('click', { isTrusted: false });
    page.send('keydown', { repeat: true });
    assert.equal(page.target.glowing, true);
    page.send(type, event);
    assert.equal(page.target.glowing, false);
    assert.equal(page.observer.disconnected, true);
    assert.equal(page.input.size, 0);
  }
});
