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

test('高塔 BOSS 經驗為對應普通怪物經驗的 2 倍', () => {
  const context = loadFormulaContext();
  [1, 10, 50].forEach((floor) => {
    const boss = context.bossStatsFor(floor);
    const normal = context.monsterStatsFor(boss.refStage, false);
    assert.equal(boss.xp, normal.xp * 2);
  });
});

test('地獄之塔 51~100 層套用攻擊與生命倍率，並限制魔魂本源掉落規則', () => {
  const context = loadFormulaContext();
  assert.equal(context.isHellTowerFloor(50), false);
  assert.equal(context.isHellTowerFloor(51), true);
  assert.equal(context.isHellTowerFloor(100), true);
  assert.equal(context.isHellTowerFloor(101), false);
  const trial = context.bossStatsFor(50);
  const hell = context.bossStatsFor(51);
  const normalHellBase = context.monsterStatsFor(hell.refStage, false);
  assert.equal(trial.hell, false);
  assert.equal(hell.hell, true);
  assert.equal(hell.hp, normalHellBase.hp * 22 * context.TOWER_HELL_HP_MULT);
  assert.equal(hell.atk, normalHellBase.atk * 1.9 * context.TOWER_HELL_ATK_MULT);
  assert.equal(context.hellSoulOriginDropChance(50), 0);
  assert.equal(context.hellSoulOriginDropChance(51), 5);
  assert.equal(context.hellSoulOriginDropChance(52), 6);
  assert.equal(context.hellSoulOriginDropChance(100), 54);
});

test('高塔通關流程會發放 BOSS 經驗並套用經驗加成', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /var xpGain = Math\.round\(\(b\.xp \|\| 0\) \* \(1 \+ st2\.xpBonus \/ 100\)\)/);
  assert.match(tower, /gainXp\(xpGain\)/);
  assert.match(tower, /hellSoulOriginDropChance\(floor\)/);
  assert.match(html, /id="r-soul-origin"/);
  assert.match(ui, /r-soul-origin/);
  assert.match(ui, /✨ 經驗 x' \+ fmt\(bossXp\)/);
  assert.match(ui, /hellSoulOriginDropChance\(fl\)/);
  assert.match(ui, /ancientEssenceDropChanceForBoss\(bossStats\.level\)/);
  assert.match(ui, /icon_ancient_essence\.png/);
  assert.doesNotMatch(ui, /100000 × 樓層\^2\.6/);
});

test('高塔戰鬥總結統計攻擊輸出，包含護盾與溢出傷害', () => {
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /TOWER\.dmgDealt \+= Math\.max\(0, \(sres\.dmg \|\| 0\)\)/);
  assert.match(tower, /TOWER\.dmgDealt \+= Math\.max\(0, \(res\.dmg \|\| 0\)\)/);
  assert.match(tower, /var bossHit = doMonsterAttack\(b, p, 'tp-float', mult\)/);
  assert.match(tower, /TOWER\.bossDmgDealt \+= Math\.max\(0, \(bossHit\.dmg \|\| 0\)\)/);
  assert.match(tower, /var bossSpecialHit = doMonsterAttack\(b, p, 'tp-float', 2\.2 \* mult\)/);
  assert.match(tower, /TOWER\.bossDmgDealt \+= Math\.max\(0, \(bossSpecialHit\.dmg \|\| 0\)\)/);
  assert.doesNotMatch(tower, /beforeHp - p\.hp/);
  assert.doesNotMatch(tower, /beforeHp2 - p\.hp/);
});
