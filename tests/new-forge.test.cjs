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
  context.G.factory.autoEquip = false; // 測試預設關閉自動換裝，聚焦傳送帶邏輯
  return context.G;
}

/* ============ 1. 資料表（企劃書數值） ============ */

test('材料註冊表：15 種材料齊全', () => {
  const c = loadContext(['js/util.js', 'js/data.js']);
  const keys = Object.keys(c.NEW_FORGE_MATERIALS);
  assert.equal(keys.length, 15);
  const names = keys.map((k) => c.NEW_FORGE_MATERIALS[k].name);
  ['爐渣', '碎鐵塊', '碎銀', '碎金塊', '秘銀碎片', '瑟銀碎片', '奧金碎片', '魔鋼碎片',
    '鐵錠', '銀錠', '金錠', '秘銀', '瑟銀', '奧金', '魔鋼'].forEach((n) => {
    assert.ok(names.includes(n), '缺少材料：' + n);
  });
});

test('拆解產出表：8 個品質列數值與企劃書一致', () => {
  const c = loadContext(['js/util.js', 'js/data.js']);
  const y = c.NEW_FORGE_SALVAGE_YIELD;
  assert.equal(y.length, 8);
  assert.deepEqual(plain(y[0]), { slag: 1, ironShard: 0.5, silverShard: 0.1 });
  assert.deepEqual(plain(y[1]), { slag: 2, ironShard: 0.6, silverShard: 0.2, goldShard: 0.1 });
  assert.deepEqual(plain(y[2]), { slag: 3, ironShard: 0.8, silverShard: 0.3, goldShard: 0.25 });
  assert.deepEqual(plain(y[3]), { slag: 4, ironShard: 1, silverShard: 0.4, goldShard: 0.3, mithrilShard: 0.1, thoriumShard: 0.01, arcaniteShard: 0.001 });
  assert.deepEqual(plain(y[4]), { slag: 5, ironShard: 2, silverShard: 0.6, goldShard: 0.5, mithrilShard: 0.25, thoriumShard: 0.02, arcaniteShard: 0.002, magisteelShard: 0.0002 });
  assert.deepEqual(plain(y[5]), { slag: 7, ironShard: 3, silverShard: 1, goldShard: 0.75, mithrilShard: 0.5, thoriumShard: 0.2, arcaniteShard: 0.04, magisteelShard: 0.01 });
  assert.deepEqual(plain(y[6]), { slag: 10, ironShard: 10, silverShard: 10, goldShard: 5, mithrilShard: 3, thoriumShard: 1, arcaniteShard: 1 });
  assert.deepEqual(plain(y[7]), { slag: 50, ironShard: 20, silverShard: 20, goldShard: 10, mithrilShard: 10, thoriumShard: 5, arcaniteShard: 3, magisteelShard: 1 });
});

test('鍛造/熔煉配方與 V2 常數（線上限/帶容量/篩選器/大圖）', () => {
  const c = loadContext(['js/util.js', 'js/data.js']);
  const cr = c.NEW_FORGE_CRAFT_RECIPES;
  assert.equal(cr.length, 4);
  assert.deepEqual(plain(cr[3]), { target: 5, inputRarity: 4, mats: { mithril: 10, thorium: 5 } });
  assert.deepEqual(plain(c.NEW_FORGE_SMELT_RECIPES.magisteel), { slag: 10, magisteelShard: 2, ironIngot: 10, thorium: 4, arcanite: 4 });
  assert.equal(c.NEW_FORGE_MAX, 10);
  assert.equal(c.NEW_FORGE_LINES_MAX, 3);
  assert.ok(c.NEW_FORGE_BELT_CAP >= 1);
  // 各爐型篩選器（V2）
  assert.deepEqual(plain(c.NEW_FORGE_FILTERS.smith.map((f) => f.name)), ['拆解裝備', '鍛造裝備', '熔煉礦石']);
  assert.deepEqual(plain(c.NEW_FORGE_FILTERS.rune.map((f) => f.name)), ['製作附魔卷軸', '製作寶石']);
  assert.deepEqual(plain(c.NEW_FORGE_FILTERS.magic.map((f) => f.name)), ['製作裝備碎片', '製作附魔精華', '製作魔塵', '製作太古精華']);
  assert.ok(c.NEW_FORGE_FILTERS.rune.every((f) => f.wip), '符文篩選器應標示尚未開放');
  assert.ok(c.NEW_FORGE_FILTERS.magic.every((f) => f.wip), '魔法篩選器應標示尚未開放');
  // 熔爐大圖
  assert.equal(c.NEW_FORGE_IMAGES.smith, 'images/Forging_Furnace.png');
  assert.equal(c.NEW_FORGE_IMAGES.rune, 'images/Runes_Furnace.png');
  assert.equal(c.NEW_FORGE_IMAGES.magic, 'images/Magic_Furnace.png');
});

