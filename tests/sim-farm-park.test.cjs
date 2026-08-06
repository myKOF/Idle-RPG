/* 掛機安全關卡：分段之內待在**底部**。

   關卡改造之前，野外掉落走 rollRarity（含 stage×0.006 的連續項），
   所以「同一個裝等分段裡愈深愈好」是對的。改造之後掉落改走
   rollFieldDrops → fieldDropRatesFor → ZONE_STAGE_DROP_TABLE 查表
   （js/combat.js），粒度是**關卡區間**，區間之內完全相同——那句話就反了。

   用遊戲自己的函式量草原 100~149：
     掉落率 R3 10% / R4 1.5%、裝等 100 —— 100 關與 149 關一模一樣
     怪物血量 ×25.79、經驗 ×21.25、金幣 ×2.73
   停在 149 的裝備／材料時薪只有停在 100 的 1/25.8，連經驗時薪都是 0.82 倍。

   這支測試盯兩件事：
   1. floor 是**問遊戲問出來的**，不是策略端重推的公式（掉落表還在調）
   2. 規則真的會退回去，而且不會震盪、不會死鎖 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
const { createPolicy } = require(path.join(ROOT, 'scripts/sim/policy.js'));

/* ============ 1. 評估器：floor 由遊戲的三支函式決定 ============ */

function tierAt(zone, stage) {
  const e = createEngine({ seed: 11 }).boot(null);
  e.ctx.G.stage.zone = zone;
  e.ctx.G.stage.current = stage;
  return { tier: e.panel('eval').tier, ctx: e.ctx };
}

test('farmFloorStage 是「掉落與裝等都不變」的最低關卡', () => {
  /* 草原 100~149 是一列掉落表，裝等分段也是 100~149，兩者的交集下界＝100。 */
  for (const s of [100, 120, 149]) {
    assert.equal(tierAt('plains', s).tier.farmFloorStage, 100, '關卡 ' + s);
  }
  for (const s of [150, 175, 199]) {
    assert.equal(tierAt('plains', s).tier.farmFloorStage, 150, '關卡 ' + s);
  }
});

test('floor 取兩個階梯的交集：掉落區間與裝等分段不對齊時取較高的那個', () => {
  /* 荒漠的掉落表第一列是 1~199（一整段），但裝等分段每 50 一階。
     停在 180 關退到 1 關的話掉落率一樣，裝等卻從 150 掉到 1——不能退。 */
  const t = tierAt('desert', 180).tier;
  assert.equal(t.farmFloorStage, 150);
  assert.equal(t.itemLevelHere, 150);
});

test('floor 認得「多列疊加」的掉落區間，不是只看裝等分段', () => {
  /* 草原 40~49 是額外疊上去的一列（史詩 +2%），41~49 與 21~39 掉的東西不同，
     所以 45 關的 floor 是 40 而不是裝等分段的 1。
     只看 equipmentTierLevel 的話會錯退到關卡 1，把那 2% 史詩丟掉。 */
  assert.equal(tierAt('plains', 45).tier.farmFloorStage, 40);
  assert.equal(tierAt('plains', 45).tier.itemLevelHere, 1);
});

test('站在 floor 上時 farmFloorHpRatio 是 null，不是 1', () => {
  /* 規則用 `>= minHpRatio` 判斷值不值得退。回 1 的話語意仍然對，
     但 null 更清楚地表示「沒有可退的距離」，而且逼規則走 Number() 的 0 分支。 */
  const t = tierAt('plains', 150).tier;
  assert.equal(t.farmFloorStage, 150);
  assert.equal(t.farmFloorHpRatio, null);
});

test('farmFloorHpRatio 是遊戲的 monsterStatsFor 算的，不是策略端重推', () => {
  const { tier, ctx } = tierAt('plains', 149);
  const here = ctx.monsterStatsFor(149, false, false);
  const floor = ctx.monsterStatsFor(tier.farmFloorStage, false, false);
  assert.equal(tier.farmFloorHpRatio, here.hp / floor.hp);
  assert.ok(tier.farmFloorHpRatio > 20, '100→149 實測 ×25.79，量出來是 ' + tier.farmFloorHpRatio);
});

