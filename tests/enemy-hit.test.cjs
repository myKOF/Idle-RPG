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

test('普通敵人命中率 = 100% + 敵人等級×1%（等級 = 階段）', () => {
  const context = loadFormulaContext();
  [1, 10, 50, 137, 300].forEach((stage) => {
    const m = context.monsterStatsFor(stage, false);
    assert.equal(m.level, stage);
    assert.equal(m.hit, 100 + stage * 1);
  });
  // 菁英沿用同一命中率公式（不因菁英另加成）
  const elite = context.monsterStatsFor(30, true);
  assert.equal(elite.hit, 100 + 30 * 1);
});

test('BOSS 命中率 = 200% + BOSS 階層×10%（階層 = 樓層）', () => {
  const context = loadFormulaContext();
  [1, 10, 40, 51, 100].forEach((floor) => {
    const b = context.bossStatsFor(floor);
    assert.equal(b.hit, 200 + floor * 10);
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
