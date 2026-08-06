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

test('高塔 BOSS 經驗為對應普通怪物經驗的 2 倍', () => {
  const context = loadFormulaContext();
  [1, 10, 50].forEach((floor) => {
    const boss = context.bossStatsFor(floor);
    const normal = context.monsterStatsFor(boss.refStage, false);
    assert.equal(boss.xp, normal.xp * 2);
  });
});

test('高塔 BOSS 單次生命傷害最高為最大生命 20%，至少五次才會死亡', () => {
  const context = loadFormulaContext();
  const towerSource = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  const combatSource = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.match(towerSource, /elite: false, isBoss: true, towerBoss: true/);
  assert.match(combatSource, /isBoss: !!m\.isBoss, towerBoss: !!m\.towerBoss/);
  const attacker = {};
  const attack = { atk: 100000, dmgType: 'phys', level: 1, critRate: 0, hit: 100 };
  const defense = { def: 0, mdef: 0, level: 1, dodge: 0, resist: {}, maxHp: 1000, isBoss: true, towerBoss: true };
  const boss = { hp: 1000, maxHp: 1000, shield: 0, towerBoss: true };

  for (let hit = 1; hit <= 5; hit += 1) {
    const before = boss.hp;
    const result = context.resolveHit(attacker, boss, attack, defense);
    assert.equal(before - boss.hp, 200);
    assert.equal(result.dmg, 200);
    assert.equal(result.killed, hit === 5);
  }
  assert.equal(boss.hp, 0);

  const normalBoss = { hp: 1000, maxHp: 1000, shield: 0 };
  const normalDefense = { ...defense, towerBoss: false };
  const normalResult = context.resolveHit(attacker, normalBoss, attack, normalDefense);
  assert.ok(normalResult.dmg > 200);
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
  // 三塔獨立參數：地獄之塔倍率為「直接乘基準值」的總倍率（不再鏈乘）
  assert.equal(hell.hp, normalHellBase.hp * context.TOWER_BOSS_HELL.hpMult);
  assert.equal(hell.atk, normalHellBase.atk * context.TOWER_BOSS_HELL.atkMult);
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
  assert.match(ui, /ancientEssenceDropChanceForBoss\(fl\)/);
  assert.match(ui, /icon_ancient_essence\.png/);
  assert.doesNotMatch(ui, /100000 × 樓層\^2\.6/);
});

test('高塔戰鬥總結統計攻擊輸出，包含護盾與溢出傷害', () => {
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  assert.match(tower, /TOWER\.dmgDealt \+= Math\.max\(0, \(sres\.dmg \|\| 0\)\)/);
  assert.match(tower, /TOWER\.dmgDealt \+= Math\.max\(0, \(res\.dmg \|\| 0\)\)/);
  /* 攻擊目標的區域變數已由 p 改名為 bossTarget／bossSpecialTarget（多敵人目標選擇）。
     這裡要守的是「傷害統計取自 doMonsterAttack 的回傳值」，不是變數叫什麼，
     所以目標參數放寬為識別字。 */
  assert.match(tower, /var bossHit = doMonsterAttack\(b, \w+, 'tp-float', mult\)/);
  assert.match(tower, /TOWER\.bossDmgDealt \+= Math\.max\(0, \(bossHit\.dmg \|\| 0\)\)/);
  assert.match(tower, /var bossSpecialHit = doMonsterAttack\(b, \w+, 'tp-float', 2\.2 \* mult, '蓄力重擊'\)/);
  assert.match(tower, /TOWER\.bossDmgDealt \+= Math\.max\(0, \(bossSpecialHit\.dmg \|\| 0\)\)/);
  assert.doesNotMatch(tower, /beforeHp - p\.hp/);
  assert.doesNotMatch(tower, /beforeHp2 - p\.hp/);
});
