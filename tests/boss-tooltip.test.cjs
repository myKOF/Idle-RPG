const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('BOSS對戰及高塔結果結算界面具備屬性提示按鈕', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  // 確保對戰面板的 BOSS 欄位有提示按鈕
  assert.match(html, /id="btn-boss-tip"\s+class="info-btn"/);
  // 確保結算彈窗有相對定位和提示按鈕
  assert.match(html, /id="tower-result-modal"[\s\S]*position:relative;[^"]*">/);
  assert.match(html, /id="btn-tower-result-boss-tip"\s+class="info-btn"/);

  // 確保 UI 邏輯有綁定對應的事件處理
  assert.match(ui, /id === 'btn-boss-tip' \|\| anchorEl\.id === 'btn-tower-result-boss-tip'/);
  assert.match(ui, /TOWER\.boss \|\| \(TOWER\.floor \? makeBoss\(TOWER\.floor\) : null\)/);
  assert.match(ui, /e\.target\.closest\('#btn-enemy-tip'\) \|\| e\.target\.closest\('#btn-boss-tip'\) \|\| e\.target\.closest\('#btn-tower-result-boss-tip'\)/);
});