/* ============ 2. 擲量公式 ============ */

test('newForgeRollAmount：整數部分必得、小數部分依機率加一', () => {
  const c = loadContext(['js/util.js', 'js/data.js', 'js/formula.js']);
  c.Math.random = () => 0.9999;
  assert.equal(c.newForgeRollAmount(50), 50);
  assert.equal(c.newForgeRollAmount(0.5), 0);
  c.Math.random = () => 0;
  assert.equal(c.newForgeRollAmount(0.5), 1);
  assert.equal(c.newForgeRollAmount(2.5), 3);
  assert.equal(c.newForgeRollAmount(0), 0);
});

/* ============ 3. 路由切換 ============ */

test('導入開啟：新裝備進新熔爐佇列；關閉：走舊輸送帶（舊行為不變）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const it = c.makeEquipment(10, { rarity: 0, level: 10 });
  assert.equal(c.pushConveyor(it), true);
  assert.equal(G.newForge.queue.length, 1);
  assert.equal(G.factory.conveyor.length, 0);
  G.newForge.intake = false;
  c.pushConveyor(c.makeEquipment(10, { rarity: 0, level: 10 }));
  assert.equal(G.factory.conveyor.length, 1);
});

test('新熔爐佇列滿載時回退舊輸送帶（裝備不丟失）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  G.newForge.queue.length = c.NEW_FORGE_QUEUE_CAP;
  assert.equal(c.pushConveyor(c.makeEquipment(10, { rarity: 0, level: 10 })), true);
  assert.equal(G.factory.conveyor.length, 1);
});

/* ============ 4. 熔爐與傳送帶結構 ============ */

test('預設熔爐：1 座鍛造爐、1 條拆解傳送帶（普通~傳說分解、神話+保留）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  assert.equal(G.newForge.furnaces.length, 1);
  const fu = G.newForge.furnaces[0];
  assert.equal(fu.ftype, 'smith');
  assert.equal(fu.lines.length, 1);
  const line = fu.lines[0];
  assert.equal(line.filter, 'salvage');
  assert.equal(line.enabled, true);
  assert.deepEqual(plain(line.salvage.actions.slice(0, 6)), ['salvage', 'salvage', 'salvage', 'salvage', 'salvage', 'salvage']);
  assert.equal(line.salvage.actions[6], 'keep');
  assert.deepEqual(plain(line.belt), []);
});

test('傳送帶增刪：每爐最多 3 條；移除時帶上內容退回', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  assert.equal(c.addNewForgeLine(fu.id), null);
  assert.equal(c.addNewForgeLine(fu.id), null);
  assert.equal(fu.lines.length, 3);
  assert.match(String(c.addNewForgeLine(fu.id)), /上限/);
  // 帶上有在途裝備與熔煉批次 → 移除線退回
  const it = c.makeEquipment(10, { rarity: 0, level: 10 });
  fu.lines[2].belt.push({ kind: 'salv', item: it });
  fu.lines[2].filter = 'smelt';
  fu.lines[2].belt.push({ kind: 'smelt', product: 'ironIngot' });
  const slagBefore = G.player.forgeMats.slag;
  c.removeNewForgeLine(fu.id, 2);
  assert.equal(fu.lines.length, 2);
  assert.ok(G.inventory.some((x) => x && x.id === it.id), '在途裝備應退回背包');
  assert.equal(G.player.forgeMats.slag, slagBefore + 2, '熔煉批次材料應退回');
  assert.equal(G.player.forgeMats.ironShard, 2);
});

/* ============ 5. 拆解傳送帶 ============ */

