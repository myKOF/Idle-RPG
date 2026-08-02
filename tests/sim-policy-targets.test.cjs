/* 目標與缺口驅動。

   策略原本寫的是「該做什麼」——一份靜態的詞條保留清單。問題是正確答案會隨關卡改變：
   實測怪物閃避在關卡 130 是 86.8%、關卡 150 是 103%，而命中公式會夾在 5%~100%。
   角色面板命中 100%、身上 65 條詞條一條命中率都沒有，有效命中觸底 5%——
   13,718 次出手只中 551 次，而策略完全不知道這件事。

   改成宣告「要達成什麼」：直譯器每個決策點算出缺口，規則據此行動，補滿自動讓位。

   這裡測的是機制本身，不開遊戲引擎——合成 state 直接驅動策略層。 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPolicy } = require('../scripts/sim/policy.js');

/* 一份最小策略：宣告一個有效命中率目標，並用一條規則把缺口原樣回報成指令參數。 */
function makePolicy(extra, targetExtra) {
  return createPolicy(Object.assign({
    name: 'test',
    decideEveryGameSec: 60,
    needPanels: ['equip', 'battle'],
    track: { monster: 'panels.battle.field.monster', stage: 'view.stage' },
    targets: [Object.assign({
      id: 'hit',
      kind: 'selfMinusEnemy',
      self: 'panels.equip.stats.hit',
      enemy: 'ctx.enemyDodge',
      clampMin: 5,
      clampMax: 100,
      atLeast: 95,
      affixKey: 'hit'
    }, targetExtra || {})],
    rules: [{
      id: 'echo',
      cmd: 'debug.echo',
      args: {
        value: { $path: 'ctx.deficit.hit.value' },
        short: { $path: 'ctx.deficit.hit.short' },
        met: { $path: 'ctx.deficit.hit.met' }
      }
    }]
  }, extra || {}));
}

/* 合成觀測點。selfHit＝面板命鐘率，dodge＝當前怪物閃避。 */
function st(sec, selfHit, dodge, equipment) {
  return {
    gameTimeSec: sec,
    view: { stage: 100 },
    panels: {
      equip: {
        stats: { hit: selfHit },
        /* 遊戲送出來的詞條規則：命中率只能長在這些部位（協議 v15）。 */
        affixRules: { hit: { slots: ['helmet', 'gloves', 'wrist', 'legs', 'boots', 'ring', 'amulet'], minR: null } }
      },
      battle: { field: { monster: dodge === null ? null : { dodge: dodge, maxHp: 100, hp: 100, level: 100 } } },
      inv: { equipment: equipment || {} }
    }
  };
}

function echoOf(cmds) {
  const c = cmds.find((x) => x.name === 'debug.echo');
  return c ? c.args : null;
}

test('缺口＝目標減去當前值，補滿之後 met 為真', () => {
  const p = makePolicy();
  const low = echoOf(p.decide(st(1, 100, 60)));       // 有效命中 40
  assert.equal(low.value, 40);
  assert.equal(low.short, 55);
  assert.equal(low.met, false);

  const ok = echoOf(p.decide(st(2, 200, 60)));        // 有效命中 100（夾在上限）
  assert.equal(ok.value, 100);
  assert.equal(ok.short, 0);
  assert.equal(ok.met, true);
});

test('要套用遊戲的夾值，否則缺口大小會誤導優先序', () => {
  /* 命中 100 − 閃避 103 = −3，但遊戲夾在 5% 下限。不夾的話缺口會被算成 98
     而不是 90，這條目標會不合理地壓過其他目標。 */
  const p = makePolicy();
  const d = echoOf(p.decide(st(1, 100, 103)));
  assert.equal(d.value, 5);
  assert.equal(d.short, 90);
});

test('沒有觀測到怪物時回報 unknown 而不是假裝缺口為 0', () => {
  /* 開場還沒交戰、或剛過關的空檔。回 0 會讓規則以為「已達標」而不動作，
     回滿缺口又會讓它在資訊不足時亂洗。unknown 是第三種答案。 */
  const p = makePolicy();
  const cmds = p.decide(st(1, 100, null));
  const d = echoOf(cmds);
  assert.equal(d.value, null);
  assert.equal(d.met, true, 'unknown 視同不動作');
});

