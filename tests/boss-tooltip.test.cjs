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

test('野外怪物閃避率公式串接驗證', () => {
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');

  // 確保 monsterStatsFor 內部的 dodge 使用公式並與 params 對接
  assert.match(formula, /dodge:\s*\d+\s*\+\s*stage\s*\*\s*\d+/);
  assert.match(formula, /m\.dodge\s*\+=\s*\d+/);

  // 確保 apply_params.cjs 有對接 4-野外怪物 閃避率 及 菁英閃避累加 規則
  assert.match(applyParams, /怪物閃避-a/);
  assert.match(applyParams, /怪物閃避-b/);
  assert.match(applyParams, /m\.dodge \+=/);
});
