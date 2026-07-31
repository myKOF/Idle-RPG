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

test('野外裝備掉落表依怪物等級分層，且高等級層每一品質都不低於低等級層', () => {
  const context = loadDataContext();
  const table = JSON.parse(JSON.stringify(context.FIELD_DROP_TABLE));

  /* ⚠️ 這裡刻意**不寫死機率數字**。數值歸參數表管
     （config/CSV/game_parameters.csv），而「程式表與參數表是否一致」已經由
     tests/apply-params.test.cjs 全域把關。這支測試若也抄一份數字，就變成每次調平衡
     都要改兩個地方，而且改漏了只會得到一支與設計無關的紅燈——先前正是如此。

     這支要守的是**結構性保證**：分層存在、由高到低排序、每層品質數一致，
     而且同一品質的機率不會出現「低等級層比高等級層還好」這種反向。 */
  assert.equal(table.length, 4, '應有 4 個等級分層');
  assert.deepEqual(table.map((t) => t.min), [150, 100, 50, 1], '分層門檻由高到低');

  const width = table[0].rates.length;
  table.forEach((tier) => {
    assert.equal(tier.rates.length, width, 'min=' + tier.min + ' 的品質欄數應與其他層一致');
    tier.rates.forEach((r) => assert.ok(r >= 0 && r <= 100, 'min=' + tier.min + ' 出現不合理機率：' + r));
  });

  for (let i = 1; i < table.length; i++) {
    for (let q = 0; q < width; q++) {
      assert.ok(table[i].rates[q] <= table[i - 1].rates[q],
        'min=' + table[i].min + ' 的第 ' + q + ' 品質機率（' + table[i].rates[q] +
        '）高於更高等級層 min=' + table[i - 1].min + '（' + table[i - 1].rates[q] + '）');
    }
  }
});
