const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('level up xp requirement uses quadratic scaling', () => {
  const context = loadFormulaContext();

  assert.equal(context.xpForLevel(1), 70);
  assert.equal(context.xpForLevel(4000), 480000040);
});

test('轉生設定依公式表支援 10 轉與十倍遞增經驗倍率', () => {
  const context = loadFormulaContext();

  assert.equal(context.REINCARNATION_MAX, 10);
  assert.deepEqual(Array.from(context.REINCARNATION_RANKS), [
    '冒險者', '勇者', '大劍師', '破世者', '不朽者', '王者', '大主宰',
    '神聖尊者', '大聖王', '至高主宰', '位面創世神'
  ]);
  assert.deepEqual(
    Array.from({ length: 11 }, (_, i) => context.reincarnationTotalMultiplier(i)),
    [1, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120]
  );
  assert.deepEqual(
    Array.from({ length: 11 }, (_, i) => context.reincarnationExpMultiplier(i)),
    [1, 10, 100, 1000, 10000, 100000, 1000000, 10000000, 100000000, 1000000000, 10000000000]
  );
  assert.equal(context.reincarnationRankName(10), '位面創世神');
});
