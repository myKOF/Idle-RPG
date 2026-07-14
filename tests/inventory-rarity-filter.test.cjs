const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('背包品質篩選功能介面與邏輯驗證', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  // 1. 驗證 index.html 中有品質篩選 dropdown 且包含指定的品質選項
  assert.match(html, /id="inv-rarity-filter"/);
  assert.match(html, /<option[^>]*>取消篩選<\/option>/);
  assert.match(html, /value="0"[^>]*>普通<\/option>/);
  assert.match(html, /value="1"[^>]*>精良<\/option>/);
  assert.match(html, /value="2"[^>]*>稀有<\/option>/);
  assert.match(html, /value="3"[^>]*>獨特<\/option>/);
  assert.match(html, /value="4"[^>]*>史詩<\/option>/);
  assert.match(html, /value="5"[^>]*>傳說<\/option>/);
  assert.match(html, /value="6"[^>]*>神話<\/option>/);
  assert.match(html, /value="7"[^>]*>創世<\/option>/);
  assert.match(html, /value="8"[^>]*>神鑄創世<\/option>/);

  // 2. 驗證 js/ui.js 中有讀取篩選下拉選單並過濾裝備顯示的邏輯
  assert.match(ui, /var\s+filterSelect\s*=\s*\$id\('inv-rarity-filter'\);/);
  assert.match(ui, /var\s+filterRarity\s*=\s*filterSelect\s*\?\s*filterSelect\.value\s*:\s*'';/);
  assert.match(ui, /G\.inventory\.filter/);

  // 3. 驗證 js/ui.js 中有監聽篩選變更並重繪背包的事件監聽器
  assert.match(ui, /var\s+rarityFilter\s*=\s*\$id\('inv-rarity-filter'\);/);
  assert.match(ui, /rarityFilter\.addEventListener\('change',\s*function\s*\(\)\s*\{/);
});
