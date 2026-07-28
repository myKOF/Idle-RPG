const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const { executeGMCommand } = require(path.join(root, 'js/gm_exec.js'));

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
    REINCARNATION_MAX: 10,
    ENCHANTS: { fire: { name: '火焰附魔' } },
    GEM_TYPES: { ruby: {} },
    GEM_FORGE_MAX_LEVEL: 10,
    GEM_TYPES: { ruby: {} },
    GEM_FORGE_MAX_LEVEL: 10,
    UI: { dirty: {} }
  };
  context.G.tower = { highest: 0, active: false };
  context.markStatsDirty = () => { context.statsDirty = true; };
  context.resetTalentsForReincarnationGM = (count) => {
    context.resetTalentsCount = count;
    context.G.player.reincarnationTalentPoints = 0;
  };
  context.window = context;
  vm.createContext(context);
  // GM 指令拆成執行層與面板兩檔：執行層同時被主執行緒與 Worker 載入，面板只在主執行緒。
  vm.runInContext(fs.readFileSync(path.join(root, 'js/gm_exec.js'), 'utf8'), context, { filename: 'js/gm_exec.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/gm.js'), 'utf8'), context, { filename: 'js/gm.js' });
  return { context, document, body };
}

function withGMExecContext(configure, run) {
  if (run === undefined) {
    run = configure;
    configure = null;
  }
  const context = {
    console,
    location: { hostname: 'localhost' },
    G: {
      player: { gold: 100, scrap: 10, essence: 10, dust: 10, books: { fire: 3 } },
      inventory: [],
      factory: { parts: [] },
      tower: { highest: 0, active: false }
    },
    TOWER_TRIAL_MAX_FLOOR: 50,
    TOWER_HELL_MAX_FLOOR: 100,
    TOWER_PURGATORY_MAX_FLOOR: 150,
    TOWER_MAX_FLOOR: 150,
    REINCARNATION_MAX: 10,
    ENCHANTS: { fire: { name: '火焰附魔' } },
    GEM_TYPES: { ruby: {} },
    GEM_FORGE_MAX_LEVEL: 10,
    UI: { dirty: {} }
  };
  context.markStatsDirty = () => { context.statsDirty = true; };
  context.resetTalentsForReincarnationGM = (count) => {
    context.resetTalentsCount = count;
    context.G.player.reincarnationTalentPoints = 0;
  };
  if (configure) configure(context);
  context.window = context;

  const saved = new Map();
  for (const [key, value] of Object.entries(context)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    globalThis[key] = value;
  }
  try {
    return run(context, executeGMCommand);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

function configureMultiKill(context) {
  context.ZONES = { plains: { name: '草原', emoji: '🌿', pool: [{ name: '史萊姆' }], rewardMult: 1 } };
  context.RARITIES = [
    { key: 'common', name: '普通' },
    { key: 'uncommon', name: '精良' },
    { key: 'rare', name: '稀有' },
    { key: 'unique', name: '獨特' },
    { key: 'epic', name: '史詩' },
    { key: 'legendary', name: '傳說' },
    { key: 'mythic', name: '神話' },
    { key: 'genesis', name: '創世' },
    { key: 'godforged', name: '神鑄創世' }
  ];
  context.isEliteStage = () => false;
  context.monsterStatsFor = () => ({ level: 500, gold: 10, xp: 10 });
  context.getStats = () => ({ goldBonus: 0, xpBonus: 0 });
  context.inventoryCapacityWithTalents = () => 10;
  context.doSalvage = () => {
    context.G.player.scrap = (context.G.player.scrap || 0) + 5;
    return { scrap: 5 };
  };
  context.pushConveyor = () => false;
  context.multiKillDrops = [
    { rarity: 6 }, { rarity: 4 }, { rarity: 6 }, { rarity: 2 }
  ];
  context.rollFieldDrops = () => {
    context.multiKillDrops.forEach((item) => {
      if (typeof context.window.pushConveyor === 'function') context.window.pushConveyor({ ...item });
    });
    return ['裝備'];
  };
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
  assert.equal(input.value, ''); // 指令執行後自動清空
  input.listeners.keydown(event('Escape'));
  assert.equal(panel.style.display, 'none');
  document.listeners.keydown(event('Enter'));
  assert.equal(panel.style.display, 'block');
  assert.equal(input.value, ''); // 重新開啟介面時也是空白
});

test('金幣與材料允許負數扣減，但物品負數不會發放', () => {
  withGMExecContext((context, execute) => {
    assert.equal(execute('gold -40').ok, true);
    assert.equal(context.G.player.gold, 60);

    assert.equal(execute('mat scrap -5').ok, true);
    assert.equal(context.G.player.scrap, 5);

    const result = execute('book fire -2');
    assert.equal(result.ok, false);
    assert.equal(context.G.player.books.fire, 3);
  });
});

test('GM 金幣與材料指令支援 10^20 以上的大數字與科學記號', () => {
  withGMExecContext((context, execute) => {
    assert.equal(execute('gold 100000000000000000000').ok, true); // 10^20
    assert.equal(context.G.player.gold, 1e20 + 100);

    assert.equal(execute('scrap 1e20').ok, true);
    assert.equal(context.G.player.scrap, 1e20 + 10);
  });
});

test('三個高塔 GM 指令可一鍵推進到各塔區終點', () => {
  withGMExecContext((context, execute) => {
    assert.equal(execute('tower_trial_clear').ok, true);
    assert.equal(context.G.tower.highest, 50);

    assert.equal(execute('tower_hell_clear').ok, true);
    assert.equal(context.G.tower.highest, 100);

    assert.equal(execute('tower_purgatory_clear').ok, true);
    assert.equal(context.G.tower.highest, 150);
    assert.equal(context.UI.dirty.tower, true);
    assert.equal(context.UI.dirty.header, true);
  });
});

test('高塔戰鬥中不允許執行一鍵通關', () => {
  withGMExecContext((context, execute) => {
    context.G.tower.highest = 20;
    context.G.tower.active = true;
    const result = execute('tower_purgatory_clear');
    assert.equal(result.ok, false);
    assert.match(result.message, /高塔戰鬥進行中/);
    assert.equal(context.G.tower.highest, 20);
  });
});

test('三個高塔 reset GM 指令只清除指定塔區進度', () => {
  withGMExecContext((context, execute) => {
    context.G.tower.highest = 150;
    assert.equal(execute('tower_purgatory_reset').ok, true);
    assert.equal(context.G.tower.highest, 100);

    assert.equal(execute('tower_hell_reset').ok, true);
    assert.equal(context.G.tower.highest, 50);

    assert.equal(execute('tower_trial_reset').ok, true);
    assert.equal(context.G.tower.highest, 0);
  });
});

test('tower_jump 指定下一個高塔樓層，並將之前樓層視為通關', () => {
  withGMExecContext((context, execute) => {
    assert.equal(execute('tower_jump 101').ok, true);
    assert.equal(context.G.tower.highest, 100);

    assert.equal(execute('tower_jump 150').ok, true);
    assert.equal(context.G.tower.highest, 149);

    const result = execute('tower_jump 151');
    assert.equal(result.ok, false);
    assert.equal(context.G.tower.highest, 149);
  });
});

test('reincarnation GM 指令可在 0～10 轉間切換並刷新狀態', () => {
  const { context, body } = loadGMContext('localhost');
  context.initGM();
  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  input.value = 'reincarnation 7';
  input.listeners.keydown(event);
  assert.equal(context.G.player.reincarnations, 7);
  assert.equal(context.resetTalentsCount, 7);
  assert.equal(context.statsDirty, true);
  assert.equal(context.UI.dirty.talents, true);

  input.value = 'turn 0';
  input.listeners.keydown(event);
  assert.equal(context.G.player.reincarnations, 0);

  input.value = 'reincarnation 11';
  input.listeners.keydown(event);
  assert.equal(context.G.player.reincarnations, 0);
  assert.equal(body.children[0].children[1].className, 'gm-status bad');
});

test('連殺 GM 指令 (場景/關卡數/擊殺數) 可一次性發放經驗，填滿背包空間並拆解溢出裝備', () => {
  const { context, body } = loadGMContext('localhost');
  context.ZONES = {
    plains: { name: '草原', emoji: '🌿', pool: [{ name: '史萊姆' }], rewardMult: 1 },
    desert: { name: '荒漠', emoji: '🏜️', pool: [{ name: '沙蟲' }], rewardMult: 2 }
  };
  context.isEliteStage = () => false;
  context.monsterStatsFor = (stage) => ({ level: stage, gold: 50, xp: 100 });
  context.getStats = () => ({ goldBonus: 0, xpBonus: 0 });
  context.inventoryCapacityWithTalents = () => 5;
  context.doSalvage = (item) => {
    context.G.player.scrap = (context.G.player.scrap || 0) + 10;
    context.G.player.gold = (context.G.player.gold || 0) + 5;
    return { scrap: 10, gold: 5 };
  };
  context.pushConveyor = () => false;
  context.rollFieldDrops = (m) => {
    const item = { rarity: 1 };
    if (typeof context.window.pushConveyor === 'function') context.window.pushConveyor(item);
    return ['裝備[精良]'];
  };
  context.gainXp = (amount) => { context.G.player.xp = (context.G.player.xp || 0) + amount; };
  context.initGM();

  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  input.value = '1/5/10';
  input.listeners.keydown(event);
  assert.equal(context.G.player.gold, 600 + 25);
  assert.equal(context.G.player.xp, 1000);
  assert.equal(context.G.inventory.length, 5);
  assert.equal(context.G.player.scrap, 60);
  assert.equal(body.children[0].children[1].className, 'gm-status good');
});

test('連殺 GM 指令支援可選的品質篩選參數 (kill 1 500 100 mythic)，未填時全進背包', () => {
  const { context, body } = loadGMContext('localhost');
  context.ZONES = {
    plains: { name: '草原', emoji: '🌿', pool: [{ name: '史萊姆' }], rewardMult: 1 }
  };
  context.RARITIES = [
    { key: 'common', name: '普通' },
    { key: 'uncommon', name: '精良' },
    { key: 'rare', name: '稀有' },
    { key: 'unique', name: '獨特' },
    { key: 'epic', name: '史詩' },
    { key: 'legendary', name: '傳說' },
    { key: 'mythic', name: '神話' },
    { key: 'genesis', name: '創世' },
    { key: 'godforged', name: '神鑄創世' }
  ];
  context.isEliteStage = () => false;
  context.monsterStatsFor = (stage) => ({ level: stage, gold: 10, xp: 10 });
  context.getStats = () => ({ goldBonus: 0, xpBonus: 0 });
  context.inventoryCapacityWithTalents = () => 10;
  context.doSalvage = (item) => {
    context.G.player.scrap = (context.G.player.scrap || 0) + 5;
    return { scrap: 5 };
  };
  context.pushConveyor = () => false;

  let currentRaritiesToDrop = [6, 4, 6, 2]; // 2 mythic(6), 1 epic(4), 1 rare(2)
  context.rollFieldDrops = () => {
    currentRaritiesToDrop.forEach(r => {
      const item = { rarity: r };
      if (typeof context.window.pushConveyor === 'function') context.window.pushConveyor(item);
    });
    return ['裝備'];
  };
  context.initGM();

  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  // 1. 指定品質 mythic：只保留 2 件 mythic 入包，其餘 2 件過濾拆解
  input.value = 'kill 1 500 1 mythic';
  input.listeners.keydown(event);
  assert.equal(context.G.inventory.length, 2);
  assert.equal(context.G.inventory[0].rarity, 6);
  assert.equal(context.G.inventory[1].rarity, 6);
  assert.equal(context.G.player.scrap, 20); // 10 base + 2 * 5
  assert.equal(body.children[0].children[1].className, 'gm-status good');

  // 清空背包重測
  context.G.inventory = [];

  // 2. 不指定品質：4 件裝備全進背包
  input.value = 'kill 1 500 1';
  input.listeners.keydown(event);
  assert.equal(context.G.inventory.length, 4);
});

test('連殺 GM 指令支援裝備部位篩選 (kill 1 500 100 mythic helmet / kill 1 500 100 shield)', () => {
  const { context, body } = loadGMContext('localhost');
  context.ZONES = { plains: { name: '草原', emoji: '🌿', pool: [{ name: '史萊姆' }], rewardMult: 1 } };
  context.RARITIES = [
    { key: 'common', name: '普通' },
    { key: 'uncommon', name: '精良' },
    { key: 'rare', name: '稀有' },
    { key: 'unique', name: '獨特' },
    { key: 'epic', name: '史詩' },
    { key: 'legendary', name: '傳說' },
    { key: 'mythic', name: '神話' },
    { key: 'genesis', name: '創世' },
    { key: 'godforged', name: '神鑄創世' }
  ];
  context.SLOT_INFO = { helmet: { name: '頭盔' }, weapon: { name: '武器' } };
  context.WEAPON_TYPES = { shield: { name: '盾牌' } };
  context.slotTypeOf = (s) => (s === 'weapon2' ? 'weapon' : s);
  context.isEliteStage = () => false;
  context.monsterStatsFor = () => ({ level: 500, gold: 10, xp: 10 });
  context.getStats = () => ({ goldBonus: 0, xpBonus: 0 });
  context.inventoryCapacityWithTalents = () => 10;
  context.doSalvage = () => ({ scrap: 5 });

  context.rollFieldDrops = () => {
    const items = [
      { rarity: 6, slot: 'helmet' },
      { rarity: 6, slot: 'weapon' },
      { rarity: 0, slot: 'helmet' },
      { rarity: 6, slot: 'weapon2', weaponType: 'shield' }
    ];
    items.forEach(it => {
      if (typeof context.window.pushConveyor === 'function') context.window.pushConveyor(it);
    });
    return ['裝備'];
  };
  context.initGM();

  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  // 1. 同時篩選品質神話(6) 與 部位頭盔(helmet) -> 只有 1 件符合
  input.value = 'kill 1 500 1 6 helmet';
  input.listeners.keydown(event);
  assert.equal(context.G.inventory.length, 1);
  assert.equal(context.G.inventory[0].slot, 'helmet');
  assert.equal(context.G.inventory[0].rarity, 6);

  context.G.inventory = [];

  // 2. 只篩選武器類型盾牌(shield) -> 只有 1 件符合
  input.value = 'kill 1 500 1 shield';
  input.listeners.keydown(event);
  assert.equal(context.G.inventory.length, 1);
  assert.equal(context.G.inventory[0].weaponType, 'shield');
});

test('inv_cap GM 指令可任意擴充背包容量並超越正常上限', () => {
  const { context, body } = loadGMContext('localhost');
  context.INVENTORY_CAP = 100;
  context.G.player.invUpgrades = 0;
  context.inventoryCapacityWithTalents = () => context.INVENTORY_CAP + (context.G.player.invUpgrades || 0);
  context.initGM();

  const input = body.children[0].children[0];
  const event = { key: 'Enter', preventDefault() {}, stopPropagation() {} };

  input.value = 'inv_cap 2000';
  input.listeners.keydown(event);
  assert.equal(context.G.player.invUpgrades, 1900); // 100 + 1900 = 2000
  assert.equal(context.inventoryCapacityWithTalents(), 2000);
  assert.equal(body.children[0].children[1].className, 'gm-status good');

  input.value = 'inv_cap +500';
  input.listeners.keydown(event);
  assert.equal(context.G.player.invUpgrades, 2400); // 2000 + 500 = 2500
  assert.equal(context.inventoryCapacityWithTalents(), 2500);

  input.value = 'inv_expand 1000';
  input.listeners.keydown(event);
  assert.equal(context.G.player.invUpgrades, 3400); // 2500 + 1000 = 3500
  assert.equal(context.inventoryCapacityWithTalents(), 3500);
});
