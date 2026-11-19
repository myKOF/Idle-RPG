'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/ui.js'), 'utf8');
const shortcut = source.slice(source.indexOf('function miniShortcutEnabled()'), source.indexOf('/* ---- 分頁標題即時戰況'));
function setup(options = {}) {
  const calls = [];
  const context = vm.createContext({
    isInternalServer: () => !!options.internal, isGMHost: () => !!options.gm,
    document: { hasFocus: () => options.focus !== false,
      querySelectorAll: () => options.modal ? [{ getClientRects: () => [{}] }] : [] },
    MINI: {}, openMiniWindow: () => calls.push('open'),
    StartMenu: { isActive: () => !!options.menu }, IntroPlayer: { isPlaying: () => !!options.intro }
  });
  vm.runInContext(shortcut, context);
  function press(extra = {}) {
    const event = { key: 'Enter', target: { tagName: 'BODY' }, preventDefault() { calls.push('prevent'); }, ...extra };
    context.handleMiniShortcut(event);
  }
  return { context, calls, press };
}
test('外部正式與 Demo 使用相同的焦點 Enter 入口', () => {
  for (const edition of ['full', 'demo']) {
    const h = setup(); h.context.GAME_EDITION = edition; h.press();
    assert.deepEqual(h.calls, ['prevent', 'open']);
  }
});
test('內測／GM、失焦、選單、序章、對話框不攔截 Enter', () => {
  for (const options of [{ internal: true }, { gm: true }, { focus: false }, { menu: true }, { intro: true }, { modal: true }]) {
    const h = setup(options); h.press(); assert.deepEqual(h.calls, [], JSON.stringify(options));
  }
});
test('保留輸入、組字、長按及帶修飾鍵的 Enter 行為', () => {
  const ignored = [{ key: 'Escape' }, { repeat: true }, { isComposing: true }, { keyCode: 229 },
    { defaultPrevented: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
    ...['INPUT', 'TEXTAREA', 'SELECT'].map(tagName => ({ target: { tagName } })),
    { target: { isContentEditable: true } }];
  const h = setup(); ignored.forEach(h.press); assert.deepEqual(h.calls, []);
  h.press({ target: { tagName: 'BUTTON' } }); assert.deepEqual(h.calls, ['prevent', 'open']);
});
test('桌面入口先選原生視窗並停止更新計時器，不呼叫瀏覽器 PiP', async () => {
  const fn = source.slice(source.indexOf('function openMiniWindow()'), source.indexOf('function miniShortcutEnabled()'));
  const calls = []; let closed;
  const context = vm.createContext({
    MINI: {}, MINI_CSS: 'css', MINI_HTML: 'html', STR: id => '#' + id,
    miniShortcutEnabled: () => true, miniSnapshot: () => ({ stage: 'live' }), renderMiniWindow() {},
    setInterval: () => 9, clearInterval: id => calls.push(['clear', id]), blog() {},
    window: { ApexHost: { mini: { onClosed: fn => { closed = fn; }, open: async initial => calls.push(initial) } } }
  });
  vm.runInContext(fn, context); context.openMiniWindow(); context.openMiniWindow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1); assert.equal(calls[0].restoreLabel, '#2072');
  assert.equal(calls[0].enterShortcut, true); assert.equal(context.MINI.desktop, true);
  closed(); assert.equal(context.MINI.desktop, false); assert.equal(context.MINI.timer, null);
  assert.deepEqual(calls[1], ['clear', 9]);
});

test('迷你視窗 Enter 只在已允許版本且有焦點時還原，Esc 與按鈕仍可用', async () => {
  const view = fs.readFileSync(require.resolve('../js/mini-monitor.js'), 'utf8');
  for (const enterShortcut of [true, false]) {
    let keydown, focused = true, restores = 0;
    const nodes = {};
    const node = () => ({ style: {}, appendChild() {}, prepend() {} });
    const document = { body: node(), head: node(),
      createElement: node, createTextNode: () => node(), hasFocus: () => focused,
      getElementById(id) { return nodes[id] ??= node(); },
      addEventListener(name, fn) { if (name === 'keydown') keydown = fn; }
    };
    const context = vm.createContext({ document, window: { ApexMini: {
      initial: async () => ({ css: '', html: '', enterShortcut, snapshot: { logs: [] } }),
      restore: () => restores++, onUpdate() {}, ready() {}
    } } });
    vm.runInContext(view, context); await new Promise(resolve => setImmediate(resolve));
    const key = name => keydown({ key: name, preventDefault() {} });
    focused = false; key('Enter'); key('Escape'); assert.equal(restores, 0);
    focused = true; key('Enter'); assert.equal(restores, enterShortcut ? 1 : 0);
    key('Escape'); assert.equal(restores, enterShortcut ? 2 : 1);
  }
});
