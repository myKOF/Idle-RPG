'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../electron/mini-window.cjs');

function setup(throttling = true) {
  const windows = [], calls = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.visible = false;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        mainFrame: {}, send: (...args) => calls.push(args),
        setWindowOpenHandler(fn) { this.openHandler = fn; },
        getBackgroundThrottling: () => throttling,
        setBackgroundThrottling: value => { throttling = value; }
      });
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    focus() { this.focused = true; }
    loadFile() { return new Promise((resolve, reject) => {
      this.loadedOnly = resolve;
      this.loaded = () => { this.miniReady(); resolve(); }; this.failed = reject;
    }); }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const owner = new Window({}); owner.show();
  const monitor = create({ owner, BrowserWindow: Window });
  return { owner, windows, calls, monitor, throttling: () => throttling };
}

test('載入完成才隱藏主窗；迷你置頂、還原時恢復原節流設定且不改主窗尺寸', async () => {
  const env = setup();
  const initial = { title: 'mini', snapshot: {} };
  const opening = env.monitor.open(initial), mini = env.windows[1];
  assert.equal(env.owner.visible, true);
  assert.equal(mini.visible, false);
  assert.equal(mini.options.alwaysOnTop, true);
  assert.equal(mini.options.webPreferences.sandbox, true);
  assert.equal(env.monitor.initial(), initial);
  mini.loaded(); await opening;
  assert.equal(env.owner.visible, false);
  assert.equal(mini.visible, true);
  assert.equal(env.throttling(), false);
  env.monitor.update({ stage: 'latest' });
  assert.deepEqual(env.calls.at(-1), ['mini:update', { stage: 'latest' }]);
  env.monitor.restore();
  assert.equal(mini.isDestroyed(), true);
  assert.equal(env.owner.visible, true);
  assert.equal(env.owner.focused, true);
  assert.equal(env.throttling(), true);
  assert.equal(env.calls.at(-1)[0], 'mini:closed');
});

test('HTML 載入但 renderer 尚未初始化時，主窗繼續可見', async () => {
  const env = setup();
  const opening = env.monitor.open({}), mini = env.windows[1];
  mini.loadedOnly();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.owner.visible, true);
  assert.equal(mini.visible, false);
  env.monitor.ready(); await opening;
  assert.equal(env.owner.visible, false);
  env.monitor.restore();
});

test('重複開啟共用載入與單一視窗，還原後可再次開啟', async () => {
  const env = setup(false);
  const first = env.monitor.open({});
  assert.equal(env.monitor.open({}), first);
  env.windows[1].loaded(); await first;
  await env.monitor.open({});
  assert.equal(env.windows.length, 2);
  env.windows[1].destroy();
  assert.equal(env.throttling(), false, '既有背景掛機設定不得被改回 true');
  const next = env.monitor.open({});
  env.windows[2].loaded(); await next;
  env.monitor.dispose();
});

test('載入失敗保留主窗並可重試，不會留下幽靈視窗', async () => {
  const env = setup();
  const first = env.monitor.open({});
  env.windows[1].failed(new Error('missing mini page'));
  await assert.rejects(first, /missing mini page/);
  assert.equal(env.owner.visible, true);
  assert.equal(env.windows[1].destroyed, true);
  assert.equal(env.throttling(), true);
  const next = env.monitor.open({}); env.windows[2].loaded(); await next;
  env.monitor.dispose();
});

test('迷你 renderer 結束會帶回主窗；結束遊戲只清理、不重開主窗', async () => {
  const env = setup();
  const first = env.monitor.open({}); env.windows[1].loaded(); await first;
  env.windows[1].webContents.emit('render-process-gone');
  assert.equal(env.owner.visible, true);
  const next = env.monitor.open({}); env.windows[2].loaded(); await next;
  const before = env.calls.length;
  env.monitor.dispose();
  assert.equal(env.owner.visible, false);
  assert.equal(env.throttling(), true);
  assert.equal(env.calls.length, before);
  await assert.rejects(env.monitor.open({}), /closing/);
});

test('載入中關閉或結束遊戲，遲到的載入不得隱藏主窗', async () => {
  for (const action of ['restore', 'dispose']) {
    const env = setup();
    const opening = env.monitor.open({});
    env.monitor[action](); env.windows[1].loaded();
    await assert.rejects(opening, /closed while loading/);
    assert.equal(env.owner.visible, true);
    assert.equal(env.throttling(), true);
  }
});

test('只有迷你主框架能取得初始化資料或要求恢復；禁止導覽與彈窗', async () => {
  const env = setup();
  const opening = env.monitor.open({}), mini = env.windows[1];
  const event = { sender: mini.webContents, senderFrame: mini.webContents.mainFrame };
  assert.equal(env.monitor.accepts(event), true);
  assert.equal(env.monitor.accepts({ ...event, senderFrame: {} }), false);
  assert.equal(env.monitor.accepts({ ...event, sender: env.owner.webContents }), false);
  assert.deepEqual(mini.webContents.openHandler({ url: 'https://example.com' }), { action: 'deny' });
  let blocked = false;
  mini.webContents.emit('will-navigate', { preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  mini.loaded(); await opening;
  env.monitor.restore();
  assert.equal(env.monitor.accepts(event), false);
});

test('共用渲染更新血魔量與戰況，日誌以文字顯示避免 HTML 注入', () => {
  const nodes = {};
  const document = {
    getElementById(id) { return nodes[id] ??= { style: {}, children: [], appendChild(child) { this.children.push(child); } }; },
    createTextNode(text) { return { text }; }, createElement(tag) { return { tag }; }
  };
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/mini-monitor.js'), 'utf8'), context);
  context.MiniMonitor.render(document, {
    stage: 'field', lv: 'Lv.8', pHp: 25, pMp: 50, eHp: 75,
    pHpText: '25 / 100', pMpText: '50 / 100', eHpText: '75 / 100',
    eName: 'boss', info: 'DPS 100', logs: ['<img onerror=bad()>', 'next']
  });
  assert.equal(nodes['m-stage'].textContent, 'field');
  assert.equal(nodes['m-php'].style.width, '25%');
  assert.equal(nodes['m-pmp'].style.width, '50%');
  assert.equal(nodes['m-ehp'].style.width, '75%');
  assert.deepEqual(nodes['m-log'].children, [{ text: '<img onerror=bad()>' }, { tag: 'br' }, { text: 'next' }]);
});
