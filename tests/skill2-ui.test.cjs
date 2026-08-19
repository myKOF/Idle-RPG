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
  assert.match(ui, /sgSkillGroupRowHTML\(sgGid,\s*sgLvs,\s*sgLoadout,\s*skillsSnapshot\)/);
  assert.match(ui, /sgStageNodeHTML\(gid,\s*i,\s*lvs,\s*loadout,\s*skillsSnapshot\)/);
  assert.match(ui, /sg-stage-arrow/);
  assert.match(ui, /data-sg-tier="' \+ tierIndex/);
  assert.match(css, /\.sg-group-row\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /\.sg-stage-track\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.sg-stage-arrow\s*\{[\s\S]*?color:\s*#1f8cb7/);
});

test('新版技能階段依解鎖狀態亮起或置灰，但灰色節點仍保留查看入口', () => {
  assert.match(ui, /function sgStageUnlocked\(gid, lvs, tierIndex, skillsSnapshot\)/);
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
  assert.match(modal, /data-skill2-learn="' \+ gid \+ ':' \+ selectedTier/);
  assert.match(modal, /data-skill2-max="' \+ gid \+ ':' \+ selectedTier/);
  assert.match(modal, /data-skill2-downgrade="' \+ gid \+ ':' \+ selectedTier/);
  assert.match(modal, /data-skill2-delete="' \+ gid \+ ':' \+ selectedTier/);
});

test('主動型被動：技能彈窗有裝備鈕與類型標籤，快捷列外框旋轉流動', () => {
  const start = ui.indexOf('function renderSkill2Modal(');
  const end = ui.indexOf('function openSkillModal(', start);
  const modal = ui.slice(start, end);
  // 需裝配才生效 → 一定要有裝備／卸下鈕（不能像純被動那樣拿掉）
  assert.match(modal, /isPassiveGroup/);
  assert.match(modal, /data-skill-equip="' \+ ref/);
  assert.match(modal, /data-skill-unequip="' \+ ref/);
  assert.match(modal, /skill-tag-passive/);
  assert.match(modal, /主動型被動/);

  // 戰鬥快捷列：主動型被動帶 active-passive class，且不套冷卻／無魔狀態
  const barStart = ui.indexOf('function renderBattleSkillBar(');
  const barEnd = ui.indexOf('function startBattleSkillBarAnimation(', barStart);
  const bar = ui.slice(barStart, barEnd);
  assert.match(bar, /isPassiveGroup = isSgE && \(typeof skills2IsPassive === 'function'\) && skills2IsPassive\(entry\.slice\(3\)\)/);
  assert.match(bar, /isActivePassive \? ' active-passive ready'/);
  assert.match(bar, /var isOnCd = !isActivePassive && cd > 0/);
  // 主動型被動的個別階可以有自己的內部冷卻（大地守護【天地共生】）：冷卻中要退回一般倒數呈現
  assert.match(bar, /var isPassiveOnCd = isPassiveGroup && cd > 0/);
  assert.match(bar, /var isActivePassive = isPassiveGroup && !isPassiveOnCd/);

  // CSS：旋轉流動外框（conic-gradient ＋ 無限旋轉動畫），並提供減少動態的替代呈現
  assert.match(css, /\.battle-skill-slot\.active-passive::before\s*\{[\s\S]*?conic-gradient/);
  assert.match(css, /\.battle-skill-slot\.active-passive::before\s*\{[\s\S]*?animation:\s*bss-passive-spin[\s\S]*?infinite/);
  assert.match(css, /@keyframes bss-passive-spin\s*\{[\s\S]*?rotate\(360deg\)/);
  assert.match(css, /\.battle-skill-slot\.active-passive::after\s*\{[\s\S]*?inset:\s*2px/);
  assert.match(css, /prefers-reduced-motion[\s\S]*?\.battle-skill-slot\.active-passive::before\s*\{[\s\S]*?animation:\s*none/);
});

test('新版技能群組列外側包含內測一鍵滿級按鈕', () => {
  assert.match(ui, /class="sg-group-row-wrap"/);
  assert.match(ui, /class="sg-row-max-btn"/);
  assert.match(css, /\.sg-group-row-wrap\s*\{[\s\S]*?display:\s*flex/);
  assert.match(css, /\.sg-row-max-btn\s*\{[\s\S]*?width:\s*28px/);
});

test('技能頁文字與資產版號已更新', () => {
  assert.match(html, /亮起階段代表已解鎖，灰色階段仍可查看但不能升級/);
  assert.match(html, /css\/style\.css\?v=1\.0\.\d+/);
  assert.match(html, /js\/ui\.js\?v=1\.0\.\d+/);
});
