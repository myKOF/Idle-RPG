/* 幸運值（量過之後移除）＋「宣告過的詞條目標不得被 ROI 洗掉」。

   使用者：「到了神話裝備以上，幸運值是值得投資的，至少出 1 條。」
   **曲線的形狀他說對了，量級差 40 倍。**

   一條幸運詞條實測只給 100 幸運值，而乘數 f = 1 + 0.5×luck/(luck+4000)
   在 100 時只有 1.0122：

     幸運值      f      R8（八條詞條）期望太古    相對幸運 0
          0   1.0000           1.210               —
        100   1.0122           1.230           +0.019   ← 一條詞條
        400   1.0455           1.283           +0.073   ← 四個合法部位全上
       4000   1.2500           1.652           +0.442
      20000   1.4167           2.008           +0.797

   48 小時 × 5 seed 的 A/B：幸運詞條確實湊到了（4/5 seed、幸運值 100），
   而太古密度 1.27 對 1.28——完全沒動；關卡中位 340 → 330、物攻 57.2M → 53.4M。
   等於拿一格詞條換了零。所以目標與保留清單都移除了。

   實際可行的幸運來源是**寶石**（太陽石 10 級 ＝ 432 幸運）不是詞條，
   而 ANCIENT_LUCK_WEIGHT_DENOM ＝ 4000 才是真正的旋鈕。

   這支測試留下兩樣東西：
   1. 曲線形狀的哨兵——「詞條數越多，同樣的幸運值買到越多太古」是機制決定的
      （第 i 項乘 f^i），參數怎麼調都不該打破
   2. 目標保護的行為——那個修正救的是 gemEff / loot / xpBonus / cdr，
      跟幸運無關，留著 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { createEngine } = require(path.join(ROOT, 'scripts/sim/engine.js'));
const { createPolicy } = require(path.join(ROOT, 'scripts/sim/policy.js'));
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/sim/policy.extreme.roi.json'), 'utf8'));
const ctx = createEngine({ seed: 1 }).ctx;

/* ============ 幸運值：機制與量級 ============ */

function evAncient(n, luck) {
  const w = ctx.ANCIENT_COUNT_WEIGHTS[n];
  const f = 1 + (ctx.ANCIENT_LUCK_WEIGHT_DENOM > 0
    ? ctx.ANCIENT_LUCK_WEIGHT_MULT * luck / (luck + ctx.ANCIENT_LUCK_WEIGHT_DENOM)
    : ctx.ANCIENT_LUCK_WEIGHT_MULT);
  const adj = w.map((x, i) => x * Math.pow(f, i));
  const tot = adj.reduce((a, b) => a + b, 0);
  return adj.reduce((a, x, i) => a + i * x / tot, 0);
}

test('幸運的邊際效益隨詞條數單調上升——這是機制決定的，不是參數', () => {
  /* 權重表第 i 項乘 f^i，表越長尾巴被拉得越誇張。
     使用者「400 級以前不太需要考慮」與「神話以上值得投資」是同一條曲線的兩端。 */
  const gain = (n) => evAncient(n, 20000) - evAncient(n, 0);
  for (let n = 5; n <= 9; n++) {
    assert.ok(gain(n) > gain(n - 1), `詞條 ${n} 的增量應大於 ${n - 1}：${gain(n)} vs ${gain(n - 1)}`);
  }
  assert.ok(gain(8) / gain(4) > 3, '神鑄創世(8 條)的增量應遠大於史詩(4 條)');
});

test('一條幸運詞條買不到可觀的太古——這是移除目標的理由', () => {
  /* 幸運詞條 base 3、非百分比，實測整套下來一條 ＝ 100 幸運值。
     這支釘住的是「量級差很遠」這個事實：使用者若把 DENOM 調小，
     這支會紅，那正是提醒「幸運值現在有用了，可以重新把目標加回來」。 */
  const oneAffix = evAncient(8, 100) - evAncient(8, 0);
  const allSlots = evAncient(8, 400) - evAncient(8, 0);
  assert.ok(oneAffix < 0.05, '一條詞條(100 幸運)的太古增量目前是 ' + oneAffix.toFixed(3) + ' 條');
  assert.ok(allSlots < 0.15, '四個合法部位全上(400 幸運)也只有 ' + allSlots.toFixed(3) + ' 條');
  assert.equal(ctx.AFFIX_POOL.luck.pct, false);
  /* ⚠️ 跨 vm realm 的陣列用 deepEqual 會卡在「同結構但非同一參照」——比字串就好。 */
  assert.equal(Array.from(ctx.AFFIX_POOL.luck.slots).join(','), 'helmet,ring,amulet');
});

