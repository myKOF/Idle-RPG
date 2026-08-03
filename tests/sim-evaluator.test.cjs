/* 邊際效益評估器（scripts/sim/evaluator.js）與它驅動的決策規則。

   這個機制回答的是「下一單位預算投到哪裡增幅最大」。它跑在**引擎的** vm context
   （看得到 G、FIELD 與遊戲函式），把結果算成純資料再交給策略沙箱——
   策略的隔離一點都沒有放寬，但它終於有了「誰比較強」的答案，而那個答案是遊戲給的。

   這裡盯住三類最容易靜默失效的地方：

   1. **唯讀性**。評估器要問「假如換上這件會怎樣」，用的是 computeStats(override)。
      只要有一條路徑不小心寫回真實物件，存檔就會分岔——而症狀只是一串對不上的雜湊，
      完全看不出來是誰動的。實際踩過：itemScore() 內部的 itemEnchants() 會把
      { enchant: null } 就地正規化成 { enchants: [] }，「看一下背包」就改到了存檔。

   2. **模型係數與遊戲同步**。命中夾值（5%~100%）在遊戲裡是內嵌在 resolveHit 的
      字面值，沒有具名函式可呼叫，只能宣告在評估器裡。遊戲改了這裡不會有任何錯誤訊息，
      所以直接比對 resolveHit 的原始碼。

   3. **規則真的照 ROI 走**。換裝改成「問遊戲哪件比較強」之後，最容易的退化是
      規則其實沒接上面板（source 路徑打錯），而那只會表現成「AI 不換裝」。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
const { createPolicy } = require(path.join(ROOT, 'scripts/sim/policy.js'));

const EVAL_CFG = {
  affixKeys: ['atkFlat', 'atkPct', 'critRate', 'critDmg', 'hpFlat', 'hpPct', 'hit'],
  slotUpgrades: { candidatesPerSlot: 2 },
  probeEquippedAffixes: true,
  probeTopSlots: 3,
  refreshSec: 15
};

function sha(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function boot(seed, sec) {
  const e = createEngine({ seed }).boot(null);
  e.setEvalParams(EVAL_CFG);
  if (sec) e.stepSeconds(sec);
  return e;
}

/* ---- 1. 唯讀性與決定論 ---- */

test('評估器是唯讀的：跑過與沒跑過，存檔逐位元組相同', () => {
  const run = (withEval) => {
    const e = boot(4242);
    for (let i = 0; i < 40; i++) {
      e.stepSeconds(30);
      if (withEval) { e.panel('eval'); e.panel('evalCombat'); }
    }
    return e.saveJson();
  };
  assert.equal(sha(run(true)), sha(run(false)),
    '建立 panels.eval 改變了遊戲狀態。純觀測絕不能寫回 G——'
    + '寫回去之後同 seed 的兩場會分岔，verify_equivalence / cross_check / 所有 A/B 全部失效');
});

test('評估器本身是決定性的：同 seed 兩次得到同一份面板', () => {
  const snap = () => JSON.stringify(boot(777, 1800).panel('eval'));
  assert.equal(snap(), snap(), '評估器有不決定性的來源（例如讀了真實時間或用了亂數）');
});

test('沒有對手時的空殼與正常回傳的欄位完全一致', () => {
  /* 這一支盯的是一個實際發生過的靜默失效。

     `equippedAffixes` 是後來才加的欄位，只加在「有對手」那一份回傳，
     空殼漏掉了。於是每個沒有對手的決策點（剛死、復活中、剛過關）
     `panels.eval.equippedAffixes` 就解析失敗一次並記進 BAD_PATHS——
     Codex 的獨立驗證在 8 場 20 小時的模擬裡全都量到，最嚴重一場 167 次。

     行為上無害（沒有對手時洗煉本來就該按兵不動），但它汙染的是「失效路徑」
     這個診斷管道，而那是發現「策略指到已改名欄位」的唯一訊號。 */
  const e = boot(4242, 600);
  const full = e.panel('eval');
  assert.equal(full.known, true, '前置條件：這一拍應該正在交戰');

  /* 把對手拿掉，逼出空殼。改的是 FIELD.monster 這個執行期參照，不是存檔。 */
  const saved = e.ctx.FIELD.monster;
  e.ctx.FIELD.monster = null;
  const shell = e.panel('eval');
  e.ctx.FIELD.monster = saved;

  assert.equal(shell.known, false, '拿掉對手之後應該回空殼');
  assert.deepEqual(Object.keys(shell).sort(), Object.keys(full).sort(),
    '空殼與正常回傳的欄位集合不同。策略讀得到哪些欄位不該取決於「這一拍有沒有怪」——'
    + '少一個欄位就會讓對應的規則靜靜失效，並把 BAD_PATHS 灌滿雜訊');
});

