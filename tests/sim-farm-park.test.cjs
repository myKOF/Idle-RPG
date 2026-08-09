/* 掛機安全關卡：分段之內待在**底部**。

   關卡改造之前，野外掉落走 rollRarity（含 stage×0.006 的連續項），
   所以「同一個裝等分段裡愈深愈好」是對的。改造之後掉落改走
   rollFieldDrops → fieldDropRatesFor → ZONE_STAGE_DROP_TABLE 查表
   （js/combat.js），粒度是**關卡區間**，區間之內完全相同——那句話就反了。

   用遊戲自己的函式量荒漠 100~149：
     掉落率 R3 10% / R4 1.5%、裝等 100 —— 100 關與 149 關一模一樣
     怪物血量 ×25.79、經驗 ×21.25、金幣 ×2.73
   ⚠️ 曾據此推論「時薪差 20 倍」——**實測不成立**。後 12 小時的擊殺速率：
   對照（推到打不動）925 隻/時、待在底部 1,042 隻/時，只差 13%。
   瓶頸是每隻怪固定的 RESPAWN_DELAY 0.8 ＋ FIELD_ENEMY_DEATH_CLEAR_DELAY 2.1 ＝ 2.9 秒
   （1,241 隻/時的硬上限），不是打死一隻要多久。
   底部買到的是「同樣的掉落數、少很多的死亡」，代價是每隻怪 21 倍的經驗。

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
  /* 荒漠 100~149 是一列掉落表，裝等分段也是 100~149，兩者的交集下界＝100。 */
  for (const s of [100, 120, 149]) {
    assert.equal(tierAt('desert', s).tier.farmFloorStage, 100, '關卡 ' + s);
  }
  for (const s of [150, 175, 199]) {
    assert.equal(tierAt('desert', s).tier.farmFloorStage, 150, '關卡 ' + s);
  }
});

test('floor 取兩個階梯的交集：掉落區間與裝等分段不對齊時取較高的那個', () => {
  /* 冰原的掉落表第一列是 1~199（一整段），但裝等分段每 50 一階。
     停在 180 關退到 1 關的話掉落率一樣，裝等卻從 150 掉到 1——不能退。 */
  const t = tierAt('Icefield', 180).tier;
  assert.equal(t.farmFloorStage, 150);
  assert.equal(t.itemLevelHere, 150);
});

test('floor 認得「多列疊加」的掉落區間，不是只看裝等分段', () => {
  /* 荒漠 40~49 是額外疊上去的一列（史詩 +2%），41~49 與 21~39 掉的東西不同，
     所以 45 關的 floor 是 40 而不是裝等分段的 1。
     只看 equipmentTierLevel 的話會錯退到關卡 1，把那 2% 史詩丟掉。 */
  assert.equal(tierAt('desert', 45).tier.farmFloorStage, 40);
  assert.equal(tierAt('desert', 45).tier.itemLevelHere, 1);
});

test('站在 floor 上時 farmFloorHpRatio 是 null，不是 1', () => {
  /* 規則用 `>= minHpRatio` 判斷值不值得退。回 1 的話語意仍然對，
     但 null 更清楚地表示「沒有可退的距離」，而且逼規則走 Number() 的 0 分支。 */
  const t = tierAt('desert', 150).tier;
  assert.equal(t.farmFloorStage, 150);
  assert.equal(t.farmFloorHpRatio, null);
});

test('farmFloorHpRatio 是遊戲的 monsterStatsFor 算的，不是策略端重推', () => {
  const { tier, ctx } = tierAt('desert', 149);
  const here = ctx.monsterStatsFor(149, false, false);
  const floor = ctx.monsterStatsFor(tier.farmFloorStage, false, false);
  assert.equal(tier.farmFloorHpRatio, here.hp / floor.hp);
  assert.ok(tier.farmFloorHpRatio > 20, '100→149 實測 ×25.79，量出來是 ' + tier.farmFloorHpRatio);
});

test('掉落率在區間之內確實不變——這是整條規則的前提', () => {
  /* 前提垮了規則就只是在自找罪受。所以直接問遊戲，而且比對整個陣列。 */
  const { ctx } = tierAt('desert', 100);
  const a = ctx.fieldDropRatesFor(100, 100, 'desert');
  const b = ctx.fieldDropRatesFor(149, 149, 'desert');
  assert.deepEqual(a, b, '荒漠 100 與 149 的掉落率應完全相同');
  assert.equal(ctx.equipmentTierLevel(100), ctx.equipmentTierLevel(149));
});

