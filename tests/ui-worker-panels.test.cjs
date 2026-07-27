'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');

function functionBody(name) {
  const start = ui.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'missing function ' + name);
  const open = ui.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < ui.length; i++) {
    if (ui[i] === '{') depth++;
    if (ui[i] === '}' && --depth === 0) return ui.slice(start, i + 1);
  }
  assert.fail('unterminated function ' + name);
}

test('寶石頁由 Worker panel 投影渲染並以 Command 修改狀態', () => {
  const renderGems = functionBody('renderGems');
  const renderShop = functionBody('renderGemShop');
  const countdown = functionBody('updateShopCountdown');

  assert.match(ui, /gems:\s*\['gems', 'header'\]/);
  assert.match(renderGems, /uiGemsPanelSnapshot\(\)/);
  assert.match(renderGems, /gemsViewCount\(gemsSnapshot,/);
  assert.doesNotMatch(renderShop, /\b(?:gemShop|rollGemShop|shopHourlyReset)\(/);
  assert.doesNotMatch(countdown, /\b(?:gemShop|shopHourlyReset)\(/);

  for (const command of [
    'gem.compose', 'gem.composeAll', 'gem.convert', 'gem.dismantle',
    'gem.dismantleAll', 'gem.dismantleFused', 'gem.fuse',
    'gem.shopBuy', 'gem.shopBuyAll', 'gem.shopRefresh', 'gem.shopUpgrade'
  ]) {
    assert.match(ui, new RegExp("sendGemUiCommand\\(\\s*'" + command.replace('.', '\\.') + "'"));
  }
});