/* ---- 2. 模型係數哨兵 ---- */

test('命中夾值與遊戲的 resolveHit 一致', () => {
  const e = boot(1);
  const notes = e.panel('eval').model;
  const src = String(e.ctx.resolveHit);
  const m = /clamp\(\s*attackerHit\s*-\s*defenderDodge\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(src);
  assert.ok(m, 'resolveHit 的命中夾值寫法變了，評估器的 MODEL_NOTES 需要重新對照（js/formula.js）');
  assert.equal(notes.hitMin, Number(m[1]), '評估器的 hitMin 與 resolveHit 不同步');
  assert.equal(notes.hitMax, Number(m[2]), '評估器的 hitMax 與 resolveHit 不同步');
});

test('探針強度取區間中點＝基準值本身', () => {
  const e = boot(1);
  const ratio = e.panel('eval').model.probeRollRatio;
  const mult = e.ctx.strengthMult(e.ctx.STRENGTH_ROLL_MAX * ratio);
  assert.ok(Math.abs(mult - 1) < 1e-9,
    `探針強度算出來的倍率是 ${mult}，不是 1。用滿值會系統性高估所有候選、用最低值會系統性低估——ROI 比的是期望值`);
});

/* ---- 3. 裝等分段：這次改造的核心事實 ---- */

test('裝等展望的斷點與 equipmentTierLevel 一致', () => {
  const e = boot(20260803, 600);
  const tier = e.panel('eval').tier;
  assert.equal(tier.itemLevelHere, e.ctx.equipmentTierLevel(tier.stage),
    '當前分段算錯了——策略會以為原地刷還掉得到更好的裝備');
  assert.equal(tier.itemLevelNext, e.ctx.equipmentTierLevel(tier.nextBreakpointStage));
  assert.ok(tier.nextBreakpointStage > tier.stage, '斷點必須在前方');
});

test('跨過裝等斷點的增幅遠大於跨一個品質階', () => {
  const e = boot(1);
  const { affixBaseValue } = e.ctx;
  const tierGain = affixBaseValue('atkFlat', 50, 4) / affixBaseValue('atkFlat', 1, 4);
  const rarityGain = affixBaseValue('atkFlat', 1, 5) / affixBaseValue('atkFlat', 1, 2);
  assert.ok(tierGain > rarityGain * 5,
    `裝等增幅 ×${tierGain.toFixed(2)}、品質增幅 ×${rarityGain.toFixed(2)}。`
    + '兩者一旦接近，「品質優先」的舊字典序就不再是明顯錯誤，本次改造的前提要重新檢討');
});

/* ---- 4. ROI 排序真的隨面板改變 ---- */

test('暴擊率低時爆傷的邊際效益接近零', () => {
  const e = boot(4242, 600);
  const roi = e.panel('eval').affixRoi;
  const st = e.ctx.getStats();
  assert.ok(st.critRate < 20, '前置條件：這一場的暴擊率應該還很低');
  assert.ok(roi.critDmg && roi.atkFlat, '前置條件：兩條詞條都要有合法宿主');
  assert.ok(roi.critDmg.dOffPct < roi.atkFlat.dOffPct,
    `暴擊率 ${st.critRate.toFixed(1)}% 時爆傷 (+${roi.critDmg.dOffPct.toFixed(2)}%) 竟然不輸物攻 `
    + `(+${roi.atkFlat.dOffPct.toFixed(2)}%)。邊際效益遞減沒有被算進去，靜態優先級清單就沒有被取代`);
});

test('ROI 推薦的宿主部位一定是遊戲允許的部位', () => {
  const e = boot(20260803, 1200);
  const p = e.panel('eval');
  const pool = e.ctx.AFFIX_POOL;
  const eq = e.ctx.G.equipment;
  for (const key in p.affixRoi) {
    const r = p.affixRoi[key];
    if (!r) continue;
    const allow = pool[key] && pool[key].slots;
    if (!allow) continue;
    assert.ok(allow.indexOf(eq[r.slotKey].slot) >= 0,
      `詞條 ${key} 被推薦洗在 ${r.slotKey}（部位 ${eq[r.slotKey].slot}），但 AFFIX_POOL 說它只能出現在 ${allow.join('/')}。`
      + '洗在洗不出來的部位會無限燒精華，而且完全沒有徵兆');
  }
});

/* ---- 5. 換裝規則接上面板了嗎 ---- */

function equipPolicy() {
  return createPolicy({
    name: 'test-equip',
    decideEveryGameSec: 15,
    needPanels: ['eval'],
    rules: [{
      id: 'equip-by-power',
      cmd: 'item.equip',
      equipByPower: { source: 'panels.eval.slotUpgrades', minGainPct: 1 }
    }]
  });
}

function stateWith(slotUpgrades) {
  return { gameTimeSec: 100, view: {}, panels: { eval: { slotUpgrades } } };
}

test('戰力更高就換：品質較低也照換', () => {
  const cmds = equipPolicy().decide(stateWith({
    helmet: { itemId: 'i1', gain: 11.1, need: 0, worth: true, curRarity: 4, candRarity: 1 }
  }));
  assert.equal(cmds.length, 1, '評估器說值得換，規則卻沒送出指令——source 路徑可能打錯了');
  assert.deepEqual(cmds[0].args, { itemId: 'i1', slotKey: 'helmet' });
});

test('戰力更低就不換：品質較高也不換', () => {
  const cmds = equipPolicy().decide(stateWith({
    helmet: { itemId: 'i1', gain: -3.9, need: 0, worth: false, curRarity: 1, candRarity: 4 }
  }));
  assert.equal(cmds.length, 0,
    '品質較高但戰力較低仍然換了。這正是舊字典序的錯誤：實測讓 5 個 seed 全身停在「R4 史詩、裝等 1」');
});

test('增幅低於策略門檻就不換——換裝會讓寶石與附魔重來一輪', () => {
  const cmds = equipPolicy().decide(stateWith({
    helmet: { itemId: 'i1', gain: 0.4, need: 0, worth: true }
  }));
  assert.equal(cmds.length, 0);
});

test('送出順序與物件的鍵順序無關', () => {
  const a = { boots: { itemId: 'b', gain: 5, worth: true }, amulet: { itemId: 'a', gain: 5, worth: true } };
  const b = { amulet: { itemId: 'a', gain: 5, worth: true }, boots: { itemId: 'b', gain: 5, worth: true } };
  const f = (x) => equipPolicy().decide(stateWith(x)).map((c) => c.args.slotKey).join(',');
  assert.equal(f(a), f(b), '鍵順序影響了送出順序，決定論就斷了');
});

/* ---- 6. 微調重試（Bottleneck Profiler） ---- */

function retryPolicy(limit) {
  return createPolicy({
    name: 'test-retry',
    decideEveryGameSec: 10,
    needPanels: [],
    track: {
      monster: 'panels.battle.field.monster',
      stage: 'view.stage',
      equipment: 'panels.inv.equipment',
      equippedScores: 'panels.inv.equipmentScores'
    },
    profile: { combat: ['panels.evalCombat.combat'], microRetry: { limit, cooldownSec: 120 } },
    rules: [{
      id: 'echo',
      cmd: 'debug.echo',
      args: {
        waiting: { $path: 'ctx.retryWaiting' },
        cause: { $path: 'ctx.cause' },
        micro: { $path: 'ctx.microTries' }
      }
    }]
  });
}

/* 合成一次「在第 N 關打 BOSS 打輸、退回第 N-1 關」的交戰。 */
function fight(pol, sec, stage, cause) {
  pol.observe({
    gameTimeSec: sec,
    view: { stage },
    panels: {
      battle: { field: { monster: { isBoss: true, hp: 40, maxHp: 100, dodge: 10, level: stage } } },
      evalCombat: { combat: { known: true, cause, margin: 0.3 } }
    }
  });
  /* 怪物消失且關卡倒退＝死了退關（js/combat.js 的 retreatStage）。 */
  pol.observe({
    gameTimeSec: sec + 1,
    view: { stage: stage - 1 },
    panels: { battle: { field: { monster: null } }, evalCombat: { combat: { known: false } } }
  });
}

function ask(pol, sec, stage) {
  return pol.decide({
    gameTimeSec: sec,
    view: { stage },
    panels: {
      battle: { field: { monster: null } },
      inv: { equipment: {}, equipmentScores: {} }
    }
  })[0].args;
}

test('敗因被記下來，而且驅動得了後續決策', () => {
  const pol = retryPolicy(3);
  fight(pol, 100, 50, 'EHP_TOO_LOW');
  assert.equal(ask(pol, 110, 49).cause, 'EHP_TOO_LOW',
    '敗因沒有傳到 ctx。它是「超時就全堆攻、被秒殺才補防」的唯一輸入，'
    + '取不到的話資源分配就退回盲目模式');
});

test('前 3 次失敗走短冷卻，而且不要求「有變強」', () => {
  const pol = retryPolicy(3);
  for (let i = 1; i <= 3; i++) {
    fight(pol, 100 * i, 50, 'DPS_TIMEOUT');
    /* 冷卻期間仍要等 */
    assert.equal(ask(pol, 100 * i + 5, 49).waiting, true, `第 ${i} 次失敗後應該還在冷卻`);
    /* 冷卻過了就放行——沒有換過任何裝備，也就是沒有「變強」 */
    assert.equal(ask(pol, 100 * i + 130, 49).waiting, false,
      `第 ${i} 次微調重試被「必須先變強」擋下了。微調的定義就是改配置而不是變強，`
      + '要求變強會讓三次微調全部無效');
  }
});

test('用完 3 次微調之後回到長冷卻（殘血百分比當分鐘數）', () => {
  const pol = retryPolicy(3);
  for (let i = 1; i <= 4; i++) fight(pol, 100 * i, 50, 'DPS_TIMEOUT');
  assert.equal(ask(pol, 400 + 130, 49).waiting, true,
    '第 4 次失敗後仍然只等 130 秒。微調預算必須是**有界**的，'
    + '否則 AI 會無限次用同樣的強度去撞同一道牆');
  assert.equal(ask(pol, 400 + 130, 49).micro, 3, '微調次數應該停在上限');
});

test('沒宣告 microRetry 就是舊行為：第一次失敗就進長冷卻', () => {
  const pol = createPolicy({
    name: 'test-no-micro',
    decideEveryGameSec: 10,
    needPanels: [],
    track: {
      monster: 'panels.battle.field.monster', stage: 'view.stage',
      equipment: 'panels.inv.equipment', equippedScores: 'panels.inv.equipmentScores'
    },
    rules: [{ id: 'echo', cmd: 'debug.echo', args: { waiting: { $path: 'ctx.retryWaiting' } } }]
  });
  fight(pol, 100, 50, null);
  assert.equal(ask(pol, 340, 49).waiting, true,
    '沒宣告 microRetry 的策略行為改變了——新機制必須是可選的，否則既有的六份策略全部被動變更');
});

/* ---- 6b. ROI 驅動的洗煉 ---- */

function rerollPolicy(weights) {
  return createPolicy({
    name: 'test-reroll',
    decideEveryGameSec: 60,
    needPanels: ['eval'],
    roi: {
      source: 'panels.eval.affixRoi',
      minGainPct: 0.5,
      weights: weights || {
        DPS_TIMEOUT: { offense: 1, ehp: 0 },
        EHP_TOO_LOW: { offense: 0.25, ehp: 1 },
        neutral: { offense: 1, ehp: 0.3 }
      }
    },
    track: {
      monster: 'panels.battle.field.monster', stage: 'view.stage',
      equipment: 'panels.inv.equipment', equippedScores: 'panels.inv.equipmentScores'
    },
    profile: { combat: ['panels.evalCombat.combat'], microRetry: { limit: 0 } },
    rules: [{
      id: 'reroll-by-roi',
      cmd: 'item.rerollAffix',
      rerollByRoi: {
        equipment: 'panels.inv.equipment',
        equippedAffixes: 'panels.eval.equippedAffixes',
        keepAncient: true
      }
    }]
  });
}

function rerollState(affixRoi, equippedAffixes) {
  return {
    gameTimeSec: 500,
    view: { stage: 60 },
    panels: {
      battle: { field: { monster: null } },
      inv: {
        equipment: { weapon: { id: 'w1', slot: 'weapon' }, boots: { id: 'b1', slot: 'boots' } },
        equipmentScores: {}
      },
      eval: { affixRoi, equippedAffixes }
    }
  };
}

test('洗掉的是邊際貢獻最低的那一條，不是清單上的第一條', () => {
  const cmds = rerollPolicy().decide(rerollState(
    { atkFlat: { slotKey: 'weapon', dOffPct: 11.1, dEhpPct: 0 } },
    {
      weapon: [
        { key: 'defFlat', index: 0, ancient: false, lossOffPct: 0.1, lossEhpPct: 0.2 },
        { key: 'critDmg', index: 1, ancient: false, lossOffPct: 4.0, lossEhpPct: 0 }
      ]
    }
  ));
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].args.affixKey, 'defFlat',
    '犧牲了貢獻較高的那一條。舊規則挑「第一條不在保留清單裡的」，'
    + '理由是「策略層沒有評價詞條好壞的能力」——現在有了，就該用它');
});

