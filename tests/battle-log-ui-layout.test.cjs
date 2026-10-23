const assert = require('node:assert/strict');
const { readExpanded } = require('./helpers/str-expand.cjs');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('戰況資訊按鈕點擊直接開啟統計面板，統計面板寬度加倍', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  const ui = readExpanded(path.join(root, 'js', 'ui.js'));
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

  // 1. 戰鬥區域右上角戰況資訊按鈕
  assert.match(html, /id="btn-battle-info"[^>]*data-tt-title="戰況資訊"/);

  // 2. 統計面板寬度加寬1倍（由 440px 加寬為 880px）
  assert.match(html, /id="summary-modal-box"[^>]*width:min\(880px,\s*94vw\)/);
  assert.match(css, /#summary-modal\s+(?:#summary-modal-box|\.modal-box)\s*\{[^}]*width:\s*min\(880px,\s*94vw\);/);
  assert.match(ui, /var boxW = box\.offsetWidth \|\| 880;/);

  // 3. 戰況資訊點擊直接切換統計面板
  assert.match(ui, /infoBtn\.addEventListener\('click',\s*toggleStatsPanel\);/);
});

test('統計面板左上角包含「詳細日誌」按鈕，點擊後打開詳細戰鬥日誌', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  const ui = readExpanded(path.join(root, 'js', 'ui.js'));
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

  // 1. 統計面板內存在詳細日誌按鈕
  assert.match(html, /id="btn-summary-detail-log"[^>]*>詳細日誌<\/button>/);
  assert.match(css, /#btn-summary-detail-log\s*\{[^}]*position:\s*absolute;[^}]*left:\s*10px;/);

  // 2. 點擊詳細日誌按鈕呼叫 openDetailLog 打開詳細戰鬥日誌
  assert.match(ui, /summaryDetailLogBtn\.addEventListener\('click',\s*openDetailLog\);/);
  assert.match(ui, /detailLogModal\.style\.display\s*=\s*'flex';/);
});

test('戰鬥區右側抽屜面版已移除且不顯示舊紀錄面版', () => {
  const html = readExpanded(path.join(root, 'index.html'));
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');

  // 1. 原戰況抽屜 DOM 已自 HTML 中移除
  assert.doesNotMatch(html, /id="battle-info-drawer"/);

  // 2. 原戰鬥區下側/右側紀錄面版已在 CSS 中隱藏
  assert.match(css, /#battle-area\s*>\s*\.log-header,\s*#battle-area\s*>\s*#battle-log\s*\{[^}]*display:\s*none\s*!important;/);
});
