const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDataContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math };
  vm.createContext(context);
  ['js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('野外裝備掉落表完整對齊配置表的怪物等級分層', () => {
  const context = loadDataContext();
  const table = JSON.parse(JSON.stringify(context.FIELD_DROP_TABLE));

  /* 這支測試同時守住兩件事：分層結構，以及配置表中容易回歸的關鍵邊界。
     完整數值同步由 tests/apply-params.test.cjs 與 apply_params 工具負責；
     這裡特別鎖定 20 級與 50 級，避免裝備套裝等級門檻再次取代掉落率區間。 */
  assert.equal(table.length, 8, '應保留配置表產生的 8 個等級分層');
  assert.deepEqual(table.map((t) => t.min), [300, 250, 200, 150, 100, 50, 20, 1], '分層門檻由高到低');

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

  assert.equal(context.dropRatesFor(context.FIELD_DROP_TABLE, 19)[3], 0, '19 級應使用獨特 1~19 區間');
  assert.equal(context.dropRatesFor(context.FIELD_DROP_TABLE, 20)[3], 5, '20 級應切換至獨特 20~99 區間');
  assert.equal(context.dropRatesFor(context.FIELD_DROP_TABLE, 21)[3], 5, '21 級應使用獨特 20~99 區間');
  assert.equal(context.dropRatesFor(context.FIELD_DROP_TABLE, 49)[4], 0, '49 級尚未進入史詩 50~99 區間');
  assert.equal(context.dropRatesFor(context.FIELD_DROP_TABLE, 50)[4], 0.5, '50 級應切換至史詩 50~99 區間');
  assert.equal(context.dropRatesFor(context.FIELD_DROP_TABLE, 300)[3], 20, '300 級應使用 300+ 區間');
});
