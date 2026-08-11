const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('煉獄之塔開放 101～150 層，且 BOSS 套用合併參數公式', () => {
  const context = loadFormulaContext();
  assert.equal(context.isPurgatoryTowerFloor(100), false);
  assert.equal(context.isPurgatoryTowerFloor(101), true);
  assert.equal(context.isPurgatoryTowerFloor(150), true);
  assert.equal(context.isPurgatoryTowerFloor(151), false);
  assert.equal(context.TOWER_MAX_FLOOR, 150);

  const purgatory = context.bossStatsFor(101);
  const base = context.monsterStatsFor(purgatory.refStage, false);
  const assertClose = (actual, expected) => {
    assert.ok(Math.abs(actual - expected) / expected < 1e-12, `${actual} is not close to ${expected}`);
  };
  assert.equal(purgatory.purgatory, true);
  assert.equal(purgatory.hell, false);
  // 三塔獨立參數：煉獄之塔倍率為「直接乘基準值」的總倍率（不再鏈乘）
  assertClose(purgatory.hp, base.hp * context.TOWER_BOSS_PURGATORY.hpMult);
  assertClose(purgatory.atk, base.atk * context.TOWER_BOSS_PURGATORY.atkMult);
  // 元素附傷以「總魔攻」為基準再乘該塔元素係數
  assertClose(purgatory.elemAtkVal, purgatory.atk * context.TOWER_BOSS_PURGATORY.elemMult);
});

test('煉獄之塔 BOSS 名稱與等級使用橘色樣式', () => {
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(data, /TOWER_PURGATORY_MAX_FLOOR\s*=\s*150/);
  assert.match(data, /TOWER_BOSS_PURGATORY\s*=\s*\{/);
  assert.match(data, /TOWER_BOSS_PURGATORY[\s\S]*?atkMult:\s*75/);
  assert.match(data, /TOWER_BOSS_PURGATORY[\s\S]*?hpMult:\s*4000/);
  assert.match(formula, /function isPurgatoryTowerFloor\(floor\)/);
  assert.match(tower, /purgatory: !!bs\.purgatory/);
  assert.match(ui, /tower-section-title.*purgatory|isPurgatoryTowerFloor/);
  assert.match(ui, /purgatory-boss/);
  assert.match(css, /\.purgatory-boss/);
  assert.match(css, /#ff8c00/);
});

test('參數表包含合併的高塔樓層與攻擊/生命倍率', () => {
  const csv = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  const applyLines = applyParams.split(/\r?\n/);
  assert.match(csv, /試練之塔範圍.*\{煉獄之塔：第a~b層\}/);
  assert.match(csv, /4-高塔BOSS,生命,.*?,20,400,4000/);
  assert.match(csv, /4-高塔BOSS,攻擊,.*?,3,15,75/);
  assert.match(applyParams, /TOWER_PURGATORY_MAX_FLOOR/);
  // 三塔錨點以迴圈定義：陣列列出三個物件名，欄位對應以 t 索引參數欄
  assert.match(applyParams, /\['TOWER_BOSS_TRIAL'.*\['TOWER_BOSS_HELL'.*\['TOWER_BOSS_PURGATORY'/);
  assert.ok(applyLines.some((line) => line.includes("'atkMult'") && line.includes("'攻擊'") && line.includes('t,')));
  assert.ok(applyLines.some((line) => line.includes("'hpMult'") && line.includes("'生命'") && line.includes('t,')));
});