test('淨增益不夠就不洗——洗煉是隨機的，期望值不划算就不要花那份精華', () => {
  const cmds = rerollPolicy().decide(rerollState(
    { atkFlat: { slotKey: 'weapon', dOffPct: 3.0, dEhpPct: 0 } },
    { weapon: [{ key: 'critDmg', index: 0, ancient: false, lossOffPct: 2.9, lossEhpPct: 0 }] }
  ));
  assert.equal(cmds.length, 0, '新詞條只比舊的好 0.1%，不該花一次洗煉');
});

test('太古位置不當犧牲品——那是可累積的永久投資', () => {
  const cmds = rerollPolicy().decide(rerollState(
    { atkFlat: { slotKey: 'weapon', dOffPct: 11.1, dEhpPct: 0 } },
    { weapon: [{ key: 'gemEff', index: 0, ancient: true, lossOffPct: 0, lossEhpPct: 0 }] }
  ));
  assert.equal(cmds.length, 0,
    '把太古位置洗掉了。太古洗煉必為滿值且永遠維持太古（js/item.js rerollSingleAffix），'
    + '洗在上面的關鍵詞條是可累積的投資');
});

test('第一名的部位沒被探測到時，往下找有探到的名次', () => {
  /* 評估器為了省 computeStats 只探前幾名的宿主部位，而它挑前幾名用的是未加權的增幅，
     這裡的排序卻是依敗因加權過的——兩份名次不一定同一個。 */
  const cmds = rerollPolicy().decide(rerollState(
    {
      atkFlat: { slotKey: 'weapon', dOffPct: 11.1, dEhpPct: 0 },   // 第一名，但 weapon 沒被探
      hit: { slotKey: 'boots', dOffPct: 6.4, dEhpPct: 0 }          // 第二名，boots 有探
    },
    { boots: [{ key: 'defFlat', index: 0, ancient: false, lossOffPct: 0.2, lossEhpPct: 0.1 }] }
  ));
  assert.equal(cmds.length, 1,
    '第一名的部位沒被探到就整條規則放棄了。那種失效不會有徵兆，'
    + '只會在報表上看到「送出 0 次」，而看報表的人會以為是門檻設太高');
  assert.equal(cmds[0].args.itemId, 'b1');
});