test('怪物閃避取自高頻觀測，決策點沒在交戰也讀得到', () => {
  /* 決策點是取樣式的，很可能落在怪物剛死的空檔。現讀會拿到 null，
     所以要用觀測記下來的最近一次。 */
  const p = makePolicy();
  p.observe(st(1, 100, 70));                          // 觀測時有怪
  const d = echoOf(p.decide(st(2, 100, null)));       // 決策時沒怪
  assert.equal(d.value, 30, '應沿用觀測到的閃避 70');
});

/* ---- 缺口洗煉挑哪個部位 ---- */

function deficitPolicy(targetExtra) {
  return createPolicy({
    name: 'test',
    decideEveryGameSec: 60,
    needPanels: ['equip', 'battle', 'inv'],
    track: { monster: 'panels.battle.field.monster', stage: 'view.stage' },
    targets: [Object.assign({
      id: 'hit', kind: 'selfMinusEnemy',
      self: 'panels.equip.stats.hit', enemy: 'ctx.enemyDodge',
      clampMin: 5, clampMax: 100, atLeast: 95, affixKey: 'hit', maxAffixes: 1
    }, targetExtra || {})],
    rules: [{
      id: 'fix', cmd: 'item.rerollAffix',
      rerollForDeficit: { equipment: 'panels.inv.equipment', minRarity: 0, keepAncient: true }
    }]
  });
}

const GEAR = {
  weapon: { id: 'w1', slot: 'weapon', rarity: 5, affixes: [{ key: 'atkPct' }] },
  amulet: { id: 'a1', slot: 'amulet', rarity: 5, affixes: [{ key: 'gemEff' }] },
  boots: { id: 'b1', slot: 'boots', rarity: 5, affixes: [{ key: 'defPct' }] },
  helmet: { id: 'h1', slot: 'helmet', rarity: 5, affixes: [{ key: 'hpPct' }] }
};

function rerollOf(cmds) {
  return cmds.filter((c) => c.name === 'item.rerollAffix');
}

test('只洗遊戲允許的部位——武器洗不出命中率就不該去洗它', () => {
  /* 手抄部位清單踩過的坑：策略寫了 weapon（命中率不能出現在武器上）
     與 bracers（遊戲的鍵是 wrist），375 次洗煉一條都沒洗出來。
     可用部位一律從 panels.equip.affixRules 讀。 */
  const p = deficitPolicy();
  const cmds = rerollOf(p.decide(st(1, 100, 60, GEAR)));
  assert.equal(cmds.length, 1);
  assert.notEqual(cmds[0].args.itemId, 'w1', '不該去洗武器');
});

test('avoidSlots 保護高價值部位，preferSlots 決定先犧牲哪一格', () => {
  /* player_strategy.md：項鏈戒指是關鍵（寶石鑲嵌率／掉寶率／經驗加成），
     命中率有 7 個部位可洗，不必用最貴的格子付帳。 */
  const p = deficitPolicy({ avoidSlots: ['ring', 'amulet'], preferSlots: ['boots', 'helmet'] });
  const cmds = rerollOf(p.decide(st(1, 100, 60, GEAR)));
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].args.itemId, 'b1', '應先犧牲 boots');
  assert.notEqual(cmds[0].args.affixKey, 'hit', '不該把目標詞條本身洗掉');
});

test('目標達成後就不再洗——這是「拿一兩格去換」，不是全身都洗成它', () => {
  const p = deficitPolicy();
  const gear = JSON.parse(JSON.stringify(GEAR));
  gear.boots.affixes = [{ key: 'hit' }];              // 已經有 1 條，maxAffixes 也是 1
  assert.equal(rerollOf(p.decide(st(1, 100, 60, gear))).length, 0);
});

test('缺口補滿後停手，就算身上一條目標詞條都沒有', () => {
  const p = deficitPolicy();
  assert.equal(rerollOf(p.decide(st(1, 200, 60, GEAR))).length, 0, '有效命中已達 100%，不該再洗');
});

/* ============ 數量型目標：首飾保證詞條 ============

   player_strategy.md 對首飾的要求是「至少保證共 N 條寶石鑲嵌率／經驗加成／掉寶率」。
   那是**數量下限**，而保留清單只表達得出「這些可以留」。實測 5 個 seed、15 件首飾，
   極限規格各 3 條，實際只出現寶石鑲嵌 1 條、經驗 4 條、掉寶 2 條——因為那三條合計
   只佔項鏈詞條池權重的 3%，而清單裡有 18 項可接受，隨便中一項就停手。 */

