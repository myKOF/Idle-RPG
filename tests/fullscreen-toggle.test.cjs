const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('全螢幕按鈕區分網頁全螢幕與瀏覽器 F11 全螢幕', () => {
  assert.match(ui, /function isBrowserFullscreen\(\)/);
  assert.match(ui, /window\.fullScreen/);
  assert.match(ui, /window\.outerHeight\s*>=\s*screenObj\.height/);
  assert.match(ui, /document\.fullscreenElement/);
  assert.match(ui, /目前為瀏覽器 F11 全螢幕，請按 F11 返回/);
});

test('全螢幕按鈕保留網頁全螢幕退出邏輯並避免 F11 時重複 requestFullscreen', () => {
  assert.match(ui, /if \(document\.fullscreenElement\)\s*\{[\s\S]*?document\.exitFullscreen\(\)/);
  assert.match(ui, /else if \(isBrowserFullscreen\(\)\)/);
  assert.match(ui, /document\.documentElement\.requestFullscreen\(\)/);
  assert.match(index, /id="btn-fullscreen"/);
});
