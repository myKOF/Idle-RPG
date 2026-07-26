const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console };
  context.Math = Object.create(Math);
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('詞條上限率為 0 時，洗煉數值上下半段等機率', () => {
  const context = loadFormulaContext();
  context.Math.random = () => 0.2;
  assert.equal(context.affixRerollUnit(0), 0.1);
});

test('詞條上限率提高時，洗煉會先偏向高數值半段', () => {
  const context = loadFormulaContext();
  const randomValues = [0.4, 0.2, 0.2, 0.2, 0.4, 0.2];
  context.Math.random = () => randomValues.shift() ?? 0.2;
  assert.equal(context.affixRerollUnit(100), 0.6);
  assert.equal(context.rollAffixValue('hpFlat', 1, 0, 0), 18);
  assert.equal(context.rollAffixValue('hpFlat', 1, 0, 100), 23);
});

test('洗煉分段權重參數接到公式檔與主參數表', () => {
  const root = path.resolve(__dirname, '..');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');
  const params = fs.readFileSync(path.join(root, 'config/CSV/game_parameters.csv'), 'utf8');
  assert.match(formula, /var AFFIX_REROLL_BIAS_EXPONENT = 0\.3333/);
  assert.match(applyParams, /AFFIX_REROLL_LOWER_WEIGHT/);
  assert.match(applyParams, /AFFIX_REROLL_UPPER_BASE_WEIGHT/);
  assert.match(applyParams, /AFFIX_REROLL_BIAS_EXPONENT/);
  assert.match(params, /7-洗煉,數值洗煉分段權重/);
});
