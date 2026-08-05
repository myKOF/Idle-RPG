/* 主線任務系統（2026-08-05）回歸測試
   涵蓋：
   1. newGameState 內含 taskState 與新統計欄位（rerolled / gemComposed）
   2. equipSlots 進度：品質/等級門檻與「雙手武器視同佔用主副手」
   3. socketCount / ancientCount / forgeParts 的即時狀態檢查
   4. 累計型進度讀 G.factory.stats（upgradeCount ← stats.upgraded）
   5. taskClaim：未達成拒絕、達成發獎並前進、全部完成
   6. equip 獎勵：makeEquipment 指定品質/等級/太古條數
   7. migrateSave：舊存檔補 taskState 與統計欄位、idx 夾限
   8. composeGems / consumeRerollResources 遞增對應統計 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const contextFiles = [
  'js/util.js',
  'js/data.js',
  'js/formula.js',
  'js/item.js',
  'js/skills.js',
  'js/player.js',
  'js/factory.js',
  'js/newforge.js',
  'js/save.js',
  'js/tasks.js'
];

function loadContext() {
  const context = { console, Math, UI: { dirty: {} }, blog: () => {}, flog: () => {} };
  context.window = context;
  vm.createContext(context);
  contextFiles.forEach((file) => {
    vm.runInContext(read(file), context, { filename: file });
  });
  context.G = context.newGameState();
  return context;
}

function makeItem(c, opts) {
  return c.makeEquipment(1, opts);
}

/* ---- 1. 新開局的預設欄位 ---- */
test('newGameState：taskState 預設 idx 0，stats 含 rerolled / gemComposed', () => {
  const c = loadContext();
  assert.equal(c.G.taskState.idx, 0);
  assert.equal(Object.keys(c.G.taskState).length, 1);
  assert.equal(c.G.factory.stats.rerolled, 0);
  assert.equal(c.G.factory.stats.gemComposed, 0);
  const view = c.taskQuickView();
  assert.equal(view.idx, 0);
  assert.equal(view.ready, false);
});

/* ---- 2. equipSlots 進度與雙手武器 ---- */
test('equipSlots：品質門檻計數，雙手武器視同佔用 weapon 與 weapon2', () => {
  const c = loadContext();
  const eq = c.G.equipment;
  // 穿上 11 件非武器部位（rarity 2）＋一把雙手武器（rarity 3）
  c.SLOT_LIST.forEach((slot) => {
    if (slot === 'weapon' || slot === 'weapon2') return;
    eq[slot] = makeItem(c, { slot: slot.replace(/2$/, ''), rarity: 2, level: 1 });
    eq[slot].slot = slot.replace(/2$/, '');
  });
  eq.weapon = makeItem(c, { slot: 'weapon', rarity: 3, level: 1, weaponType: 'greatsword2h' });
  assert.equal(c.isTwoHandItem(eq.weapon), true);
  assert.equal(eq.weapon2, null);

  // 任意品質：13 格全滿（雙手武器補上 weapon2 那格）
  assert.equal(c.taskProgressFor({ type: 'equipSlots', param: '0|0', count: 13 }), 13);
  // 稀有以上：全部達標
  assert.equal(c.taskProgressFor({ type: 'equipSlots', param: '2|0', count: 13 }), 13);
  // 獨特以上：只有雙手武器（佔 2 格）
  assert.equal(c.taskProgressFor({ type: 'equipSlots', param: '3|0', count: 13 }), 2);
  // 等級門檻：全部 1 級裝，等級 50 門檻應為 0
  assert.equal(c.taskProgressFor({ type: 'equipSlots', param: '0|50', count: 13 }), 0);
});

/* ---- 3. 即時狀態檢查 ---- */
test('socketCount / ancientCount / forgeParts 依現況計算', () => {
  const c = loadContext();
  const eq = c.G.equipment;
  const helmet = makeItem(c, { slot: 'helmet', rarity: 4, level: 1 });
  c.ensureSockets(helmet);
  helmet.sockets = [{ type: 'ruby', level: 1 }, { type: 'ruby', level: 2 }, null];
  helmet.affixes = [
    { key: 'atkPct', roll: 500, ancient: true },
    { key: 'hpPct', roll: 500, ancient: false }
  ];
  delete helmet.ancientCount;
  eq.helmet = helmet;

  assert.equal(c.taskProgressFor({ type: 'socketCount' }), 2);
  assert.equal(c.taskProgressFor({ type: 'ancientCount' }), 1);

  // 熔爐零件：預設熔爐無零件 → 0；裝 2 個 → 2
  assert.equal(c.taskProgressFor({ type: 'forgeParts' }), 0);
  c.G.newForge.furnaces[0].parts.push({ key: 'grinder' }, { key: 'grinder' });
  assert.equal(c.taskProgressFor({ type: 'forgeParts' }), 2);
});

/* ---- 4 + 5. 累計型進度與領獎流程 ---- */
test('taskClaim：未達成拒絕；達成發獎、idx 前進、日誌', () => {
  const c = loadContext();
  // 跳到任務 3（強化裝備10次，獎勵 裝備碎片+200）
  c.G.taskState.idx = 2;
  c.G.factory.stats.upgraded = 9;
  assert.equal(c.taskQuickView().ready, false);
  let r = c.taskClaim();
  assert.ok(r.err, '未達成應回 err');

  c.G.factory.stats.upgraded = 10;
  assert.equal(c.taskQuickView().ready, true);
  const scrapBefore = c.G.player.scrap;
  r = c.taskClaim();
  assert.equal(r.claimed, 3);
  assert.equal(c.G.player.scrap, scrapBefore + 200);
  assert.equal(c.G.taskState.idx, 3);
  assert.equal(c.UI.dirty.task, true);
});

