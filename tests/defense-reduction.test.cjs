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

function expectedPlayerDamage(context, attack, defense, attackerLevel) {
  return Math.max(0, attack - defense) *
    (1 - context.defReduction(defense, attackerLevel));
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

test('防禦減傷率 = 防禦 ÷ (防禦 + a + b × 受攻擊者等級)', () => {
  const context = loadContext();
  const a = context.DEF_REDUCTION_CONST, b = context.DEF_REDUCTION_PER_LEVEL;
  [[100, 1], [5000, 300], [200000, 600]].forEach(([def, lv]) => {
    assert.ok(Math.abs(context.defReduction(def, lv) - def / (def + a + b * lv)) < 1e-12, '防禦 ' + def + '／等級 ' + lv);
  });
  assert.ok(context.defReduction(5000, 600) < context.defReduction(5000, 1), '受攻擊者等級越高，同樣防禦減傷越少');
});

test('resolveHit／DoT：防禦減傷曲線的等級取受攻擊者，不是攻擊者（2026-11-06）', () => {
  const context = loadContext();
  const defense = 5000;
  // 敵人承受：攻擊者 1 級、受攻擊者 600 級 → 用 600
  const onEnemy = resolve(context, { atk: 100000, dmgType: 'phys', level: 1 }, { def: defense, level: 600 });
  assert.equal(onEnemy, Math.round(100000 * (1 - context.defReduction(defense, 600))));
  assert.notEqual(onEnemy, Math.round(100000 * (1 - context.defReduction(defense, 1))), '不得改用攻擊者等級');

  // 我方承受：攻擊者 600 級、受攻擊者（玩家）10 級 → 用 10
  const onPlayer = resolve(context, { atk: 100000, dmgType: 'phys', level: 600 }, { def: defense, level: 10, isPlayer: true });
  assert.equal(onPlayer, Math.round(expectedPlayerDamage(context, 100000, defense, 10)));

  // 魔法段同一條規則
  const magic = resolve(context, { atk: 100000, dmgType: 'magic', level: 1 }, { mdef: defense, level: 600 });
  assert.equal(magic, Math.round(100000 * (1 - context.defReduction(defense, 600))));

  // DoT：跟直接命中一致
  const dot = context.dotDamageAfterMitigation(1000, { level: 1 }, { def: defense, level: 600 });
  assert.ok(Math.abs(dot - 1000 * (1 - context.defReduction(defense, 600))) < 1e-9);
});
