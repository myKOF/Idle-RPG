const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math), UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('all_lock 詞條不進入裝備詞條池，也不顯示在屬性面板', () => {
  const context = loadContext();
  context.AFFIX_POOL.testAllLock = {
    name: '測試隱藏屬性', base: 1, lv: 0, pct: false, weight: 999, slots: ['all_lock']
  };

  assert.equal(context.affixIsAllLocked('testAllLock'), true);
  assert.equal(context.statPanelRowIsAllLocked(['測試隱藏屬性', () => 0, '']), true);

  const pools = [];
  context.wpick = (pairs) => {
    pools.push(pairs.map(([key]) => key));
    return pairs[0][0];
  };
  context.rollAffixes(1, 1, 0, 'weapon', {}, undefined);
  assert.equal(pools.length > 0, true);
  assert.equal(pools.every((keys) => !keys.includes('testAllLock')), true);
});
