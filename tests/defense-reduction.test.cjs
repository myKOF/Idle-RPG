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