test('敗因翻轉攻防權重：被秒殺時防禦詞條會排到前面', () => {
  const roi = {
    atkFlat: { slotKey: 'weapon', dOffPct: 8, dEhpPct: 0 },
    hpPct: { slotKey: 'boots', dOffPct: 0, dEhpPct: 9 }
  };
  const affixes = {
    weapon: [{ key: 'x', index: 0, ancient: false, lossOffPct: 0.1, lossEhpPct: 0 }],
    boots: [{ key: 'y', index: 0, ancient: false, lossOffPct: 0, lossEhpPct: 0.1 }]
  };

  const pol = rerollPolicy();
  /* 沒有敗因（中性權重偏攻 1 : 0.3）→ 攻擊詞條勝出 */
  assert.equal(pol.decide(rerollState(roi, affixes))[0].args.itemId, 'w1');

  /* 診斷為「撐不住」→ 權重翻成 0.25 : 1，防禦詞條勝出 */
  const pol2 = rerollPolicy();
  pol2.observe({
    gameTimeSec: 100,
    view: { stage: 61 },
    panels: {
      battle: { field: { monster: { isBoss: true, hp: 60, maxHp: 100, dodge: 5, level: 61 } } },
      evalCombat: { combat: { known: true, cause: 'EHP_TOO_LOW', margin: 0.2 } }
    }
  });
  pol2.observe({
    gameTimeSec: 101, view: { stage: 60 },
    panels: { battle: { field: { monster: null } }, evalCombat: { combat: { known: false } } }
  });
  assert.equal(pol2.decide(rerollState(roi, affixes))[0].args.itemId, 'b1',
    '診斷成 EHP_TOO_LOW 之後仍然在堆攻擊。'
    + 'player_strategy.md v2.0：「超時就全堆攻，被秒殺才補對應屬性抗性或生命」');
});

