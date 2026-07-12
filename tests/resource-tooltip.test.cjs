const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('金幣與材料提示使用完整數值，寶石與附魔書提示維持原格式', () => {
  const context = { console, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/util.js'), 'utf8'), context);
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');

  assert.equal(context.fmtFull(3700000000), '3,700,000,000');
  assert.match(ui, /updateResourceTip\('r-gold',[\s\S]*fmtFull\(p\.gold\)/);
  assert.match(ui, /updateResourceTip\('r-ancient-essence',[\s\S]*fmtFull\(p\.ancientEssence/);
  assert.match(ui, /updateResourceTip\('r-gems', '寶石', gemTip/);
  assert.match(ui, /updateResourceTip\('r-books', '附魔書', bookTip/);
  assert.match(ui, /refreshOpenResourceTooltip\(\);/);
  assert.match(ui, /UI\.tooltipAnchor = anchorEl/);
  assert.match(ui, /anchorEl\.classList\.contains\('res'\)/);
});
