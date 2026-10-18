/* 威能熱路徑：靜態節點快取與逐欄加總等價；滿轉加成亦須一致。 */

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

test('某一轉最後一級啟用25%加成：快取與逐節點計算相同', () => {
  const MAX = ctx.TALENT_MAX_LEVEL;
  const tree1 = ctx.TALENT_TREES[1] || [];
  assert.ok(tree1.length === 8, '前提：1 轉樹要有 8 個節點，檢查完整一轉');

  /* 差一級：少最後一級 */
  const almost = {};
  tree1.forEach((def, i) => { almost[def.id] = i === 0 ? MAX - 1 : MAX; });
  setLevels(almost);
  const a = compare('1 轉差一級');

  /* 剛好全滿：原表值及全轉加成一起更新 */
  const full = {};
  tree1.forEach((def) => { full[def.id] = MAX; });
  setLevels(full);
  const b = compare('1 轉剛好全滿');

  const sum = (o) => Object.keys(o).reduce((s, k) => s + o[k], 0);
  assert.equal(sum(b) - sum(a), 10.5, '最後一級增加0.5，整轉40再增加25%');
  assert.equal(b.strPct,6.25);assert.equal(b.agiPct,6.25);
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

test('正式Worker最後一級即時提高其他威能的實際屬性，讀檔保留、降級撤除', () => {
  const e=createEngine({seed:1018}).boot(), c=e.ctx;
  c.G.player.level=917;c.G.player.reincarnations=2;
  c.G.player.reincarnationTalentPoints=500;
  for(const def of c.TALENT_TREES[1])c.G.player.talents.levels[def.id]=10;
  c.G.player.talents.levels.t1_mres=9;
  c.markStatsDirty();
  const before=c.getStats().str, threat=c.talentThreatTotal();
  e.cmd('talent.upgrade',{id:'t1_mres'});
  assert.equal(c.talentLevel('t1_mres'),10);
  assert.equal(c.talentStatBonuses().strPct,6.25);
  const full=c.getStats().str;
  assert.ok(full>before,'升級魔抗亦須立即啟用力量威能的滿轉加成');
  assert.equal(c.talentThreatTotal(),threat);
  assert.equal(c.G.player.reincarnationTalentPoints,490);
  const loaded=createEngine({seed:1018}).boot(JSON.parse(e.saveJson())).ctx;
  assert.equal(loaded.getStats().str,full);
  assert.equal(loaded.G.player.reincarnationTalentPoints,490);
  e.cmd('talent.downgrade',{id:'t1_mres'});
  assert.equal(c.talentStatBonuses().strPct,5);
  assert.equal(c.getStats().str,before);
  assert.equal(c.G.player.reincarnationTalentPoints,500);
});
