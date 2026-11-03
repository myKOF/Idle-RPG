const test = require('node:test');
const { readExpanded } = require('./helpers/str-expand.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('金幣與材料提示使用完整數值，頂列不再顯示附魔書', () => {
  const context = { console, Math };
  vm.createContext(context);
  vm.runInContext(readExpanded(path.join(root, 'js/util.js')), context);
  const ui = readExpanded(path.join(root, 'js/ui.js'));

  assert.equal(context.fmtFull(3700000000), '3,700,000,000');
  assert.match(ui, /updateResourceTip\('r-gold',[\s\S]*fmtFull\(p\.gold\)/);
  assert.match(ui, /updateResourceTip\('r-ancient-essence',[\s\S]*fmtFull\(p\.ancientEssence/);
  assert.doesNotMatch(ui, /updateResourceTip\('r-gems'/);
  assert.doesNotMatch(ui, /updateResourceTip\('r-books'/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html.slice(html.indexOf('<header id="topbar">'), html.indexOf('</header>')), /r-books|icon_books|data-tt-title:102/);
  assert.match(ui, /refreshOpenResourceTooltip\(\);/);
  assert.match(ui, /UI\.tooltipAnchor = anchorEl/);
  assert.match(ui, /anchorEl\.classList\.contains\('res'\)/);
});
