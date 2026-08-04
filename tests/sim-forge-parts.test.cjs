/* 熔爐零件策略。

   為什麼要有這一支：實測 20 小時的存檔，兩座熔爐都是 **0/3 格、一個零件都沒裝**，
   而零件庫存裡每一種都已經是 T7×10（PART_KEEP_PER_KEY 上限）。
   整個熔爐零件系統整場沒被使用過，而 T7 滿格的精粹透鏡是 +1120%（產出 ×12.2）——
   精華是這份策略的硬上限，這是唯一能把上限本身推高的槓桿。

   前半用合成 state 測機制（不開遊戲引擎），後半開真引擎驗證指令真的被遊戲接受，
   理由是機制對了但參數名對不上的話，模擬照樣跑完、熔爐照樣空著。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createPolicy } = require('../scripts/sim/policy.js');
const { createEngine } = require('../scripts/sim/engine.js');

/* ---- 合成觀測點 ---- */

function furnace(id, partSlots, parts, queue, belt) {
  return {
    id: id,
    partSlots: partSlots,
    parts: parts || [],
    queue: new Array(queue || 0).fill({}),
    belt: new Array(belt || 0).fill({}),
    qualities: []
  };
}

function st(sec, furnaces, opts) {
  const o = opts || {};
  return {
    gameTimeSec: sec,
    view: {
      gold: o.gold === undefined ? 1e9 : o.gold,
      essence: o.essence === undefined ? 100 : o.essence,
      scrap: o.scrap === undefined ? 10000 : o.scrap
    },
    panels: {
      newforge: {
        newForge: { furnaces: furnaces },
        partSlotCost: o.slotCosts || furnaces.map(() => 1000),
        ownedParts: o.owned || { extractLens: 7, scrapForge: 7, speedGear: 7 }
      }
    }
  };
}

/* ---- 待測策略：把專案實際使用的那兩條規則原樣搬過來 ---- */

const ROI_POLICY = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'sim', 'policy.extreme.roi.json'), 'utf8')
);
const SLOT_RULE = ROI_POLICY.rules.find((r) => r.id === 'forge-unlock-slots');
const PART_RULE = ROI_POLICY.rules.find((r) => r.id === 'forge-parts');

function makePolicy(rules) {
  return createPolicy({
    name: 'test-forge',
    decideEveryGameSec: 60,
    needPanels: ['newforge'],
    rules: rules
  });
}

function cmdsOf(list, name) {
  return list.filter((c) => c.name === name);
}

/* ============ 零件格解鎖 ============ */

test('零件格解鎖：成本在金幣的保留比例內才送，逐爐各送一次', () => {
  const p = makePolicy([SLOT_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 3), furnace(2, 3)], { gold: 100000, slotCosts: [8000, 8000] }));
  const unlock = cmdsOf(cmds, 'newforge.unlockPartSlot');
  assert.deepEqual(unlock.map((c) => c.args.furnaceId), [1, 2]);
});

test('零件格解鎖：金幣不夠就不送——不比對的話全是空轉', () => {
  /* 同 buyInvUpgrade 踩過的坑：不先比成本，實測 101 小時送了 1,212 次、
     其中 1,014 次是金幣不足。 */
  const p = makePolicy([SLOT_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 7)], { gold: 100000, slotCosts: [72000] }));
  assert.equal(cmdsOf(cmds, 'newforge.unlockPartSlot').length, 0,
    '成本 72000 > 金幣 100000×0.25，應該不送');
});

test('零件格解鎖：已達上限（成本 null）不送', () => {
  const p = makePolicy([SLOT_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8)], { slotCosts: [null] }));
  assert.equal(cmdsOf(cmds, 'newforge.unlockPartSlot').length, 0);
});

test('零件格解鎖：一次只解一格——解完成本就變了', () => {
  /* newForgePartSlotCost 隨已解鎖格數指數上升，同一拍連送兩次的第二次
     用的是過期成本，多半是空轉。 */
  const p = makePolicy([SLOT_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 3)], { slotCosts: [8000] }));
  assert.equal(cmdsOf(cmds, 'newforge.unlockPartSlot').length, 1);
});

/* ============ 零件配置 ============ */

test('空爐依 plan 逐爐鋪滿：一爐精粹透鏡、一爐碎片熔煉爐', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8), furnace(2, 8)]));
  const inst = cmdsOf(cmds, 'newforge.installPart');
  const f1 = inst.filter((c) => c.args.furnaceId === 1).map((c) => c.args.partKey);
  const f2 = inst.filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey);
  assert.equal(f1.length, 8);
  assert.equal(f2.length, 8);
  assert.ok(f1.every((k) => k === 'extractLens'), '第一爐應全是精粹透鏡：' + f1.join(','));
  assert.ok(f2.every((k) => k === 'scrapForge'), '第二爐應全是碎片熔煉爐：' + f2.join(','));
});

