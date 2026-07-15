const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('技能樹每列固定四個技能格，分類卡片寬度足以容納四格', () => {
  assert.match(ui, /cells\.slice\(r,\s*r \+ 4\)/);

  const trees = css.match(/#skill-trees\s*\{([\s\S]*?)\}/);
  assert.ok(trees, '找不到 #skill-trees 樣式');
  assert.match(trees[1], /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(288px,\s*1fr\)\)/);

  const row = css.match(/\.tree-row\s*\{([\s\S]*?)\}/);
  assert.ok(row, '找不到 .tree-row 樣式');
  assert.match(row[1], /display:\s*grid/);
  assert.match(row[1], /grid-template-columns:\s*repeat\(4,\s*52px\)/);
  assert.doesNotMatch(row[1], /flex-wrap:\s*wrap/);
});

test('融合技能列表維持每排十二個，不套用技能樹四欄排列', () => {
  assert.match(html, /id="fusion-skill-list" class="tree-row"/);

  const fusionRow = css.match(/#fusion-skill-list\.tree-row\s*\{([\s\S]*?)\}/);
  assert.ok(fusionRow, '找不到 #fusion-skill-list.tree-row 覆蓋樣式');
  assert.match(fusionRow[1], /display:\s*grid/);
  assert.match(fusionRow[1], /grid-template-columns:\s*repeat\(12,\s*52px\)/);
  assert.match(fusionRow[1], /overflow-x:\s*auto/);
});