test('掉落率在區間之內確實不變——這是整條規則的前提', () => {
  /* 前提垮了規則就只是在自找罪受。所以直接問遊戲，而且比對整個陣列。 */
  const { ctx } = tierAt('plains', 100);
  const a = ctx.fieldDropRatesFor(100, 100, 'plains');
  const b = ctx.fieldDropRatesFor(149, 149, 'plains');
  assert.deepEqual(a, b, '草原 100 與 149 的掉落率應完全相同');
  assert.equal(ctx.equipmentTierLevel(100), ctx.equipmentTierLevel(149));
});

/* ============ 2. 規則：退回底部、不震盪、不死鎖 ============ */

const FARM_PARK = { source: 'panels.eval.tier', pushHoldSec: 900 };

function gatePolicy(gateExtra) {
  return createPolicy({
    name: 'test-farm-park',
    decideEveryGameSec: 10,
    needPanels: ['inv', 'eval'],
    rules: [{
      id: 'gate',
      cmd: 'stage.setAutoAdvance',
      stageGate: Object.assign({
        stage: 'view.stage',
        equippedRarities: 'panels.inv.equipmentRarities',
        argKey: 'on',
        /* 沒有 park＝「指南不涵蓋這一段」，farmPark 只在這種段落接管。 */
        checkpoints: [{ minRarity: 0, coverage: 0 }],
        retreatCmd: 'stage.go',
        farmPark: FARM_PARK
      }, gateExtra || {})
    }]
  });
}

/* 合成觀測點。tier 的欄位語意與評估器一致（見上半部的真引擎測試）：
   角色在草原 100~149 這一格，下一格是 150，已經到過 145 關。 */
function fst(sec, stage, tierExtra) {
  return {
    gameTimeSec: sec,
    view: { stage: stage },
    panels: {
      inv: { equipmentRarities: { weapon: 5 } },
      eval: {
        tier: Object.assign({
          stage: stage,
          best: 145,
          itemLevelHere: 100,
          nextBreakpointStage: 150,
          breakpointGain: 1.5,
          equippedItemLevelMin: 100,
          farmFloorStage: 100,
          nextFarmStage: 150,
          farmFloorHpRatio: 25.79
        }, tierExtra || {})
      }
    }
  };
}

function retreats(cmds) { return cmds.filter((c) => c.name === 'stage.go'); }
function autoOn(cmds) {
  const c = cmds.find((x) => x.name === 'stage.setAutoAdvance');
  return c ? c.args.on : null;
}

test('裝等還沒追平這一格：退回底部，delta 剛好落在 floor', () => {
  /* 「裝等落後」＝這一格還有東西可以撿。使用者說的「材料跟裝備掉落數的
     權重比等級高」在這裡就是：先把這一格刷滿，不要急著往前。 */
  const p = gatePolicy();
  const r = retreats(p.decide(fst(10, 149, { equippedItemLevelMin: 50 })));
  assert.equal(r.length, 1);
  assert.equal(r[0].args.delta, 100 - 149);
});

test('已經站在底部就不再送退關指令', () => {
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 100, { equippedItemLevelMin: 50, farmFloorHpRatio: null }));
  assert.equal(retreats(cmds).length, 0);
  assert.equal(autoOn(cmds), false, '待在這一格＝自動推關要關掉');
});

test('條件都滿足就搬去下一格，而且 best 之內是直接跳', () => {
  /* stageGo 在 [1, min(best, 地圖上限)] 之內是直接跳（js/combat.js:993），
     所以搬到已經到過的關卡零成本，只有超出 best 的那一段要逐關清。 */
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 100));       // 裝等追平（100）、無目標阻擋
  const r = retreats(cmds);
  assert.equal(r.length, 1);
  assert.equal(r[0].args.delta, 145 - 100, '先跳到 best，剩下 5 關交給自動推關');
  assert.equal(autoOn(cmds), true);
});

test('下一格已在 best 之內時一步到位，之後就把自動推關關掉', () => {
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 100, { best: 180 }));
  assert.equal(retreats(cmds)[0].args.delta, 150 - 100);
  const arrived = p.decide(fst(20, 150, {
    best: 180, itemLevelHere: 150, farmFloorStage: 150, nextFarmStage: 200,
    equippedItemLevelMin: 100, farmFloorHpRatio: null
  }));
  assert.equal(retreats(arrived).length, 0);
  assert.equal(autoOn(arrived), false, '到站就停——繼續往前是同一格裡最貴的一關');
});

