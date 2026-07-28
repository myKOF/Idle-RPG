const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function fakeElement() {
  const listeners = Object.create(null);
  const classNames = new Set();
  const element = {
    style: {},
    className: '',
    classList: {
      add: (...names) => names.forEach((name) => classNames.add(name)),
      remove: (...names) => names.forEach((name) => classNames.delete(name)),
      toggle: (name, force) => {
        const next = force === undefined ? !classNames.has(name) : !!force;
        if (next) classNames.add(name); else classNames.delete(name);
        return next;
      },
      contains: (name) => classNames.has(name)
    },
    children: [],
    childNodes: [],
    parentNode: {
      insertBefore: () => {},
      removeChild: () => {}
    },
    addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener: () => {},
    appendChild: (child) => { element.children.push(child); element.childNodes.push(child); return child; },
    insertBefore: (child) => { element.children.push(child); element.childNodes.push(child); return child; },
    removeChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: (name, value) => { element[name] = String(value); },
    getAttribute: (name) => element[name] === undefined ? null : element[name],
    hasAttribute: (name) => element[name] !== undefined,
    closest: () => null,
    contains: () => false,
    focus: () => {},
    blur: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    click: () => {}
  };
  return element;
}

test('initUI 可在 Worker 面板尚未抵達時安全啟動', () => {
  const elements = Object.create(null);
  const workerHandlers = Object.create(null);
  const body = fakeElement();
  const document = {
    hidden: false,
    body,
    documentElement: { contains: () => true },
    getElementById: () => fakeElement(),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => fakeElement(),
    addEventListener: () => {}
  };
  const context = {
    console,
    document,
    window: {
      location: { hostname: 'example.test', search: '?worker=1' },
      addEventListener: () => {},
      removeEventListener: () => {}
    },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    $id: (id) => elements[id] || (elements[id] = fakeElement()),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    fmt: (value) => String(value),
    esc: (value) => String(value),
    pad2: (value) => String(value).padStart(2, '0'),
    UI: {
      dirty: { header: false, battle: false, equip: false, inv: false, factory: false,
        newforge: false, forge: false, tower: false, gems: false, skills: false, talents: false },
      tab: 'equip',
      performanceEventsBound: false,
      statsPanelOpen: false,
      battleLayoutDirty: false,
      fuseSlots: []
    },
    WorkerBridge: {
      on: (name, handler) => { workerHandlers[name] = handler; },
      subscribeView: () => {},
      subscribePanels: () => {},
      requestPanel: () => Promise.resolve(),
      send: () => Promise.resolve({ ok: true }),
      status: () => ({ booted: true }),
    safeMode: () => false
    },
    MSG_OUT: { BOOTED: 'BOOTED', FULL: 'FULL', TICK: 'TICK', PANEL: 'PANEL' },
    PANEL_KEYS: ['header', 'battle', 'equip', 'inv', 'factory', 'newforge', 'forge', 'tower', 'gems', 'skills', 'talents'],
    autoSaveMetaV2: () => ({ runId: 1 }),
    saveIndex: () => [],
    saveRecName: () => 'auto',
    ZONES: {},
    REINCARNATION_MAX: 10,
    GT: 0
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), context, { filename: 'js/ui.js' });

  // initUI 的開機時機早於任何 PANEL 回應，刻意保持面板快取為空。
  context.UI_WORKER_STATE.panels = Object.create(null);
  assert.doesNotThrow(() => context.initUI());

  // 面板回應抵達後，初始化時沒有資料的 factory 控制項也要重新同步。
  context.UI_WORKER_STATE.panels.factory = { factory: { autoEquip: true } };
  workerHandlers.PANEL({ name: 'factory', data: context.UI_WORKER_STATE.panels.factory });
  assert.equal(elements['toggle-autoequip'].checked, true);
});