test('拆解判定：動作/等級條件/上鎖/神鑄創世保護', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const line = G.newForge.furnaces[0].lines[0];
  const mk = (rarity, level, locked) => {
    const it = c.makeEquipment(level, { rarity, level });
    it.locked = !!locked;
    return it;
  };
  assert.equal(c.newForgeDecide(line, mk(0, 10)), 'salvage');
  assert.equal(c.newForgeDecide(line, mk(6, 10)), 'keep');
  assert.equal(c.newForgeDecide(line, mk(0, 10, true)), 'keep');
  line.salvage.conds[0] = { op: 'lte', lv: 200 };
  assert.equal(c.newForgeDecide(line, mk(0, 200)), 'salvage');
  assert.equal(c.newForgeDecide(line, mk(0, 201)), 'keep');
  line.salvage.conds[0] = { op: 'gte', lv: 100 };
  assert.equal(c.newForgeDecide(line, mk(0, 99)), 'keep');
  assert.equal(c.newForgeDecide(line, mk(0, 100)), 'salvage');
  line.salvage.actions[6] = 'salvage';
  assert.equal(c.newForgeDecide(line, mk(6, 10)), 'salvage');
  line.salvage.actions[8] = 'salvage';
  assert.equal(c.newForgeDecide(line, mk(8, 10)), 'keep'); // 神鑄創世一律保留
});

test('拆解線 tick：先裝載上帶、下一 tick 入爐產材料；保留品直接入包', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  c.Math.random = () => 0.9999;
  const fu = G.newForge.furnaces[0];
  const line = fu.lines[0];
  const a = c.makeEquipment(10, { rarity: 0, level: 10 });   // 分解
  const b = c.makeEquipment(10, { rarity: 6, level: 10 });   // 神話 → 保留
  G.newForge.queue.push(a, b);
  c.newForgeLineTick(fu, line);
  // 第一次 tick：a 上帶、b 入包（保留不佔帶位）
  assert.equal(line.belt.length, 1);
  assert.equal(line.belt[0].item.id, a.id);
  assert.equal(G.inventory.length, 1);
  assert.equal(G.newForge.stats.kept, 1);
  assert.equal(G.newForge.queue.length, 0);
  // 第二次 tick：a 入爐 → 材料入帳
  c.newForgeLineTick(fu, line);
  assert.equal(line.belt.length, 0);
  assert.equal(G.player.forgeMats.slag, 1);
  assert.equal(G.newForge.stats.salvaged, 1);
});

test('拆解產出：材料入帳、鑲嵌寶石取回', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  c.Math.random = () => 0.9999;
  const it = c.makeEquipment(10, { rarity: 7, level: 10 });
  it.sockets = [{ type: 'ruby', level: 2 }, null];
  c.newForgeSalvage(it);
  assert.equal(G.player.forgeMats.slag, 50);
  assert.equal(G.player.forgeMats.magisteelShard, 1);
  assert.equal(G.player.gems.ruby[2], 1);
});

test('背包滿載時保留失敗（被舊系統分解）不計入 kept 統計', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const line = fu.lines[0];
  line.salvage.actions[0] = 'keep';
  const cap = c.INVENTORY_CAP + (G.player.invUpgrades || 0);
  while (G.inventory.length < cap) G.inventory.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  G.newForge.queue.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  c.newForgeLineTick(fu, line);
  assert.equal(G.newForge.stats.kept, 0);
  assert.equal(G.inventory.length, cap);
});

/* ============ 6. 鍛造傳送帶（自動：材料＋佇列對應品質裝備） ============ */

test('鍛造線：扣材料取件上帶 → 入爐產出品質+1（等級/部位同素材）', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const line = fu.lines[0];
  line.filter = 'craft';
  line.craft = { recipe: 0 }; // 鍛造稀有：秘銀×2＋任1精良
  G.player.forgeMats.mithril = 2;
  const src = c.makeEquipment(37, { rarity: 1, level: 37, slot: 'helmet' });
  const other = c.makeEquipment(10, { rarity: 0, level: 10 });
  G.newForge.queue.push(other, src);
  c.newForgeLineTick(fu, line);
  // 裝載：只取品質相符的 src；other 留在佇列
  assert.equal(line.belt.length, 1);
  assert.equal(line.belt[0].item.id, src.id);
  assert.equal(G.player.forgeMats.mithril, 0, '裝載時即扣材料');
  assert.equal(G.newForge.queue.length, 1);
  assert.equal(G.newForge.queue[0].id, other.id);
  // 入爐：產出稀有、等級/部位同素材
  c.newForgeLineTick(fu, line);
  assert.equal(line.belt.length, 0);
  const out = G.inventory.find((x) => x && x.rarity === 2);
  assert.ok(out);
  assert.equal(out.level, 37);
  assert.equal(out.slot, 'helmet');
  assert.equal(G.newForge.stats.crafted, 1);
});

