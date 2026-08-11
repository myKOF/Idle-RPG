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
const LEVEL_RULE = ROI_POLICY.rules.find((r) => r.id === 'upgrade-forge-parts');

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
  const cmds = p.decide(st(1, [furnace(1, 3), furnace(2, 3)], { gold: 10000000, slotCosts: [1360000, 1360000] }));
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
  const cmds = p.decide(st(1, [furnace(1, 3)], { slotCosts: [20000] }));
  assert.equal(cmdsOf(cmds, 'newforge.unlockPartSlot').length, 1);
});

/* ============ 零件配置 ============ */

/* 每座爐都照同一個比例混裝，不是一爐一種零件。熔爐派工是負載平衡的
   （newForgeDispatchTarget 挑最閒的），一件裝備落到哪座爐是隨機的——
   一爐全精華、一爐全碎片的話，同一件裝備只吃得到其中一種加成。
   使用者實測的最佳配置：附魔精華×4 + 裝備碎片×2 + 寶石採集器×2。 */
function countBy(list) {
  const c = {};
  for (const k of list) c[k] = (c[k] || 0) + 1;
  return c;
}

test('空爐依 mix 每爐照同一比例鋪滿', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8), furnace(2, 8)]));
  const inst = cmdsOf(cmds, 'newforge.installPart');
  for (const id of [1, 2]) {
    const got = countBy(inst.filter((c) => c.args.furnaceId === id).map((c) => c.args.partKey));
    assert.deepEqual(got, { extractLens: 4, scrapForge: 2, gemCollector: 2 },
      '爐' + id + ' 應照 4/2/2 混裝：' + JSON.stringify(got));
  }
});

test('格數不足時按比例分配，剛好填滿而且不重不漏', () => {
  /* 早期每爐只有 3 格。4:2:2 攤到 3 格是 1.5 : 0.75 : 0.75，最大餘數法給 1:1:1——
     三種材料都有產出，比「精華 2 + 碎片 1 + 寶石 0」合理。
     這裡釘的是「填滿且不超過」，不是特定的分法：分法本身可以再調，
     但格數對不上會讓遊戲回「零件格已滿」或留空格，那才是 bug。 */
  const p = makePolicy([PART_RULE]);
  /* ⚠️ 時間戳要拉開：規則的 everySec 是 300，連續呼叫只有第一次會生效，
     其餘全部被冷卻擋掉而回傳空陣列——那會讓這支測試看起來像「一格都沒填」。 */
  let t = 0;
  for (const slots of [1, 2, 3, 5, 8]) {
    t += 1000;
    const got = countBy(cmdsOf(p.decide(st(t, [furnace(1, slots)])), 'newforge.installPart')
      .map((c) => c.args.partKey));
    const total = Object.values(got).reduce((a, b) => a + b, 0);
    assert.equal(total, slots, slots + ' 格應剛好填滿：' + JSON.stringify(got));
    if (slots === 8) {
      assert.deepEqual(got, { extractLens: 4, scrapForge: 2, gemCollector: 2 },
        '8 格時要精確等於宣告的比例：' + JSON.stringify(got));
    }
  }
});

test('已裝滿且都是最高階時不送任何指令', () => {
  const p = makePolicy([PART_RULE]);
  const parts = [].concat(
    new Array(4).fill(null).map(() => ({ key: 'extractLens' })),
    new Array(2).fill(null).map(() => ({ key: 'scrapForge' })),
    new Array(2).fill(null).map(() => ({ key: 'gemCollector' }))
  );
  const cmds = p.decide(st(1, [furnace(1, 8, parts)]));
  assert.equal(cmds.length, 0, '收斂之後應該安靜下來，否則每 5 分鐘刷一輪必然無效的指令');
});

test('只補缺口：已有 3 個對的零件、8 格 → 只送 5 次安裝，不重裝已對的', () => {
  const p = makePolicy([PART_RULE]);
  const parts = new Array(3).fill(null).map(() => ({ key: 'extractLens' }));
  const cmds = p.decide(st(1, [furnace(1, 8, parts)]));
  assert.equal(cmdsOf(cmds, 'newforge.uninstallPart').length, 0);
  assert.equal(cmdsOf(cmds, 'newforge.installPart').length, 5);
});

test('零件升級後不需拆裝，已裝零件直接套用全域等級', () => {
  /* 熔爐只保存零件種類；零件等級由上方的全域 partLevels 決定，
     因此升級後不應產生拆下重裝指令。 */
  const p = makePolicy([PART_RULE]);
  /* 2 格的 mix 是精華 1 + 碎片 1（最大餘數法），所以拿這個組合來測「升級不必重裝」。 */
  const parts = [{ key: 'extractLens' }, { key: 'scrapForge' }];
  const cmds = p.decide(st(1, [furnace(1, 2, parts)], { owned: { extractLens: 7, scrapForge: 7 } }));
  assert.equal(cmdsOf(cmds, 'newforge.uninstallPart').length, 0);
  assert.equal(cmdsOf(cmds, 'newforge.installPart').length, 0);
});

