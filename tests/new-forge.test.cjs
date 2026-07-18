const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// vm 沙箱物件與本 realm 原型不同，深度比較前先 JSON 正規化
const plain = (v) => JSON.parse(JSON.stringify(v));

/* ---- vm 沙箱：載入遊戲邏輯（依需求增減檔案；hostname 可模擬外服） ---- */
function loadContext(files, hostname) {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {}, sel: null },
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, key() { return null; }, length: 0 },
    location: { hostname: hostname || '127.0.0.1', reload() {} },
    setTimeout() {}, clearTimeout() {},
    Date, JSON,
  };
  context.window = context;
  context.flog = () => {};
  context.blog = () => {};
  vm.createContext(context);
  files.forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

const LOGIC_FILES = ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js', 'js/player.js', 'js/factory.js', 'js/newforge.js'];

function freshG(context) {
  context.G = context.newGameState();
  context.G.factory.autoEquip = false; // 測試預設關閉自動換裝，聚焦路由邏輯
  return context.G;
}

/* ============ 1. 常數（合併版） ============ */

test('合併版常數：零件格 3~8、熔爐上限 12/轉生連動、統一大圖；專屬材料表已刪除', () => {
  const c = loadContext(['js/util.js', 'js/data.js']);
  assert.equal(c.NEW_FORGE_MAX, 12);
  assert.equal(c.NEW_FORGE_BASE_FURNACES, 2);
  assert.equal(c.NEW_FORGE_FURNACE_PER_REINC, 1);
  assert.equal(c.NEW_FORGE_PART_SLOTS_INITIAL, 3);
  assert.equal(c.NEW_FORGE_PART_SLOTS_MAX, 8, '零件格上限應提升為 8');
  assert.equal(c.NEW_FORGE_SLOT_COST_REINC, 50000);
  assert.equal(c.NEW_FORGE_SLOT_COST_BASE, 10000);
  assert.equal(c.NEW_FORGE_SLOT_COST_EXP, 4);
  assert.equal(c.NEW_FORGE_IMAGE, 'images/furnace_LV1.png');
  assert.ok(fs.existsSync(path.join(root, 'images/furnace_LV1.png')), '缺少 furnace_LV1.png');
  // 專屬材料/產出/配方表已全數移除（拆解改用舊分解槽規則）
  assert.equal(c.NEW_FORGE_MATERIALS, undefined);
  assert.equal(c.NEW_FORGE_SALVAGE_YIELD, undefined);
  assert.equal(c.NEW_FORGE_CRAFT_RECIPES, undefined);
  assert.equal(c.NEW_FORGE_SMELT_RECIPES, undefined);
});

/* ============ 2. 公式 ============ */

test('newForgeMaxFurnaces：0轉=2、每轉+1、上限12', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  assert.equal(c.newForgeMaxFurnaces(0), 2);
  assert.equal(c.newForgeMaxFurnaces(1), 3);
  assert.equal(c.newForgeMaxFurnaces(5), 7);
  assert.equal(c.newForgeMaxFurnaces(10), 12);
  assert.equal(c.newForgeMaxFurnaces(99), 12);
});

test('newForgePartSlotCost：50000×轉生²＋10000×(已解鎖-1)^(4＋熔爐數)', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  // 0轉、2座熔爐、已解鎖3格 → 第4格：10000×2^6 = 640000
  assert.equal(c.newForgePartSlotCost(0, 3, 2), 640000);
  // 0轉、2座、已解鎖4 → 第5格：10000×3^6 = 7290000
  assert.equal(c.newForgePartSlotCost(0, 4, 2), 7290000);
  // 2轉、3座、已解鎖3 → 50000×4 + 10000×2^7 = 200000 + 1280000
  assert.equal(c.newForgePartSlotCost(2, 3, 3), 200000 + 10000 * Math.pow(2, 7));
  // 第 8 格（已解鎖 7）：0轉、1座 → 10000×6^5
  assert.equal(c.newForgePartSlotCost(0, 7, 1), 10000 * Math.pow(6, 5));
});

/* ============ 3. 裝備導入（全服一律進熔爐佇列） ============ */

