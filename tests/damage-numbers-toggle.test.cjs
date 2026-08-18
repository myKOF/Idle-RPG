'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('傷害數字開關按鈕 DOM 與 CSS 定義完整', function () {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

  // index.html 包含 #btn-toggle-damage 且有開眼與閉眼圖示及提示屬性
  assert.match(html, /id="btn-toggle-damage"/);
  assert.match(html, /data-tt-title="傷害數字"/);
  assert.match(html, /icon-eye-open/);
  assert.match(html, /icon-eye-closed/);

  // css/style.css 定義了 #btn-toggle-damage 的定位、樣式與 is-off 狀態
  assert.match(css, /#btn-toggle-damage\s*\{/);
  assert.match(css, /#btn-toggle-damage\.is-off/);
  assert.match(css, /body\.battle-canvas-mode #combat-area \.battle-scene-wrapper > #btn-toggle-damage/);
});

test('UI 與戰鬥渲染器包含傷害數字開關邏輯與清除函式', function () {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');

  // ui.js 中定義開關變數與切換/清除函式
  assert.match(ui, /var UI_DAMAGE_NUMBERS_ENABLED/);
  assert.match(ui, /function isDamageNumbersEnabled\s*\(\)/);
  assert.match(ui, /function setDamageNumbersEnabled\s*\(/);
  assert.match(ui, /function updateDamageToggleButton\s*\(\)/);
  assert.match(ui, /function clearActiveDamageFloats\s*\(\)/);

  // floatText 中包含傷害數字關閉檢查
  assert.match(ui, /if \(!isDamageNumbersEnabled\(\)\)/);

  // battle-renderer.js 導出 clearDamageFloats / clearAllFloats 並於 onFloat 檢查 isDamageNumbersEnabled
  assert.match(renderer, /clearDamageFloats:\s*clearDamageFloats/);
  assert.match(renderer, /clearAllFloats:\s*clearAllFloats/);
  assert.match(renderer, /if \(typeof isDamageNumbersEnabled === 'function' && !isDamageNumbersEnabled\(\)\) return;/);
});
