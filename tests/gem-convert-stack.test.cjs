const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    UI: { dirty: {} },
    G: { player: { gold: 0, gems: { ruby: { 1: 1000 }, opal: { 1: 0 } } } }
  };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/item.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { gold: 0, gems: { ruby: { 1: 1000 }, opal: { 1: 0 } } } };
  return context;
}

test('寶石九宮格每格上限為 1000 顆', () => {
  const context = loadContext();
  assert.equal(context.GEM_CONVERT_STACK, 1000);
  assert.equal(context.convertGems([{ type: 'ruby', lv: 1, n: 1000 }], 'opal'), null);
  assert.equal(context.G.player.gems.ruby[1], 0);
  assert.equal(context.G.player.gems.opal[1], 1000);
  assert.match(context.convertGems([{ type: 'ruby', lv: 1, n: 1001 }], 'opal'), /每格 1~1000 顆/);
});
