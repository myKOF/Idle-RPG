const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.rnd = () => 1;
  context.chance = (probability) => probability > 0;
  return context;
}

function expectedReduction(context, defense, attackerLevel, attackerAttack) {
  const gap = Math.max(0, attackerAttack - defense);
  return (1 + gap) * defense /
    (defense + context.DEF_REDUCTION_CONST + context.DEF_REDUCTION_PER_LEVEL * attackerLevel);
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

test('防禦減傷依同類型攻防差值計算，且差值下限為 0', () => {
  const context = loadContext();
  const defense = 100;
  const level = 10;

  assert.equal(
    context.defReduction(defense, level, 50),
    context.defReduction(defense, level, 0),
    '攻擊低於防禦時不得產生負的攻防差值'
  );
  assert.equal(
    context.defReduction(defense, level, 125),
    expectedReduction(context, defense, level, 125)
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
    mdef: magicDefense
  });
  const expected = Math.round(
    physicalAttack * (1 - expectedReduction(context, physicalDefense, attackerLevel, physicalAttack)) +
    magicAttack * (1 - expectedReduction(context, magicDefense, attackerLevel, magicAttack))
  );

  assert.equal(actual, expected);
});
