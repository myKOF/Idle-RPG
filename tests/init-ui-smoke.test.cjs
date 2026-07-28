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

test('Worker Snapshot 完整但主執行緒 G 為空時 initUI 與 uiTick 不拋例外', () => {
  const elements = Object.create(null);
  const workerHandlers = Object.create(null);
  const fake = () => (elements._last = fakeElement());
  const document = {
    hidden: false,
    body: fakeElement(),
    documentElement: { contains: () => true },
    getElementById: (id) => elements[id] || (elements[id] = fakeElement()),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: fake,
    addEventListener: () => {}
  };
  const context = {
    console,
    document,
    window: { location: { hostname: 'example.test', search: '?worker=1' }, addEventListener: () => {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    $id: (id) => elements[id] || (elements[id] = fakeElement()),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    fmt: (value) => String(value),
    fmt1: (value) => String(value),
    esc: (value) => String(value),
    pad2: (value) => String(value).padStart(2, '0'),
    ZONES: { plains: { name: '草原', emoji: '🌿' } },
    REINCARNATION_MAX: 20,
    REINCARNATION_LEVEL: 100,
    REINCARNATION_MAX: 20,
    TALENT_TREES: {},
    SKILLS: {},
    PANEL_KEYS: ['header', 'battle', 'equip', 'inv', 'factory', 'newforge', 'forge', 'tower', 'gems', 'skills', 'talents'],
    MSG_OUT: { BOOTED: 'BOOTED', FULL: 'FULL', TICK: 'TICK', PANEL: 'PANEL' },
    G: {},
    UI: {
      dirty: { header: false, battle: false, equip: false, inv: false, factory: false,
        newforge: false, forge: false, tower: false, gems: false, skills: false, talents: false },
      tab: 'equip', performanceEventsBound: false, statsPanelOpen: false,
      battleLayoutDirty: false, fuseSlots: []
    },
    WorkerBridge: {
      on: (name, handler) => { workerHandlers[name] = handler; },
      subscribeView: () => {}, subscribePanels: () => {},
      requestPanel: () => Promise.resolve(), send: () => Promise.resolve({ ok: true }),
      status: () => ({ booted: true }), safeMode: () => false
    },
    autoSaveMetaV2: () => ({ runId: 1 }), saveIndex: () => [], saveRecName: () => 'auto',
    GT: 0
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), context, { filename: 'js/ui.js' });
  context.UI_WORKER_STATE.panels = {
    header: { player: { level: 1, reincarnations: 0, loadout: [] }, stage: { zone: 'plains', current: 1, best: 1, autoAdvance: false }, stats: {} },
    battle: { field: { player: null, monsters: [] }, tower: null, stage: { zone: 'plains' }, zoneProgress: {} },
    equip: { equipment: {}, sets: [{}], equipActive: 0, equipView: 0, settings: {}, stats: {}, viewStats: {} },
    inv: { items: [], details: {}, count: 0, cap: 100, settings: {}, equipment: {}, viewEquipment: {} },
    factory: { factory: { autoEquip: false } }, newforge: { newForge: {} },
    forge: { forge: {} }, gems: { gems: {}, fusedGems: [], shop: {} },
    skills: { skills: {}, unlocks: {}, loadout: [], fusions: [], points: 0, budget: 0 },
    talents: { talents: { levels: {}, potentialLevels: {} }, reincarnations: 0, talentPoints: 0 }
  };
  assert.doesNotThrow(() => context.initUI());

  // uiTick 的派發路徑保持實際執行；各頁渲染器在此煙霧測試中只隔離 DOM fixture。
  context.renderBattle = () => {};
  context.renderHeader = () => {};
  context.renderEquip = () => {};
  context.renderInventory = () => {};
  context.renderNewForge = () => {};
  context.renderForge = () => {};
  context.renderTowerFight = () => {};
  context.renderSkills = () => {};
  context.renderTalents = () => {};
  context.renderGems = () => {};
  context.updateLiveTitle = () => {};
  context.flushPendingLogDom = () => {};
  context.flushDirtyDetailLogs = () => {};
  context.refreshBuffTooltip = () => {};
  assert.doesNotThrow(() => context.uiTick());

  // 直接覆蓋曾經讀取 G 的顯示查詢，確認投影路徑在 G={} 下可用。
  assert.doesNotThrow(() => context.refreshStageDisplay());
  assert.doesNotThrow(() => context.renderDetail());
  assert.doesNotThrow(() => context.renderMpSkill({ mp: 0, skillCds: {} }, 'tp', { mp: 1 }));
});
