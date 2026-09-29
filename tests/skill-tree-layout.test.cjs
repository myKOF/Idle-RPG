const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// 舊版技能樹與融合技能列表已移除；技能樹格線目前只給「潛力」分類使用（新版技能群組走 .sg-skill-list）。
test('技能樹每列固定六個技能格，分類卡片寬度足以容納六格', () => {
  assert.match(ui, /potentialCells\.slice\(pr,\s*pr \+ 6\)/);

  const trees = css.match(/#skill-trees\s*\{([\s\S]*?)\}/);
  assert.ok(trees, '找不到 #skill-trees 樣式');
  assert.match(trees[1], /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(400px,\s*1fr\)\)/);

  const row = css.match(/\.tree-row\s*\{([\s\S]*?)\}/);
  assert.ok(row, '找不到 .tree-row 樣式');
  assert.match(row[1], /display:\s*grid/);
  assert.match(row[1], /grid-template-columns:\s*repeat\(6,\s*52px\)/);
  assert.doesNotMatch(row[1], /flex-wrap:\s*wrap/);
});

test('融合技能列表容器已隨融合系統移除，不留孤兒節點與樣式', () => {
  assert.doesNotMatch(html, /fusion-skill-list/);
  assert.doesNotMatch(css, /#fusion-skill-list/);
  assert.match(html, /id="skill-trees"/);
});
