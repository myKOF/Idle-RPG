const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('高塔 BOSS 挑戰費用使用樓層 2.6 次方公式', () => {
  const context = { console, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context, { filename: 'js/data.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8'), context, { filename: 'js/formula.js' });

  assert.equal(context.towerChallengeCost(1), 100000);
  assert.equal(context.towerChallengeCost(2), Math.round(100000 * Math.pow(2, 2.6)));
  assert.equal(context.towerChallengeCost(10), Math.round(100000 * Math.pow(10, 2.6)));
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /【挑戰費用】/);
  assert.doesNotMatch(ui, /100000 × 樓層\^2\.6/);
});
