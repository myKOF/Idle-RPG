const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/strings_data.js', 'js/strings.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.rnd = () => 1;
  context.chance = (probability) => probability > 0;
  return context;
}

function expectedPlayerDamage(context, attack, defense, attackerLevel, defenderLevel) {
  return Math.max(0, attack - defense) *
    (1 - context.defReduction(defense, attackerLevel, defenderLevel));
}

function resolve(context, attackerCfg, defenderCfg) {
  const defender = { hp: 1e12, shield: 0, effects: {}, dots: [] };
  const result = context.resolveHit({}, defender, Object.assign({
    atk: 0, matk: 0, dmgType: 'both', level: 1, hit: 100, critRate: 0
  }, attackerCfg), Object.assign({
    def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {}
  }, defenderCfg));
  return result.dmg;
}

test('我方承傷先扣同類型防禦，再套用舊版防禦減傷率', () => {
  const context = loadContext();
  const defense = 100;
  const level = 10;

  assert.equal(
    context.playerDamageAfterDefense(50, defense, level),
    0,
    '攻擊低於防禦時不得產生負的攻防差值'
  );
  assert.equal(
    context.playerDamageAfterDefense(125, defense, level),
    expectedPlayerDamage(context, 125, defense, level)
  );
});

test('both 攻擊分別使用物理攻擊／物防與魔法攻擊／魔防', () => {
  const context = loadContext();
  const attackerLevel = 1;
  const physicalAttack = 120;
  const magicAttack = 220;
  const physicalDefense = 100;
  const magicDefense = 200;

  const actual = resolve(context, {
    atk: physicalAttack,
    matk: magicAttack,
    dmgType: 'both',
    level: attackerLevel
  }, {
    def: physicalDefense,
    mdef: magicDefense,
    isPlayer: true
  });
  const expected = Math.round(
    expectedPlayerDamage(context, physicalAttack, physicalDefense, attackerLevel) +
    expectedPlayerDamage(context, magicAttack, magicDefense, attackerLevel)
  );

  assert.equal(actual, expected);
});

test('敵人承受傷害仍使用舊版防禦減傷公式', () => {
  const context = loadContext();
  const attackerLevel = 1;
  const attack = 220;
  const defense = 100;
  const actual = resolve(context, {
    atk: attack,
    matk: 0,
    dmgType: 'phys',
    level: attackerLevel
  }, { def: defense, isPlayer: false });
  const expected = Math.round(attack * (1 - context.defReduction(defense, attackerLevel)));

  assert.equal(actual, expected);
  assert.notEqual(actual, Math.round(
    expectedPlayerDamage(context, attack, defense, attackerLevel)
  ), '敵方不應套用我方新增的先扣防禦層');
});

test('防禦減傷率 = 防禦 ÷ (防禦 + max(c, a + b × (攻擊者等級 − 受攻擊者等級)))', () => {
  const context = loadContext();
  const a = context.DEF_REDUCTION_CONST, b = context.DEF_REDUCTION_PER_LEVEL, cFloor = context.DEF_REDUCTION_FLOOR;
  const expect = (def, atk, lv) => def / (def + Math.max(cFloor, a + b * (atk - lv)));
  [[100, 1, 1], [5000, 600, 300], [200000, 1, 600], [50000, 1000, 100]].forEach(([def, atk, lv]) => {
    assert.ok(Math.abs(context.defReduction(def, atk, lv) - expect(def, atk, lv)) < 1e-12, '防禦 ' + def + '／' + atk + ' 打 ' + lv);
  });
  // 只看等級差：同樣差 300 級，結果一樣
  assert.ok(Math.abs(context.defReduction(5000, 400, 100) - context.defReduction(5000, 900, 600)) < 1e-12);
  // 攻擊者領先 → 防禦擋得少；受攻擊者領先 → 擋得多
  assert.ok(context.defReduction(50000, 600, 300) < context.defReduction(50000, 300, 300));
  assert.ok(context.defReduction(50000, 300, 600) > context.defReduction(50000, 300, 300));
  // 下限 c：受攻擊者領先很多時分母項夾在 c，減傷不會超過 100%
  const capped = context.defReduction(50000, 1, 1000);
  assert.ok(Math.abs(capped - 50000 / (50000 + cFloor)) < 1e-12);
  assert.ok(capped < 1);
  // c 填 0 也不會變成完全免傷
  context.DEF_REDUCTION_FLOOR = 0;
  assert.ok(context.defReduction(50000, 1, 1000) < 1);
});

test('防禦減傷曲線釘住參數表現值（a、b、c）', () => {
  /* 依 AI_RULES.md 9.1 例外刻意釘住：參數表一動這裡就會紅，確認是有意調整後一併更新。
     2026-11-06：改為等級差，a = 10000、b = 100、c = 1000。 */
  const context = loadContext();
  assert.equal(context.DEF_REDUCTION_CONST, 10000);
  assert.equal(context.DEF_REDUCTION_PER_LEVEL, 100);
  assert.equal(context.DEF_REDUCTION_FLOOR, 1000);
  // 防禦 50000：600 級怪打 1000 級玩家／1000 級玩家打 600 級怪／600 級怪打 100 級玩家（夾在 c）
  assert.ok(Math.abs(context.defReduction(50000, 600, 1000) * 100 - 98.04) < 0.01);
  assert.ok(Math.abs(context.defReduction(50000, 1000, 600) * 100 - 50.00) < 0.01);
  assert.ok(Math.abs(context.defReduction(50000, 600, 100) * 100 - 45.45) < 0.01);
});

test('resolveHit／DoT：防禦減傷曲線用（攻擊者 − 受攻擊者）的等級差（2026-11-06）', () => {
  const context = loadContext();
  const defense = 50000;
  // 敵人承受：攻擊者 1 級、受攻擊者 600 級
  const onEnemy = resolve(context, { atk: 1e6, dmgType: 'phys', level: 1 }, { def: defense, level: 600 });
  assert.equal(onEnemy, Math.round(1e6 * (1 - context.defReduction(defense, 1, 600))));
  assert.notEqual(onEnemy, Math.round(1e6 * (1 - context.defReduction(defense, 600, 1))), '方向不得對調');

  // 我方承受：攻擊者 600 級、受攻擊者（玩家）10 級
  const onPlayer = resolve(context, { atk: 1e6, dmgType: 'phys', level: 600 }, { def: defense, level: 10, isPlayer: true });
  assert.equal(onPlayer, Math.round(Math.max(0, 1e6 - defense) * (1 - context.defReduction(defense, 600, 10))));

  // 魔法段同一條規則
  const magic = resolve(context, { atk: 1e6, dmgType: 'magic', level: 1 }, { mdef: defense, level: 600 });
  assert.equal(magic, Math.round(1e6 * (1 - context.defReduction(defense, 1, 600))));

  // DoT：跟直接命中一致
  const dot = context.dotDamageAfterMitigation(1000, { level: 1 }, { def: defense, level: 600 });
  assert.ok(Math.abs(dot - 1000 * (1 - context.defReduction(defense, 1, 600))) < 1e-9);
});