test('拆零件必須由大到小送——splice 會讓後面的索引位移', () => {
  /* newForgeUninstallPart 用 splice 移除。先拆索引 0 的話，原本索引 2 的零件
     會變成索引 1，第二條指令就拆錯零件。這個錯不會報錯，只會裝出一爐
     跟策略宣告不同的零件。 */
  const p = makePolicy([PART_RULE]);
  const parts = [
    { key: 'goldSluice' },      // 不在 plan 裡 → 拆
    { key: 'extractLens' },     // 對的 → 留
    { key: 'goldSluice' },      // 拆
    { key: 'luckHeart' }        // 拆
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
  const parts = new Array(3).fill(null).map(() => ({ key: 'goldSluice' }));
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

test('微調：精華遠比碎片緊時，每座爐都讓出 2 格給精粹透鏡', () => {
  /* ⚠️ 改成混裝之後，「只有不是自己主力的那座爐要讓」這個舊條件永遠不成立
     （每座爐都同時有兩種材料零件），微調會整條失效。改成從尾端讓出其他種類的格子。 */
  const p = makePolicy([PART_RULE]);
  // 實測 seed20260906 的結局：精華 10、碎片 23,313
  const cmds = decideHeld(p, [furnace(1, 8), furnace(2, 8)], { essence: 10, scrap: 23313 });
  for (const id of [1, 2]) {
    const got = countBy(cmdsOf(cmds, 'newforge.installPart')
      .filter((c) => c.args.furnaceId === id).map((c) => c.args.partKey));
    assert.deepEqual(got, { extractLens: 6, gemCollector: 2 },
      '爐' + id + ' 應由最寬裕的碎片熔煉爐讓出 2 格：' + JSON.stringify(got));
  }
});

test('微調只動最寬裕那一種的格子，不牽連不在材料清單裡的零件', () => {
  /* ⚠️ 這是實跑抓到的：第一版寫成「從尾端讓出其他種類」，於是每一拍都把
     mix 裡排最後的 gemCollector 換成 extractLens——精華滿足率 0.08、碎片 0.91，
     微調全程觸發，20 小時下來熔爐 128 格裡寶石採集器一個都不剩，
     而它根本不在 rebalance.materials 裡，本來就不該被牽連。 */
  const p = makePolicy([PART_RULE]);
  const cmds = decideHeld(p, [furnace(1, 8)], { essence: 10, scrap: 23313 });
  const got = countBy(cmdsOf(cmds, 'newforge.installPart').map((c) => c.args.partKey));
  assert.equal(got.gemCollector, 2, '寶石採集器不在材料清單裡，不該被讓掉：' + JSON.stringify(got));
  assert.equal(got.scrapForge, undefined, '讓的應該是最寬裕的碎片格：' + JSON.stringify(got));
});

test('微調：判斷還沒站穩就不動手——庫存訊號本身在跳', () => {
  /* 實測 seed20260903 的日誌：16:50 把碎片熔煉爐裝進 1 號爐、16:55 又換回精粹透鏡，
     整場 308 次安裝／146 次拆卸，大半是這樣來回翻。
     churn 不花資源，但時間平均下來等於沒有微調過。 */
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8), furnace(2, 8)], { essence: 10, scrap: 23313 }));
  const got = countBy(cmdsOf(cmds, 'newforge.installPart')
    .filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey));
  assert.deepEqual(got, { extractLens: 4, scrapForge: 2, gemCollector: 2 },
    '第一拍應維持基本盤：' + JSON.stringify(got));
});

test('微調：格子不夠讓時就讓幾格算幾格，不會超額', () => {
  /* 碎片格只有 2 個，shiftSlots 也是 2，剛好讓完；再多要不到就停手，
     不能因為額度沒用完就去動別種零件。 */
  const p = makePolicy([PART_RULE]);
  const cmds = decideHeld(p, [furnace(1, 8)], { essence: 10, scrap: 23313 });
  const got = countBy(cmdsOf(cmds, 'newforge.installPart').map((c) => c.args.partKey));
  const total = Object.values(got).reduce((a, b) => a + b, 0);
  assert.equal(total, 8, '總格數不變：' + JSON.stringify(got));
  assert.equal(got.extractLens, 6, JSON.stringify(got));
});

