const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

test('遊戲畫面禁止反白，但輸入欄位保留文字選取', () => {
  assert.match(css, /html,[\s\S]*?user-select:\s*none/);
  assert.match(css, /input,[\s\S]*?user-select:\s*text/);
  assert.match(css, /textarea,[\s\S]*?user-select:\s*text/);
  assert.match(ui, /addEventListener\(['"]selectstart['"]/);
});