/* ---- 6c. 上限型目標與「撐得住才准往前推」 ---- */

function capPolicy(atMost) {
  return createPolicy({
    name: 'test-cap',
    decideEveryGameSec: 30,
    needPanels: ['battle'],
    targets: [{
      id: 'deathRate', kind: 'ratePerMin',
      counter: 'panels.battle.lootStats.sources.field.deaths',
      windowSec: 600, atMost: atMost
    }],
    rules: [{
      id: 'echo', cmd: 'debug.echo',
      args: {
        value: { $path: 'ctx.deficit.deathRate.value' },
        over: { $path: 'ctx.deficit.deathRate.over' },
        met: { $path: 'ctx.deficit.deathRate.met' },
        unknown: { $path: 'ctx.deficit.deathRate.unknown' }
      }
    }]
  });
}

function deathTick(pol, sec, deaths, decide) {
  const s = {
    gameTimeSec: sec, view: {},
    panels: { battle: { lootStats: { sources: { field: { deaths } } } } }
  };
  return decide ? pol.decide(s)[0].args : (pol.observe(s), null);
}

/* 每 60 秒取樣一次，累積 600 秒。

   ⚠️ 取樣間隔不能大於等於 windowSec：sampleRates 把「間隔 >= maxGapSec（預設等於
   windowSec）」判定為取樣中斷過而重新起算，於是永遠攢不滿視窗、永遠回 unknown。
   第一版的測試就是每 600 秒才取一次，兩個案例都變成 unknown，
   而 unknown 的 met 是 true——所以「達標」那一案**假性通過**了。
   真實策略的 observeEverySec 是 1 秒，不會踩到。 */
