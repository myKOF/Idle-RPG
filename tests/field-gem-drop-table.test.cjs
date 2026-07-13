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
  assert.deepEqual(JSON.parse(JSON.stringify(context.FIELD_GEM_DROP_TABLE)), [
    { min: 301, rates: [40, 6, 3, 1, 0.5] },
    { min: 251, rates: [30, 4, 2, 0.75, 0.25] },
    { min: 201, rates: [20, 3, 1.5, 0.5, 0] },
    { min: 151, rates: [15, 2, 1, 0, 0] },
    { min: 101, rates: [10, 1.25, 0.75, 0, 0] },
    { min: 51, rates: [7.5, 1, 0.5, 0, 0] },
    { min: 1, rates: [5, 1, 0.5, 0, 0] }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.fieldGemDropRatesFor(300))), [30, 4, 2, 0.75, 0.25]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.fieldGemDropRatesFor(999))), [40, 6, 3, 1, 0.5]);
});

test('寶石掉落改為使用怪物等級表，不再使用固定總機率', () => {
  const root = path.resolve(__dirname, '..');
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const combat = fs.readFileSync(path.join(root, 'js/combat.js'), 'utf8');
  assert.doesNotMatch(formula, /FIELD_GEM_DROP_PCT/);
  assert.doesNotMatch(combat, /fieldGemLevelFor\(s\)/);
  assert.match(combat, /fieldGemDropRatesFor\(m\.level\)/);
});