test('鍛造線：材料不足/無對應裝備/上鎖/背包滿載 → 不裝載不扣料', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const line = fu.lines[0];
  line.filter = 'craft';
  line.craft = { recipe: 0 };
  // 材料不足
  const src = c.makeEquipment(10, { rarity: 1, level: 10 });
  G.newForge.queue.push(src);
  G.player.forgeMats.mithril = 1;
  c.newForgeLineTick(fu, line);
  assert.equal(line.belt.length, 0);
  assert.equal(G.player.forgeMats.mithril, 1);
  assert.equal(G.newForge.queue.length, 1);
  // 上鎖不取
  G.player.forgeMats.mithril = 2;
  src.locked = true;
  c.newForgeLineTick(fu, line);
  assert.equal(line.belt.length, 0);
  assert.equal(G.player.forgeMats.mithril, 2);
  // 背包滿載不裝載
  src.locked = false;
  const cap = c.INVENTORY_CAP + (G.player.invUpgrades || 0);
  while (G.inventory.length < cap) G.inventory.push(c.makeEquipment(5, { rarity: 0, level: 5 }));
  c.newForgeLineTick(fu, line);
  assert.equal(line.belt.length, 0, '背包滿載時鍛造線停止裝載');
  assert.equal(G.player.forgeMats.mithril, 2);
});

/* ============ 7. 熔煉傳送帶 ============ */

test('熔煉線：材料足夠自動扣料上帶（例：金錠=爐渣2+碎金塊2）→ 入爐產品+1', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  const fu = G.newForge.furnaces[0];
  const line = fu.lines[0];
  line.filter = 'smelt';
  line.smelt = { product: 'goldIngot' };
  G.player.forgeMats.slag = 4;
  G.player.forgeMats.goldShard = 5;
  c.newForgeLineTick(fu, line);
  // 裝載：材料夠 2 批 → 扣 2 批上帶
  assert.equal(line.belt.length, 2);
  assert.equal(G.player.forgeMats.slag, 0);
  assert.equal(G.player.forgeMats.goldShard, 1);
  // 入爐 2 次
  c.newForgeLineTick(fu, line);
  c.newForgeLineTick(fu, line);
  assert.equal(G.player.forgeMats.goldIngot, 2);
  assert.equal(G.newForge.stats.smelted, 2);
  assert.equal(line.belt.length, 0);
  // 停用時不動作
  line.enabled = false;
  G.player.forgeMats.slag = 2;
  G.player.forgeMats.goldShard = 2;
  c.newForgeLineTick(fu, line);
  assert.equal(line.belt.length, 0);
  assert.equal(G.player.forgeMats.slag, 2);
});

/* ============ 8. 熔爐管理 ============ */

test('添加熔爐至多 10 座；移除熔爐退回所有傳送帶內容', () => {
  const c = loadContext(LOGIC_FILES);
  const G = freshG(c);
  for (let i = G.newForge.furnaces.length; i < 10; i++) assert.equal(c.addNewForgeFurnace('smith'), null);
  assert.match(String(c.addNewForgeFurnace('smith')), /上限/);
  const fu = G.newForge.furnaces[9];
  const it = c.makeEquipment(10, { rarity: 0, level: 10 });
  fu.lines[0].belt.push({ kind: 'salv', item: it });
  c.removeNewForgeFurnace(fu.id);
  assert.equal(G.newForge.furnaces.length, 9);
  assert.ok(G.inventory.some((x) => x && x.id === it.id), '移除熔爐時帶上裝備退回背包');
});

/* ============ 9. 存檔遷移（含 V1→V2） ============ */

