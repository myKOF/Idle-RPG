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
  context.gmMessages = [];
  context.WorkerBridge = {
    send(name, args) {
      context.gmMessages.push({ name, args });
      return Promise.resolve({ ok: true, message: 'Worker 已執行' });
    }
  };
  context.window = context;
  vm.createContext(context);
  // 主執行緒只載入面板；指令執行層由 Worker 載入。
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

test('本機 GM Enter/Escape 行為符合需求', async () => {
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
  assert.deepEqual(JSON.parse(JSON.stringify(context.gmMessages)), [
    { name: 'gm.exec', args: { line: 'gold 100' } }
  ]);
  assert.equal(context.G.player.gold, 100, '主執行緒面板不得直接變更遊戲狀態');
  assert.equal(panel.style.display, 'block');
  assert.equal(input.value, ''); // 指令執行後自動清空
  await Promise.resolve();
  assert.equal(panel.children[1].textContent, 'Worker 已執行');
  assert.equal(panel.children[1].className, 'gm-status good');
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
  withGMExecContext((context, execute) => {
    assert.equal(execute('reincarnation 7').ok, true);
    assert.equal(context.G.player.reincarnations, 7);
    assert.equal(context.resetTalentsCount, 7);
    assert.equal(context.statsDirty, true);
    assert.equal(context.UI.dirty.talents, true);

    assert.equal(execute('turn 0').ok, true);
    assert.equal(context.G.player.reincarnations, 0);

    const result = execute('reincarnation 11');
    assert.equal(result.ok, false);
    assert.equal(context.G.player.reincarnations, 0);
  });
});

test('連殺 GM 指令 (場景/關卡數/擊殺數) 可一次性發放經驗，填滿背包空間並拆解溢出裝備', () => {
  withGMExecContext((context) => {
    context.ZONES = {
      plains: { name: '草原', emoji: '🌿', pool: [{ name: '史萊姆' }], rewardMult: 1 },
      desert: { name: '荒漠', emoji: '🏜️', pool: [{ name: '沙蟲' }], rewardMult: 2 }
    };
    context.isEliteStage = () => false;
    context.monsterStatsFor = (stage) => ({ level: stage, gold: 50, xp: 100 });
    context.getStats = () => ({ goldBonus: 0, xpBonus: 0 });
    context.inventoryCapacityWithTalents = () => 5;
    context.doSalvage = () => {
      context.G.player.scrap = (context.G.player.scrap || 0) + 10;
      context.G.player.gold = (context.G.player.gold || 0) + 5;
      return { scrap: 10, gold: 5 };
    };
    context.pushConveyor = () => false;
    context.rollFieldDrops = () => {
      if (typeof context.window.pushConveyor === 'function') context.window.pushConveyor({ rarity: 1 });
      return ['裝備[精良]'];
    };
    context.gainXp = (amount) => { context.G.player.xp = (context.G.player.xp || 0) + amount; };
  }, (context, execute) => {
    const result = execute('1/5/10');
    assert.equal(result.ok, true);
    assert.equal(context.G.player.gold, 600 + 25);
    assert.equal(context.G.player.xp, 1000);
    assert.equal(context.G.inventory.length, 5);
    assert.equal(context.G.player.scrap, 60);
  });
});

test('連殺 GM 指令支援可選的品質篩選參數 (kill 1 500 100 mythic)，未填時全進背包', () => {
  withGMExecContext(configureMultiKill, (context, execute) => {
    const result = execute('kill 1 500 1 mythic');
    assert.equal(result.ok, true);
    assert.deepEqual(context.G.inventory.map((item) => item.rarity), [6, 6]);
    assert.equal(context.G.player.scrap, 20); // 10 base + 2 * 5

    context.G.inventory = [];
    assert.equal(execute('kill 1 500 1').ok, true);
    assert.equal(context.G.inventory.length, 4);
  });
});