test('已裝滿且都是最高階時不送任何指令', () => {
  const p = makePolicy([PART_RULE]);
  const parts = new Array(8).fill(null).map(() => ({ key: 'extractLens', tier: 7 }));
  const cmds = p.decide(st(1, [furnace(1, 8, parts)]));
  assert.equal(cmds.length, 0, '收斂之後應該安靜下來，否則每 5 分鐘刷一輪必然無效的指令');
});

test('只補缺口：已有 3 個對的零件、8 格 → 只送 5 次安裝，不重裝已對的', () => {
  const p = makePolicy([PART_RULE]);
  const parts = new Array(3).fill(null).map(() => ({ key: 'extractLens', tier: 7 }));
  const cmds = p.decide(st(1, [furnace(1, 8, parts)]));
  assert.equal(cmdsOf(cmds, 'newforge.uninstallPart').length, 0);
  assert.equal(cmdsOf(cmds, 'newforge.installPart').length, 5);
});

test('快照過期（庫存有更高階）就拆掉重裝', () => {
  /* 零件是快照制：安裝當下複製數值，庫存後來掉到 T7 也不會自己升上去
     （newforge.js newForgeInstallPart）。不重裝的話早期用 T2 填滿的爐子
     會用 T2 的加成跑完整場。 */
  const p = makePolicy([PART_RULE]);
  const parts = [{ key: 'extractLens', tier: 2 }, { key: 'extractLens', tier: 7 }];
  const cmds = p.decide(st(1, [furnace(1, 2, parts)], { owned: { extractLens: 7 } }));
  const un = cmdsOf(cmds, 'newforge.uninstallPart');
  assert.deepEqual(un.map((c) => c.args.slotIndex), [0], '只有 T2 那一格該拆');
  assert.equal(cmdsOf(cmds, 'newforge.installPart').length, 1);
});

test('拆零件必須由大到小送——splice 會讓後面的索引位移', () => {
  /* newForgeUninstallPart 用 splice 移除。先拆索引 0 的話，原本索引 2 的零件
     會變成索引 1，第二條指令就拆錯零件。這個錯不會報錯，只會裝出一爐
     跟策略宣告不同的零件。 */
  const p = makePolicy([PART_RULE]);
  const parts = [
    { key: 'goldSluice', tier: 7 },      // 不在 plan 裡 → 拆
    { key: 'extractLens', tier: 7 },     // 對的 → 留
    { key: 'goldSluice', tier: 7 },      // 拆
    { key: 'fortuneChip', tier: 7 }      // 拆
  ];
  const cmds = p.decide(st(1, [furnace(1, 4, parts)]));
  const idx = cmdsOf(cmds, 'newforge.uninstallPart').map((c) => c.args.slotIndex);
  assert.deepEqual(idx, [3, 2, 0]);
  for (let i = 1; i < idx.length; i++) {
    assert.ok(idx[i] < idx[i - 1], '索引必須嚴格遞減');
  }
});

test('拆一定排在裝前面——格子滿的時候 installPart 直接被擋', () => {
  const p = makePolicy([PART_RULE]);
  const parts = new Array(3).fill(null).map(() => ({ key: 'goldSluice', tier: 7 }));
  const cmds = p.decide(st(1, [furnace(1, 3, parts)]));
  const firstInstall = cmds.findIndex((c) => c.name === 'newforge.installPart');
  const lastUninstall = cmds.map((c) => c.name).lastIndexOf('newforge.uninstallPart');
  assert.ok(lastUninstall >= 0 && firstInstall > lastUninstall,
    '所有拆卸都要排在第一條安裝之前');
});

/* ============ 微調：兩種材料的相對緊度 ============ */

/* 微調有遲滯：同一個判斷要連續成立 holdRounds 次才動手。跑滿門檻再取最後一輪。 */
const HOLD = PART_RULE.forgeParts.rebalance.holdRounds;
function decideHeld(p, furnaces, opts) {
  /* 間隔要大於規則的 everySec，否則 decide 會直接跳過整條規則，遲滯計數不會前進。
     所以「連續 3 次」在實跑裡等於 3 × 300 秒 ＝ 15 分鐘的一致判斷。 */
  const gap = (PART_RULE.everySec || 1) + 1;
  let cmds = [];
  for (let i = 0; i < HOLD; i++) cmds = p.decide(st((i + 1) * gap, furnaces, opts));
  return cmds;
}

