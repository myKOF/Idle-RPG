const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('高塔倒數固定寬度，DPS 資訊不會隨計時文字左右跳動', () => {
  const root = path.resolve(__dirname, '..');
  const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  const timer = css.match(/\.tw-timer\s*\{([^}]*)\}/s);
  const dps = css.match(/\.tower-head #tw-dps\s*\{([^}]*)\}/s);
  assert.ok(timer, '找不到高塔計時樣式');
  assert.ok(dps, '找不到高塔 DPS 資訊樣式');
  assert.match(timer[1], /flex:\s*0 0 72px/);
  assert.match(timer[1], /text-align:\s*right/);
  assert.match(dps[1], /margin-left:\s*16px/);
});

test('高塔倒數使用逐幀插值，避免只隨 UI 迴圈跳動', () => {
  const root = path.resolve(__dirname, '..');
  const uiJs = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(uiJs, /function renderTowerTimerFrame\(\)/);
  assert.match(uiJs, /towerTimerAnchor/);
  assert.match(uiJs, /performance\.now\(\)/);
  assert.match(uiJs, /requestAnimationFrame\(renderTowerTimerFrame\)/);
  assert.match(uiJs, /cancelAnimationFrame\(UI\.towerTimerRaf\)/);
  assert.match(uiJs, /function formatTowerTimerSeconds\(seconds\)/);
  assert.match(uiJs, /formatTowerTimerSeconds\(remain\)/);
  assert.match(uiJs, /toFixed\(1\)/);
});