function deathWindow(pol, perMinute) {
  for (let s = 0; s <= 600; s += 60) deathTick(pol, s, Math.round(perMinute * s / 60), false);
  return deathTick(pol, 600, Math.round(perMinute * 10), true);
}

test('atMost 目標：低於上限算達標，超過就 over > 0', () => {
  const a = deathWindow(capPolicy(0.5), 0.3);
  assert.equal(a.unknown, false, `視窗應該攢滿了（value=${a.value}）`);
  assert.equal(a.met, true, `0.3 次/分應該在 0.5 的上限內（實際 ${a.value}）`);
  assert.equal(a.over, 0);

  const b = deathWindow(capPolicy(0.5), 1.2);
  assert.equal(b.unknown, false);
  assert.equal(b.met, false, `1.2 次/分應該超過 0.5 的上限（實際 ${b.value}）`);
  assert.ok(b.over > 0.6 && b.over < 0.8, `over 應該約為 0.7，實際 ${b.over}`);
});

test('視窗還沒攢滿時是 unknown，不是「超標」也不是「達標」', () => {
  const pol = capPolicy(0.5);
  deathTick(pol, 0, 0, false);
  const a = deathTick(pol, 10, 5, true);   // 只過了 10 秒，遠短於 windowSec/2
  assert.equal(a.unknown, true,
    '資料不足時就下判斷。「還不知道」跟「達標」與「沒達標」是三件不同的事');
});