test('微調：兩種都見底時不動——絕對門檻會讓這條規則整場失效', () => {
  /* 這是第一版寫錯的地方。策略把精華與碎片都花到見底
     （實測 20 小時結局：精華 8、碎片 661），用「低於某個絕對值」判斷的話
     兩邊同時成立，規則等於沒寫。改比 ref/庫存 的相對緊度就分得出來。 */
  const p = makePolicy([PART_RULE]);
  const cmds = decideHeld(p, [furnace(1, 8), furnace(2, 8)], { essence: 8, scrap: 661 });
  const got = countBy(cmdsOf(cmds, 'newforge.installPart')
    .filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey));
  // 滿足率 8/50=0.16 vs 661/5000=0.132，差距未達 minRatio=2 倍 → 維持基本盤
  assert.deepEqual(got, { extractLens: 4, scrapForge: 2, gemCollector: 2 }, JSON.stringify(got));
});

/* ============ 加速：產能跟不上打怪速度 ============ */

test('塞車的爐才換加速齒輪，而且只換宣告的格數', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8, [], 300, 30), furnace(2, 8, [], 0, 0)]));
  const inst = cmdsOf(cmds, 'newforge.installPart');
  const f1 = countBy(inst.filter((c) => c.args.furnaceId === 1).map((c) => c.args.partKey));
  const f2 = countBy(inst.filter((c) => c.args.furnaceId === 2).map((c) => c.args.partKey));
  /* 加速覆寫前面兩格，吃掉的是比重最高的精粹透鏡（4 → 2）。 */
  assert.equal(f1.speedGear, 2, JSON.stringify(f1));
  assert.deepEqual(f1, { speedGear: 2, extractLens: 2, scrapForge: 2, gemCollector: 2 }, JSON.stringify(f1));
  assert.equal(f2.speedGear, undefined, '沒塞車的爐加速等於零收益：' + JSON.stringify(f2));
});

test('沒塞車就不裝加速——帶上沒東西可燒，拿產量格去換是純虧', () => {
  const p = makePolicy([PART_RULE]);
  const cmds = p.decide(st(1, [furnace(1, 8, [], 42, 30)]));   // 實測 seed20260906 的水位
  const f1 = cmdsOf(cmds, 'newforge.installPart').map((c) => c.args.partKey);
  assert.equal(f1.filter((k) => k === 'speedGear').length, 0);
});

/* ============ 零件等級：全域乘數 ============ */

/* 零件等級存在 factory.partLevels，是全域的——升一次，所有熔爐的同種零件一起變強。
   實測 24 小時 × 5 seed：AI 的零件全部停在 1 級（newforge.upgradePart 一次都沒送過），
   真人是 extractLens 5 / gemCollector 6 / scrapForge 4。這是唯一能把材料**產出上限本身**
   推高的槓桿，其餘熔爐規則都只是在分配既有的量。 */

function lvSt(sec, levels, costs, gold) {
  return {
    gameTimeSec: sec,
    view: { gold: gold === undefined ? 1e9 : gold },
    panels: { newforge: { partLevels: levels, partUpgradeCosts: costs } }
  };
}

function makeLevelPolicy() {
  return createPolicy({
    name: 'test-part-level',
    decideEveryGameSec: 60,
    needPanels: ['newforge'],
    rules: [LEVEL_RULE]
  });
}

/* 規則的 everySec 是 120，連續呼叫只有第一次會生效。時間戳一律拉開。 */
const LV_GAP = (LEVEL_RULE.everySec || 1) + 1;

test('零件升級：等級最低的先升——全域乘數之間補短板比推單一種類到頂划算', () => {
  const p = makeLevelPolicy();
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 5, gemCollector: 2, scrapForge: 3 },
    { extractLens: 1000, gemCollector: 1000, scrapForge: 1000 }));
  assert.deepEqual(cmds.map((c) => c.args.partKey), ['gemCollector']);
});

test('零件升級：同級時照宣告順序，維持決定論', () => {
  const p = makeLevelPolicy();
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 1, gemCollector: 1, scrapForge: 1 },
    { extractLens: 1000, gemCollector: 1000, scrapForge: 1000 }));
  assert.deepEqual(cmds.map((c) => c.args.partKey), [LEVEL_RULE.upgradeParts.parts[0]]);
});

test('零件升級：一個決策點最多送一條——成本隨等級變，第二條用的是過期成本', () => {
  /* 升一級成本 ×6（380K → 2.18M → 12.98M）。同一拍連送兩次，
     第二次十之八九會被遊戲以「金幣不足」擋下。 */
  const p = makeLevelPolicy();
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 1, gemCollector: 1, scrapForge: 1 },
    { extractLens: 100, gemCollector: 100, scrapForge: 100 }));
  assert.equal(cmds.length, 1);
});