test('微調：精華遠比碎片緊時，碎片爐讓出 2 格給精粹透鏡', () => {
  const p = makePolicy([PART_RULE]);
  // 實測 seed20260906 的結局：精華 10、碎片 23,313
  const cmds = decideHeld(p, [furnace(1, 8), furnace(2, 8)], { essence: 10, scrap: 23313 });
  const f2 = cmdsOf(cmds, 'newforge.installPart')
    .filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey);
  assert.equal(f2.filter((k) => k === 'extractLens').length, 2);
  assert.equal(f2.filter((k) => k === 'scrapForge').length, 6);
});

test('微調：判斷還沒站穩就不動手——庫存訊號本身在跳', () => {
  /* 實測 seed20260903 的日誌：16:50 把碎片熔煉爐裝進 1 號爐、16:55 又換回精粹透鏡，
     整場 308 次安裝／146 次拆卸，大半是這樣來回翻。
     churn 不花資源（零件是快照制），但時間平均下來等於沒有微調過。 */
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8), furnace(2, 8)], { essence: 10, scrap: 23313 }));
  const f2 = cmdsOf(cmds, 'newforge.installPart')
    .filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey);
  assert.ok(f2.every((k) => k === 'scrapForge'), '第一拍應維持基本盤：' + f2.join(','));
});

test('微調：主力爐不會讓格子給自己', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = decideHeld(p, [furnace(1, 8), furnace(2, 8)], { essence: 10, scrap: 23313 });
  const f1 = cmdsOf(cmds, 'newforge.installPart')
    .filter((c) => c.args.furnaceId === 1).map((c) => c.args.partKey);
  assert.ok(f1.every((k) => k === 'extractLens'), f1.join(','));
});

test('微調：兩種都見底時不動——絕對門檻會讓這條規則整場失效', () => {
  /* 這是第一版寫錯的地方。策略把精華與碎片都花到見底
     （實測 20 小時結局：精華 8、碎片 661），用「低於某個絕對值」判斷的話
     兩邊同時成立，規則等於沒寫。改比 ref/庫存 的相對緊度就分得出來。 */
  const p = makePolicy([PART_RULE]);
  const cmds = decideHeld(p, [furnace(1, 8), furnace(2, 8)], { essence: 8, scrap: 661 });
  const f2 = cmdsOf(cmds, 'newforge.installPart')
    .filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey);
  // 滿足率 8/50=0.16 vs 661/5000=0.132，差距未達 minRatio=2 倍 → 維持基本盤
  assert.ok(f2.every((k) => k === 'scrapForge'), f2.join(','));
});

/* ============ 加速：產能跟不上打怪速度 ============ */

test('塞車的爐才換加速齒輪，而且只換宣告的格數', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8, [], 300, 30), furnace(2, 8, [], 0, 0)]));
  const inst = cmdsOf(cmds, 'newforge.installPart');
  const f1 = inst.filter((c) => c.args.furnaceId === 1).map((c) => c.args.partKey);
  const f2 = inst.filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey);
  assert.equal(f1.filter((k) => k === 'speedGear').length, 2);
  assert.equal(f1.filter((k) => k === 'extractLens').length, 6);
  assert.equal(f2.filter((k) => k === 'speedGear').length, 0, '沒塞車的爐加速等於零收益');
});

test('沒塞車就不裝加速——帶上沒東西可燒，拿產量格去換是純虧', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8, [], 42, 30)]));   // 實測 seed20260906 的水位
  const f1 = cmdsOf(cmds, 'newforge.installPart').map((c) => c.args.partKey);
  assert.equal(f1.filter((k) => k === 'speedGear').length, 0);
});

/* ============ 真引擎：指令真的被遊戲接受 ============ */

