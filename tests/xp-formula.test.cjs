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

test('level up xp requirement uses 2.2 power scaling', () => {
  const context = loadFormulaContext();

  // xpForLevel(l) = floor((30 × l^2.2 + 40) × 轉生經驗倍率 + 升級經驗基礎增加值)；未轉生時倍率 1、基礎增加值 0。
  assert.equal(context.xpForLevel(1), 70);        // 30×1^2.2 + 40 = 70
  assert.equal(context.xpForLevel(10), 4794);    // ⌊30×10^2.2 + 40⌋ = 4794
  assert.equal(context.xpForLevel(100), 753605); // ⌊30×100^2.2 + 40⌋ = 753605
});

test('轉生設定依公式表支援 20 轉與轉生對照表經驗倍率', () => {
  const context = loadFormulaContext();

  assert.equal(context.REINCARNATION_MAX, 20);
  assert.equal(context.REINCARNATION_RANKS.length, 21);
  assert.equal(context.reincarnationRankName(0), '冒險者');
  assert.equal(context.reincarnationRankName(10), '位面創世神');
  assert.equal(context.reincarnationRankName(20), '神位終階');

  assert.equal(context.reincarnationTotalMultiplier(0), 1);
  assert.equal(context.reincarnationTotalMultiplier(10), 5120);
  assert.equal(context.reincarnationTotalMultiplier(20), 165288.374272);

  assert.equal(context.reincarnationExpMultiplier(0), 1);
  assert.equal(context.reincarnationExpMultiplier(1), 10);
  assert.equal(context.reincarnationExpMultiplier(10), 1e11);
  assert.equal(context.reincarnationExpMultiplier(20), 1e33);
});