test('pushConveyor：一律進熔爐佇列；佇列滿載丟棄（不再回退舊輸送帶）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  assert.equal(c.pushConveyor(c.makeEquipment(10, { rarity: 0, level: 10 })), true);
  assert.equal(G.newForge.queue.length, 1);
  assert.equal(G.factory.conveyor.length, 0);
  // 滿載 → 丟棄（回 false），舊輸送帶不再收件
  G.newForge.queue.length = c.NEW_FORGE_QUEUE_CAP;
  assert.equal(c.pushConveyor(c.makeEquipment(10, { rarity: 0, level: 10 })), false);
  assert.equal(G.factory.conveyor.length, 0);
  assert.equal(G.newForge.queue.length, c.NEW_FORGE_QUEUE_CAP);
});

test('外服 hostname：導入與 tick 行為與本地一致（本地服限定已解除）', () => {
  const c = loadContext(LOGIC_FILES, 'mygame.github.io');
  const G = freshG(c);
  assert.equal(typeof c.newForgeHostAvailable, 'undefined', '本地服閘門應移除');
  assert.equal(c.pushConveyor(c.makeEquipment(10, { rarity: 0, level: 10 })), true);
  assert.equal(G.newForge.queue.length, 1);
  assert.equal(G.factory.conveyor.length, 0);
  c.newForgeTick(2.1); // 路由應執行
  assert.equal(G.newForge.queue.length, 0, '外服 tick 應正常處理佇列');
});

/* ============ 4. 熔爐結構與品質路由 ============ */

test('預設熔爐：單傳送帶結構、品質勾選預設普通~傳說、零件格 3', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  assert.equal(G.newForge.furnaces.length, 1);
  assert.equal(G.newForge.intake, undefined, '導入開關已移除');
  assert.equal(G.player.forgeMats, undefined, '專屬材料計數已移除');
  const fu = G.newForge.furnaces[0];
  assert.equal(fu.enabled, true);
  assert.ok(Array.isArray(fu.belt));
  assert.equal(fu.qualities.length, c.RARITIES.length);
  assert.deepEqual(plain(fu.qualities.slice(0, 6)), [true, true, true, true, true, true]);
  assert.equal(fu.qualities[6], false);
  assert.equal(fu.qualities[7], false);
  assert.equal(fu.qualities[8], false);
  assert.equal(fu.partSlots, 3);
  assert.ok(Array.isArray(fu.parts));
});

test('品質路由：勾選品質上帶、未勾/上鎖/神鑄創世保留入包；帶滿等待', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const a = c.makeEquipment(10, { rarity: 0, level: 10 });      // 勾選 → 上帶
  const b = c.makeEquipment(10, { rarity: 6, level: 10 });      // 神話未勾 → 保留
  const lk = c.makeEquipment(10, { rarity: 0, level: 10 });     // 上鎖 → 保留
  lk.locked = true;
  const gf = c.makeEquipment(10, { rarity: 8, level: 10 });     // 神鑄創世 → 保留
  G.newForge.queue.push(a, b, lk, gf);
  c.newForgeRouteQueue();
  assert.equal(fu.belt.length, 1);
  assert.equal(fu.belt[0].id, a.id);
  assert.equal(G.inventory.length, 3);
  assert.equal(G.newForge.stats.kept, 3);
  assert.equal(G.newForge.queue.length, 0);
  // 帶滿 → 留佇列等待
  while (fu.belt.length < c.NEW_FORGE_BELT_CAP) fu.belt.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  const w = c.makeEquipment(10, { rarity: 1, level: 10 });
  G.newForge.queue.push(w);
  c.newForgeRouteQueue();
  assert.equal(G.newForge.queue.length, 1, '帶滿時勾選品質應留在佇列');
  assert.equal(G.newForge.queue[0].id, w.id);
});

test('多熔爐路由：裝備進第一座啟用且勾選該品質的熔爐；停用熔爐跳過', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  G.player.reincarnations = 3; // 允許 5 座
  const fu1 = G.newForge.furnaces[0];
  assert.equal(c.addNewForgeFurnace(), null);
  const fu2 = G.newForge.furnaces[1];
  // fu1 只收精良、fu2 只收普通
  fu1.qualities = fu1.qualities.map(() => false); fu1.qualities[1] = true;
  fu2.qualities = fu2.qualities.map(() => false); fu2.qualities[0] = true;
  const common = c.makeEquipment(10, { rarity: 0, level: 10 });
  const fine = c.makeEquipment(10, { rarity: 1, level: 10 });
  G.newForge.queue.push(common, fine);
  c.newForgeRouteQueue();
  assert.equal(fu2.belt.length, 1);
  assert.equal(fu2.belt[0].id, common.id);
  assert.equal(fu1.belt.length, 1);
  assert.equal(fu1.belt[0].id, fine.id);
  // 停用 fu2 → 普通品質無人收 → 保留入包
  fu2.enabled = false;
  const common2 = c.makeEquipment(10, { rarity: 0, level: 10 });
  G.newForge.queue.push(common2);
  c.newForgeRouteQueue();
  assert.equal(fu2.belt.length, 1, '停用熔爐不收件');
  assert.ok(G.inventory.some((x) => x && x.id === common2.id), '無熔爐可收時保留入包');
});

