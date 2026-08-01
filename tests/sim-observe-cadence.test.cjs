/* 觀測與行動分離的測試。

   在這之前 decideEveryGameSec 一個旋鈕同時決定兩件事：玩家多久做一次後勤、
   以及玩家多仔細看戰鬥。而卡關重試間隔是「觀察到的敵人殘血百分比當分鐘數」，
   於是玩得少的人不只操作少，還會**系統性地高估殘血**、把重試間隔拉長，
   甚至整場失敗都沒被偵測到（交戰與死亡都發生在兩次取樣之間）。

   這裡不開遊戲引擎，用合成的 state 直接驅動策略層——要測的是取樣邏輯本身，
   引擎跑不跑得動是別的測試的事。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPolicy } = require('../scripts/sim/policy.js');

/* 一份最小策略：只有一條規則，把 ctx.minHpPct 原樣回報成指令參數。
   這是從外部看見追蹤狀態的唯一乾淨管道——策略層是隔離的，memo 拿不到。 */
function makePolicy(extra) {
  return createPolicy(Object.assign({
    name: 'test',
    decideEveryGameSec: 60,
    needPanels: ['battle'],
    track: {
      monster: 'panels.battle.field.monster',
      stage: 'view.stage',
      equipment: 'panels.inv.equipment',
      equippedScores: 'panels.inv.equipmentScores'
    },
    rules: [{
      id: 'echo',
      cmd: 'debug.echo',
      args: { minHpPct: { $path: 'ctx.minHpPct' }, fails: { $path: 'ctx.fails' }, block: { $path: 'ctx.blockStage' } }
    }]
  }, extra || {}));
}

/* stage 與怪物血量的合成觀測點。monster 給 null 代表沒有在打菁英／BOSS。 */
function st(sec, stage, hpPct) {
  return {
    gameTimeSec: sec,
    view: { stage: stage },
    panels: {
      battle: { field: { monster: hpPct === null ? null : { isBoss: true, maxHp: 1000, hp: 10 * hpPct } } },
      inv: { equipment: {}, equipmentScores: {} }
    }
  };
}

function echoOf(cmds) {
  const c = cmds.find((x) => x.name === 'debug.echo');
  return c ? c.args : null;
}

/* ---- 宣告與推導 ---- */

test('observeEverySec 預設 1 秒，且不因玩家強度而異', () => {
  assert.equal(makePolicy().observeEverySec, 1);
  assert.equal(makePolicy({ decideEveryGameSec: 5 }).observeEverySec, 1);
});

test('策略可以自行宣告 observeEverySec', () => {
  assert.equal(makePolicy({ observeEverySec: 0.5 }).observeEverySec, 0.5);
});

test('宣告 0 或負數時退回預設，不會變成除以零或無限迴圈', () => {
  assert.equal(makePolicy({ observeEverySec: 0 }).observeEverySec, 1);
  assert.equal(makePolicy({ observeEverySec: -3 }).observeEverySec, 1);
});

test('observePanels 從 track 推導，且不包含昂貴的背包面板', () => {
  /* 觀測只需要 monster 與 stage 指到的面板。把 inv 也拉進來的話，
     1Hz 觀測會變成每秒建一次背包面板——那是這個設計最容易踩的效能陷阱。 */
  assert.deepEqual(makePolicy().observePanels, ['battle']);
});

test('沒有 track 的策略不需要任何觀測面板', () => {
  const p = createPolicy({ name: 't', decideEveryGameSec: 10, rules: [] });
  assert.deepEqual(p.observePanels, []);
});

/* ---- 取樣精度：這才是這次改動要修的東西 ---- */

test('高頻觀測抓得到低頻會錯過的殘血低點', () => {
  const coarse = makePolicy();
  const fine = makePolicy();

  /* 同一場戰鬥：BOSS 從 90% 一路被打到 12%，然後玩家死了退關（stage 10 → 9）。
     低頻只在 90% 那一刻看過一眼，高頻看完全程。 */
  fine.observe(st(0, 10, 90));
  fine.observe(st(1, 10, 60));
  fine.observe(st(2, 10, 30));
  fine.observe(st(3, 10, 12));
  coarse.observe(st(0, 10, 90));

  /* 退關：交戰結束，兩邊各自結算 */
  const fineOut = echoOf(fine.decide(st(4, 9, null)));
  const coarseOut = echoOf(coarse.decide(st(4, 9, null)));

  assert.equal(fineOut.minHpPct, 12, '高頻應該記到 12%');
  assert.equal(coarseOut.minHpPct, 90, '低頻只看過 90%');
  /* 重試間隔＝殘血百分比當分鐘數。低頻玩家因此要多等 78 分鐘，純粹因為看得粗。 */
});

test('整場交戰落在兩次取樣之間時，低頻連失敗都偵測不到', () => {
  /* 這是比「高估殘血」更嚴重的一種：那一關根本沒被記成卡點，
     之後的針對性強化與重試閘門完全不會啟動。 */
  const coarse = makePolicy();
  coarse.observe(st(0, 10, null));      // 還沒遇到 BOSS
  const out = echoOf(coarse.decide(st(60, 9, null)));   // 下一眼時已經死完退關了
  assert.equal(out.fails, 0, '低頻沒看到這場失敗');
  assert.equal(out.block, 0, '也就不會有卡點');

  const fine = makePolicy();
  fine.observe(st(0, 10, null));
  fine.observe(st(1, 10, 80));          // 高頻在中間看到了交戰
  const out2 = echoOf(fine.decide(st(60, 9, null)));
  assert.equal(out2.fails, 1, '高頻記到了這場失敗');
  assert.equal(out2.block, 10);
});

/* ---- 可重入：行動點本身也是一個觀測時刻 ---- */

test('同一個時刻 observe 與 decide 各呼叫一次，失敗只算一次', () => {
  /* 驅動端在行動點會先觀測、再決策，兩者拿到同一份 state。
     交戰結束的記帳若不是可重入的，fails 會被灌成兩倍。 */
  const p = makePolicy();
  p.observe(st(0, 10, 50));
  p.observe(st(1, 9, null));            // 觀測先看到退關
  const out = echoOf(p.decide(st(1, 9, null)));  // 同一刻再決策一次
  assert.equal(out.fails, 1, '同一場失敗不該被算兩次');
});

test('未分離時行為與拆分前相同：decide 自己就會觀測', () => {
  /* observeEverySec 設成與行動間隔相同（或驅動端不呼叫 observe）時，
     decide 內部仍然會做一次觀測，整條追蹤照常運作。 */
  const p = makePolicy();
  p.decide(st(0, 10, 90));
  p.decide(st(60, 10, 40));
  const out = echoOf(p.decide(st(120, 9, null)));
  assert.equal(out.minHpPct, 40);
  assert.equal(out.fails, 1);
});

test('observe 不送出任何指令——看戰鬥不是按按鈕', () => {
  const p = makePolicy();
  assert.equal(p.observe(st(0, 10, 90)), undefined);
});

test('observe 與 decide 一樣拿不到遊戲狀態', () => {
  /* 隔離是這一層的地基，新增進入點不能開後門。 */
  const p = makePolicy();
  assert.equal(p.__evalInPolicyContext('typeof G'), 'undefined');
  assert.equal(p.__evalInPolicyContext('typeof require'), 'undefined');
  assert.equal(p.__evalInPolicyContext('typeof observe'), 'function');
});
