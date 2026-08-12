const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('裝備功能區加寬、詳情縮窄且素材寶石固定四欄', () => {
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  assert.match(css, /\.equip-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(300px,\s*320px\)\s+minmax\(264px,\s*1fr\)/);
  assert.match(css, /#equip-grid\s*\{[\s\S]*max-width:\s*400px/);
  assert.match(css, /\.equip-detail-card\s*\{[\s\S]*width:\s*280px\s*!important[\s\S]*min-width:\s*280px\s*!important[\s\S]*max-width:\s*280px\s*!important/);
  assert.match(css, /#detail-pane\s+\.it-affix\s*,[\s\S]*font-size:\s*14px/);
  assert.match(css, /\.it-sub\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.it-sockets\s+\.socket\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(css, /\.equip-material-panel\s*\{[\s\S]*margin-left:\s*0[\s\S]*width:\s*100%/);
  assert.match(css, /\.equip-material-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*32px\)/);
  assert.match(css, /\.equip-top-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(180px,\s*190px\)/);
  assert.match(css, /#ui-shell \.equip-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(300px,\s*320px\)\s+minmax\(264px,\s*1fr\)\s*!important/);
  assert.match(css, /#ui-shell \.equip-top-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(180px,\s*190px\)\s*!important/);
  assert.match(css, /#ui-shell #combat-area\s*\{[\s\S]*flex:\s*0\s+0\s+816px\s*!important[\s\S]*width:\s*816px\s*!important/);
});

test('裝備評分移到裝備等級列右側，避免遮住裝備名稱', () => {
  const item = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.doesNotMatch(item, /it-score it-score-top/);
  assert.match(item, /it-score it-score-sub/);
  assert.match(css, /\.it-sub\s*\{[\s\S]*display:\s*flex[\s\S]*justify-content:\s*space-between/);
  assert.match(css, /\.it-score-sub\s*\{[\s\S]*white-space:\s*nowrap/);
});

test('空附魔欄以已使用欄位數顯示，第一個空欄為 0/1', () => {
  const item = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');
  assert.ok(item.includes("空附魔欄（' + enSlot + '/' + enCap + '）"));
  assert.ok(!item.includes("空附魔欄（' + (enSlot + 1) + '/' + enCap + '）"));
});