test('路由平均分流：同設定多爐分派給帶上最少者；單輪路由量足以補滿空帶（不再被前面熔爐餓死）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  G.player.reincarnations = 2; // 允許 4 座
  c.addNewForgeFurnace();
  c.addNewForgeFurnace(); // 3 座同預設設定（普通~傳說）
  const fu1 = G.newForge.furnaces[0];
  const fu2 = G.newForge.furnaces[1];
  const fu3 = G.newForge.furnaces[2];
  // 重現回報情境：1 號爐帶滿、後面兩座空帶、佇列大排長龍
  while (fu1.belt.length < c.NEW_FORGE_BELT_CAP) fu1.belt.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  for (let i = 0; i < 20; i++) G.newForge.queue.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  c.newForgeRouteQueue();
  assert.equal(G.newForge.queue.length, 0);
  assert.equal(fu2.belt.length, 10, '空帶應平均分流');
  assert.equal(fu3.belt.length, 10, '不再全部塞給前面的熔爐');
  // 單輪即可補滿整帶（每輪每爐路由額度＝帶容量）
  for (let i = 0; i < 200; i++) G.newForge.queue.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  c.newForgeRouteQueue();
  assert.equal(fu2.belt.length, c.NEW_FORGE_BELT_CAP, '單輪應能補滿空帶');
  assert.equal(fu3.belt.length, c.NEW_FORGE_BELT_CAP);
  assert.equal(G.newForge.queue.length, 160, '全滿後其餘留佇列等待（FIFO）');
});

/* ============ 5. 入爐拆解（沿用舊分解槽規則＋該爐零件加成） ============ */

test('入爐拆解：doSalvage 舊規則產出碎片/金幣、鑲嵌寶石取回、統計累計', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  c.rnd = () => 1;                 // 固定化：碎片/金幣可精確斷言
  c.chance = (p) => p >= 100;      // 機率事件只在 ≥100% 成立
  const fu = G.newForge.furnaces[0];
  const it = c.makeEquipment(10, { rarity: 3, level: 10 });
  it.sockets = [{ type: 'ruby', level: 2 }, null];
  fu.belt.push(it);
  const scrapBefore = G.player.scrap;
  const goldBefore = G.player.gold;
  c.newForgeConsumeOne(fu);
  assert.equal(fu.belt.length, 0);
  const salv = c.RARITIES[3].salv;
  const expScrap = Math.max(1, Math.round((2 + 10 * 0.6) * salv * 1));
  assert.equal(G.player.scrap - scrapBefore, expScrap, '碎片依 salvageResult 公式');
  assert.equal(G.player.gold - goldBefore, Math.round((3 + 10) * salv * 0.5), '金幣依 salvageResult 公式');
  assert.equal(G.player.gems.ruby[2], 1, '鑲嵌寶石應取回');
  assert.equal(G.newForge.stats.salvaged, 1);
  assert.equal(G.factory.stats.salvaged, 1, '沿用 doSalvage → 工廠統計同步累計');
});

test('熔爐零件加成：碎片熔煉爐 +100% 使該爐拆解碎片翻倍（其他爐不受影響）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  c.rnd = () => 1;
  c.chance = (p) => p >= 100;
  const fu = G.newForge.furnaces[0];
  // 基準：無零件拆解
  const it1 = c.makeEquipment(10, { rarity: 2, level: 10 });
  const base = c.doSalvage(it1, true);
  // 該爐裝 1 顆 +100% 碎片熔煉爐（perTier 20 × T5 = 100）
  G.factory.parts.push({ id: 'sf', key: 'scrapForge', tier: 5, val: 100, name: '碎片熔煉爐 T5' });
  assert.equal(c.newForgeInstallPart(fu.id, 'scrapForge'), null);
  const it2 = c.makeEquipment(10, { rarity: 2, level: 10 });
  const boosted = c.newForgeSalvage(it2, fu);
  assert.equal(boosted.scrap, base.scrap * 2, '爐上零件應套用於該爐拆解');
  // 手動 doSalvage（無 bonus 參數）不吃熔爐零件加成
  const it3 = c.makeEquipment(10, { rarity: 2, level: 10 });
  assert.equal(c.doSalvage(it3, true).scrap, base.scrap);
});

