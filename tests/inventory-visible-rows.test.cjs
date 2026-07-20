const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const uiSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'ui.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
const rowsBlock = uiSource.match(/function inventoryVisibleRows\([\s\S]*?\n\}/);
assert.ok(rowsBlock, '找不到背包可視排數計算函式');

const getVisibleRows = vm.runInNewContext(
  '(function () {' + rowsBlock[0] + '; return inventoryVisibleRows; })()',
  { Math, Number, INVENTORY_VISIBLE_ROWS_DEFAULT: 3, INVENTORY_VISIBLE_ROWS_MAX: 9 }
);

test('背包可視排數依目前展開排數逐排增加，且限制在 3～9 排', () => {
  assert.equal(getVisibleRows(3, 3), 3);
  assert.equal(getVisibleRows(4, 3), 3);
  assert.equal(getVisibleRows(4, 4), 4);
  assert.equal(getVisibleRows(8, 8), 8);
  assert.equal(getVisibleRows(12, 9), 9);
  assert.equal(getVisibleRows(20, 12), 9);
  assert.equal(getVisibleRows(1, 1), 3);
});

test('背包外向下滾輪才會觸發逐排展開，背包內仍保留原捲動區', () => {
  assert.match(uiSource, /document\.addEventListener\('wheel'/);
  assert.match(uiSource, /target\.closest\('#inv-section-box'\)/);
  assert.match(uiSource, /e\.deltaY\s*<=\s*0/);
  assert.match(cssSource, /#inventory-grid\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(uiSource, /--inventory-visible-rows/);
});