test('atLeast 目標的行為完全不變（新增 atMost 不得動到既有語意）', () => {
  const pol = createPolicy({
    name: 'test-min', decideEveryGameSec: 30, needPanels: ['equip'],
    targets: [{ id: 'hit', kind: 'value', path: 'panels.equip.stats.hit', atLeast: 95 }],
    rules: [{
      id: 'echo', cmd: 'debug.echo',
      args: { short: { $path: 'ctx.deficit.hit.short' }, met: { $path: 'ctx.deficit.hit.met' } }
    }]
  });
  const ask = (hit) => pol.decide({ gameTimeSec: 10, view: {}, panels: { equip: { stats: { hit } } } })[0].args;
  assert.deepEqual(ask(80), { short: 15, met: false });
  assert.deepEqual(ask(99), { short: 0, met: true });
});

test('死亡率超標時不准在裝等分段之內繼續往前推', () => {
  /* 實測動機：seed 20260903 的 ROI 場 20 小時死 1,137 次（對照組 49 次），
     一路被推到分段深處反覆送死，撿不到裝備也跨不過斷點——
     這個機制反而擋掉了它自己要促成的那件事。 */
  /* ⚠️ 不能直接把 ctx.deficit 塞進 state——updateContext 每個決策點都會重建它，
     塞進去的會被原樣覆蓋掉（第一版就是這樣寫的，測出來永遠是「可以前進」）。
     要驗閘門就得**真的宣告一個目標**，讓直譯器自己算出缺口。
     這裡用 kind:'value' 直接餵值，速率取樣的部分由上面兩支測試各自覆蓋。 */
  const mk = (deathRate) => createPolicy({
    name: 'test-tierpush', decideEveryGameSec: 30, needPanels: ['eval'],
    targets: [{ id: 'deathRate', kind: 'value', path: 'panels.probe.deathRate', atMost: 0.5 }],
    rules: [{
      id: 'gate', cmd: 'stage.setAutoAdvance',
      stageGate: {
        stage: 'view.stage',
        equippedRarities: 'panels.inv.equipmentRarities',
        checkpoints: [{ maxStage: 50, minRarity: 4, coverage: 1, park: [41, 45] }, { minRarity: 0, coverage: 0 }],
        retreatCmd: 'stage.go',
        tierPush: { source: 'panels.eval.tier', minBreakpointGain: 2, advanceRequiresTargets: ['deathRate'] }
      }
    }]
  }).decide({
    gameTimeSec: 100,
    view: { stage: 44 },
    panels: {
      probe: deathRate === null ? {} : { deathRate },
      inv: { equipmentRarities: { weapon: 2, helmet: 2 } },   // 覆蓋率不足 → 品質閘門關著
      /* 身上裝等 1、當前分段也是 1、斷點在 50 且值 28 倍 → behind，park 被拉到 [41,49] */
      eval: { tier: { stage: 44, itemLevelHere: 1, nextBreakpointStage: 50, breakpointGain: 27.95, equippedItemLevelMin: 1 } }
    }
  }).find((c) => c.name === 'stage.setAutoAdvance');

  assert.equal(mk(0.2).args.on, true,
    '死亡率在上限內時應該可以繼續往分段深處推——分段之內裝等不變但品質擲骰更好');
  assert.equal(mk(1.2).args.on, false,
    '死亡率超標了還在往前推。撐不住的時候推得更深只會死更多、撿更少');
  assert.equal(mk(null).args.on, false,
    'unknown 應該當成「先不要前進」——前進是有風險的動作，資料不足時按兵不動，下一拍就有值');
});

