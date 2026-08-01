'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

test('背包選取對應裝備欄以向外 outline 加粗，不壓縮內容', () => {
  const match = css.match(/\.eq-slot\.inventory-selection-match\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, '找不到背包選取對應裝備欄樣式');
  assert.match(match[1], /border-width:\s*2px\s*!important/);
  assert.match(match[1], /outline:\s*2px\s+solid\s+var\(--eq-selection-border-color\)\s*!important/);
  assert.match(match[1], /outline-offset:\s*0\s*!important/);
  assert.doesNotMatch(match[1], /border-width:\s*4px/);
});

test('裝備欄渲染將稀有度顏色提供給選取外框', () => {
  assert.match(ui, /--eq-selection-border-color:'\s*\+\s*r\.color/);
});
