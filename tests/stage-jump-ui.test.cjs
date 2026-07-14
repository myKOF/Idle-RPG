const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('階段列提供直達最高按鈕並將最高資訊放在其右側', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(html, /id="st-max"[^>]*>⏭/);
  assert.match(html, /id="st-max"[\s\S]*id="stage-best"/);
  assert.match(ui, /\$id\('st-max'\)\.addEventListener\('click',[\s\S]*stageGoMax\(\)/);
});

test('階段前進與後退按鈕提供提示並支援長按快速切換', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.match(html, /id="st-prev"[^>]*data-tip="後退關卡&lt;br&gt;鼠標按住可以快速後退"/);
  assert.match(html, /id="st-next"[^>]*data-tip="前進關卡&lt;br&gt;鼠標按住可以快速前進"/);
  assert.match(html, /id="st-prev"[^>]*data-tip-placement="stage-left"/);
  assert.match(html, /id="st-next"[^>]*data-tip-placement="stage-right"/);
  assert.match(ui, /var STAGE_HOLD_REPEAT_MS = 50;/);
  assert.match(ui, /function refreshStageDisplay\(\)/);
  assert.match(ui, /function stepStageButton\(delta\)[\s\S]*stageGo\(delta\);[\s\S]*refreshStageDisplay\(\);/);
  assert.match(ui, /btn\.addEventListener\('click',[\s\S]*stepStageButton\(delta\);/);
  assert.match(ui, /function bindStageHoldButton\(id, delta\)/);
  assert.match(ui, /bindStageHoldButton\('st-prev', -1\);/);
  assert.match(ui, /bindStageHoldButton\('st-next', 1\);/);
});

test('階段按鈕提示支援外側定位，避免蓋住階段文字', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /var placement = anchorEl\.getAttribute\('data-tip-placement'\);/);
  assert.match(ui, /if \(placement === 'stage-left'\)[\s\S]*x = r\.left - tw - 10/);
  assert.match(ui, /else if \(placement === 'stage-right'\)[\s\S]*x = r\.right \+ 10/);
});
