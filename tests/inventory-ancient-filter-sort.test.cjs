const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('背包太古數量篩選與排序功能驗證', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const item = fs.readFileSync(path.join(root, 'js/item.js'), 'utf8');

  // 1. 驗證 index.html 包含 #inv-ancient-filter 且位於 #inv-rarity-filter 左側
  assert.match(html, /id="inv-ancient-filter"/);
  const ancientIdx = html.indexOf('id="inv-ancient-filter"');
  const rarityIdx = html.indexOf('id="inv-rarity-filter"');
  assert.ok(ancientIdx > 0 && rarityIdx > 0 && ancientIdx < rarityIdx, '太古篩選應位於品質篩選左側');

  // 2. 驗證太古篩選選項 (0, 1, 2, 3, 4, 5, 6, 7+ 太古)
  assert.match(html, /<option[^>]*>不限太古<\/option>/);
  assert.match(html, /value="0"[^>]*>0 太古<\/option>/);
  assert.match(html, /value="1"[^>]*>1 太古<\/option>/);
  assert.match(html, /value="2"[^>]*>2 太古<\/option>/);
  assert.match(html, /value="3"[^>]*>3 太古<\/option>/);
  assert.match(html, /value="4"[^>]*>4 太古<\/option>/);
  assert.match(html, /value="5"[^>]*>5 太古<\/option>/);
  assert.match(html, /value="6"[^>]*>6 太古<\/option>/);
  assert.match(html, /value="7"[^>]*>7\+\s*太古<\/option>/);

  // 3. 驗證排序按鈕包含預設文字且為 button 元素
  assert.match(html, /<button[^>]*id="inv-sort"[^>]*>🔄 排序 \(等級\)<\/button>/);

  // 4. 驗證 getItemAncientCount 已收斂至 js/item.js（唯一實作），篩選邏輯仍在 ui.js
  assert.match(item, /function\s+getItemAncientCount\s*\(/);
  assert.doesNotMatch(ui, /function\s+getItemAncientCount\s*\(/);
  assert.match(ui, /var\s+ancientFilterSelect\s*=\s*\$id\('inv-ancient-filter'\);/);
  assert.match(ui, /filterAncient\s*!==\s*''/);

  // 5. 驗證 js/ui.js 排序模式按鈕點擊循環邏輯
  assert.match(ui, /var\s+INV_SORT_MODES\s*=\s*\[/);
  assert.match(ui, /key:\s*'level'/);
  assert.match(ui, /key:\s*'ancient'/);
  assert.match(ui, /key:\s*'rarity'/);
  assert.match(ui, /sendUiCommand\('player\.setInvSort'/);
});