/* ============ 6. 熔爐數量＝轉生連動 ============ */

test('熔爐上限：0轉2座、轉生後遞增、cap 12；移除熔爐帶內容退回', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  assert.equal(c.addNewForgeFurnace(), null); // 第 2 座
  assert.match(String(c.addNewForgeFurnace()), /轉生|上限/, '0轉第3座應被拒');
  G.player.reincarnations = 1;
  assert.equal(c.addNewForgeFurnace(), null); // 1轉 → 3 座
  assert.match(String(c.addNewForgeFurnace()), /轉生|上限/);
  G.player.reincarnations = 99;
  for (let i = G.newForge.furnaces.length; i < 12; i++) assert.equal(c.addNewForgeFurnace(), null);
  assert.match(String(c.addNewForgeFurnace()), /上限/);
  // 移除退回
  const fu = G.newForge.furnaces[11];
  const it = c.makeEquipment(10, { rarity: 0, level: 10 });
  fu.belt.push(it);
  c.removeNewForgeFurnace(fu.id);
  assert.equal(G.newForge.furnaces.length, 11);
  assert.ok(G.inventory.some((x) => x && x.id === it.id));
});

/* ============ 7. 零件格解鎖（上限 8） ============ */

test('零件格：初始3、金幣逐格解鎖至8；金幣不足/已滿拒絕', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const cost = c.newForgePartSlotCost(0, 3, 1); // 10000×2^5
  assert.equal(cost, 10000 * Math.pow(2, 5));
  G.player.gold = cost - 1;
  assert.match(String(c.unlockNewForgePartSlot(fu.id)), /金幣不足/);
  assert.equal(fu.partSlots, 3);
  G.player.gold = cost + 5;
  assert.equal(c.unlockNewForgePartSlot(fu.id), null);
  assert.equal(fu.partSlots, 4);
  assert.equal(G.player.gold, 5);
  G.player.gold = 1e30;
  while (fu.partSlots < 8) assert.equal(c.unlockNewForgePartSlot(fu.id), null);
  assert.equal(fu.partSlots, 8);
  assert.match(String(c.unlockNewForgePartSlot(fu.id)), /上限/);
});

test('待進帶計數：依路由規則歸屬各熔爐；上鎖/神鑄創世/未勾品質不計', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  G.player.reincarnations = 1;
  c.addNewForgeFurnace();
  const fu1 = G.newForge.furnaces[0];
  const fu2 = G.newForge.furnaces[1];
  fu1.qualities = fu1.qualities.map(() => false); fu1.qualities[1] = true; // 只收精良
  fu2.qualities = fu2.qualities.map(() => false); fu2.qualities[0] = true; // 只收普通
  for (let i = 0; i < 3; i++) G.newForge.queue.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  for (let i = 0; i < 2; i++) G.newForge.queue.push(c.makeEquipment(5, { rarity: 1, level: 5 }));
  G.newForge.queue.push(c.makeEquipment(5, { rarity: 6, level: 5 }));   // 神話未勾 → 不計
  const lk = c.makeEquipment(5, { rarity: 0, level: 5 }); lk.locked = true;
  G.newForge.queue.push(lk);                                            // 上鎖 → 不計
  const counts = c.newForgePendingCounts();
  assert.equal(counts[fu2.id], 3);
  assert.equal(counts[fu1.id], 2);
  // 同品質多爐：各爐獨立計數（同件可同時計入多爐——「能進此爐的排隊數」）
  fu1.qualities[0] = true;
  const counts2 = c.newForgePendingCounts();
  assert.equal(counts2[fu1.id], 5, 'fu1 收普通+精良 → 5');
  assert.equal(counts2[fu2.id], 3, 'fu2 仍收普通 → 3，不被第一座獨佔');
  // 停用的熔爐不計
  fu2.enabled = false;
  const counts3 = c.newForgePendingCounts();
  assert.equal(counts3[fu2.id] || 0, 0);
});

