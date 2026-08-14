'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

test('彈窗關閉與重繪時自動清理浮動提示 Tooltip', () => {
  // closeSkillModal 必須呼叫 hideTooltip
  const closeSkillBlock = ui.slice(ui.indexOf('function closeSkillModal()'), ui.indexOf('function closeSkillModal()') + 200);
  assert.match(closeSkillBlock, /hideTooltip\(\);/);

  // closeTalentModal 必須呼叫 hideTooltip
  const closeTalentBlock = ui.slice(ui.indexOf('function closeTalentModal()'), ui.indexOf('function closeTalentModal()') + 200);
  assert.match(closeTalentBlock, /hideTooltip\(\);/);

  // renderSkill2Modal 重繪包含錨點時必須呼叫 hideTooltip
  const renderSkill2Block = ui.slice(ui.indexOf('function renderSkill2Modal('), ui.indexOf('function renderSkill2Modal(') + 300);
  assert.match(renderSkill2Block, /if \(UI\.tooltipAnchor && body\.contains\(UI\.tooltipAnchor\)\)\s*hideTooltip\(\);/);

  // renderSkillModal 重繪包含錨點時必須呼叫 hideTooltip
  const renderSkillBlock = ui.slice(ui.indexOf('function renderSkillModal()'), ui.indexOf('function renderSkillModal()') + 300);
  assert.match(renderSkillBlock, /if \(UI\.tooltipAnchor && body\.contains\(UI\.tooltipAnchor\)\)\s*hideTooltip\(\);/);

  // refreshOpenStatTooltip 當錨點脫離 DOM 或所屬彈窗隱藏時必須自動 hideTooltip
  const refreshBlock = ui.slice(ui.indexOf('function refreshOpenStatTooltip()'), ui.indexOf('function refreshOpenResourceTooltip()'));
  assert.match(refreshBlock, /if \(!anchorEl \|\| !document\.documentElement\.contains\(anchorEl\)\)\s*\{\s*hideTooltip\(\);/);
  assert.match(refreshBlock, /if \(modalParent && modalParent\.style\.display === 'none'\)\s*\{\s*hideTooltip\(\);/);
});