test('零件升級：成本超過金幣的保留比例就不送', () => {
  /* 金幣同時要餵強化與背包擴充，不能為了升級把它抽乾。 */
  const p = makeLevelPolicy();
  const ratio = LEVEL_RULE.upgradeParts.goldRatio;
  const gold = 1e6;
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 1, gemCollector: 1, scrapForge: 1 },
    { extractLens: gold * ratio + 1, gemCollector: gold * ratio + 1, scrapForge: gold * ratio + 1 },
    gold));
  assert.equal(cmds.length, 0);
});

test('零件升級：買得起的最低階優先，買不起的直接跳過而不是整條停擺', () => {
  /* gemCollector 最低但太貴。這時應該去升次低而買得起的 scrapForge，
     不能因為最想升的那個買不起就整拍不動——那等於規則在等一個永遠不來的時機。 */
  const p = makeLevelPolicy();
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 5, gemCollector: 1, scrapForge: 3 },
    { extractLens: 1000, gemCollector: 9e9, scrapForge: 1000 }));
  assert.deepEqual(cmds.map((c) => c.args.partKey), ['scrapForge']);
});

test('零件升級：已達上限（遊戲給 null 成本）不送', () => {
  const p = makeLevelPolicy();
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 10, gemCollector: 10, scrapForge: 10 },
    { extractLens: null, gemCollector: null, scrapForge: null }));
  assert.equal(cmds.length, 0);
});

test('零件升級：只升 mix 真的在用的種類，不碰其他零件', () => {
  /* 全域等級對沒裝上熔爐的零件毫無作用，升它就是把金幣丟掉。 */
  const p = makeLevelPolicy();
  const cmds = p.decide(lvSt(LV_GAP,
    { extractLens: 5, gemCollector: 5, scrapForge: 5, goldSluice: 1, luckHeart: 1 },
    { extractLens: 1000, gemCollector: 1000, scrapForge: 1000, goldSluice: 1, luckHeart: 1 }));
  assert.equal(cmds.length, 1);
  assert.ok(LEVEL_RULE.upgradeParts.parts.indexOf(cmds[0].args.partKey) >= 0,
    '升的必須是 mix 宣告的種類：' + cmds[0].args.partKey);
});

test('真引擎：升級指令的參數名對得上，且成本欄位是遊戲算的', () => {
  /* 機制對了但 partKey 對不上的話，runCommand 只會回一句中文訊息，
     模擬照樣跑完、零件照樣停在 1 級——實測 24 小時就是這樣過去的。 */
  const e = createEngine({ seed: 913 }).boot(null);
  const c = e.ctx;
  c.G.player.gold = 1e9;

  const pan = e.panel('newforge');
  for (const key of LEVEL_RULE.upgradeParts.parts) {
    assert.equal(pan.partUpgradeCosts[key], c.partUpgradeCost(pan.partLevels[key] + 1),
      key + ' 的升級成本必須由遊戲的 partUpgradeCost 算，策略端不重推');
  }

  const p = makeLevelPolicy();
  const cmds = p.decide({
    gameTimeSec: LV_GAP,
    view: { gold: c.G.player.gold },
    panels: { newforge: pan }
  });
  assert.equal(cmds.length, 1);
  const before = c.G.factory.partLevels ? c.G.factory.partLevels[cmds[0].args.partKey] : undefined;
  const res = c.runCommand(cmds[0].name, cmds[0].args);
  const bad = !res.ok ? res.error : (typeof res.result === 'string' ? res.result : null);
  assert.equal(bad, null, '不該被遊戲拒絕');
  assert.ok(c.G.factory.partLevels[cmds[0].args.partKey] > (before || 0), '等級應該真的上去了');
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
  c.G.player.gold = 1e9;
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

test('真引擎：零件升級後，所有已裝配同種類零件立即套用全域等級', () => {
  const e = createEngine({ seed: 8 }).boot(null);
  const c = e.ctx;
  const fu = c.G.newForge.furnaces[0];
  c.ensurePartLevels(c.G.factory);
  c.G.factory.partLevels.extractLens = 2;

  assert.equal(c.newForgeInstallPart(fu.id, 'extractLens'), null);
  assert.equal(fu.parts[0].key, 'extractLens', '安裝時只保存零件種類');
  assert.equal(Object.keys(fu.parts[0]).length, 1);
  const before = c.newForgePartBonus(fu, 'extractLens');

  c.G.player.gold = c.partUpgradeCost(3);
  assert.equal(c.newForgeUpgradePart('extractLens'), null);
  assert.equal(fu.parts[0].key, 'extractLens', '升級不應改寫熔爐零件資料');
  assert.equal(Object.keys(fu.parts[0]).length, 1);
  assert.ok(c.newForgePartBonus(fu, 'extractLens') > before, '升級後效果應立即提升');
});
