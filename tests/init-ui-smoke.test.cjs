const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function fakeElement() {
  const listeners = Object.create(null);
  const classNames = new Set();
  const style = {
    display: 'none',
    setProperty: (name, value) => { style[name] = String(value); },
    removeProperty: (name) => { delete style[name]; }
  };
  const element = {
    style,
    className: '',
    value: '',
    checked: false,
    textContent: '',
    innerHTML: '',
    dataset: {},
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
    options: [],
    parentNode: {
      style: {
        setProperty: () => {},
        removeProperty: () => {}
      },
      insertBefore: () => {},
      removeChild: () => {},
      setAttribute: () => {},
      removeAttribute: () => {}
    },
    parentElement: {
      classList: { add: () => {}, remove: () => {}, toggle: () => false }
    },
    addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener: () => {},
    appendChild: (child) => { element.children.push(child); element.childNodes.push(child); return child; },
    insertBefore: (child) => { element.children.push(child); element.childNodes.push(child); return child; },
    /* removeChild／replaceChild 必須真的動到 children：DOM 差異更新的程式常以
       「還有多餘節點就移除」這種條件迴圈收尾（例：renderBattleSkillBar），
       空實作會讓條件永遠成立而無限迴圈——本測試曾因此卡到 5000 秒逾時。 */
    removeChild: (child) => {
      const ci = element.children.indexOf(child);
      if (ci >= 0) element.children.splice(ci, 1);
      const ni = element.childNodes.indexOf(child);
      if (ni >= 0) element.childNodes.splice(ni, 1);
      return child;
    },
    replaceChild: (next, old) => {
      const ci = element.children.indexOf(old);
      if (ci >= 0) element.children[ci] = next; else element.children.push(next);
      const ni = element.childNodes.indexOf(old);
      if (ni >= 0) element.childNodes[ni] = next; else element.childNodes.push(next);
      return old;
    },
    get firstElementChild() { return element.children.length ? element.children[0] : null; },
    get lastElementChild() { return element.children.length ? element.children[element.children.length - 1] : null; },
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute: (name, value) => { element[name] = String(value); },
    removeAttribute: (name) => { delete element[name]; },
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
  const panelRequests = [];
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
      requestPanel: (name, params) => { panelRequests.push({ name, params }); return Promise.resolve(); },
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
  // 狀態表與列舉器：ui.js 的狀態列與提示框直接讀狀態表（js/status.js）
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'status.js'), 'utf8'), context, { filename: 'js/status.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), context, { filename: 'js/ui.js' });

  // initUI 的開機時機早於任何 PANEL 回應，刻意保持面板快取為空。
  context.UI_WORKER_STATE.panels = Object.create(null);
  assert.doesNotThrow(() => context.initUI());

  // 面板回應抵達後，初始化時沒有資料的 factory 控制項也要重新同步。
  context.UI_WORKER_STATE.panels.factory = { factory: { autoEquip: true } };
  workerHandlers.PANEL({ name: 'factory', data: context.UI_WORKER_STATE.panels.factory });
  assert.equal(elements['toggle-autoequip'].checked, true);

  panelRequests.length = 0;
  context.switchTab('skills');
  assert.deepEqual(panelRequests.map((request) => request.name), ['skills']);
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
    ZONES: { desert: { name: '荒漠', emoji: '🏜️' } },
    REINCARNATION_MAX: 20,
    REINCARNATION_LEVEL: 100,
    REINCARNATION_MAX: 20,
    TALENT_TREES: {},
    SKILLS: {},
    PANEL_KEYS: ['header', 'battle', 'equip', 'inv', 'factory', 'newforge', 'forge', 'tower', 'gems', 'skills', 'talents'],
    MSG_OUT: { BOOTED: 'BOOTED', FULL: 'FULL', TICK: 'TICK', PANEL: 'PANEL' },
    G: null,
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
  for (const file of [
    'util.js', 'data.js', 'formula.js', 'stats.js', 'item.js', 'skills.js',
    'talents.js', 'player.js', 'special_rules.js', 'combat.js', 'legendary.js',
    'potential.js', 'tower.js', 'factory.js', 'newforge.js', 'forge.js', 'save.js'
  ]) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: 'js/' + file });
  }
  // 狀態表與列舉器：ui.js 的狀態列與提示框直接讀狀態表（js/status.js）
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'status.js'), 'utf8'), context, { filename: 'js/status.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8'), context, { filename: 'js/ui.js' });
  context.UI_WORKER_STATE.panels = {
    header: {
      player: {
        level: 1, xp: 0, reincarnations: 0, loadout: [], gold: 0, scrap: 0,
        essence: 0, dust: 0, ancientEssence: 0, soulOrigin: 0, demonSeed: 0,
        gems: {}, books: {}, shownRes: {}
      },
      stage: { zone: 'desert', current: 1, best: 1, autoAdvance: false },
      stats: { hp: 1, mp: 1, atk: 0, def: 0, aspd: 1, critRate: 0, lifesteal: 0, hit: 1, loot: 0 },
      viewStats: { hp: 1, mp: 1, atk: 0, def: 0, aspd: 1, critRate: 0, lifesteal: 0, hit: 1, loot: 0 },
      dps: 0, settings: {}, autoEquip: false, equipView: 0, equipActive: 0
    },
    battle: {
      field: {
        player: {
          hp: 1, maxHp: 1, mp: 0, maxMp: 1, shield: 0, reviveCd: 0,
          effects: {}, buffs: {}, dots: [], skillCds: {}
        },
        monsters: []
      },
      tower: null, stage: { zone: 'desert' }, zoneProgress: {}
    },
    equip: { equipment: {}, sets: [{}], equipActive: 0, equipView: 0, settings: {}, stats: {}, viewStats: {} },
    inv: { items: [], details: {}, count: 0, cap: 100, settings: {}, equipment: {}, viewEquipment: {} },
    factory: { factory: { autoEquip: false, stats: { enchanted: 0 } } },
    newforge: { newForge: { queue: [], furnaces: [], stats: { salvaged: 0, kept: 0 } } },
    forge: {
      forge: {
        slots: [null, null, null, null, null, null],
        dustSlots: [false, false, false, false, false, false],
        crafting: false, result: null, autoFill: null, log: [],
        autoDust: false, autoForge: false
      }
    },
    gems: {
      gems: {}, fusedGems: [],
      shop: { level: 1, items: [], refreshes: 0, hourStart: Date.now() }
    },
    skills: { skills: {}, unlocks: {}, loadout: [], loadoutSize: 4, fusions: [], points: 0, budget: 0 },
    talents: { talents: { levels: {}, potentialLevels: {} }, reincarnations: 0, talentPoints: 0 },
    tower: { tower: { active: false }, player: null, monsters: [] }
  };
  assert.doesNotThrow(() => context.initUI());
  assert.equal(context.skillViewLoadoutSize({ loadoutSize: 4 }), 4);

  for (const renderer of [
    'renderHeader', 'renderBattle', 'renderEquip', 'renderInventory',
    'renderNewForge', 'renderForge', 'renderTower', 'renderGems',
    'renderSkills', 'renderTalents'
  ]) {
    assert.doesNotThrow(() => context[renderer](), renderer + ' 不得讀取主執行緒 G');
  }

  assert.equal(context.G, null);
  for (const tab of ['equip', 'newforge', 'gems', 'skills', 'talents', 'forge', 'tower', 'settings']) {
    context.UI.tab = tab;
    context.markVisibleUiDirty();
    assert.doesNotThrow(() => context.uiTick(), 'uiTick 應能派發 ' + tab + ' 頁');
  }

  // 各頁與實際 uiTick 派發已在上方執行；最後再隔離 DOM fixture，
  // 確認最小派發路徑也能獨立運作。
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
  assert.doesNotThrow(() => context.renderMpSkill({ mp: 0, skillCds: {} }, 'tp', null));
  assert.doesNotThrow(() => context.renderMpSkill({ mp: 0, skillCds: {} }, 'tp', { mp: 1 }));
  assert.doesNotThrow(() => context.talentNodeHTML({
    id: 'missing-talent', name: '缺少 Snapshot', emoji: '🔒', disabled: false
  }, 1, null));
  assert.doesNotThrow(() => context.potentialNodeHTML({
    id: 'missing-potential', name: '缺少 Snapshot', emoji: '🔒'
  }, 0, null, null));
});
