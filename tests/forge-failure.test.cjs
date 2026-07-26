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

test('神鑄失敗改為消耗 3 個素材並退回其餘 3 個', () => {
  const root = path.resolve(__dirname, '..');
  const dataJs = fs.readFileSync(path.join(root, 'js/data.js'), 'utf8');
  const forgeJs = fs.readFileSync(path.join(root, 'js/forge.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const formula = fs.readFileSync(path.join(root, 'game_formula.md'), 'utf8');

  assert.match(dataJs, /FORGE_FAIL_CONSUME\s*=\s*3/);
  assert.match(forgeJs, /FORGE_SLOTS\s*-\s*FORGE_FAIL_CONSUME/);
  assert.doesNotMatch(html, /神鑄.*?(?:消耗|損失) 2 件/);
  assert.match(formula, /失敗處理.*?消耗 3 件、其餘 3 件退回背包；寶石：消耗 3 顆、退回 3 顆/s);
});
