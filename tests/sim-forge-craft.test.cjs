/* 神鑄法陣策略：六件同品質 → 一件高一階。

   實測 48 小時 × 5 seed（2 轉、關卡 301）：累積掉落傳說 2,495 件、神話 175 件，
   而創世只有 2 件、神鑄創世 0 件——因為 policy.extreme.roi.json 裡 forge.* 規則數是 0。
   五條名字帶 forge 的規則全部是 newforge.*（熔爐＝分解爐），跟神鑄法陣是兩套系統。

   這支測試盯住兩個「看起來會動、實際上鑄不出好東西」的坑：

   1. **產物等級取六件裡最高**（js/forge.js resolveForge 的 maxLv），
      而遊戲的自動放入取的是**評分最低**的六件——兩者剛好相反。
   2. 魔塵在裝備側 +5%、寶石側只有 +3%，而寶石鑄造**失敗會給 1 個魔塵**，
      所以低階寶石是魔塵的產地，不該把魔塵花在那裡。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
const { createPolicy } = require(path.join(ROOT, 'scripts/sim/policy.js'));

const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.extreme.roi.json'), 'utf8'));
const RULE = POLICY.rules.find((r) => r.id === 'forge-craft');
const PARAMS = POLICY.panelParams.forge;

function boot(opts) {
  const o = opts || {};
  const e = createEngine({ seed: o.seed || 5 }).boot(null);
  const c = e.ctx;
  c.G.player.reincarnations = o.reinc === undefined ? 1 : o.reinc;
  c.G.player.gold = o.gold === undefined ? 5e9 : o.gold;
  c.G.player.dust = o.dust === undefined ? 60 : o.dust;
  for (const [lv, rarity] of (o.items || [])) c.G.inventory.push(c.makeEquipment(lv, { rarity: rarity, level: lv }));
  for (const [type, level, n] of (o.gems || [])) c.G.player.gems[type][String(level)] = n;
  return e;
}

function policy() {
  return createPolicy({ name: 'test-forge-craft', decideEveryGameSec: 5, needPanels: ['forge'], rules: [RULE] });
}

function decide(e, p, sec) {
  return p.decide({
    gameTimeSec: sec === undefined ? 100 : sec,
    view: { gold: e.ctx.G.player.gold },
    panels: { forge: e.panel('forge', PARAMS) }
  });
}

const names = (cmds) => cmds.map((c) => c.name);

/* ============ 面板：唯讀、而且數字是遊戲算的 ============ */

test('forge 面板不宣告 craft 時行為不變（UI 走的就是這條）', () => {
  const e = boot({ items: [[300, 5]] });
  const plain = e.panel('forge');
  assert.deepEqual(Object.keys(plain), ['forge'], '沒宣告 craft 就只回原本的 forge 狀態');
  assert.ok(e.panel('forge', PARAMS).equip, '宣告了才建鑄造資料');
});

test('建面板不得改動任何狀態', () => {
  const e = boot({ items: [[300, 5], [1, 5], [1, 5]], gems: [['ruby', 5, 12]] });
  const before = e.saveJson();
  e.panel('forge', PARAMS);
  assert.equal(e.saveJson(), before);
});

test('成功率與成本由遊戲的函式給，策略端不重推', () => {
  const e = boot({ items: Array.from({ length: 6 }, () => [100, 5]) });
  const pan = e.panel('forge', PARAMS);
  const c = e.ctx;
  assert.equal(pan.equip[5].base, c.forgeBaseRateFor(5));
  assert.equal(pan.equip[5].dustRate, c.forgeDustRateFor(5));
  assert.equal(pan.equip[5].cost, c.forgeGoldCostFor(5));
  assert.equal(pan.minRarity, c.FORGE_MIN_RARITY);
  assert.equal(pan.slotsNeeded, c.FORGE_SLOTS);
});

test('候選只含未上鎖的裝備——上鎖的遊戲根本不收', () => {
  const e = boot({ items: Array.from({ length: 7 }, () => [100, 5]) });
  e.ctx.G.inventory[0].locked = true;
  assert.equal(e.panel('forge', PARAMS).equip[5].count, 6);
});

/* ============ 選件：一件高等載體 ＋ 五件墊檔 ============ */