test('舊存檔無 newForge → 補預設；V1 熔爐（mode 形狀）→ 轉為對應傳送帶', () => {
  const files = LOGIC_FILES.concat(['js/save.js']);
  const c = loadContext(files);
  // 全新舊存檔
  const state = c.newGameState();
  delete state.newForge;
  delete state.player.forgeMats;
  c.migrateSave(state);
  assert.ok(state.newForge);
  assert.equal(state.newForge.furnaces[0].lines.length, 1);
  assert.equal(Object.keys(state.player.forgeMats).length, 15);
  // V1 形狀熔爐：mode='smelt'＋自訂品質設定 → 1 條熔煉線且設定保留
  const state2 = c.newGameState();
  state2.newForge.furnaces = [{
    id: 3, ftype: 'smith', mode: 'smelt',
    salvage: { actions: ['keep', 'salvage', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep', 'keep'], conds: [] },
    craft: { sel: ['', '', '', ''] },
    smelt: { product: 'mithril', auto: true },
    timer: 0.5
  }];
  state2.newForge.nextId = 4;
  c.migrateSave(state2);
  const fu = state2.newForge.furnaces[0];
  assert.ok(Array.isArray(fu.lines), 'V1 熔爐應轉出 lines');
  assert.equal(fu.lines.length, 1);
  assert.equal(fu.lines[0].filter, 'smelt');
  assert.equal(fu.lines[0].smelt.product, 'mithril');
  assert.equal(fu.lines[0].salvage.actions[1], 'salvage', 'V1 品質設定應搬移到線上');
  assert.equal(fu.lines[0].salvage.conds.length, c.RARITIES.length);
  assert.equal(fu.mode, undefined, 'V1 舊欄位應清除');
  // 熔爐超量與壞線淨化
  const state3 = c.newGameState();
  for (let i = 0; i < 15; i++) state3.newForge.furnaces.push(c.newForgeDefaultFurnace(100 + i, 'smith'));
  state3.newForge.furnaces[0].lines = [null, { filter: 'bogus', belt: [{ bad: true }] }, ...state3.newForge.furnaces[0].lines];
  c.migrateSave(state3);
  assert.ok(state3.newForge.furnaces.length <= c.NEW_FORGE_MAX);
  state3.newForge.furnaces[0].lines.forEach((ln) => {
    assert.ok(ln && typeof ln === 'object');
    assert.ok(['salvage', 'craft', 'smelt'].includes(ln.filter));
    ln.belt.forEach((e) => assert.ok(['salv', 'craft', 'smelt'].includes(e.kind)));
  });
});

/* ============ 9.5 審查修正回歸 ============ */

test('傳送帶有穩定 id：預設線含 id、sanitize 補缺漏 id', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const G = freshG(c);
  const line = G.newForge.furnaces[0].lines[0];
  assert.equal(typeof line.id, 'string');
  assert.ok(line.id.length > 0);
  delete line.id;
  c.migrateSave(G);
  assert.equal(typeof G.newForge.furnaces[0].lines[0].id, 'string', 'sanitize 應補回穩定 id');
});

test('UI 抗重繪：帶視覺定點更新、焦點防衛、展開狀態以 line.id 為鍵', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /data-nf-belt="' \+ fu\.id \+ ':' \+ li \+ '"/, '帶容器應留空由定點更新填充');
  assert.match(ui, /function nfUpdateBelts/);
  assert.match(ui, /nfUpdateBelts\(list\)/);
  assert.match(ui, /document\.activeElement/, '整段重建前應有焦點防衛');
  assert.match(ui, /ae\.tagName === 'SELECT' \|\| ae\.tagName === 'INPUT'/);
  assert.match(ui, /UI\.nfCfgOpen\[fu\.id \+ ':' \+ line\.id\]/, '展開狀態鍵應用穩定 line.id');
  assert.match(ui, /ctx\.fu\.id \+ ':' \+ ctx\.line\.id/);
  // 帶批次不應再內嵌於熔爐卡片快取字串（nfLineHTML 不得直接呼叫 nfBeltChipsHTML）
  const lineFn = ui.slice(ui.indexOf('function nfLineHTML'), ui.indexOf('function nfFurnaceHTML'));
  assert.ok(!lineFn.includes('nfBeltChipsHTML('), 'nfLineHTML 不應直接渲染帶批次');
});

/* ============ 9.7 本地服限定（外服沿用舊熔爐） ============ */

test('本地服判定：localhost/127.0.0.1/::1 開放，外部主機關閉', () => {
  const local = loadContext(LOGIC_FILES);
  assert.equal(local.newForgeHostAvailable(), true);
  ['example.com', 'mygame.github.io', '192.168.1.5'].forEach((host) => {
    const ext = loadContext(LOGIC_FILES, host);
    assert.equal(ext.newForgeHostAvailable(), false, host + ' 應判定為外服');
  });
});