/* ============ 8. 零件安裝（共用零件池、快照自由裝配） ============ */

function mkPart(c, id, key, tier) {
  const pt = c.PART_TYPES[key];
  return { id, key, tier, val: pt.perTier * tier, name: pt.name + ' T' + tier };
}

test('零件自由裝配：依類型安裝快照、同型可重複裝滿、不佔用零件庫、多爐共用', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  G.player.reincarnations = 1;
  c.addNewForgeFurnace();
  const fu1 = G.newForge.furnaces[0];
  const fu2 = G.newForge.furnaces[1];
  G.factory.parts.push(mkPart(c, 'sgLow', 'speedGear', 2), mkPart(c, 'sgHigh', 'speedGear', 5), mkPart(c, 'sy', 'luckCore', 3));
  // 依類型安裝：取最高階（T5）快照
  assert.equal(c.newForgeInstallPart(fu1.id, 'speedGear'), null);
  assert.equal(fu1.parts[0].key, 'speedGear');
  assert.equal(fu1.parts[0].tier, 5, '應取最高階零件數值');
  // 同型重複裝滿（不限數量）
  assert.equal(c.newForgeInstallPart(fu1.id, 'speedGear'), null);
  assert.equal(c.newForgeInstallPart(fu1.id, 'speedGear'), null);
  assert.match(String(c.newForgeInstallPart(fu1.id, 'speedGear')), /已滿/, '僅零件格數為上限');
  // 不佔用零件庫：另一爐照樣可裝、零件池原封不動
  assert.equal(c.newForgeInstallPart(fu2.id, 'speedGear'), null);
  assert.equal(G.factory.parts.length, 3, '安裝不消耗零件');
  assert.equal(c.isInstalled('sgHigh'), false, '不佔用實例');
  // 非分解槽零件與未持有類型拒絕
  assert.match(String(c.newForgeInstallPart(fu2.id, 'luckCore')), /無法安裝/);
  assert.match(String(c.newForgeInstallPart(fu2.id, 'bookScavenger')), /尚無此類型/);
  // 卸下（依格位索引）：僅移除快照
  assert.equal(c.newForgeUninstallPart(fu1.id, 1), true);
  assert.equal(fu1.parts.length, 2);
  assert.equal(G.factory.parts.length, 3);
});

test('加速齒輪快照生效：同型堆疊、速度倍率＝1＋Σ(數值＋固定加成)/100', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const sg = mkPart(c, 'sg1', 'speedGear', 2);
  G.factory.parts.push(sg);
  c.newForgeInstallPart(fu.id, 'speedGear');
  c.newForgeInstallPart(fu.id, 'speedGear');
  const one = c.effectiveFactoryPartValue('speedGear', sg.val);
  assert.ok(Math.abs(c.newForgeFurnaceSpeed(fu) - (1 + (one * 2) / 100)) < 1e-9, '同型快照效果應堆疊');
});

test('sanitize：舊 id 陣列轉快照、無效項剔除、超量截斷', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const state = c.newGameState();
  const p1 = mkPart(c, 'p1', 'speedGear', 3);
  state.factory.parts.push(p1);
  const fu1 = state.newForge.furnaces[0];
  // 舊版存檔形狀：parts 為零件 id 字串陣列（ghost 失效）＋壞物件
  fu1.parts = ['p1', 'ghost', { bogus: 1 }, { key: 'scrapForge', tier: 2, val: 40, name: '碎片熔煉爐 T2' }];
  c.migrateSave(state);
  assert.equal(fu1.parts.length, 2);
  assert.equal(fu1.parts[0].key, 'speedGear', '舊 id 應轉為快照');
  assert.equal(fu1.parts[0].tier, 3);
  assert.equal(fu1.parts[1].key, 'scrapForge', '合法快照保留');
  // 超量截斷（partSlots=3）
  fu1.parts = [1, 2, 3, 4, 5].map(() => ({ key: 'speedGear', tier: 1, val: 25, name: 'x' }));
  c.migrateSave(state);
  assert.equal(fu1.parts.length, 3);
});

/* ============ 9. 存檔遷移（合併版） ============ */

