/* 背包掃描的跨規劃快取（scripts/sim/evaluator.js 的 _evalBagCache）。

   背包裡的裝備在待在背包的期間是不動的——強化、洗煉、鑲嵌、附魔的對象都是身上那套，
   掉落是新物件，穿上去就離開背包。所以複本、可用部位與 itemScore 每 15 秒重算一次
   是純浪費，而且成本與件數成正比（策略會把背包上限一路買到 1000 格）。

   但快取錯了不會壞掉，只會**用舊分數挑裝備**——症狀是「AI 挑了一件比較差的」，
   看報表看不出來。所以這支測試專攻失效：對每一種會改變 itemScore 的欄位各改一次，
   分數都必須跟著變。

   ⚠️ 這裡刻意用「改完之後分數要變」來反證，而不是去讀快取的內部狀態。
   快取的實作可以換，這個性質不能變。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine.js');

/* keepPerSlot:0 ⇒ 每一件都會被列進 deadStock，連同它的分數——
   這是從外面觀察「評估器現在認為這件值多少」唯一的管道。 */
const PARAMS = { refreshSec: 0, deadStock: { keepPerSlot: 0, maxPerRefresh: 100000 } };

function bootedEngine() {
  const engine = createEngine({ seed: 20260804 });
  engine.boot(null);
  engine.stepSeconds(1800);
  /* 停在「正在交戰」的那一拍：沒有對手時 panel('eval') 只回空殼，
     背包分數整份取不到，測試會卡在前置條件而不是它要驗的快取失效。
     波次串流改造後角色可能剛好停在復活倒數或換波空檔，所以要多推幾秒。 */
  for (let i = 0; i < 240 && !engine.panel('eval', PARAMS).known; i++) engine.stepSeconds(1);
  return engine;
}

function scores(engine) {
  const ds = engine.panel('eval', PARAMS).deadStock;
  const out = {};
  for (const row of ds.items) out[row.id] = row.score;
  return out;
}

/* 找一件「動了之後分數一定會變」的背包裝備：要有詞條，數值才動得了。 */
function pickItem(engine) {
  const it = (engine.ctx.G.inventory || []).find(
    (x) => x && !x.locked && x.kind === 'equip' && x.affixes && x.affixes.length > 0);
  assert.ok(it, '前提：背包要有一件帶詞條的裝備');
  return it;
}

/* 找一條「改了之後真的會改變 itemScore」的詞條。
   不能假設 affixes[0] 就算數：同一件裝備上可能掛著對評分權重為 0 的屬性
   （實測掉到一雙 int/defPct 的靴子，改 int 分數完全不動），
   那樣測到的就只是「改了沒差的東西沒差」，快取失效根本沒被驗到。
   判斷基準用**不經快取**的 ctx.itemScore，這樣「真值變了」是前提，
   「面板（走快取）跟著變」才是被測的性質。 */
function pickScoringAffix(engine) {
  const truth = (it) => engine.ctx.itemScore(it);
  for (const it of (engine.ctx.G.inventory || [])) {
    if (!it || it.locked || it.kind !== 'equip' || !it.affixes || !it.affixes.length) continue;
    for (let i = 0; i < it.affixes.length; i++) {
      const old = it.affixes[i];
      const flipped = { key: old.key, roll: (old.roll || 0) === 0 ? 1000 : 0, ancient: !!old.ancient };
      const base = truth(it);
      it.affixes[i] = flipped;
      const moved = truth(it) !== base;
      it.affixes[i] = old;
      if (moved) return { item: it, index: i, flipped: flipped };
    }
  }
  assert.fail('前提：背包裡要有一條改了會影響評分的詞條');
}

test('同一份狀態問兩次，分數一致（快取本身沒有把值弄壞）', () => {
  const engine = bootedEngine();
  const a = scores(engine);
  const b = scores(engine);
  assert.deepEqual(b, a);
  assert.ok(Object.keys(a).length > 5, '前提：背包要有夠多東西');
});

