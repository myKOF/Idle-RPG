const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

function loadCombatContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { stage: { current: 1 }, tower: { active: false } };
  context.currentZoneDef = () => ({
    pool: [{ name: '測試怪', emoji: '👾', magic: false }],
    hpMult: 1, atkMult: 1, defMult: 1, rewardMult: 1
  });
  return context;
}

test('普通敵人數量依 78/15/5/2 機率區間選出 1～4 隻', () => {
  const context = loadFormulaContext();
  [
    [0.00, 1],
    [0.7799, 1],
    [0.7801, 2],
    [0.9299, 2],
    [0.9301, 3],
    [0.9799, 3],
    [0.9801, 4],
    [0.9999, 4]
  ].forEach(([randomValue, expected]) => {
    context.Math.random = () => randomValue;
    assert.equal(context.rollFieldEnemyCount(), expected);
  });
});

test('普通關卡可生成多敵人，但菁英固定單一敵人', () => {
  const context = loadCombatContext();
  context.Math.random = () => 0.999;

  context.G.stage.current = 1;
  context.spawnFieldMonster();
  assert.equal(context.FIELD.monsters.length, 4);
  assert.equal(context.FIELD.monster, context.FIELD.monsters[0]);
  assert.equal(context.FIELD.monsters.every((enemy) => !enemy.elite), true);

  context.G.stage.current = 10;
  context.spawnFieldMonster();
  assert.equal(context.FIELD.monsters.length, 1);
  assert.equal(context.FIELD.monsters[0].elite, true);
});

test('多敵人逐一擊殺時各自結算經驗與掉落，全部擊殺後才推進', () => {
  const context = loadCombatContext();
  const xp = [];
  context.G = {
    player: { gold: 0 },
    stage: { current: 1, best: 1, kills: 0, autoAdvance: true },
    tower: { active: false }
  };
  context.FIELD.player = { hp: 100, maxHp: 100 };
  context.getStats = () => ({ hp: 100, goldBonus: 0, xpBonus: 0, moveSpeed: 0, passives: {} });
  context.healPlayer = () => {};
  context.gainXp = (amount) => xp.push(amount);
  context.rollFieldDrops = (enemy) => ['掉落' + enemy.name];
  const first = { name: '甲', hp: 0, maxHp: 10, gold: 10, xp: 20, elite: false };
  const second = { name: '乙', hp: 0, maxHp: 10, gold: 30, xp: 40, elite: false };
  context.FIELD.monsters = [first, second];
  context.FIELD.monster = first;

  context.onFieldKill(first);
  assert.equal(context.G.player.gold, 10);
  assert.deepEqual(xp, [20]);
  assert.equal(context.FIELD.monsters.length, 1);
  assert.equal(context.G.stage.current, 1);
  assert.equal(context.G.stage.kills, 0);

  context.onFieldKill(second);
  assert.equal(context.G.player.gold, 40);
  assert.deepEqual(xp, [20, 40]);
  assert.equal(context.FIELD.monsters.length, 0);
  assert.equal(context.G.stage.current, 2);
  assert.equal(context.G.stage.kills, 1);
});

test('敵人集合暫時為空時仍能以目前目標提供畫面資料', () => {
  const context = loadCombatContext();
  const activeEnemy = { name: '目前目標', hp: 100, maxHp: 100 };
  context.FIELD.monsters = [];
  context.FIELD.monster = activeEnemy;
  assert.equal(context.fieldEnemyList().length, 1);
  assert.equal(context.fieldEnemyList()[0].name, '目前目標');
});
