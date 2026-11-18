const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const display = fs.readFileSync(path.join(root, 'js/display-settings-ui.js'), 'utf8');

test('頂欄移除全螢幕按鈕，內測資訊仍插在版本更新提示前', () => {
  const topbar = index.match(/<header id="topbar"[\s\S]*?<\/header>/)[0];
  assert.doesNotMatch(topbar, /\bbtn-fullscreen\b/);
  assert.doesNotMatch(ui, /\bbtn-fullscreen\b/);
  assert.match(topbar, /class="brand-sub"[^>]*><\/span>\s*<button id="update-banner"/);
  assert.match(ui, /var updateBanner = \$id\('update-banner'\);[\s\S]*?updateBanner\.before\(wrap\)/);
});

test('顯示設定與戰鬥工具列仍提供各自的全螢幕控制', () => {
  assert.match(index, /name="display-mode" value="fullscreen"/);
  assert.match(index, /name="display-mode" value="windowed"/);
  assert.match(display, /document\.documentElement\.requestFullscreen\(\)/);
  assert.match(display, /document\.exitFullscreen\(\)/);
  assert.match(index, /id="btn-battle-fullscreen"/);
});