test('強化等級改變 → 分數跟著變', () => {
  const engine = bootedEngine();
  const it = pickItem(engine);
  const before = scores(engine)[it.id];
  assert.ok(before > 0);
  it.upgrade = (it.upgrade || 0) + 5;
  assert.notEqual(scores(engine)[it.id], before, '強化倍率變了，分數必須跟著變');
});

test('洗煉（換掉詞條物件）→ 分數跟著變', () => {
  const engine = bootedEngine();
  /* rerollSingleAffix 的做法：就地指派一個**新的**詞條物件（js/item.js）。
     這裡照同樣的形狀改，驗證識別比對抓得到。 */
  const pick = pickScoringAffix(engine);
  const before = scores(engine)[pick.item.id];
  pick.item.affixes[pick.index] = pick.flipped;
  assert.notEqual(scores(engine)[pick.item.id], before, '詞條換了物件，分數必須跟著變');
});

test('整份詞條陣列被換掉（全洗）→ 分數跟著變', () => {
  const engine = bootedEngine();
  /* 同 pickScoringAffix 的理由：整份換掉之後真值要真的變，這支測試才有意義。
     背包裡第一件裝備的詞條可能全都是對評分權重為 0 的屬性。 */
  const pick = pickScoringAffix(engine);
  const it = pick.item;
  const before = scores(engine)[it.id];
  /* 整份陣列換成新物件（全洗的做法），其中那條會影響評分的詞條給不同的 roll——
     全部一律寫 1000 的話，剛好本來就是 1000 的那條等於沒變，測不到東西。 */
  it.affixes = it.affixes.map((a, i) => (i === pick.index
    ? { key: a.key, roll: pick.flipped.roll, ancient: !!a.ancient }
    : { key: a.key, roll: a.roll, ancient: !!a.ancient }));
  assert.notEqual(scores(engine)[it.id], before);
});

test('鑲嵌寶石（sockets[i] = gem）→ 分數跟著變', () => {
  const engine = bootedEngine();
  const ctx = engine.ctx;
  const it = (ctx.G.inventory || []).find(
    (x) => x && !x.locked && x.kind === 'equip' && x.sockets && x.sockets.length > 0 && !x.sockets[0]);
  if (!it) return;   // 這一局沒有帶空插槽的裝備就跳過，不硬造一個遊戲不會產生的狀態
  const before = scores(engine)[it.id];
  const type = Object.keys(ctx.GEM_TYPES)[0];
  it.sockets[0] = { type: type, level: 3 };
  assert.notEqual(scores(engine)[it.id], before, '鑲了寶石，分數必須跟著變');
});

test('附魔（push 進 enchants）→ 分數跟著變', () => {
  const engine = bootedEngine();
  const it = pickItem(engine);
  const before = scores(engine)[it.id];
  /* 附魔物件的形狀由遊戲決定：數值是由「附魔當下的寶石等級」當場算出（gemLv），
     不是存一個 level。寫錯欄位的話 enchantValue 會走凍結值那條路回 0，
     於是分數不變、測試看起來「通過了」——這支測試就完全沒有測到東西。 */
  const key = Object.keys(engine.ctx.ENCHANTS)[0];
  const added = { key: key, gemLv: 5 };
  assert.ok(engine.ctx.enchantValue(it, added) > 0, '前提：這條附魔要真的有數值');
  it.enchants = (it.enchants || []).concat([added]);
  assert.notEqual(scores(engine)[it.id], before, '附魔加上去了，分數必須跟著變');
});

test('快取不得讓評估器改到真實物品（存檔逐位元組不變）', () => {
  const engine = bootedEngine();
  const before = engine.saveJson();
  scores(engine);
  scores(engine);
  scores(engine);
  assert.equal(engine.saveJson(), before, '建面板是唯讀動作，連續問三次都不能動到存檔');
});
