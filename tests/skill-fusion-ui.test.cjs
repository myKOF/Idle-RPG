'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

test('未學習的融合技能仍顯示刪除按鈕', () => {
  const start = ui.indexOf('function renderSkillModal()');
  const end = ui.indexOf('/* ----', start);
  assert.ok(start >= 0 && end > start, '找不到技能詳情渲染區塊');
  const modal = ui.slice(start, end);

  assert.match(modal, /if \(lv > 0 \|\| isFusion\) \{/);
  assert.match(modal, /data-skill-delete="' \+ deleteRef/);
});
