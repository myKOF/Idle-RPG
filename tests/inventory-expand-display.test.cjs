const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('背包擴充費用顯示金額後接金幣圖示，不再追加 G', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(html, /id="inv-expand"[^>]*>[^<]*擴充 \(10000<img src="images\/icon_gold\.png" class="res-icon">\)/);
  assert.match(ui, /btn\.innerHTML = '➕ 擴充 \(' \+ fmt\(inventoryExpandCost\(G\.player\.invUpgrades \|\| 0\)\) \+ '<img src="images\/icon_gold\.png" class="res-icon">\)'/);
  assert.doesNotMatch(ui, /btn\.textContent = '➕ 擴充 \(' \+ fmt\(inventoryExpandCost/);
});
