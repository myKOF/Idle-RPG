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
  assert.deepEqual(JSON.parse(JSON.stringify(context.FIELD_DROP_TABLE)), [
    { min: 150, rates: [0, 0, 0, 20, 6, 3, 0.25, 0] },
    { min: 100, rates: [0, 10, 8, 6, 4, 2, 0, 0] },
    { min: 50, rates: [25, 10, 5, 2, 0, 0, 0, 0] },
    { min: 1, rates: [25, 10, 5, 0, 0, 0, 0, 0] }
  ]);
});