function countPolicy(atLeast, extra) {
  return createPolicy({
    name: 'count-test',
    decideEveryGameSec: 60,
    needPanels: ['equip', 'inv'],
    targets: [Object.assign({
      id: 'jewelGemEff',
      kind: 'affixCount',
      affixKey: 'gemEff',
      equipment: 'panels.inv.equipment',
      slots: ['amulet', 'ring', 'ring2'],
      atLeast: atLeast
    }, extra || {})],
    rules: [{
      id: 'fix', cmd: 'item.rerollAffix',
      rerollForDeficit: { equipment: 'panels.inv.equipment', minRarity: 4, keepAncient: true }
    }]
  });
}

/* 首飾三件，預設都沒有目標詞條。遊戲規則：gemEff 只長在 ring/amulet 且需 R4 以上。 */
function jewelState(sec, equipment) {
  return {
    gameTimeSec: sec,
    view: { stage: 100 },
    panels: {
      equip: { stats: { hit: 100 }, affixRules: { gemEff: { slots: ['ring', 'amulet'], minR: 4 } } },
      inv: { equipment: equipment }
    }
  };
}
function jewelGear(perSlot) {
  const mk = (id, slot, keys) => ({ id: id, slot: slot, rarity: 5, affixes: keys.map((k) => ({ key: k })) });
  return {
    amulet: mk('a1', 'amulet', perSlot.amulet || ['critRate', 'atkPct']),
    ring: mk('r1', 'ring', perSlot.ring || ['critRate', 'atkPct']),
    ring2: mk('r2', 'ring', perSlot.ring2 || ['critRate', 'atkPct']),
    weapon: mk('w1', 'weapon', ['atkPct', 'critRate'])
  };
}

test('數量型目標：缺口＝要求條數減去身上實際條數', () => {
  const p = countPolicy(3);
  const cmds = p.decide(jewelState(1, jewelGear({})));
  assert.equal(cmds.filter((c) => c.name === 'item.rerollAffix').length, 1, '一次專注一個部位');

  const q = countPolicy(3);
  const done = jewelGear({ amulet: ['gemEff'], ring: ['gemEff'], ring2: ['gemEff'] });
  assert.equal(q.decide(jewelState(1, done)).filter((c) => c.name === 'item.rerollAffix').length, 0,
    '三條都有了就停手');
});

test('ring2 用的是裝備欄位鍵、部位鍵是 ring——兩套鍵都要認得', () => {
  /* 戒指與副手的裝備欄位鍵（ring2/weapon2）與遊戲的部位鍵（ring/weapon）不一致。
     只認一套的話會漏掉一整格，而且不會有任何徵兆。 */
  const p = countPolicy(1);
  const gear = jewelGear({ ring2: ['gemEff'] });          // 只有 ring2 有
  assert.equal(p.decide(jewelState(1, gear)).filter((c) => c.name === 'item.rerollAffix').length, 0,
    'ring2 上的那一條要算進數量');
});

test('只洗遊戲允許的部位——武器洗不出寶石鑲嵌效率', () => {
  const p = countPolicy(3);
  const cmds = p.decide(jewelState(1, jewelGear({}))).filter((c) => c.name === 'item.rerollAffix');
  assert.notEqual(cmds[0].args.itemId, 'w1');
});

test('不會把已經洗出來的目標詞條當成犧牲品洗掉', () => {
  const p = countPolicy(3);
  const gear = jewelGear({ amulet: ['gemEff', 'critRate'] });
  const cmds = p.decide(jewelState(1, gear)).filter((c) => c.name === 'item.rerollAffix');
  assert.equal(cmds.length, 1);
  assert.notEqual(cmds[0].args.affixKey, 'gemEff');
});

test('atLeast 就是數量下限，不必再寫一次 maxAffixes', () => {
  /* 兩個地方各寫一次同一個數字，遲早對不上；對不上的症狀是「洗到一半就停」。 */
  const p = countPolicy(2);
  const gear = jewelGear({ amulet: ['gemEff'] });          // 已有 1 條，還缺 1 條
  assert.equal(p.decide(jewelState(1, gear)).filter((c) => c.name === 'item.rerollAffix').length, 1);

  const q = countPolicy(2);
  const gear2 = jewelGear({ amulet: ['gemEff'], ring: ['gemEff'] });
  assert.equal(q.decide(jewelState(1, gear2)).filter((c) => c.name === 'item.rerollAffix').length, 0);
});

