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

test('煉獄之塔開放 101～150 層，且 BOSS 為相對地獄倍率 10 倍', () => {
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
  assertClose(purgatory.hp, base.hp * 20 * context.TOWER_HELL_HP_MULT * context.TOWER_PURGATORY_HP_MULT);
  assertClose(purgatory.atk, base.atk * 3 * context.TOWER_HELL_ATK_MULT * context.TOWER_PURGATORY_ATK_MULT);
  assertClose(purgatory.elemAtkVal, base.atk * 3 * context.TOWER_HELL_ATK_MULT * context.TOWER_PURGATORY_ATK_MULT);
});

test('煉獄之塔 BOSS 名稱與等級使用橘色樣式', () => {
  const data = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const tower = fs.readFileSync(path.join(root, 'js/tower.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(data, /TOWER_PURGATORY_MAX_FLOOR\s*=\s*150/);
  assert.match(data, /TOWER_PURGATORY_ATK_MULT\s*=\s*10/);
  assert.match(data, /TOWER_PURGATORY_HP_MULT\s*=\s*10/);
  assert.match(formula, /function isPurgatoryTowerFloor\(floor\)/);
  assert.match(tower, /purgatory: !!bs\.purgatory/);
  assert.match(ui, /tower-section-title.*purgatory|isPurgatoryTowerFloor/);
  assert.match(ui, /purgatory-boss/);
  assert.match(css, /\.purgatory-boss/);
  assert.match(css, /#ff8c00/);
});

test('參數表包含煉獄之塔樓層與相對地獄攻擊/生命倍率', () => {
  const csv = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  assert.match(csv, /煉獄之塔範圍/);
  assert.match(csv, /煉獄之塔攻擊倍率/);
  assert.match(csv, /煉獄之塔生命倍率/);
  assert.match(applyParams, /TOWER_PURGATORY_MAX_FLOOR/);
  assert.match(applyParams, /TOWER_PURGATORY_ATK_MULT/);
  assert.match(applyParams, /TOWER_PURGATORY_HP_MULT/);
});
