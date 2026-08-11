const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

test('敵方狀態列可顯示即時狀態與增減益詳情', () => {
  assert.match(html, /id="tb-status" data-enemy-buff-tip/);
  assert.match(ui, /data-enemy-buff-tip data-enemy-index="/);
  assert.match(ui, /function currentCombatEnemyEntity\(anchorEl\)/);
  assert.match(ui, /function enemyBuffTooltipDesc\(anchorEl\)/);
  assert.match(ui, /function showEnemyBuffTooltip\(anchorEl\)/);
  assert.match(ui, /closest\('\[data-enemy-buff-tip\]'\)[\s\S]*?showEnemyBuffTooltip/);
  assert.match(ui, /descEl\.innerHTML = enemyBuffTooltipDesc\(anchor\)/);
  assert.match(css, /\.enemy-status\[data-enemy-buff-tip\],[\s\S]*?#tb-status\[data-enemy-buff-tip\]\s*\{[\s\S]*cursor:\s*pointer/);
});

/* 2026-08-11 技能及狀態改造：控制、持續傷害、增益減益統一由狀態層列舉（statusEntries），
   UI 不再逐一判斷 effects／dots／buffs，圖標與名稱一律取自狀態表。 */
test('敵方 tooltip 詳情涵蓋控制、持續傷害與增減益', () => {
  assert.match(ui, /function enemyBuffTooltipDesc\(anchorEl\)/);
  assert.match(ui, /var list = statusEntries\(ent\);/);
  assert.match(ui, /combatStatusRow\(e\.icon, e\.name/);
  assert.doesNotMatch(ui, /var BUFF_TIP_EMOJI = \{/, 'UI 不應再自帶第二份狀態圖標對照表');
});
