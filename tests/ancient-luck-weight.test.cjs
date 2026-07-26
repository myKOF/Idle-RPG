const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('幸運值會按太古詞條數提高權重，並正規化為機率', () => {
  const context = loadContext();
  let pairs = null;
  context.wpick = (weightedPairs) => {
    pairs = weightedPairs;
    return weightedPairs[0][0];
  };

  context.rollAncientAffixCount(5, 4000);
  assert.ok(pairs);
  const total = pairs.reduce((sum, [, probability]) => sum + probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);

  const raw = context.ANCIENT_COUNT_WEIGHTS[5];
  const factor = 1.25; // m = 0.5 × 4000 / (4000 + 4000) = 0.25
  const expectedRatio = (raw[5] * Math.pow(factor, 5)) / raw[0];
  const actualRatio = pairs[5][1] / pairs[0][1];
  assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-12);
});

test('裝備產生時會把幸運值傳入太古詞條數量抽取', () => {
  const item = fs.readFileSync(path.join(__dirname, '..', 'js/item.js'), 'utf8');
  assert.match(item, /rollAncientAffixCount\(affixCount, luck\)/);
});
