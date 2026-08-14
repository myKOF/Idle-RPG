'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

test('戰鬥場景 HTML 結構包含頂部 quest-bar 與底部 battle-skill-bar', () => {
  assert.ok(html.includes('<div class="battle-scene-wrapper"'), '需存在 .battle-scene-wrapper');
  assert.ok(html.includes('<div id="quest-bar" style="display:none"></div>'), '需存在 #quest-bar');
  assert.ok(html.includes('<div id="battle-skill-bar"></div>'), '需存在 #battle-skill-bar');

  // 確認 quest-bar 與 battle-skill-bar 都在 battle-scene-wrapper 內
  const wrapperIdx = html.indexOf('<div class="battle-scene-wrapper"');
  const questIdx = html.indexOf('<div id="quest-bar"', wrapperIdx);
  const skillBarIdx = html.indexOf('<div id="battle-skill-bar">', wrapperIdx);

  assert.ok(questIdx > wrapperIdx, '#quest-bar 應在 .battle-scene-wrapper 內');
  assert.ok(skillBarIdx > wrapperIdx, '#battle-skill-bar 應在 .battle-scene-wrapper 內');
});

test('戰鬥區 CSS 包含頂部任務列膠囊定位與底部 10 技能槽位樣式', () => {
  assert.match(css, /#quest-bar\s*\{[^}]*position:\s*absolute;[^}]*top:\s*8px;/);
  assert.match(css, /#battle-skill-bar\s*\{[^}]*position:\s*absolute;[^}]*bottom:\s*8px;/);
  assert.match(css, /\.battle-skill-slot\.locked/);
  assert.match(css, /\.battle-skill-slot\.empty/);
  assert.match(css, /\.battle-skill-slot\.equipped/);
  assert.match(css, /\.battle-skill-slot\s+\.bss-cd-mask/);
  assert.match(css, /conic-gradient/);
  assert.match(css, /\.battle-skill-slot\s+\.bss-cd-text/);
});

test('ui.js 包含 renderBattleSkillBar 渲染邏輯與跳轉技能頁事件', () => {
  assert.match(ui, /function renderBattleSkillBar\(/);
  assert.match(ui, /var TOTAL_SLOTS = 10;/);
  assert.match(ui, /data-skill-slot-action="goto-skills"/);
  assert.match(ui, /data-tab="skills"/);
  assert.match(ui, /--cd-deg:/);
});
