const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('神鑄失敗補償固定增加 1 個魔塵並刷新神鑄與資源 UI', () => {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    G: { player: { dust: 4 } },
    UI: { dirty: { header: false, forge: false } }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/forge.js'), 'utf8'), context, { filename: 'js/forge.js' });

  context.forgeFailureReward();
  assert.equal(context.G.player.dust, 5);
  assert.equal(context.UI.dirty.header, true);
  assert.equal(context.UI.dirty.forge, true);
});
