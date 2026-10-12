'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const styleCss = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

test('彈窗關閉按鈕 .modal-x 層級與觸碰範圍防遮擋驗證', () => {
  // 1. .modal-x 必須具有大於 0 的明確 z-index（避免被 .sec-title 等 relative/auto 兄弟標題元素遮蓋）
  const modalXBlockMatch = styleCss.match(/\n\.modal-x\s*\{([^}]+)\}/);
  assert.ok(modalXBlockMatch, '必須存在 .modal-x 基礎樣式規則');
  const modalXCss = modalXBlockMatch[1];
  assert.match(modalXCss, /z-index:\s*(?:10|[1-9]\d+);/, '.modal-x 必須定義足夠高的 z-index (>= 10)');
  assert.match(modalXCss, /cursor:\s*pointer;/, '.modal-x 必須具有 pointer 指標');

  // 2. .modal-x::before 必須存在且具有觸控/點擊熱區擴展
  assert.match(
    styleCss,
    /\.modal-x::before\s*\{[^}]*position:\s*absolute;[^}]*(?:inset:\s*-[1-9]\d*px|top:\s*-[1-9]\d*px)/,
    '.modal-x::before 必須提供擴展點擊範圍（hitbox）避免邊界過小難以點選'
  );

  // 3. .battle-info-drawer-head .modal-x 必須為 position: relative 以確保 ::before 範圍限制在自身內
  assert.match(
    styleCss,
    /\.battle-info-drawer-head\s+\.modal-x\s*\{[^}]*position:\s*relative;/,
    '.battle-info-drawer-head .modal-x 應設定為 position: relative 建立定位上下文'
  );
});
