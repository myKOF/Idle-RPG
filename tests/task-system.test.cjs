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

/* 最後一個任務的內容由 Task.xlsx 決定（會隨企劃增列而變），所以斷言一律從
   TASKS[last] 反推，不寫死順序與獎勵數字；只固定「型別是 stageClear＋獎勵是 equip」
   這個前提，前提若被改掉會由 assert 訊息直接指出來。 */
test('taskClaim：最後一個任務領完後 quick view 回 idx -1', () => {
  const c = loadContext();
  const last = c.TASKS[c.TASKS.length - 1];
  assert.equal(last.type, 'stageClear', '本測試假設最後一個任務是 stageClear');
  assert.equal(last.rewardType, 'equip', '本測試假設最後一個任務獎勵是 equip');
  c.G.taskState.idx = c.TASKS.length - 1;
  c.G.stage.zone = last.param;
  c.G.zoneProgress[last.param].cleared = last.count;
  const invBefore = c.G.inventory.length;
  const r = c.taskClaim();
  assert.equal(r.claimed, last.order);
  assert.equal(r.next, null);
  // 獎勵：equip 參數＝品質|等級|太古數，直接入包
  const [rarity, level, ancient] = String(last.rewardParam).split('|').map(Number);
  assert.equal(c.G.inventory.length, invBefore + last.rewardQty);
  const it = c.G.inventory[c.G.inventory.length - 1];
  assert.equal(it.rarity, rarity);
  assert.equal(it.level, level);
  assert.equal(c.getItemAncientCount(it), ancient);
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
test('stageClear 讀 zoneClearedStage；skillLevel 讀技能等級', () => {
  const c = loadContext();
  c.G.stage.zone = 'desert';
  c.G.stage.best = 21; // 已通關 20
  assert.equal(c.taskProgressFor({ type: 'stageClear', param: 'desert', count: 20 }), 20);
  // 非當前地圖走 zoneProgress
  c.G.stage.zone = 'Icefield';
  c.G.zoneProgress.desert.best = 31;
  assert.equal(c.taskProgressFor({ type: 'stageClear', param: 'desert', count: 30 }), 30);

  // 開局自帶 manaBarrier 1 級；regenerate 未學 → 0
  assert.equal(c.taskProgressFor({ type: 'skillLevel', param: 'manaBarrier', count: 5 }), 1);
  assert.equal(c.taskProgressFor({ type: 'skillLevel', param: 'regenerate', count: 1 }), 0);
});

/* ---- stageClear：地圖最後一關（best 被上限夾住，只有 cleared 分得出來）---- */
test('stageClear：荒漠第 200 關（＝上限）打贏才算達成，只到 199 關不算', () => {
  const c = loadContext();
  const goal = { type: 'stageClear', param: 'desert', count: 200 };
  c.G.stage.zone = 'desert';
  // 打贏第 199 關：best 前進到 200（＝上限），cleared 199
  c.G.stage.best = 200;
  c.G.zoneProgress.desert.cleared = 199;
  assert.equal(c.taskProgressFor(goal), 199, 'best 已到上限，但只通關 199 關');
  // 打贏第 200 關：best 仍被夾在 200，cleared 才前進
  c.G.zoneProgress.desert.cleared = 200;
  assert.equal(c.taskProgressFor(goal), 200);
});

test('zoneClearedStage：舊存檔沒有 cleared 時以 best-1 回推，進度不倒退', () => {
  const c = loadContext();
  c.G.stage.zone = 'Icefield';
  delete c.G.zoneProgress.desert.cleared;
  c.G.zoneProgress.desert.best = 151;
  assert.equal(c.zoneClearedStage('desert'), 150);
  // markZoneCleared 只增不減
  c.markZoneCleared('desert', 120);
  assert.equal(c.zoneClearedStage('desert'), 150);
  c.markZoneCleared('desert', 180);
  assert.equal(c.zoneClearedStage('desert'), 180);
});

/* ---- towerFloor / forgePartLevel ---- */
test('towerFloor 讀 G.tower.highest；forgePartLevel 讀零件等級最高值', () => {
  const c = loadContext();
  const towerGoal = { type: 'towerFloor', count: 5 };
  assert.equal(c.taskProgressFor(towerGoal), 0); // 開局未挑戰高塔
  c.G.tower.highest = 5;
  assert.equal(c.taskProgressFor(towerGoal), 5);

  const partGoal = { type: 'forgePartLevel', count: 3 };
  assert.equal(c.taskProgressFor(partGoal), 1); // 開局零件皆 1 級
  c.G.factory.partLevels.goldSluice = 3;
  assert.equal(c.taskProgressFor(partGoal), 3);
  // 零件等級是全域的：沒裝在熔爐上也算（與 forgeParts 不同）
  assert.equal(c.taskProgressFor({ type: 'forgeParts' }), 0);
});

test('migrateSave：舊存檔補 zoneProgress.cleared（由 best-1 回推）', () => {
  const c = loadContext();
  const old = {
    version: 1, player: { level: 10 }, equipment: {}, inventory: [],
    stage: { current: 100, best: 120, zone: 'desert' },
    zoneProgress: { desert: { current: 100, best: 120 } }
  };
  const m = c.migrateSave(old);
  assert.equal(m.zoneProgress.desert.cleared, 119);
  assert.equal(m.zoneProgress.Icefield.cleared, 0); // 未開的地圖補 0
  // 已有 cleared 的存檔不被 best-1 蓋掉（打贏最後一關的情形）
  const c2 = loadContext();
  const saved = {
    version: 1, player: { level: 10 }, equipment: {}, inventory: [],
    stage: { current: 200, best: 200, zone: 'desert' },
    zoneProgress: { desert: { current: 200, best: 200, cleared: 200 } }
  };
  assert.equal(c2.migrateSave(saved).zoneProgress.desert.cleared, 200);
});