/* ============ 產出速率與關卡閘門 ============

   命中率、傷害、抗性都是原因；殺敵速度是結果。player_strategy.md 定義安全關卡
   用的正是結果——「能在平均 3 秒內殺死一個敵人」。量結果的一關卡閘門，任何一個
   原因出問題都攔得到，不必替每個原因各補一條規則。 */

function gatePolicy(gateExtra, targetExtra) {
  return createPolicy({
    name: 'gate-test',
    decideEveryGameSec: 60,
    needPanels: ['battle', 'inv'],
    targets: [Object.assign({
      id: 'killRate',
      kind: 'ratePerMin',
      counter: 'panels.battle.lootStats.sources.field.kills',
      windowSec: 300,
      atLeast: 20
    }, targetExtra || {})],
    rules: [{
      id: 'gate',
      cmd: 'stage.setAutoAdvance',
      stageGate: Object.assign({
        stage: 'view.stage',
        equippedRarities: 'panels.inv.equipmentRarities',
        argKey: 'on',
        checkpoints: [{ minRarity: 0, coverage: 0 }],   // 品質門檻放行，只驗產出這一道
        retreatCmd: 'stage.go',
        requireTargets: ['killRate']
      }, gateExtra || {})
    }]
  });
}

/* 合成觀測點：kills 是遊戲的累積野外擊殺數。 */
function bst(sec, kills, stage) {
  return {
    gameTimeSec: sec,
    view: { stage: stage === undefined ? 150 : stage },
    panels: {
      battle: { lootStats: { sources: { field: { kills: kills } } } },
      inv: { equipmentRarities: { weapon: 5 } }
    }
  };
}

function autoOn(cmds) {
  const c = cmds.find((x) => x.name === 'stage.setAutoAdvance');
  return c ? c.args.on : null;
}
function retreatOf(cmds) {
  return cmds.filter((c) => c.name === 'stage.go');
}

/* 依實際節奏餵觀測：每 10 秒一拍，模擬 observeEverySec 的高頻取樣。
   回傳結束時的累積擊殺數，讓後續的決策點接得下去。 */
function feed(p, fromSec, toSec, perMin, kills0, stage) {
  let kills = kills0 || 0;
  for (let t = fromSec + 10; t <= toSec; t += 10) {
    kills += perMin / 6;                                // 每 10 秒 ＝ 每分鐘的 1/6
    p.observe(bst(t, kills, stage));
  }
  return kills;
}

test('速率＝計數器差分除以經過時間，觀測時累積、決策時取用', () => {
  const p = gatePolicy();
  p.observe(bst(0, 0));
  const k = feed(p, 0, 300, 30);                        // 30 隻/分，高於門檻 20
  assert.equal(autoOn(p.decide(bst(300, k))), true, '殺得動，閘門應放行');

  const q = gatePolicy();
  q.observe(bst(0, 0));
  const k2 = feed(q, 0, 300, 10);
  assert.equal(autoOn(q.decide(bst(300, k2))), false, '只有 10 隻/分，不算安全關卡');
});

test('視窗還沒攢滿時回 unknown，閘門照常放行', () => {
  /* 資料不足時不要下判斷。回「沒達標」的話開場前幾分鐘會被誤判成打不動，
     一路退到第 1 關；回「已達標」又會讓閘門在真的打不動時晚好幾分鐘才反應。 */
  const p = gatePolicy({ targetRetreat: { step: 5, everySec: 300, minStage: 1 } });
  p.observe(bst(0, 0));
  feed(p, 0, 60, 0);                                    // 只跨 60 秒，短於視窗的一半
  const cmds = p.decide(bst(60, 0));
  assert.equal(autoOn(cmds), true);
  assert.equal(retreatOf(cmds).length, 0, '資料不足不該退關');
});

test('同一個遊戲時刻重複觀測不會灌爆視窗', () => {
  /* 決策點本身也是觀測時刻，observe 與 decide 會在同一秒各取樣一次。
     重複記點的話視窗會被同時刻的點佔滿，跨距永遠攢不到門檻。 */
  const p = gatePolicy();
  p.observe(bst(0, 0));
  const k = feed(p, 0, 300, 30);
  for (let i = 0; i < 20; i++) p.observe(bst(300, k));
  assert.equal(autoOn(p.decide(bst(300, k))), true, '跨距仍應是 0→300 秒');
});

