/* talentStatBonuses 的熱路徑重構（2026-08-03）：把 levels 表、節點清單、
   每一轉的「全滿倍率」都提到迴圈外。

   為什麼要動它：這一支在 computeStats 裡，而 computeStats 是全遊戲最熱的路徑——
   AI 模擬器的評估器每次規劃要跑約 47 次。改造前每個節點都各自呼叫一次
   talentCompleteMultiplier，而它內部要查 8 個節點的等級，80 個節點就是 640 次
   等級查找、其中 632 次是重複的。實測天賦查找佔 headless 總 CPU 的 17%。

   這支測試釘的是「只快了、沒變」：拿**改造前的寫法**當參照實作，逐欄比對。
   邊界情況要一起比，因為全滿倍率（×2）正是被提出迴圈的那一項——
   只比「都沒點」的話，那個倍率永遠是 1，改壞了也測不出來。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEngine } = require('../scripts/sim/engine.js');

const engine = createEngine({ seed: 7 });
engine.boot(null);
const ctx = engine.ctx;

/* 改造前的原始寫法（逐節點各算一次全滿倍率、每次查等級都重取 levels 表）。
   刻意保留原文，讓比對對象是真的舊行為，而不是我描述的舊行為。 */
function referenceBonuses() {
  const out = ctx.talentBonusesTemplate();
  ctx.talentList().forEach((entry) => {
    const def = entry.def;
    const value = ctx.talentLevelValue(def, ctx.talentLevel(def.id)) * ctx.talentCompleteMultiplier(entry.turn);
    if (def.stat !== 'potentialUnlock' && out[def.stat] !== undefined) out[def.stat] += value;
  });
  return out;
}

function setLevels(levels) {
  const st = ctx.talentState();
  for (const k of Object.keys(st.levels)) delete st.levels[k];
  Object.assign(st.levels, levels || {});
}

function compare(label) {
  const ref = referenceBonuses();
  const now = ctx.talentStatBonuses();
  assert.deepEqual(JSON.parse(JSON.stringify(now)), JSON.parse(JSON.stringify(ref)), label);
  return now;
}

test('全部沒點：與改造前逐欄相同', () => {
  setLevels({});
  compare('沒點任何天賦');
});

test('零散點數：與改造前逐欄相同', () => {
  const list = ctx.talentList();
  const levels = {};
  list.forEach((entry, i) => { if (i % 3 === 0) levels[entry.def.id] = (i % 97) + 1; });
  setLevels(levels);
  const out = compare('零散點數');
  const any = Object.keys(out).some((k) => out[k] !== 0);
  assert.ok(any, '前提：這組點數要真的產生加成，否則比對證明不了任何事');
});

test('某一轉剛好全滿（×2 倍率邊界）：與改造前逐欄相同', () => {
  const MAX = ctx.TALENT_MAX_LEVEL;
  const tree1 = ctx.TALENT_TREES[1] || [];
  assert.ok(tree1.length === 8, '前提：1 轉樹要有 8 個節點，全滿倍率才會生效');

  /* 差一級：不該有 ×2 */
  const almost = {};
  tree1.forEach((def, i) => { almost[def.id] = i === 0 ? MAX - 1 : MAX; });
  setLevels(almost);
  const a = compare('1 轉差一級');

  /* 剛好全滿：該有 ×2 */
  const full = {};
  tree1.forEach((def) => { full[def.id] = MAX; });
  setLevels(full);
  const b = compare('1 轉剛好全滿');

  const sum = (o) => Object.keys(o).reduce((s, k) => s + o[k], 0);
  assert.ok(sum(b) > sum(a), '全滿倍率必須真的讓數值跳上去（否則這個邊界沒被測到）');
});

test('全部滿級：與改造前逐欄相同', () => {
  const levels = {};
  ctx.talentList().forEach((entry) => { levels[entry.def.id] = ctx.TALENT_MAX_LEVEL; });
  setLevels(levels);
  compare('全部滿級');
});

test('talentList 快取：內容正確，且回傳同一份（呼叫端不得就地改）', () => {
  const a = ctx.talentList();
  const b = ctx.talentList();
  assert.equal(a, b, '應該回傳同一個陣列（這正是省下來的配置）');
  let expected = 0;
  for (let turn = 1; turn <= ctx.TALENT_IMPLEMENTED_REINCARNATIONS; turn++) {
    expected += (ctx.TALENT_TREES[turn] || []).length;
  }
  assert.equal(a.length, expected, '節點數必須與 TALENT_TREES 一致');
  a.forEach((entry) => {
    assert.ok(entry.def && entry.def.id, '每一項都要有 def');
    assert.ok(entry.turn >= 1, '每一項都要有轉數');
  });
});

test('getStats 不因這次重構而改變（天賦有點數時）', () => {
  const levels = {};
  ctx.talentList().forEach((entry, i) => { levels[entry.def.id] = (i * 7) % 100; });
  setLevels(levels);
  ctx.markStatsDirty();
  const stats = ctx.getStats();
  const bonuses = ctx.talentStatBonuses();
  /* 這裡只能釘「算得出來且與參照一致」——真正的逐欄比對在上面那幾支。
     放這一支是為了確認重構後的函式真的還被 computeStats 吃得下去。 */
  assert.ok(stats && typeof stats.atk === 'number' && isFinite(stats.atk));
  assert.deepEqual(JSON.parse(JSON.stringify(bonuses)), JSON.parse(JSON.stringify(referenceBonuses())));
});
