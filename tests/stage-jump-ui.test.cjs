const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('階段列提供直達最高按鈕並將最高資訊放在其右側', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(html, /id="st-max"[^>]*>⏭/);
  assert.match(html, /id="st-max"[\s\S]*id="stage-best"/);
  assert.match(ui, /\$id\('st-max'\)\.addEventListener\('click',[\s\S]*stageGoMax\(\)/);
});