test('計數器被歸零時不會算出負速率', () => {
  /* 遊戲的統計「清理」會重建 LOOT_STATS。不處理的話差分變負數，
     閘門會被一個假訊號關上，而且看起來就只是「AI 忽然開始退關」。 */
  const p = gatePolicy({ targetRetreat: { step: 5, everySec: 300, minStage: 1 } });
  p.observe(bst(0, 0));
  feed(p, 0, 300, 20);
  p.observe(bst(310, 0));                               // 歸零
  const cmds = p.decide(bst(320, 0));
  assert.equal(retreatOf(cmds).length, 0, '歸零後應重新攢視窗，不該立刻判定打不動');
});

test('取樣中斷過（離線）就重新起算，不會被誤判成打不動', () => {
  /* state.gameTimeSec 是含離線的牆鐘（engine.gameTimeSec 讀 vNowMs，offlineFor 會推它），
     但離線收益不寫 LOOT_STATS。不處理的話，離線 16 小時之後那一拍是
     「時間過了 57,600 秒、擊殺 0 隻」，於是每天上線的頭五分鐘都會被判成打不動而退關。 */
  const p = gatePolicy({ targetRetreat: { step: 5, everySec: 300, minStage: 1 } });
  p.observe(bst(0, 0));
  const k = feed(p, 0, 300, 40);                        // 上線這段打得很好
  const back = 300 + 16 * 3600;
  p.observe(bst(back, k));                              // 離線 16 小時後回來，擊殺沒增加
  const cmds = p.decide(bst(back, k, 150));
  assert.equal(autoOn(cmds), true, '中斷不是打不動，應重新攢視窗而不是判定失敗');
  assert.equal(retreatOf(cmds).length, 0);
});

test('產出不足就退關，而且退關間隔內只退一次', () => {
  const p = gatePolicy({ targetRetreat: { step: 5, everySec: 300, minStage: 1 } });
  p.observe(bst(0, 0));
  feed(p, 0, 300, 0);                                   // 整整五分鐘 0 隻

  const first = p.decide(bst(300, 0, 150));
  assert.equal(autoOn(first), false);
  assert.deepEqual(retreatOf(first).map((c) => c.args), [{ delta: -5 }], '應退 5 關');

  feed(p, 300, 400, 0, 0, 145);
  assert.equal(retreatOf(p.decide(bst(400, 0, 145))).length, 0,
    '間隔未到不該再退——視窗裡還是退關前的取樣');

  feed(p, 400, 600, 0, 0, 145);
  assert.deepEqual(retreatOf(p.decide(bst(600, 0, 145))).map((c) => c.args), [{ delta: -5 }],
    '間隔到了才退第二次');
});

test('退關不會低於 minStage', () => {
  const p = gatePolicy({ targetRetreat: { step: 5, everySec: 300, minStage: 10 } });
  p.observe(bst(0, 0));
  feed(p, 0, 300, 0);
  assert.deepEqual(retreatOf(p.decide(bst(300, 0, 12))).map((c) => c.args), [{ delta: -2 }], '只退到下限');

  const q = gatePolicy({ targetRetreat: { step: 5, everySec: 300, minStage: 10 } });
  q.observe(bst(0, 0));
  feed(q, 0, 300, 0);
  assert.equal(retreatOf(q.decide(bst(300, 0, 10))).length, 0, '已在下限就不再退');
});

test('沒宣告 targetRetreat 時只關閉自動推關，不會退關', () => {
  /* 退關要明確宣告才會發生。宣告了 requireTargets 就自動開始往回跑的話，
     既有策略升級這個機制時行為會無聲改變。 */
  const p = gatePolicy();
  p.observe(bst(0, 0));
  feed(p, 0, 300, 0);
  const cmds = p.decide(bst(300, 0, 150));
  assert.equal(autoOn(cmds), false);
  assert.equal(retreatOf(cmds).length, 0);
});

test('速率目標的計數器面板會自動列進觀測面板', () => {
  /* 漏列的話觀測時取不到值、取樣整場跳過，速率只在決策點被取樣——
     決策間隔 15~60 秒，視窗要好幾分鐘才攢得滿，而且不會有任何錯誤訊息。 */
  const p = gatePolicy();
  assert.ok(p.observePanels.indexOf('battle') >= 0, `observePanels 應含 battle，實際為 ${JSON.stringify(p.observePanels)}`);
});
