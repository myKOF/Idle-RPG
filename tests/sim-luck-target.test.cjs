/* 幸運值：宣告的詞條目標不得被 reroll-by-roi 拆掉。

   使用者：「到了神話裝備以上，幸運值是值得投資的，至少出 1 條。」
   而更早他說過「400 級以前的裝備不太需要考慮」——兩句話是同一條曲線的兩端。

   用遊戲的 ANCIENT_COUNT_WEIGHTS 算期望太古條數（幸運 0 → 20000）：
     R4 四條詞條 +0.18｜R5 +0.30｜R6 +0.44｜R7 +0.60｜R8 +0.80｜R10 +1.20
   幸運的乘數 f = 1 + 0.5×luck/(luck+4000) 是**逐項次方**加權（第 i 項乘 f^i），
   權重表越長尾巴被拉得越誇張，所以絕對增量差 6.7 倍。

   ⚠️ 這支測試真正盯的是一個結構性的洞：reroll-by-roi 挑犧牲品時純看
   ΔDPS/ΔEHP 的損失，而 luck / gemEff / loot / xpBonus / enhanceSuccess
   這些詞條的損失恆為 0——它們永遠是損失最小的那一條，於是永遠第一個被洗掉。
   實測 24 小時 × 5 seed：gemEff / loot / xpBonus 都宣告 atLeast 3，
   結果全身合計只有 2 / 5 / 3 條。 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
const { createPolicy } = require(path.join(ROOT, 'scripts/sim/policy.js'));
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.extreme.roi.json'), 'utf8'));
const ctx = createEngine({ seed: 1 }).ctx;

/* ---- 遊戲側的前提：幸運到底值不值得 ---- */

test('幸運的邊際效益隨詞條數上升——這是「神話以上才投資」的依據', () => {
  const W = ctx.ANCIENT_COUNT_WEIGHTS;
  const MULT = ctx.ANCIENT_LUCK_WEIGHT_MULT, DEN = ctx.ANCIENT_LUCK_WEIGHT_DENOM;
  const ev = (n, luck) => {
    const w = W[n];
    const f = 1 + (DEN > 0 ? MULT * luck / (luck + DEN) : MULT);
    const adj = w.map((x, i) => x * Math.pow(f, i));
    const tot = adj.reduce((a, b) => a + b, 0);
    return adj.reduce((a, x, i) => a + i * x / tot, 0);
  };
  const gain = (n) => ev(n, 20000) - ev(n, 0);
  /* 詞條數越多，同樣的幸運值買到的太古條數越多。單調性是機制決定的
     （第 i 項乘 f^i），所以可以當哨兵釘住——參數怎麼調都不該打破它。 */
  for (let n = 5; n <= 9; n++) {
    assert.ok(gain(n) > gain(n - 1), `詞條 ${n} 的增量應大於 ${n - 1}：${gain(n)} vs ${gain(n - 1)}`);
  }
  assert.ok(gain(8) / gain(4) > 3, '神鑄創世(8 條)的增量應該遠大於史詩(4 條)');
});

test('幸運詞條的合法部位只有頭盔、戒指、項鍊——目標的 slots 不能超出', () => {
  const t = POLICY.targets.find((x) => x.id === 'luckAffix');
  const legal = ctx.AFFIX_POOL.luck.slots;
  for (const s of t.slots) {
    const base = s.replace(/2$/, '');            // ring2 是第二只戒指，詞條池只寫 ring
    assert.ok(legal.indexOf(base) >= 0, `${s} 出不了幸運值，列進目標只會讓缺口永遠補不滿`);
  }
});

test('幸運在它每一個合法部位上都受保留清單保護', () => {
  /* 少了這個，洗掉無用詞條的規則會把剛湊到的幸運當垃圾洗掉。
     （完整的分組破洞檢查在 tests/policy-keys.test.cjs） */
  const groups = POLICY.rules.find((r) => r.id === 'reroll-off-target').rerollOffTarget.targetGroups;
  const keep = {};
  let fallback = null;
  for (const g of groups) {
    const keys = [];
    for (const l of g.lists || []) keys.push(...(POLICY.lists[l.list] || []));
    if (!g.slots) { fallback = keys; continue; }
    for (const s of g.slots) keep[s] = (keep[s] || []).concat(keys);
  }
  for (const s of ctx.AFFIX_POOL.luck.slots) {
    assert.ok((keep[s] || fallback).includes('luck'), `${s} 沒保護幸運值`);
  }
});

