const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

/* 期望值一律由參數表推導，測試不另存一份數字。
   數值以配表為準（`4-野外怪物/命中率`、`/閃避率` → data.js 的 FIELD_MONSTER_*_GROWTH，
   由 apply_params 產生），所以調整平衡不會再誤報成測試失敗；
   這裡真正要守的是「逐級累加」這個語意：每一級各自吃自己所在區間的成長值，
   跨區間時不重算、不跳號。累加迴圈在測試裡獨立實作，不呼叫 segmentedLevelGrowth。 */
function expectedSegmentedValue(base, level, brackets) {
  let total = base;
  for (let lv = 1; lv <= level; lv++) {
    const bracket = brackets.find((b) => lv >= b.min && (b.max == null || lv <= b.max));
    if (bracket) total += bracket.rate;
  }
  return Math.round(total * 1e6) / 1e6; // 逐級相加的浮點誤差
}

// 取各區間的下界、上界與跨界處，確保邊界行為被覆蓋
function segmentProbeLevels(brackets) {
  const levels = new Set([1]);
  brackets.forEach((b) => {
    levels.add(b.min);
    if (b.max != null) { levels.add(b.max); levels.add(b.max + 1); }
    else levels.add(b.min + 100);
  });
  return [...levels].filter((lv) => lv >= 1).sort((a, b) => a - b);
}

test('普通敵人命中率依 game_parameters 等級區間逐級累加', () => {
  const context = loadFormulaContext();
  const base = context.FIELD_MONSTER_HIT_BASE;
  const brackets = context.FIELD_MONSTER_HIT_GROWTH;
  assert.ok(brackets.length >= 2, '命中率應有多個等級區間');
  segmentProbeLevels(brackets).forEach((stage) => {
    const m = context.monsterStatsFor(stage, false);
    assert.equal(m.level, stage);
    assert.equal(
      Math.round(m.hit * 1e6) / 1e6,
      expectedSegmentedValue(base, stage, brackets),
      'Lv' + stage + ' 命中率與參數表不符'
    );
  });
  // 菁英沿用同一命中率公式（不因菁英另加成）
  assert.equal(context.monsterStatsFor(30, true).hit, context.monsterStatsFor(30, false).hit);
});

test('普通敵人閃避率依 game_parameters 等級區間逐級累加', () => {
  const context = loadFormulaContext();
  const base = context.FIELD_MONSTER_DODGE_BASE;
  const brackets = context.FIELD_MONSTER_DODGE_GROWTH;
  assert.ok(brackets.length >= 2, '閃避率應有多個等級區間');
  segmentProbeLevels(brackets).forEach((stage) => {
    assert.equal(
      Math.round(context.monsterStatsFor(stage, false).dodge * 1e6) / 1e6,
      expectedSegmentedValue(base, stage, brackets),
      'Lv' + stage + ' 閃避率與參數表不符'
    );
  });
  // 菁英閃避＝一般閃避 + 菁英加成（加成值同樣以程式套用的為準，不在此另抄一份）
  const elite = context.monsterStatsFor(30, true).dodge;
  const normal = context.monsterStatsFor(30, false).dodge;
  assert.ok(elite > normal, '菁英閃避應高於同階普通怪');
});

test('玩家命中率包含基礎 100%，額外命中再抵消敵方閃避', () => {
  const context = loadFormulaContext();
  let hitChance = null;
  context.chance = (value) => {
    if (hitChance === null) hitChance = value;
    return true;
  };
  context.resolveHit(
    {},
    { hp: 100000, maxHp: 100000, shield: 0, effects: {}, dots: [] },
    { atk: 100, dmgType: 'phys', level: 1, hit: 103, critRate: 0 },
    { def: 0, mdef: 0, level: 1, dodge: 11, pRes: 0, mRes: 0, resist: {} }
  );
  assert.equal(hitChance, 92);
});

test('BOSS 命中率沿用目前高塔命中率參數', () => {
  const context = loadFormulaContext();
  [1, 10, 40, 51, 100].forEach((floor) => {
    const b = context.bossStatsFor(floor);
    assert.equal(b.hit, 200 + floor * 70);
  });
});

test('combat.js 敵人命中率帶入攻擊組態，不再寫死 100', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  // 野外敵人物件帶入命中率
  assert.match(combat, /hit:\s*base\.hit/);
  /* 攻擊組態改用敵人自身命中率；沒有 hit 欄位時退回預設值。
     那個預設值原本是寫死的 100，套用參數表靠 numCtx 夾住數字改寫；
     已改為 data.js 的具名常數 MONSTER_DEFAULT_HIT，錨點綁變數名。 */
  assert.match(combat, /hit:\s*m\.hit\s*\|\|\s*MONSTER_DEFAULT_HIT/);
  assert.match(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), /var MONSTER_DEFAULT_HIT = 100;/);
  assert.doesNotMatch(combat, /critRate:\s*5,\s*critDmg:\s*150,\s*hit:\s*100,/);
});

test('tower.js BOSS 物件帶入命中率', () => {
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /hit:\s*bs\.hit/);
});
