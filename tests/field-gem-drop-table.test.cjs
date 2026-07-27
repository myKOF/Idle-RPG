const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context, {
    filename: 'js/data.js'
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8'), context, {
    filename: 'js/formula.js'
  });
  return context;
}

test('野外寶石掉落表依怪物等級與寶石階級套用', () => {
  const context = loadContext();
  // CSV: config/CSV/game_parameters.csv:147-153。
  assert.deepEqual(JSON.parse(JSON.stringify(context.FIELD_GEM_DROP_TABLE)), [
    { min: 301, rates: [14, 2.3, 0.8, 0.4, 0.3] },
    { min: 251, rates: [12, 2, 0.7, 0.3, 0.2] },
    { min: 201, rates: [10, 1.7, 0.6, 0.2, 0] },
    { min: 151, rates: [8, 1.4, 0.5, 0.1, 0] },
    { min: 101, rates: [6, 1.1, 0.4, 0, 0] },
    { min: 51, rates: [4, 0.8, 0.3, 0, 0] },
    { min: 1, rates: [2, 0.5, 0.2, 0, 0] }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.fieldGemDropRatesFor(300))), [12, 2, 0.7, 0.3, 0.2]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.fieldGemDropRatesFor(999))), [14, 2.3, 0.8, 0.4, 0.3]);
});

test('寶石掉落改為使用怪物等級表，不再使用固定總機率', () => {
  const root = path.resolve(__dirname, '..');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.doesNotMatch(formula, /FIELD_GEM_DROP_PCT/);
  assert.doesNotMatch(combat, /fieldGemLevelFor\(s\)/);
  assert.match(combat, /fieldGemDropRatesFor\(m\.level\)/);
});