test('可行的幸運來源是寶石不是詞條', () => {
  /* 太陽石高階一顆就抵四個詞條部位。之後真要投資幸運，
     入口在鑲嵌偏好（socketEmpty）而不是洗煉目標。 */
  assert.equal(ctx.GEM_TYPES.sunstone.stat, 'luck');
  assert.ok(ctx.gemStatValue('sunstone', 10) > 400);
});

test('幸運已經不在洗煉目標與保留清單裡', () => {
  assert.equal(POLICY.targets.some((t) => t.affixKey === 'luck'), false);
  for (const name of ['affixWeapon', 'affixArmor', 'affixJewel']) {
    assert.equal((POLICY.lists[name] || []).includes('luck'), false, name + ' 不該再保留幸運');
  }
});

/* ============ 宣告過的詞條目標不得被 ROI 當犧牲品 ============ */

/* 犧牲品純粹以 ΔDPS/ΔEHP 的損失挑，而價值不出現在戰鬥面板上的詞條損失恆為 0
   （gemEff / loot / xpBonus / enhanceSuccess / cdr）。不保護的話它們永遠是
   損失最小的那一條，reroll-by-roi 就系統性地拆掉 reroll-for-deficit 的成果。
   實測 24 小時 × 5 seed：三個目標都宣告 atLeast 3，結果只有 2 / 5 / 3 條。 */

const ROI_RULE = POLICY.rules.find((r) => r.id === 'reroll-by-roi');
const GUARDED = POLICY.targets.find((t) => t.id === 'jewelGemEff');

function state(opts) {
  const o = opts || {};
  const affixes = [{ key: 'atkFlat', index: 0, ancient: false, lossOffPct: 30, lossEhpPct: 0 }];
  for (const k of (o.zeroLoss || [])) {
    affixes.push({ key: k, index: affixes.length, ancient: false, lossOffPct: 0, lossEhpPct: 0 });
  }
  const owned = (o.zeroLoss || []).map((k) => ({ key: k }));
  return {
    gameTimeSec: 100,
    /* ⚠️ 兩道門檻都要餵：reroll-by-roi 宣告 if: view.essence >= 20，
       而 jewelGemEff 這個目標自己還有 when: view.essence >= 400。
       只餵 100 的話目標會回 waiting（前提不成立）而不受保護，
       測試就會誤以為「保護沒生效」——寫這支時真的踩過。 */
    view: { essence: o.essence === undefined ? 500 : o.essence },
    panels: {
      inv: { equipment: { amulet: { id: 'a1', affixes: owned }, ring: null, ring2: null } },
      eval: {
        affixRoi: { critDmg: { slotKey: 'amulet', dOffPct: 90, dEhpPct: 0 } },
        equippedAffixes: { amulet: affixes },
        resources: {}
      }
    }
  };
}

function victimOf(st, targets) {
  const p = createPolicy({
    name: 'test-target-guard', decideEveryGameSec: 5, needPanels: ['inv', 'eval'],
    targets: targets || [GUARDED], roi: POLICY.roi, rules: [ROI_RULE]
  });
  const cmds = p.decide(st).filter((c) => c.name === 'item.rerollAffix');
  return cmds.length ? cmds[0].args.affixKey : null;
}

test('前提：沒有保護時，零損失的詞條一定是第一個被犧牲的', () => {
  /* 用一份不含任何 affixKey 目標的宣告，重現修正前的行為。 */
  assert.equal(victimOf(state({ zeroLoss: ['gemEff'] }), []), 'gemEff');
});

test('宣告過的目標還差一條時，那條不准被犧牲', () => {
  assert.notEqual(victimOf(state({ zeroLoss: ['gemEff'] })), 'gemEff');
});

test('保護是逐目標的，沒宣告的零損失詞條照樣可以換掉', () => {
  /* 依據是「宣告過」，不是「看起來沒用」。 */
  assert.equal(victimOf(state({ zeroLoss: ['gemEff', 'xpBonus'] })), 'xpBonus');
});

test('目標的 when 不成立（waiting）時不保護——那時它本來就不該佔位置', () => {
  /* jewelGemEff 自己就有 when: view.essence >= 400，把精華壓到門檻以下即可。 */
  assert.equal(victimOf(state({ zeroLoss: ['gemEff'], essence: 100 })), 'gemEff');
});
