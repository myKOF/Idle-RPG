const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  context.window = context;
  context.UI = { dirty: { forge: false } };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/player.js', 'js/forge.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('神鑄在 0 轉達到 1000 級後永久開放，轉生後不會關閉', () => {
  const context = loadContext();
  context.G = context.newGameState();
  context.G.player.level = context.FORGE_UNLOCK_LEVEL;

  assert.equal(context.forgeUnlocked(), true);
  assert.equal(context.G.forge.unlocked, true);

  context.G.player.reincarnations = 1;
  context.G.player.level = 1;
  assert.equal(context.forgeUnlocked(), true);
});

test('未曾在 0 轉達到門檻的轉生存檔仍維持鎖定', () => {
  const context = loadContext();
  context.G = context.newGameState();
  context.G.player.reincarnations = 1;
  context.G.player.level = context.FORGE_UNLOCK_LEVEL;

  assert.equal(context.forgeUnlocked(), false);
  assert.equal(context.G.forge.unlocked, false);
});

test('舊存檔已有開放通知時會遷移為永久開放', () => {
  const context = loadContext();
  context.G = context.newGameState();
  delete context.G.forge.unlocked;
  context.G.forge.unlockNotified = true;
  assert.equal(context.forgeUnlocked(), true);
  assert.equal(context.G.forge.unlocked, true);
});