test('產物等級取六件裡最高，所以只需要一件高等素材', () => {
  /* 這是整條規則的核心。遊戲的自動放入取「評分最低的六件」，配上這個規則
     會穩定鑄出低等神話——所以策略不能用 forge.setAutoFill。 */
  const e = boot({ items: [[1, 5], [1, 5], [1, 5], [1, 5], [1, 5], [300, 5]] });
  const p = policy();
  for (const cmd of decide(e, p)) e.ctx.runCommand(cmd.name, cmd.args);
  e.stepSeconds(30);
  const made = e.ctx.G.inventory.filter((i) => i.rarity === 6);
  assert.equal(made.length, 1);
  assert.equal(made[0].level, 300, '五件 1 級墊檔不該把產物等級拉下來');
});

test('載體挑等級最高那件，墊檔挑等級最低的', () => {
  /* ⚠️ 素材等級要挑**不同分段**的值。裝備等級是 equipmentTierLevel 的階梯
     （EQUIP_TIER_SIZE=50），1~49 全部變成 1 級——用 1/2/3/4/5 建出來的是五件
     一模一樣的 1 級裝，這支測試就驗不到排序。 */
  const e = boot({ items: [[1, 5], [50, 5], [100, 5], [150, 5], [200, 5], [300, 5], [250, 5]] });
  const pan = e.panel('forge', PARAMS);
  const p = policy();
  const placed = decide(e, p).filter((c) => c.name === 'forge.placeItem').map((c) => c.args.itemId);
  const lvOf = (id) => e.ctx.G.inventory.find((i) => i.id === id).level;
  assert.equal(placed.length, 6);
  assert.equal(lvOf(placed[0]), 300, '第一件是等級載體');
  assert.deepEqual(placed.slice(1).map(lvOf).sort((a, b) => a - b), [1, 50, 100, 150, 200],
    '其餘五件應該是等級最低的，不能把 250 級那件當墊檔燒掉');
  assert.ok(pan.equip[5].top[0].level >= pan.equip[5].low[0].level);
});

test('庫存剛好六件時載體不會被自己算兩次', () => {
  /* low 與 top 會重疊。少了去重就只送 5 件 placeItem，法陣永遠湊不滿而且沒有徵兆。 */
  const e = boot({ items: [[1, 5], [1, 5], [1, 5], [1, 5], [1, 5], [300, 5]] });
  const ids = decide(e, policy()).filter((c) => c.name === 'forge.placeItem').map((c) => c.args.itemId);
  assert.equal(ids.length, 6);
  assert.equal(new Set(ids).size, 6, '六件必須是六個不同的 id');
});

test('不足六件就不動手', () => {
  const e = boot({ items: Array.from({ length: 5 }, () => [100, 5]) });
  assert.deepEqual(names(decide(e, policy())), []);
});

/* ============ 品質順序與資源閘門 ============ */

test('同時湊得滿時先燒高品質——神話變創世比傳說變神話值錢', () => {
  const e = boot({
    items: [].concat(
      Array.from({ length: 6 }, () => [100, 5]),
      Array.from({ length: 6 }, () => [200, 6]))
  });
  for (const cmd of decide(e, policy())) e.ctx.runCommand(cmd.name, cmd.args);
  assert.equal(e.ctx.forgeRarity(), 6, '法陣裡應該是神話，不是傳說');
});

test('金幣不到保留比例就不鑄——鑄到一半沒錢會被遊戲擋在結算', () => {
  const e = boot({ items: Array.from({ length: 6 }, () => [100, 5]) });
  const cost = e.ctx.forgeGoldCostFor(5);
  e.ctx.G.player.gold = Math.floor(cost / RULE.forgeCraft.goldRatio) - 1;
  assert.deepEqual(names(decide(e, policy())), []);
  e.ctx.G.player.gold = Math.ceil(cost / RULE.forgeCraft.goldRatio) + 1;
  assert.ok(names(decide(e, policy())).includes('forge.start'));
});

test('鑄造進行中不再送任何指令', () => {
  const e = boot({ items: Array.from({ length: 6 }, () => [100, 5]) });
  const p = policy();
  for (const cmd of decide(e, p)) e.ctx.runCommand(cmd.name, cmd.args);
  assert.ok(e.ctx.G.forge.crafting, '前提：正在鑄造');
  assert.deepEqual(names(decide(e, p, 200)), []);
});

test('法陣半滿時先清空，不硬補——補的時候不知道裡面是什麼品質', () => {
  const e = boot({ items: Array.from({ length: 8 }, () => [100, 5]) });
  e.ctx.forgePlaceItem(e.ctx.G.inventory[0].id);
  assert.deepEqual(names(decide(e, policy())), ['forge.unloadAll']);
});

