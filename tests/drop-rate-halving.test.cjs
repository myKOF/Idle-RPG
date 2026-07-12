const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math, Date };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context, { filename: 'js/data.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8'), context, { filename: 'js/formula.js' });
  return context;
}

test('掉寶率來源統一減半，既有數值也透過計算套用', () => {
  const context = loadFormulaContext();
  assert.equal(context.DROP_RATE_EFFECT_MULT, 0.5);
  assert.equal(context.effectiveDropRateEffect(880), 440);
  assert.equal(context.effectiveDropRateEffect(-20), -10);
  assert.equal(context.effectivePartEffectValue('ancientEssenceRate', 175), 87.5);
  assert.equal(context.effectivePartEffectValue('gemSieve', 4.2), 2.1);
  assert.equal(context.effectivePartEffectValue('speedGear', 25), 25);
});

test('掉寶率實際消費點使用減半後的裝備與技能加成', () => {
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const skills = fs.readFileSync(path.join(root, 'js/skills.js'), 'utf8');
  assert.match(formula, /st\.loot\s*=\s*effectiveDropRateEffect\(A\.loot\)/);
  assert.match(combat, /effectiveDropRateEffect\(buffVal\(FIELD\.player, 'lootUp'\)\)/);
  assert.match(skills, /key === 'lootUp'[\s\S]*effectiveDropRateEffect/);
});