test('taskClaim：最後一個任務領完後 quick view 回 idx -1', () => {
  const c = loadContext();
  c.G.taskState.idx = c.TASKS.length - 1; // 任務 22：草原第 100 關
  c.G.stage.zone = 'plains';
  c.G.stage.best = 101;
  const invBefore = c.G.inventory.length;
  const r = c.taskClaim();
  assert.equal(r.claimed, 22);
  assert.equal(r.next, null);
  // 獎勵：3 太古傳說 100 級裝備 ×1，直接入包
  assert.equal(c.G.inventory.length, invBefore + 1);
  const it = c.G.inventory[c.G.inventory.length - 1];
  assert.equal(it.rarity, 5);
  assert.equal(it.level, 100);
  assert.equal(c.getItemAncientCount(it), 3);
  assert.equal(c.taskQuickView().idx, -1);
  // 已領完後再領應拒絕
  assert.ok(c.taskClaim().err);
});

test('taskPanelData：已領/進行中/未來任務的狀態欄位', () => {
  const c = loadContext();
  c.G.taskState.idx = 2;
  c.G.factory.stats.upgraded = 10;
  const data = c.taskPanelData();
  assert.equal(data.tasks.length, c.TASKS.length);
  assert.equal(data.tasks[0].claimed, true);
  assert.equal(data.tasks[0].prog, c.TASKS[0].count); // 已領一律顯示滿進度
  assert.equal(data.tasks[2].current, true);
  assert.equal(data.tasks[2].ready, true);
  assert.equal(data.tasks[3].claimed, false);
  assert.equal(data.tasks[3].current, false);
  // 未來任務也回報即時進度（任務 8 強化20次 → 10/20）
  assert.equal(data.tasks[7].prog, 10);
});

/* ---- 6. equip 獎勵的太古指定 ---- */
test('makeEquipment：opts.ancientCount 指定太古條數（超過詞條數自然截斷）', () => {
  const c = loadContext();
  for (let i = 0; i < 20; i++) {
    const it = c.makeEquipment(1, { rarity: 4, level: 50, ancientCount: 2 });
    assert.equal(it.rarity, 4);
    assert.equal(it.level, 50);
    assert.equal(c.getItemAncientCount(it), 2);
  }
  // 指定 0 條 → 一定沒有太古
  for (let i = 0; i < 20; i++) {
    const it = c.makeEquipment(1, { rarity: 3, level: 1, ancientCount: 0 });
    assert.equal(c.getItemAncientCount(it), 0);
  }
});

/* ---- 7. 舊存檔遷移 ---- */
test('migrateSave：舊存檔補 taskState / 統計欄位；idx 夾限', () => {
  const c = loadContext();
  const oldSave = { version: 1, player: { level: 10 }, equipment: {}, inventory: [] };
  const migrated = c.migrateSave(oldSave);
  assert.equal(migrated.taskState.idx, 0);
  assert.equal(migrated.factory.stats.rerolled, 0);
  assert.equal(migrated.factory.stats.gemComposed, 0);

  const c2 = loadContext();
  const weird = { version: 1, player: { level: 10 }, equipment: {}, inventory: [], taskState: { idx: 999 } };
  const migrated2 = c2.migrateSave(weird);
  assert.equal(migrated2.taskState.idx, c2.TASKS.length); // 超出上限＝全部領完
  const c3 = loadContext();
  const bad = { version: 1, player: { level: 10 }, equipment: {}, inventory: [], taskState: { idx: 'x' } };
  assert.equal(c3.migrateSave(bad).taskState.idx, 0);
});

/* ---- 8. 掛勾遞增 ---- */
test('composeGems 與 consumeRerollResources 遞增對應統計', () => {
  const c = loadContext();
  const type = Object.keys(c.GEM_TYPES)[0];
  c.addGem(type, 1, 3);
  c.G.player.gold = 10000000;
  const err = c.composeGems(type, 1);
  assert.equal(err, null);
  assert.equal(c.G.factory.stats.gemComposed, 1);
  assert.equal(c.taskProgressFor({ type: 'composeCount' }), 1);

  c.consumeRerollResources({ gold: 0, essence: 0 });
  c.consumeRerollResources({ gold: 0, essence: 0 });
  assert.equal(c.G.factory.stats.rerolled, 2);
  assert.equal(c.taskProgressFor({ type: 'rerollCount' }), 2);
});

/* ---- stageClear / skillLevel 進度 ---- */
test('stageClear 讀 zoneBestProgress；skillLevel 讀技能等級', () => {
  const c = loadContext();
  c.G.stage.zone = 'plains';
  c.G.stage.best = 21; // 已通關 20
  assert.equal(c.taskProgressFor({ type: 'stageClear', param: 'plains', count: 20 }), 20);
  // 非當前地圖走 zoneProgress
  c.G.stage.zone = 'desert';
  c.G.zoneProgress.plains.best = 31;
  assert.equal(c.taskProgressFor({ type: 'stageClear', param: 'plains', count: 30 }), 30);

  // 開局自帶 manaBarrier 1 級；regenerate 未學 → 0
  assert.equal(c.taskProgressFor({ type: 'skillLevel', param: 'manaBarrier', count: 5 }), 1);
  assert.equal(c.taskProgressFor({ type: 'skillLevel', param: 'regenerate', count: 1 }), 0);
});