test('連殺 GM 指令支援裝備部位篩選 (kill 1 500 100 mythic helmet / kill 1 500 100 shield)', () => {
  withGMExecContext((context) => {
    configureMultiKill(context);
    context.SLOT_INFO = { helmet: { name: '頭盔' }, weapon: { name: '武器' } };
    context.WEAPON_TYPES = { shield: { name: '盾牌' } };
    context.slotTypeOf = (slot) => (slot === 'weapon2' ? 'weapon' : slot);
    context.multiKillDrops = [
      { rarity: 6, slot: 'helmet' },
      { rarity: 6, slot: 'weapon' },
      { rarity: 0, slot: 'helmet' },
      { rarity: 6, slot: 'weapon2', weaponType: 'shield' }
    ];
  }, (context, execute) => {
    assert.equal(execute('kill 1 500 1 6 helmet').ok, true);
    assert.equal(context.G.inventory.length, 1);
    assert.equal(context.G.inventory[0].slot, 'helmet');
    assert.equal(context.G.inventory[0].rarity, 6);

    context.G.inventory = [];
    assert.equal(execute('kill 1 500 1 shield').ok, true);
    assert.equal(context.G.inventory.length, 1);
    assert.equal(context.G.inventory[0].weaponType, 'shield');
  });
});

test('equip GM 指令支援 any 品質與 any 部位，且品質逐件隨機', () => {
  withGMExecContext((context) => {
    context.RARITIES = [
      { key: 'common', name: '普通' },
      { key: 'legendary', name: '傳說' },
      { key: 'chaos', name: '混沌' }
    ];
    context.SLOT_INFO = {
      weapon: { name: '主手' },
      helmet: { name: '頭盔' }
    };
    context.WEAPON_TYPES = {};
    context.slotTypeOf = (slot) => slot;
    const randomValues = [0, 0.4, 0.99];
    context.Math = { floor: Math.floor, random: () => randomValues.shift() ?? 0 };
    context.makeEquipment = (level, opts) => ({ level, rarity: opts.rarity, slot: opts.slot || 'random' });
  }, (context, execute) => {
    const randomResult = execute('equip any 100 any 3');
    assert.equal(randomResult.ok, true);
    assert.deepEqual(context.G.inventory.map((item) => item.rarity), [0, 1, 2]);
    assert.deepEqual(context.G.inventory.map((item) => item.slot), ['random', 'random', 'random']);

    context.G.inventory = [];
    const fixedResult = execute('equip legendary 100 any 1');
    assert.equal(fixedResult.ok, true);
    assert.equal(context.G.inventory[0].rarity, 1);
    assert.equal(context.G.inventory[0].slot, 'random');
  });
});

test('bag GM 指令（及 inv_cap 別名）可任意擴充背包容量並超越正常上限', () => {
  withGMExecContext((context) => {
    context.INVENTORY_CAP = 100;
    context.G.player.invUpgrades = 0;
    context.inventoryCapacityWithTalents = () => context.INVENTORY_CAP + (context.G.player.invUpgrades || 0);
  }, (context, execute) => {
    assert.equal(execute('bag 1000').ok, true);
    assert.equal(context.G.player.invUpgrades, 900); // 100 + 900 = 1000
    assert.equal(context.inventoryCapacityWithTalents(), 1000);

    assert.equal(execute('bag 2000').ok, true);
    assert.equal(context.G.player.invUpgrades, 1900); // 100 + 1900 = 2000
    assert.equal(context.inventoryCapacityWithTalents(), 2000);

    assert.equal(execute('bag +500').ok, true);
    assert.equal(context.G.player.invUpgrades, 2400); // 2000 + 500 = 2500
    assert.equal(context.inventoryCapacityWithTalents(), 2500);

    assert.equal(execute('inv_cap 3000').ok, true);
    assert.equal(context.G.player.invUpgrades, 2900); // 100 + 2900 = 3000
    assert.equal(context.inventoryCapacityWithTalents(), 3000);

    assert.equal(execute('inv_expand 1000').ok, true);
    assert.equal(context.G.player.invUpgrades, 3900); // 3000 + 1000 = 4000
    assert.equal(context.inventoryCapacityWithTalents(), 4000);
  });
});

