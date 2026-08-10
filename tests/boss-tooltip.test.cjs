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
  assert.match(ui, /var towerRuntime = towerSnapshot && towerSnapshot\.runtime[\s\S]*towerRuntime && towerRuntime\.boss/);
  assert.match(ui, /e\.target\.closest\('#btn-enemy-tip'\) \|\| e\.target\.closest\('#btn-boss-tip'\) \|\| e\.target\.closest\('#btn-tower-result-boss-tip'\)/);
});

test('野外敵人資訊提示在 Worker 模式使用 header snapshot 的關卡資料', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  const start = ui.indexOf('function showEnemyTooltip(');
  const end = ui.indexOf('\nfunction hideTooltip()', start);
  assert.ok(start >= 0 && end > start);
  const body = ui.slice(start, end);

  assert.match(body, /var headerSnapshot = uiHeaderPanelSnapshot\(\) \|\| \{\};/);
  assert.match(body, /var zoneKey = \(headerSnapshot\.stage && headerSnapshot\.stage\.zone\) \|\| 'desert';/);
  assert.match(body, /var stage = \(headerSnapshot\.stage && headerSnapshot\.stage\.current\) \|\| 1;/);
  assert.doesNotMatch(body, /\bG\.stage\b/);
});

test('野外怪物閃避率公式串接驗證', () => {
  const formula = fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools/apply_params.cjs'), 'utf8');

  // 確保 monsterStatsFor 內部的 dodge 使用公式並與 params 對接
  assert.match(formula, /dodge:\s*segmentedLevelGrowth\(FIELD_MONSTER_DODGE_BASE,\s*stage,\s*FIELD_MONSTER_DODGE_GROWTH\)/);
  /* 菁英閃避加成改讀 data.js 的具名欄位（FIELD_ELITE.dodgeAdd）。
     原本是內嵌字面值 `m.dodge += 1.5;`，套用參數表靠 numCtx 夾住那個數字改寫——
     那種錨點會被任何一次重構無聲打斷，所以整批改成綁欄位名。 */
  assert.match(formula, /m\.dodge\s*\+=\s*FIELD_ELITE\.dodgeAdd/);

  // 確保 apply_params.cjs 有對接 4-野外怪物 閃避率 及 菁英閃避累加 規則
  assert.match(applyParams, /scalar\('data',\s*'FIELD_MONSTER_DODGE_BASE',\s*'4-野外怪物',\s*'閃避率',\s*0\)/);
  assert.match(applyParams, /arrayContent\('data',\s*'FIELD_MONSTER_DODGE_GROWTH',\s*levelGrowthContent\('4-野外怪物',\s*'閃避率'\)/);
  assert.match(applyParams, /objFieldML\('data',\s*'FIELD_ELITE = \{',\s*'dodgeAdd',\s*'4-野外怪物',\s*'菁英倍率',\s*3,\s*'菁英-閃避'\)/);
});
