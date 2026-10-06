const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('已裝配的技能：清單顯示1px白色外框與已裝配標籤，右上角按鈕顯示卸下', () => {
  const root = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'css/ashen-forge.css'), 'utf8');

  // 1. 驗證 CSS 中已裝配技能（.sgb-item.is-eq）有 1px 白色外框
  assert.match(
    css,
    /\.sgb-item\.is-eq\s*\{[^}]*border:\s*1px solid #ffffff;/s,
    '已裝配技能卡片應具備 1px solid #ffffff 白色外框'
  );
  assert.match(
    css,
    /\.sgb-item\.is-eq:hover\s*\{[^}]*border-color:\s*#ffffff;/s,
    '已裝配技能卡片 hover 時應維持白色外框'
  );

  // 2. 驗證 ui.js 中清單標籤與卡片 class
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  // 標籤文字為「已裝配」
  assert.match(ui, /equipped \? '已裝配' : ''/);
  assert.ok(!ui.includes("equipped ? '已裝上' : ''"), '不得殘留舊已裝上文字');

  // 卡片帶有 is-eq class
  assert.match(ui, /equipped && !groupLocked \? ' is-eq' : ''/);

  // 詳情右上角卸下按鈕文字為「卸下」
  assert.match(ui, /data-skill-unequip="' \+ ref \+ '"' \+ equipPendingAttrs \+ '>卸下<\/button>/);
  assert.ok(!ui.includes('>已裝上 · 卸下</button>'), '右上角卸下按鈕不得殘留 已裝上 · 卸下');
});
