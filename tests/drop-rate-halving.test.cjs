const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadFormulaContext() {
  const context = { console, Math, Date };
  vm.createContext(context);
  vm.runInContext(readExpanded(path.join(root, 'js/data.js')), context, { filename: 'js/data.js' });
  vm.runInContext(readExpanded(path.join(root, 'js/formula.js')), context, { filename: 'js/formula.js' });
  return context;
}

test('掉寶率來源統一減半，既有數值也透過計算套用', () => {
  const context = loadFormulaContext();
  assert.equal(context.DROP_RATE_EFFECT_MULT, 0.5);
  assert.equal(context.effectiveDropRateEffect(880), 440);
  assert.equal(context.effectiveDropRateEffect(-20), -10);
  assert.equal(context.effectivePartEffectValue('ancientEssenceRate', 175), 87.5);
  assert.equal(context.effectivePartEffectValue('speedGear', 25), 25);
  assert.equal(context.effectivePartEffectValue('speedGear', 250), 250);
  assert.equal(context.effectivePartEffectValue('scrapForge', 140), 140);
});

test('掉寶率實際消費點使用減半後的裝備與技能加成', () => {
  const combat = readExpanded(path.join(root, 'js/combat.js'));
  const formula = readExpanded(path.join(root, 'js/formula.js'));
  const ui = readExpanded(path.join(root, 'js/ui.js'));
  assert.match(formula, /st\.loot\s*=\s*effectiveDropRateEffect\(A\.loot\)/);
  assert.match(combat, /effectiveDropRateEffect\(buffVal\(FIELD\.player, 'lootUp'\)\)/);
  assert.match(ui, /s-loot'\)\.textContent\s*=\s*\(st\.loot\s*\*\s*100\)/);
  assert.doesNotMatch(ui, /s-loot'\)\.textContent\s*=\s*\(st\.lootBonus/);
});