test('地圖打到頂（nextFarmStage 為 null）就待在底部，不亂衝', () => {
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 230, {
    best: 230, itemLevelHere: 200, farmFloorStage: 200,
    nextFarmStage: null, farmFloorHpRatio: 1.9
  }));
  assert.equal(retreats(cmds)[0].args.delta, 200 - 230);
  assert.equal(autoOn(cmds), false);
});

test('搬家之後的 pushHoldSec 內不再往上搬，時間到了自動解除', () => {
  /* 沒有遲滯會震盪：退到底 → 目標達標 → 往上跳 → 打不動 → 再退到底。
     那趟「打不動」正是要消除的浪費。 */
  const p = gatePolicy();
  assert.equal(retreats(p.decide(fst(10, 149, { equippedItemLevelMin: 50 }))).length, 1);

  /* 退完之後裝等追平了（撿到當格裝備），照理可以搬家——但遲滯要擋住。 */
  assert.equal(retreats(p.decide(fst(20, 100))).length, 0, '剛退回來就往上搬＝震盪');
  assert.equal(autoOn(p.decide(fst(900, 100))), false, '還在遲滯期內');
  assert.equal(autoOn(p.decide(fst(911, 100))), true, '遲滯到期應恢復搬家');
});

test('遲滯只擋往上搬，不擋退關——擋住退關才會死鎖', () => {
  /* docs/SIM_HARNESS.md 記過兩次死鎖，兩次都是某個下限把退關擋死。
     這裡在遲滯期內把角色放到格子深處（死亡退關之後又被推上去），
     退關必須照樣送得出去。 */
  const p = gatePolicy();
  p.decide(fst(10, 149, { equippedItemLevelMin: 50 }));
  const cmds = p.decide(fst(200, 140, { equippedItemLevelMin: 50, farmFloorHpRatio: 11.9 }));
  assert.equal(retreats(cmds).length, 1, '遲滯期內仍應退得回去');
  assert.equal(retreats(cmds)[0].args.delta, 100 - 140);
});

test('沒宣告 farmPark 的策略行為完全不變', () => {
  /* 這個機制是加上去的，不能改到既有策略——policy.lategame.json 等仍在用舊語意。 */
  const p = gatePolicy({ farmPark: undefined });
  const cmds = p.decide(fst(10, 149, { equippedItemLevelMin: 50 }));
  assert.equal(retreats(cmds).length, 0);
});

test('有指南安全區間的關卡段不接管——前期那幾個 park 是量過的行為', () => {
  /* minRarity 6 / coverage 1 讓品質閘門關著（身上最好只有 R5），
     那正是指南 park 生效的情境。 */
  const p = gatePolicy({ checkpoints: [{ maxStage: 200, minRarity: 6, coverage: 1, park: [41, 45] }] });
  const cmds = p.decide(fst(10, 149, { equippedItemLevelMin: 50 }));
  const r = retreats(cmds);
  assert.equal(r.length, 1);
  assert.equal(r[0].args.delta, 45 - 149, '應該退到 park 上緣，不是 farmFloor');
});

/* ============ 3. 真引擎：退關指令真的被遊戲接受 ============ */

test('真引擎：算出來的 floor 送進 stage.go 會被接受，且掉落率不變', () => {
  const e = createEngine({ seed: 606 }).boot(null);
  const c = e.ctx;
  c.G.stage.best = 149;
  c.G.stage.current = 149;
  c.G.stage.zone = 'plains';
  if (c.G.zoneProgress && c.G.zoneProgress.plains) c.G.zoneProgress.plains.best = 149;

  const tier = e.panel('eval').tier;
  const before = c.fieldDropRatesFor(c.G.stage.current, c.G.stage.current, 'plains');

  const res = c.runCommand('stage.go', { delta: tier.farmFloorStage - c.G.stage.current });
  const bad = !res.ok ? res.error : (typeof res.result === 'string' ? res.result : null);
  assert.equal(bad, null, 'stage.go 不該被遊戲拒絕');
  assert.equal(c.G.stage.current, tier.farmFloorStage);
  assert.deepEqual(c.fieldDropRatesFor(c.G.stage.current, c.G.stage.current, 'plains'), before,
    '退到 floor 之後掉落率必須完全不變——這是整條規則的前提');
});
