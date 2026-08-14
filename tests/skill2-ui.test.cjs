'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('新版技能樹以群組列呈現七階橫向進階鏈', () => {
  assert.match(ui, /sgSkillGroupRowHTML\(sgGid,\s*sgLvs,\s*sgLoadout\)/);
  assert.match(ui, /sgStageNodeHTML\(gid,\s*i,\s*lvs,\s*loadout\)/);
  assert.match(ui, /sg-stage-arrow/);
  assert.match(ui, /data-sg-tier="' \+ tierIndex/);
  assert.match(css, /\.sg-group-row\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.sg-stage-track\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.sg-stage-arrow\s*\{[\s\S]*?color:\s*#1f8cb7/);
});

test('新版技能階段依解鎖狀態亮起或置灰，但灰色節點仍保留查看入口', () => {
  assert.match(ui, /function sgStageUnlocked\(lvs, tierIndex\)/);
  assert.match(ui, /tierIndex === 0 \|\| !!\(lvs && lvs\[tierIndex - 1\] >= 1\)/);
  assert.match(ui, /unlocked \? ' sg-stage-unlocked' : ' sg-stage-locked'/);
  assert.match(ui, /data-sk="' \+ ref/);
  assert.match(css, /\.sg-stage-node\.sg-stage-unlocked\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(css, /\.sg-stage-locked \.sg-stage-emoji/);
});

test('新版技能節點不因 hover 或重繪產生放大縮小效果', () => {
  const nodeStart = css.indexOf('.sg-stage-node {');
  const unlockedStart = css.indexOf('.sg-stage-node.sg-stage-unlocked {', nodeStart);
  assert.ok(nodeStart >= 0 && unlockedStart > nodeStart);
  const nodeBlock = css.slice(nodeStart, unlockedStart);
  assert.doesNotMatch(css, /\.sg-stage-node:hover\s*\{/);
  assert.doesNotMatch(nodeBlock, /transform\s*:/);
  assert.match(nodeBlock, /transition:\s*opacity/);
});

test('新版階段彈窗沿用舊版單技能結構，未解鎖階段不產生升級按鈕', () => {
  const start = ui.indexOf('function renderSkill2Modal(');
  const end = ui.indexOf('function openSkillModal(', start);
  assert.ok(start >= 0 && end > start, '找不到新版技能彈窗渲染區塊');
  const modal = ui.slice(start, end);
  assert.match(modal, /class="skd-head"/);
  assert.match(modal, /class="skill-modal-copy"/);
  assert.match(modal, /class="skill-modal-points"/);
  assert.match(modal, /if \(!locked && !atCap\) \{/);
  assert.match(modal, /class="sg-modal-locked-action"/);
  assert.match(modal, /data-skill2-learn="' \+ gid \+ ':' \+ selectedTier/);
});

test('技能頁文字與資產版號已更新', () => {
  assert.match(html, /亮起階段代表已解鎖，灰色階段仍可查看但不能升級/);
  assert.match(html, /css\/style\.css\?v=1\.0\.13/);
  assert.match(html, /js\/ui\.js\?v=1\.0\.41/);
});
