const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDataContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context, {
    filename: 'js/data.js'
  });
  return context;
}

test('野外裝備掉落表依怪物等級套用新機率', () => {
  const context = loadDataContext();
  // CSV: config/CSV/game_parameters.csv:139-146；目前程式表使用各品質前四個等級區間。
  assert.deepEqual(JSON.parse(JSON.stringify(context.FIELD_DROP_TABLE)), [
    { min: 150, rates: [50, 40, 30, 10, 5, 2, 0.05, 0] },
    { min: 100, rates: [40, 30, 15, 10, 2.5, 1, 0, 0] },
    { min: 50, rates: [35, 20, 8, 4, 0.5, 0, 0, 0] },
    { min: 1, rates: [15, 10, 5, 0, 0, 0, 0, 0] }
  ]);
});