test('外服：導入開關即使開啟，裝備仍走舊輸送帶；傳送帶 tick 停用', () => {
  const c = loadContext(LOGIC_FILES, 'mygame.github.io');
  const G = freshG(c);
  G.newForge.intake = true;
  const it = c.makeEquipment(10, { rarity: 0, level: 10 });
  assert.equal(c.pushConveyor(it), true);
  assert.equal(G.factory.conveyor.length, 1, '外服新裝備應進舊輸送帶');
  assert.equal(G.newForge.queue.length, 0);
  // tick 停用：即使佇列被塞入內容也不處理
  G.newForge.queue.push(c.makeEquipment(10, { rarity: 0, level: 10 }));
  c.newForgeTick(10);
  assert.equal(G.newForge.queue.length, 1, '外服 newForgeTick 不應處理佇列');
  assert.equal(G.newForge.furnaces[0].lines[0].belt.length, 0);
  assert.equal(G.newForge.stats.salvaged, 0);
});

test('外服載入存檔：滯留佇列/在途裝備歸還舊輸送帶、在途材料退回庫存；配置保留', () => {
  const c = loadContext(LOGIC_FILES.concat(['js/save.js']), 'mygame.github.io');
  const state = c.newGameState();
  const qItem = c.makeEquipment(10, { rarity: 0, level: 10 });
  const salvItem = c.makeEquipment(10, { rarity: 1, level: 10 });
  const craftItem = c.makeEquipment(10, { rarity: 1, level: 10 });
  state.newForge.queue.push(qItem);
  const line = state.newForge.furnaces[0].lines[0];
  line.belt.push({ kind: 'salv', item: salvItem });
  line.belt.push({ kind: 'craft', item: craftItem, recipe: 0 });   // 秘銀×2 在途
  line.belt.push({ kind: 'smelt', product: 'ironIngot' });          // 爐渣2＋碎鐵2 在途
  line.salvage.actions[3] = 'keep'; // 自訂配置應保留
  c.migrateSave(state);
  assert.equal(state.newForge.queue.length, 0, '佇列應清空');
  assert.equal(line.belt.length, 0, '傳送帶應清空');
  const convIds = state.factory.conveyor.map((x) => x.id);
  [qItem, salvItem, craftItem].forEach((x) => assert.ok(convIds.includes(x.id), '裝備應歸還舊輸送帶'));
  assert.equal(state.player.forgeMats.mithril, 2, '鍛造在途材料應退回');
  assert.equal(state.player.forgeMats.slag, 2, '熔煉在途材料應退回');
  assert.equal(state.player.forgeMats.ironShard, 2);
  assert.equal(line.salvage.actions[3], 'keep', '熔爐配置應保留（回本地服恢復）');
  // 本地服載入：不歸還
  const cl = loadContext(LOGIC_FILES.concat(['js/save.js']));
  const s2 = cl.newGameState();
  const q2 = cl.makeEquipment(10, { rarity: 0, level: 10 });
  s2.newForge.queue.push(q2);
  cl.migrateSave(s2);
  assert.equal(s2.newForge.queue.length, 1, '本地服佇列應保留');
  assert.equal(s2.factory.conveyor.length, 0);
});

test('頁籤顯隱接線：index.html 預設隱藏、initUI 依本地服判定顯示', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /data-tab="newforge" style="display:none"/, '新熔爐頁籤應預設隱藏');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /newForgeHostAvailable/, 'ui.js 應依本地服判定切換頁籤顯示');
});

/* ============ 10. 接線靜態檢查 ============ */

test('index.html：新熔爐頁籤、面板、script；ui.js/main.js/factory.js 接線；熔爐大圖', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /data-tab="newforge"/);
  assert.match(html, /<section id="tab-newforge" class="tab">/);
  assert.match(html, /<script src="js\/newforge\.js"><\/script>/);
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /newforge:\s*true/);
  assert.match(ui, /UI\.tab === 'newforge'/);
  assert.match(ui, /function renderNewForge/);
  assert.match(ui, /NEW_FORGE_IMAGES\[/, '熔爐卡片應使用大圖常數');
  assert.match(ui, /nf-furnace-img/, '應有熔爐大圖元素');
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  assert.match(main, /newForgeTick/);
  const factory = fs.readFileSync(path.join(root, 'js/factory.js'), 'utf8');
  assert.match(factory, /newForgeTryIntake/);
  // 三張熔爐大圖存在
  ['Forging_Furnace.png', 'Runes_Furnace.png', 'Magic_Furnace.png'].forEach((f) => {
    assert.ok(fs.existsSync(path.join(root, 'images', f)), '缺少圖片 ' + f);
  });
});