/* ============ 2. 規則：刷與推兩個階段輪流 ============ */

/* ☠️ 第一版寫成條件式（目標達標且裝等追平才准往上搬，自動推關也交給它），
   實測 24 小時 × 5 seed 全部卡在關卡 64：等級中位 335 → 87、最高關卡 198 → 64、
   物攻 263,079 → 83,071。擊殺反而 +46%、死亡 −27%，所以「刷的地方選對了」
   這一半是成立的，垮掉的是「什麼時候該往前推」。

   原因是 best 只能靠走出來，而往前走的過程中殺敵速度必然會掉；一掉就不達標、
   一不達標就被拉回底部，於是一趟 50 關的走法永遠走不完。

   現在改成兩個**有界**的階段輪流，兩邊都只看計時器。下面這幾支測試盯的就是
   「不管處境多糟，兩個階段都一定會輪到」——那是不再死鎖的唯一保證。 */

const FARM_SEC = 1800;
const PUSH_SEC = 600;
const FARM_PARK = { source: 'panels.eval.tier', farmSec: FARM_SEC, pushSec: PUSH_SEC };

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
   角色在荒漠 100~149 這一格，下一格是 150，已經到過 145 關。 */
function fst(sec, stage, tierExtra, ctx) {
  const s = {
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
  if (ctx) s.ctx = ctx;
  return s;
}

function retreats(cmds) { return cmds.filter((c) => c.name === 'stage.go'); }
function autoOn(cmds) {
  const c = cmds.find((x) => x.name === 'stage.setAutoAdvance');
  return c ? c.args.on : null;
}

test('開場是刷：退回這一格的底部，而且關掉自動推關', () => {
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 149));
  const r = retreats(cmds);
  assert.equal(r.length, 1);
  assert.equal(r[0].args.delta, 100 - 149);
  assert.equal(autoOn(cmds), false);
});

test('刷的階段站在底部就不再送退關指令', () => {
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 100, { farmFloorHpRatio: null }));
  assert.equal(retreats(cmds).length, 0);
  assert.equal(autoOn(cmds), false);
});

test('farmSec 到期就換成推：先跳回 best，然後開自動推關', () => {
  /* 跳回 best 是免費的（stageGo 在 [1, min(best, 地圖上限)] 之內直接跳），
     所以每次推進期都從前線開始，不必把走過的關卡再走一遍。 */
  const p = gatePolicy();
  p.decide(fst(10, 149));                                   // 刷：退到 100
  const cmds = p.decide(fst(10 + FARM_SEC, 100));
  assert.equal(retreats(cmds)[0].args.delta, 145 - 100, '應該跳回 best');
  assert.equal(autoOn(cmds), true);
});

test('推進期不看瞬時殺敵速度——那正是第一版卡在關卡 64 的死因', () => {
  const p = gatePolicy();
  p.decide(fst(10, 149));
  /* 宣告 killRate 目標並且明確不達標。舊版在這裡會被拉回底部，
     於是 best 永遠推不動；現在推進期只認計時器。 */
  const blocked = { deficit: { killRate: { met: false, unknown: false } } };
  const cmds = p.decide(fst(10 + FARM_SEC, 145, {}, blocked));
  assert.equal(autoOn(cmds), true, '推進期就是要往前推，殺得慢不是放棄的理由');
});

test('卡關重試仍然是硬煞車：真的打不過就不往前送死', () => {
  const p = gatePolicy();
  p.decide(fst(10, 149));
  const cmds = p.decide(fst(10 + FARM_SEC, 145, {}, { retryWaiting: true }));
  assert.equal(autoOn(cmds), false);
});

test('pushSec 到期就換回刷，而且會回到底部', () => {
  const p = gatePolicy();
  p.decide(fst(10, 149));                                   // 刷
  p.decide(fst(10 + FARM_SEC, 100));                        // 轉推
  const cmds = p.decide(fst(10 + FARM_SEC + PUSH_SEC, 140));
  assert.equal(retreats(cmds)[0].args.delta, 100 - 140);
  assert.equal(autoOn(cmds), false);
});