test('真引擎：兩座熔爐從 0/3 空格收斂到滿格，加成不再是 0', () => {
  /* 機制對了但參數名對不上的話（furnaceId／partKey／slotIndex），
     runCommand 只會回一句錯誤訊息，模擬照樣跑完、熔爐照樣空著。
     所以最後一關要讓遊戲自己說話：看 newForgePartBonus 有沒有動。 */
  const e = createEngine({ seed: 4242 }).boot(null);
  const c = e.ctx;
  const p = createPolicy({
    name: 'test-forge-live',
    decideEveryGameSec: 60,
    needPanels: ['newforge'],
    rules: [SLOT_RULE, PART_RULE]
  });

  /* 開局沒有零件也沒有金幣，先把前提補上——測的是策略會不會用，
     不是零件掉不掉得到。金幣直接給，零件用遊戲自己的產生函式。 */
  c.G.player.gold = 5e6;
  for (const key of ['extractLens', 'scrapForge', 'speedGear']) {
    c.G.factory.parts.push({ id: 'test-' + key, key: key, tier: 7 });
  }
  while (c.G.newForge.furnaces.length < 2) c.addNewForgeFurnace();

  const before = c.newForgePartBonus(c.G.newForge.furnaces[0], 'extractLens');
  assert.equal(before, 0, '前提：一開始沒有任何加成');

  let sent = 0, failed = [];
  for (let round = 0; round < 20; round++) {
    const state = {
      gameTimeSec: round * 600,
      view: { gold: c.G.player.gold, essence: c.G.player.essence, scrap: c.G.player.scrap },
      panels: { newforge: e.panel('newforge') }
    };
    for (const cmd of p.decide(state)) {
      sent++;
      /* runCommand 回 {ok,result,error}。⚠️ 熔爐這幾支「成功」時 result 是 null，
         失敗時 result 是一句中文錯誤（'零件格已滿'／'金幣不足'）而 ok 仍是 true——
         只看 ok 的話這一關會全綠，但熔爐可能一個零件都沒裝上。 */
      const res = c.runCommand(cmd.name, cmd.args);
      const bad = !res.ok ? res.error : (typeof res.result === 'string' ? res.result : null);
      if (bad) failed.push(cmd.name + ' ' + JSON.stringify(cmd.args) + ' → ' + bad);
    }
  }

  assert.deepEqual(failed, [], '不該有任何被遊戲拒絕的指令');
  assert.ok(sent > 0, '策略應該送出指令');

  const nf = c.G.newForge;
  assert.equal(nf.furnaces[0].partSlots, c.NEW_FORGE_PART_SLOTS_MAX);
  assert.equal(nf.furnaces[1].partSlots, c.NEW_FORGE_PART_SLOTS_MAX);
  assert.equal(nf.furnaces[0].parts.length, 8);
  assert.equal(nf.furnaces[1].parts.length, 8);
  assert.ok(c.newForgePartBonus(nf.furnaces[0], 'extractLens') > 0,
    '第一爐的附魔精華加成應該不是 0');
  assert.ok(c.newForgePartBonus(nf.furnaces[1], 'scrapForge') > 0,
    '第二爐的碎片加成應該不是 0');
});

test('真引擎：熔爐面板新增的三個欄位都是遊戲算的，且不寫進存檔', () => {
  /* partSlotCost 另開陣列而不是塞進 furnaces——furnaces 就是存檔本體，
     寫進去會污染存檔，而決定論比對是整個模擬器的地基。 */
  const e = createEngine({ seed: 7 }).boot(null);
  const c = e.ctx;
  c.G.factory.parts.push({ id: 'x', key: 'extractLens', tier: 5 });
  c.G.factory.parts.push({ id: 'y', key: 'luckCore', tier: 7 });

  const before = e.saveJson();
  const pan = e.panel('newforge');
  assert.equal(e.saveJson(), before, '建面板不得改動任何狀態');

  assert.equal(pan.partSlotsMax, c.NEW_FORGE_PART_SLOTS_MAX);
  assert.equal(pan.partSlotCost.length, pan.newForge.furnaces.length);
  assert.equal(
    pan.partSlotCost[0],
    c.newForgePartSlotCost(0, pan.newForge.furnaces[0].partSlots, pan.newForge.furnaces.length),
    '成本必須是遊戲的 newForgePartSlotCost 算的，策略端不重推'
  );
  assert.equal(pan.ownedParts.extractLens, 5);
  assert.equal(pan.ownedParts.luckCore, undefined,
    '合成節點零件不該列出來——installPart 只收分解槽零件');
  assert.ok(!('partSlotCost' in pan.newForge.furnaces[0]), '不得把衍生欄位寫進存檔物件');
});

test('真引擎：零件升級後，舊快照要拆下重裝才套用新階級', () => {
  const e = createEngine({ seed: 8 }).boot(null);
  const c = e.ctx;
  const fu = c.G.newForge.furnaces[0];
  c.ensurePartLevels(c.G.factory);
  c.G.factory.partLevels.extractLens = 2;

  assert.equal(c.newForgeInstallPart(fu.id, 'extractLens'), null);
  assert.equal(fu.parts[0].tier, 2, '安裝時應保存當下階級');
  const before = c.newForgePartBonus(fu, 'extractLens');

  c.G.factory.partLevels.extractLens = 5;
  assert.equal(fu.parts[0].tier, 2, '升級庫存不應改寫已裝快照');
  assert.equal(c.newForgePartBonus(fu, 'extractLens'), before, '未重裝前效果應維持舊快照');

  assert.equal(c.newForgeUninstallPart(fu.id, 0), true);
  assert.equal(c.newForgeInstallPart(fu.id, 'extractLens'), null);
  assert.equal(fu.parts[0].tier, 5, '重裝後才應使用新階級');
  assert.ok(c.newForgePartBonus(fu, 'extractLens') > before, '重裝後效果應提升');
});
