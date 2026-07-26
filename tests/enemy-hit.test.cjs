const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('普通敵人命中率依 game_parameters 等級區間逐級累加', () => {
  const context = loadFormulaContext();
  const expected = new Map([
    [1, 100.5], [49, 124.5], [50, 125.25], [99, 162],
    [100, 163], [149, 212], [150, 214], [199, 312],
    [200, 314.5], [299, 562], [300, 565]
  ]);
  expected.forEach((value, stage) => {
    const m = context.monsterStatsFor(stage, false);
    assert.equal(m.level, stage);
    assert.equal(m.hit, value);
  });
  // 菁英沿用同一命中率公式（不因菁英另加成）
  const elite = context.monsterStatsFor(30, true);
  assert.equal(elite.hit, 115);
});

test('普通敵人閃避率依 game_parameters 等級區間逐級累加', () => {
  const context = loadFormulaContext();
  const expected = new Map([
    [1, 5.5], [49, 29.5], [50, 30.25], [99, 67],
    [100, 68], [149, 117], [150, 118.5], [199, 192], [200, 194]
  ]);
  expected.forEach((value, stage) => {
    assert.equal(context.monsterStatsFor(stage, false).dodge, value);
  });
  assert.equal(context.monsterStatsFor(30, true).dodge, 25);
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
  // 攻擊組態改用敵人自身命中率
  assert.match(combat, /hit:\s*m\.hit\s*\|\|\s*100/);
  assert.doesNotMatch(combat, /critRate:\s*5,\s*critDmg:\s*150,\s*hit:\s*100,/);
});

test('tower.js BOSS 物件帶入命中率', () => {
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /hit:\s*bs\.hit/);
});