/* ---- 策略側：目標的前提與保護 ---- */

const ROI_RULE = POLICY.rules.find((r) => r.id === 'reroll-by-roi');

function state(minRarity, luckCount) {
  const affixes = [{ key: 'atkFlat', index: 0, ancient: false, lossOffPct: 30, lossEhpPct: 0 }];
  if (luckCount > 0) affixes.push({ key: 'luck', index: 1, ancient: false, lossOffPct: 0, lossEhpPct: 0 });
  const eqLuck = luckCount > 0 ? [{ key: 'luck' }] : [];
  return {
    gameTimeSec: 100,
    /* ⚠️ reroll-by-roi 宣告了 if: view.essence >= 20。沒這一行規則整條不觸發，
       而不觸發的後果是回 null——notEqual('luck') 會空洞地通過。 */
    view: { essence: 100 },
    panels: {
      inv: {
        equipmentRarityMin: minRarity,
        equipment: { helmet: { id: 'h1', affixes: eqLuck }, ring: null, ring2: null, amulet: null }
      },
      eval: {
        affixRoi: { critDmg: { slotKey: 'helmet', dOffPct: 90, dEhpPct: 0 } },
        equippedAffixes: { helmet: affixes },
        resources: {}
      }
    }
  };
}

function victimOf(st) {
  const p = createPolicy({
    name: 'test-luck', decideEveryGameSec: 5, needPanels: ['inv', 'eval'],
    targets: POLICY.targets.filter((t) => t.id === 'luckAffix'),
    roi: POLICY.roi, rules: [ROI_RULE]
  });
  const cmds = p.decide(st).filter((c) => c.name === 'item.rerollAffix');
  return cmds.length ? cmds[0].args.affixKey : null;
}

test('神話裝以上時，幸運不會被 ROI 當犧牲品洗掉', () => {
  /* 幸運對 ΔDPS/ΔEHP 的損失恆為 0，不保護的話它永遠是損失最小的那一條。 */
  assert.notEqual(victimOf(state(6, 1)), 'luck',
    '身上只有一條幸運且目標要求至少一條，洗掉它就永遠補不滿');
});

test('還沒穿到神話時不保護——那時幸運本來就不該佔位置', () => {
  /* 目標的 when 不成立會回 waiting，保護要跟著讓開，
     否則早期就被一條沒用的幸運卡住一格。 */
  assert.equal(victimOf(state(5, 1)), 'luck');
});

test('目標的 when 讀的是遊戲給的身上最低品質', () => {
  const t = POLICY.targets.find((x) => x.id === 'luckAffix');
  assert.deepEqual(t.when, ['panels.inv.equipmentRarityMin', '>=', 6]);
  const e = createEngine({ seed: 2 }).boot(null);
  const pan = e.panel('inv', { items: false });
  assert.equal(pan.equipmentRarityMin, -1, '全空時回 -1，語意與逐部位一致');
  e.ctx.G.equipment.helmet = e.ctx.makeEquipment(100, { rarity: 7, level: 100, slot: 'helmet' });
  e.ctx.G.equipment.chest = e.ctx.makeEquipment(100, { rarity: 6, level: 100, slot: 'chest' });
  assert.equal(e.panel('inv', { items: false }).equipmentRarityMin, 6, '取最低，不是最高');
});

test('保護是逐目標的，不是把所有零損失詞條一律鎖死', () => {
  /* 沒宣告目標的零損失詞條仍然可以被換掉——保護的依據是「宣告過」，
     不是「看起來沒用」。 */
  const st = state(6, 1);
  st.panels.eval.equippedAffixes.helmet.push(
    { key: 'xpBonus', index: 2, ancient: false, lossOffPct: 0, lossEhpPct: 0 });
  assert.equal(victimOf(st), 'xpBonus', '沒被這份 targets 宣告的零損失詞條應該優先被犧牲');
});