test('合併前存檔：intake/forgeMats 移除、舊輸送帶併入佇列、公告旗標設為未讀、舊分解槽安裝解除', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const state = c.newGameState();
  // 模擬合併前形狀
  delete state.newForge.noticeShown;
  delete state.newForge.tabSeen;
  state.newForge.intake = true;
  state.player.forgeMats = { slag: 5, ironShard: 3 };
  const convA = c.makeEquipment(10, { rarity: 0, level: 10 });
  const convB = c.makeEquipment(10, { rarity: 1, level: 10 });
  state.factory.conveyor.push(convA, convB);
  state.factory.installed.salvage = ['x1', 'x2'];
  c.migrateSave(state);
  assert.equal(state.newForge.intake, undefined, '導入開關欄位應移除');
  assert.equal(state.player.forgeMats, undefined, '專屬材料計數應移除');
  assert.equal(state.factory.conveyor.length, 0, '舊輸送帶滯留裝備應併入佇列');
  const qIds = state.newForge.queue.map((x) => x && x.id);
  assert.ok(qIds.includes(convA.id) && qIds.includes(convB.id));
  assert.equal(state.newForge.noticeShown, false, '合併前存檔應觸發改版公告');
  assert.equal(state.newForge.tabSeen, false, '頁籤應閃爍至玩家切頁');
  assert.equal(state.factory.installed.salvage.length, 0, '舊分解槽零件安裝應解除');
});

test('無 newForge 的更舊存檔（外服舊熔爐玩家）：建立結構且公告未讀', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']), 'mygame.github.io');
  const state = c.newGameState();
  delete state.newForge;
  const convA = c.makeEquipment(10, { rarity: 0, level: 10 });
  state.factory.conveyor.push(convA);
  c.migrateSave(state);
  assert.ok(state.newForge && Array.isArray(state.newForge.furnaces));
  assert.equal(state.newForge.noticeShown, false);
  assert.equal(state.newForge.tabSeen, false);
  assert.ok(state.newForge.queue.some((x) => x && x.id === convA.id), '輸送帶裝備併入佇列');
});

test('已合併存檔：公告旗標保留原值，不重複觸發', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const seen = c.newGameState(); // 新局：noticeShown=true
  c.migrateSave(seen);
  assert.equal(seen.newForge.noticeShown, true);
  assert.equal(seen.newForge.tabSeen, true);
  const pending = c.newGameState(); // 已收到公告但尚未按確認/切頁就存檔
  pending.newForge.noticeShown = false;
  pending.newForge.tabSeen = false;
  c.migrateSave(pending);
  assert.equal(pending.newForge.noticeShown, false, '未讀狀態應維持');
  assert.equal(pending.newForge.tabSeen, false);
});

test('V2 存檔（lines 形狀）→ V3：品質承接拆解線、帶上裝備回佇列、超額熔爐裁減', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const state = c.newGameState();
  const beltItem = c.makeEquipment(10, { rarity: 1, level: 10 });
  const craftItem = c.makeEquipment(10, { rarity: 1, level: 10 });
  state.player.reincarnations = 0; // 上限 2 座
  state.newForge.furnaces = [
    { id: 1, ftype: 'smith', lines: [{ id: 'l1', filter: 'salvage', enabled: true,
      salvage: { actions: ['keep', 'salvage', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep'], conds: [] },
      craft: { recipe: 0 }, smelt: { product: 'ironIngot' },
      belt: [{ kind: 'salv', item: beltItem }, { kind: 'craft', item: craftItem, recipe: 0 }, { kind: 'smelt', product: 'ironIngot' }], timer: 0 }] },
    { id: 2, ftype: 'rune', lines: [] },
    { id: 3, ftype: 'smith', lines: [] },
  ];
  state.newForge.nextId = 4;
  c.migrateSave(state);
  assert.ok(state.newForge.furnaces.length <= 2, '0轉超額熔爐應裁減');
  const fu = state.newForge.furnaces[0];
  assert.equal(fu.lines, undefined, 'V2 lines 應移除');
  assert.equal(fu.qualities[0], false);
  assert.equal(fu.qualities[1], true, '拆解線 salvage 設定應轉為勾選');
  assert.equal(fu.partSlots, 3);
  // 帶上裝備（salv+craft）回佇列；smelt 批次（材料系統已移除）直接捨棄不致錯
  const qIds = state.newForge.queue.map((x) => x.id);
  assert.ok(qIds.includes(beltItem.id));
  assert.ok(qIds.includes(craftItem.id));
});

test('V3 淨化：qualities 補長度且神鑄創世恆 false、partSlots 夾 3~8、壞帶項剔除', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const state = c.newGameState();
  const fu = state.newForge.furnaces[0];
  fu.qualities = [true, 'x', true];
  fu.qualities[8] = true;
  fu.partSlots = 99;
  fu.belt = [null, { bogus: 1 }, c.makeEquipment(5, { rarity: 0, level: 5 })];
  c.migrateSave(state);
  assert.equal(fu.qualities.length, c.RARITIES.length);
  assert.equal(fu.qualities[8], false, '神鑄創世不可勾選');
  assert.equal(fu.partSlots, 8, 'partSlots 上限應為 8');
  assert.equal(fu.belt.length, 1, '壞帶項應剔除、裝備保留');
});