test('推到下一格就提前收工，不繼續往同一格的深處走', () => {
  /* 到站之後再往前是同一格裡最貴的一關：掉落與裝等都不變，怪物血量卻一路指數成長。 */
  const p = gatePolicy();
  p.decide(fst(10, 149));
  p.decide(fst(10 + FARM_SEC, 100));                        // 轉推
  const arrived = p.decide(fst(10 + FARM_SEC + 60, 150, {
    best: 180, itemLevelHere: 150, farmFloorStage: 150, nextFarmStage: 200,
    farmFloorHpRatio: null
  }));
  assert.equal(retreats(arrived).length, 0);
  assert.equal(autoOn(arrived), false, '到站就轉回刷');
});

test('兩個階段一定會輪到——這是不再死鎖的唯一保證', () => {
  /* 把處境設成最糟：目標不達標、裝等落後、站在打不動的深處。
     第一版在這個狀態下會永遠停在刷；現在必須看得到推進期。 */
  const p = gatePolicy();
  const bad = { deficit: { killRate: { met: false, unknown: false } } };
  const phases = [];
  for (let t = 10; t <= 10 + (FARM_SEC + PUSH_SEC) * 2; t += 60) {
    phases.push(autoOn(p.decide(fst(t, 149, { equippedItemLevelMin: 1 }, bad))));
  }
  assert.ok(phases.some((x) => x === true), '整整兩輪都沒有推進期＝死鎖');
  assert.ok(phases.some((x) => x === false), '整整兩輪都沒有刷＝機制沒生效');
});

test('整條推圖流程到頂時（zoneCapped）讓開，把去留交回原本的閘門', () => {
  /* 這張圖沒有更好的區間、也沒有已解鎖上限更高的圖可以換
     （第五張要 11 轉，打通第四張之後就落在這裡）。

     這時「待在底部刷掉落」是錯的：唯一還能前進的軸線是等級——
     練到 1000 才轉得了生，而轉生才解得開下一張圖。擊殺速率被固定開銷夾住、
     每隻經驗卻隨關卡指數成長，所以經驗時薪由深度決定。

     規則整條讓開＝farmAuto 回 null，自動推關的開關交還 passGate / advanceOn，
     而且不再送退關指令。 */
  const p = gatePolicy();
  const capped = {
    best: 200, itemLevelHere: 200, farmFloorStage: 200,
    nextFarmStage: null, zoneCapped: true, farmFloorHpRatio: 1.9
  };
  const cmds = p.decide(fst(10, 195, capped));
  assert.equal(retreats(cmds).length, 0, '到頂了就不該再把角色往回拉');
  assert.notEqual(autoOn(cmds), null, '仍要送出自動推關指令，只是由原本的閘門決定開關');
});

test('地圖打到頂但還有圖可換時，仍照常待在底部', () => {
  /* zoneCapped 為 false（switchZone 會處理換圖），farmPark 的行為不變。 */
  const p = gatePolicy();
  const cmds = p.decide(fst(10, 230, {
    best: 230, itemLevelHere: 200, farmFloorStage: 200,
    nextFarmStage: null, zoneCapped: false, farmFloorHpRatio: 1.9
  }));
  assert.equal(retreats(cmds)[0].args.delta, 200 - 230);
  assert.equal(autoOn(cmds), false);
});

test('地圖打到頂（nextFarmStage 為 null）推進期只跳回 best，不亂衝', () => {
  const p = gatePolicy();
  const tier = {
    best: 230, itemLevelHere: 200, farmFloorStage: 200,
    nextFarmStage: null, farmFloorHpRatio: 1.9
  };
  p.decide(fst(10, 230, tier));                             // 刷：退到 200
  const cmds = p.decide(fst(10 + FARM_SEC, 200, tier));
  assert.equal(retreats(cmds)[0].args.delta, 230 - 200);
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
  c.G.stage.zone = 'desert';
  if (c.G.zoneProgress && c.G.zoneProgress.desert) c.G.zoneProgress.desert.best = 149;

  const tier = e.panel('eval').tier;
  const before = c.fieldDropRatesFor(c.G.stage.current, c.G.stage.current, 'desert');

  const res = c.runCommand('stage.go', { delta: tier.farmFloorStage - c.G.stage.current });
  const bad = !res.ok ? res.error : (typeof res.result === 'string' ? res.result : null);
  assert.equal(bad, null, 'stage.go 不該被遊戲拒絕');
  assert.equal(c.G.stage.current, tier.farmFloorStage);
  assert.deepEqual(c.fieldDropRatesFor(c.G.stage.current, c.G.stage.current, 'desert'), before,
    '退到 floor 之後掉落率必須完全不變——這是整條規則的前提');
});
