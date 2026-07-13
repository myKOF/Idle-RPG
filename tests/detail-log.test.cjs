const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('綜合紀錄提供詳細日誌按鈕與獨立長條視窗', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /id="btn-detail-log"/);
  assert.match(html, /id="detail-log-modal"/);
  assert.match(html, /id="detail-log-content"/);
  assert.match(html, /id="detail-log-filter"/);
});

test('詳細日誌保留時間、分類與較長歷史，且可清除', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  assert.match(ui, /var DETAIL_LOG_CAP = 500/);
  assert.match(ui, /DETAIL_LOG_HISTORY\.unshift/);
  assert.match(ui, /detail-log-time/);
  assert.match(ui, /DETAIL_LOG_HISTORY\.length = 0/);
  assert.match(ui, /detailLogFilter\.addEventListener\('change', renderDetailLog\)/);
});

test('詳細日誌使用現有分類，不改變原本小型日誌篩選', () => {
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.detail-log-modal\s*\{/);
  assert.match(css, /\.detail-log-content\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.log-header-actions\s*\{/);
});
