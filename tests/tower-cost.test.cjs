const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('高塔 BOSS 挑戰費用使用 CSV 的三段樓層公式', () => {
  const context = { console, Math };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/data.js'), 'utf8'), context, { filename: 'js/data.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'js/formula.js'), 'utf8'), context, { filename: 'js/formula.js' });

  // CSV: config/CSV/game_parameters.csv:112。
  assert.equal(context.towerChallengeCost(1), Math.round(10000 * Math.pow(1, 1.8)));
  assert.equal(context.towerChallengeCost(50), Math.round(10000 * Math.pow(50, 1.8)));
  assert.equal(context.towerChallengeCost(51), Math.round(50000 * Math.pow(51, 2)));
  assert.equal(context.towerChallengeCost(100), Math.round(50000 * Math.pow(100, 2)));
  assert.equal(context.towerChallengeCost(101), Math.round(100000 * Math.pow(101, 2.2)));
  assert.equal(context.towerChallengeCost(150), Math.round(100000 * Math.pow(150, 2.2)));
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /【挑戰費用】/);
  assert.doesNotMatch(ui, /100000 × 樓層\^2\.6/);
});