test('stage_jump GM 指令（及 stage/set_stage/zone 等別名）可指定場景與關卡，並將後續場景/關卡設為不可進', () => {
  withGMExecContext((context) => {
    context.ZONE_LIST = ['plains', 'desert', 'swamp', 'undead_mountains', 'god_battlefield', 'god_chaos', 'god_sanctuary'];
    context.ZONES = {
      plains: { name: '草原', emoji: '🌿', maxStage: 200 },
      desert: { name: '荒漠', emoji: '🏜️', maxStage: 300, reqZone: 'plains', reqStage: 200 },
      swamp: { name: '沼澤', emoji: '🦠', maxStage: 400, reqZone: 'desert', reqStage: 300 },
      undead_mountains: { name: '亡靈山脈', emoji: '⛰️', maxStage: 500, reqZone: 'swamp', reqStage: 400 },
      god_battlefield: { name: '太古戰場', emoji: '⚔️', maxStage: 600, reqZone: 'undead_mountains', reqStage: 500, reqReincarnation: 11 },
      god_chaos: { name: '混沌界', emoji: '🌀', maxStage: 700, reqZone: 'god_battlefield', reqStage: 600, reqReincarnation: 11 },
      god_sanctuary: { name: '永恒神域', emoji: '✨', maxStage: 800, reqZone: 'god_chaos', reqStage: 700, reqReincarnation: 11 }
    };
    context.zoneMaxStage = (zKey) => (context.ZONES[zKey] ? context.ZONES[zKey].maxStage : 200);
    context.zoneBestProgress = (zKey) => (context.G.zoneProgress && context.G.zoneProgress[zKey] ? context.G.zoneProgress[zKey].best : 1);
    context.zoneClearedStage = (zKey) => (context.G.zoneProgress && context.G.zoneProgress[zKey] ? context.G.zoneProgress[zKey].cleared : 0);
    context.isZoneUnlocked = (zKey) => {
      const zd = context.ZONES[zKey];
      if (!zd) return false;
      if (zd.reqReincarnation && (context.G.player.reincarnations || 0) < zd.reqReincarnation) return false;
      if (zd.reqZone && context.zoneClearedStage(zd.reqZone) < zd.reqStage) return false;
      return true;
    };
  }, (context, execute) => {
    // 1. 指定荒漠（2號場景）第 150 關
    const res1 = execute('stage_jump desert 150');
    assert.equal(res1.ok, true);
    assert.equal(context.G.stage.zone, 'desert');
    assert.equal(context.G.stage.current, 150);
    assert.equal(context.G.stage.best, 150);

    // 檢查 zoneProgress：前置草原已全通關，荒漠最高 150（已通 149），後續沼澤等全重置為 1/1/0
    assert.deepEqual(context.G.zoneProgress.plains, { current: 200, best: 200, cleared: 200 });
    assert.deepEqual(context.G.zoneProgress.desert, { current: 150, best: 150, cleared: 149 });
    assert.deepEqual(context.G.zoneProgress.swamp, { current: 1, best: 1, cleared: 0 });
    assert.deepEqual(context.G.zoneProgress.god_sanctuary, { current: 1, best: 1, cleared: 0 });

    // 驗證解鎖判定：荒漠已解鎖，但後續沼澤不可進（LOCKED）
    assert.equal(context.isZoneUnlocked('plains'), true);
    assert.equal(context.isZoneUnlocked('desert'), true);
    assert.equal(context.isZoneUnlocked('swamp'), false);
    assert.equal(context.isZoneUnlocked('god_battlefield'), false);

    // 2. 測試數字與斜線語法 `stage 1/50`（草原第 50 關）
    const res2 = execute('stage 1/50');
    assert.equal(res2.ok, true);
    assert.equal(context.G.stage.zone, 'plains');
    assert.equal(context.G.stage.current, 50);
    assert.equal(context.G.stage.best, 50);
    assert.deepEqual(context.G.zoneProgress.plains, { current: 50, best: 50, cleared: 49 });
    assert.deepEqual(context.G.zoneProgress.desert, { current: 1, best: 1, cleared: 0 });
    assert.equal(context.isZoneUnlocked('desert'), false);

    // 3. 測試神界場景與轉生條件判定 `set_stage 5 300`
    context.G.player.reincarnations = 0;
    const res3 = execute('set_stage 5 300');
    assert.equal(res3.ok, true);
    assert.equal(context.G.stage.zone, 'god_battlefield');
    assert.equal(context.G.stage.current, 300);
    assert.equal(context.G.stage.best, 300);
    assert.equal(context.G.player.reincarnations, 11); // 自動解鎖神界轉生門檻
    assert.equal(context.isZoneUnlocked('god_battlefield'), true);
    assert.equal(context.isZoneUnlocked('god_chaos'), false); // 混沌界仍不可進

    // 4. 錯誤檢錯處理
    assert.equal(execute('stage_jump invalid_zone 10').ok, false);
    assert.equal(execute('stage_jump plains 9999').ok, false);
  });
});