/* ============ 10. 接線靜態檢查 ============ */

test('index.html/ui.js/main.js/factory.js/gm.js 接線（合併版）', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /data-tab="newforge">🏭 熔爐/, '熔爐頁籤應由新熔爐取代且不再隱藏');
  assert.ok(!/data-tab="factory"/.test(html), '舊熔爐頁籤應移除');
  assert.ok(!/id="tab-factory"/.test(html), '舊熔爐分頁區段應移除');
  assert.match(html, /<section id="tab-newforge" class="tab">/);
  assert.match(html, /<script src="js\/newforge\.js"><\/script>/);
  assert.ok(!/nf-intake/.test(html), '導入開關應移除');
  assert.ok(!/nf-return-queue/.test(html), '佇列退回按鈕應移除');
  assert.ok(!/nf-mats/.test(html), '材料庫存區應移除');
  assert.ok(!/flt-sel/.test(html), '舊篩選節點應移除');
  assert.match(html, /id="forge-rebuild-modal"/, '應有改版公告彈窗');
  assert.match(html, /id="forge-rebuild-ok"/);
  assert.ok(!/id="up-enabled"/.test(html), '強化節點界面應被刪除');
  assert.match(html, /id="enc-books"/, '附魔書庫存應搬入熔爐分頁保留');

  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /UI\.tab === 'newforge'/);
  assert.match(ui, /function renderNewForge/);
  assert.match(ui, /fmtFull\(nf\.queue\.length\)/, '佇列應顯示完整數字');
  assert.ok(!/newForgeHostAvailable/.test(ui), '本地服閘門應移除');
  assert.ok(!/renderFactory/.test(ui), '舊生產線渲染應移除');
  assert.match(ui, /function updateForgeTabGlow/, '應有頁籤閃爍控制');
  assert.match(ui, /function showForgeRebuildNotice/, '應有改版公告彈窗控制');
  assert.match(ui, /nf-glow/);
  assert.match(ui, /data-nf-qual/, '應有品質勾選面板');
  assert.match(ui, /newForgePartSlotCost/, '零件格解鎖應顯示公式成本');
  assert.match(ui, /data-nf-partinstall-key/, '零件列表應可點擊安裝');
  assert.match(ui, /nf-parts-list'\)\s*\|\|\s*t\.closest\('\.nf-parts-row/, '點擊零件界面外任意處應收起零件列表');
  assert.match(ui, /belt\.slice\(0, NEW_FORGE_BELT_SHOW\)/, '帶顯示上限應用顯示常數');
  assert.ok(!/由右至左/.test(ui), '「由右至左」文字應移除');
  assert.match(ui, /newForgePendingCounts/, '帶尾應顯示待進帶數量');
  assert.match(ui, /data-nf-more/, '帶尾應有固定 +N 區');

  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(css, /\.tab-btn\.nf-glow/, '應有頁籤閃爍樣式');

  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  assert.match(main, /newForgeTick/);
  assert.match(main, /showForgeRebuildNotice/, '載入後應觸發改版公告');

  const factory = fs.readFileSync(path.join(root, 'js/factory.js'), 'utf8');
  assert.match(factory, /newForgeTryIntake/);
  assert.match(factory, /function doSalvage\(it, silent, bonus\)/, '分解應支援零件加成來源參數');

  const gm = fs.readFileSync(path.join(root, 'js/gm.js'), 'utf8');
  assert.ok(!/nfmat/.test(gm), 'nfmat 指令應移除');
});