/* ---- 7. 止損 ---- */

test('資源見底時提高門檻，但不是停手', () => {
  const mk = (afford) => createPolicy({
    name: 'test-stoploss',
    decideEveryGameSec: 10,
    needPanels: ['eval'],
    stopLoss: { affordPath: 'panels.eval.resources.upgradesAffordable', minUpgradesAffordable: 3, leanGainMultiplier: 4 },
    rules: [{
      id: 'echo', cmd: 'debug.echo',
      args: { lean: { $path: 'ctx.stopLoss.lean' }, mult: { $path: 'ctx.stopLoss.gainMultiplier' } }
    }]
  }).decide({
    gameTimeSec: 10, view: {},
    panels: { eval: { resources: { upgradesAffordable: afford } } }
  })[0].args;

  assert.deepEqual(mk(10), { lean: false, mult: 1 });
  const lean = mk(1);
  assert.equal(lean.lean, true);
  assert.ok(lean.mult > 1,
    '止損把倍率設成 0 或直接停手。完全停手會讓「資源不足」變成永久狀態——'
    + '不洗就不會變強、不變強就推不過去、推不過去就掉不到資源');
});

/* ---- 8. 觀測節奏不得建立昂貴的面板 ---- */

test('完整的 panels.eval 不會被排進 1Hz 觀測', () => {
  const pol = createPolicy({
    name: 'test-observe',
    decideEveryGameSec: 60,
    needPanels: ['eval'],
    profile: { combat: ['panels.evalCombat.combat', 'panels.eval.combat'] },
    rules: []
  });
  assert.ok(pol.observePanels.indexOf('evalCombat') >= 0, '便宜的診斷面板要掛上觀測');
  assert.equal(pol.observePanels.indexOf('eval'), -1,
    '完整的 eval 面板被排進 1Hz 觀測了。它一次要跑幾十次 computeStats，'
    + '掛在觀測節奏上等於每個遊戲秒全身重算幾十遍——與背包面板同一類的效能陷阱');
});

/* ---- 9. 這份策略的宣告有沒有互相對上 ---- */

test('policy.extreme.roi.json 的每一條 eval 路徑都解得出值', () => {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.extreme.roi.json'), 'utf8'));
  const e = boot(31337, 1800);
  e.setEvalParams(p.evalConfig);
  const panels = { eval: e.panel('eval'), evalCombat: e.panel('evalCombat') };

  const paths = [p.roi.source, p.stopLoss.affordPath];
  for (const r of p.rules) {
    for (const kind of ['equipByPower', 'rerollByRoi', 'upgradeByRoi']) {
      const c = r[kind];
      if (!c) continue;
      for (const k of ['source', 'equippedAffixes', 'slotUpgrades', 'affordPath']) {
        if (typeof c[k] === 'string' && c[k].startsWith('panels.eval')) paths.push(c[k]);
      }
    }
    if (r.stageGate && r.stageGate.tierPush) paths.push(r.stageGate.tierPush.source);
  }

  for (const pth of paths) {
    let cur = { panels };
    for (const part of pth.split('.')) {
      assert.ok(cur !== null && cur !== undefined, `路徑 ${pth} 在 ${part} 之前就斷了`);
      cur = cur[part];
    }
    assert.notEqual(cur, undefined,
      `策略指到的 ${pth} 解不出值。規則會靜靜失效，報表只會顯示「這條規則沒送出過」`);
  }
});