/* ============ 魔塵 ============ */

test('裝備鑄造一律塞滿魔塵——每個 +5%，傳說 55% → 85%', () => {
  const e = boot({ items: Array.from({ length: 6 }, () => [100, 5]), dust: 60 });
  const p = policy();
  const cmds = decide(e, p);
  assert.ok(names(cmds).includes('forge.autoFillDust'));
  assert.ok(names(cmds).indexOf('forge.autoFillDust') < names(cmds).indexOf('forge.start'),
    '要在開始鑄造之前放');
  for (const cmd of cmds) e.ctx.runCommand(cmd.name, cmd.args);
  const info = e.ctx.forgeRateInfo();
  assert.equal(info.total, e.ctx.forgeSuccessRateFor(5, e.ctx.FORGE_SLOTS));
});

test('沒有魔塵時照鑄，不卡住', () => {
  const e = boot({ items: Array.from({ length: 6 }, () => [100, 5]), dust: 0 });
  const cmds = names(decide(e, policy()));
  assert.ok(!cmds.includes('forge.autoFillDust'));
  assert.ok(cmds.includes('forge.start'));
});

test('低階寶石鑄造不放魔塵——失敗才是魔塵的產地', () => {
  /* 五級寶石→六級基礎成功率 50%，失敗退回 3 顆並給 1 個魔塵（forgeFailureReward）。
     把 +3% 的魔塵花在這裡，等於拿走裝備側 +5% 的額度去買一個自己會產出的東西。 */
  const e = boot({ gems: [['ruby', 5, 12]], dust: 60 });
  const cmds = decide(e, policy());
  assert.equal(cmds.filter((c) => c.name === 'forge.placeGem').length, 6);
  assert.ok(!names(cmds).includes('forge.autoFillDust'),
    '五級寶石低於 gemDustMinLevel（' + RULE.forgeCraft.gemDustMinLevel + '），不該放魔塵');
  assert.ok(names(cmds).includes('forge.start'));
});

test('七級以上的寶石才放魔塵——那時素材貴，買成功率划算', () => {
  const e = boot({ gems: [['ruby', 7, 12]], dust: 60 });
  assert.ok(names(decide(e, policy())).includes('forge.autoFillDust'));
});

test('裝備排在寶石前面——寶石只是魔塵與鑲嵌的補給', () => {
  const e = boot({ items: Array.from({ length: 6 }, () => [100, 5]), gems: [['ruby', 5, 12]] });
  const cmds = decide(e, policy());
  assert.ok(names(cmds).includes('forge.placeItem'));
  assert.ok(!names(cmds).includes('forge.placeGem'));
});

/* ============ 解鎖與熔爐門檻 ============ */

test('沒轉生就不送任何指令——神鑄還沒解鎖', () => {
  const e = boot({ reinc: 0, items: Array.from({ length: 6 }, () => [100, 5]) });
  assert.equal(e.panel('forge', PARAMS).unlocked, false);
  assert.deepEqual(names(decide(e, policy())), []);
});

test('熔爐分解門檻有上限，不會把神鑄素材當垃圾燒掉', () => {
  /* 門檻跟著身上最低品質走，全身創世之後會變成「傳說、神話一起分解」——
     而神話正是鑄創世的唯一素材。使用者的分段：全身創世後傳說可以直接拆，
     神話以上要留著繼續往上鑄。 */
  const svRule = POLICY.rules.find((r) => r.id === 'salvage-below-equipped');
  const cap = svRule.salvageBelowEquipped.maxThreshold;
  assert.equal(typeof cap, 'number');

  const p = createPolicy({
    name: 'test-salvage-cap', decideEveryGameSec: 5,
    needPanels: ['inv', 'newforge'], rules: [svRule]
  });
  const qualities = new Array(11).fill(false);
  const st = (minEquipped) => ({
    gameTimeSec: 10,
    view: {},
    panels: {
      inv: { equipmentRarities: { weapon: minEquipped, helmet: 7, chest: 7 } },
      newforge: { newForge: { furnaces: [{ id: 1, qualities: qualities.slice() }] } }
    }
  });
  /* 全身創世（最低也是 7）→ 門檻本來會是 7，被夾在 6：R5 拆、R6 留。 */
  const on = p.decide(st(7)).filter((c) => c.args.on).map((c) => c.args.rarity).sort((a, b) => a - b);
  assert.deepEqual(on, [0, 1, 2, 3, 4, 5], '傳說(5)可拆，神話(6)以上必須留著鑄造');
});
