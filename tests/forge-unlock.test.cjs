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

test('需同時滿足等級與轉生次數才開放，開放後永久保留', () => {
  const context = loadContext();
  context.G = context.newGameState();
  context.G.player.level = context.FORGE_UNLOCK_LEVEL;
  context.G.player.reincarnations = context.FORGE_UNLOCK_REINCARNATION;

  assert.equal(context.forgeUnlocked(), true);
  assert.equal(context.G.forge.unlocked, true);

  // 永久保留：即使之後等級與轉生次數皆降到門檻以下，仍維持開放。
  context.G.player.level = 1;
  context.G.player.reincarnations = 0;
  assert.equal(context.forgeUnlocked(), true);
});

test('只滿足其中一個條件時維持鎖定', () => {
  // 轉生次數達標、等級不足 → 鎖定
  const c1 = loadContext();
  c1.G = c1.newGameState();
  c1.G.player.reincarnations = c1.FORGE_UNLOCK_REINCARNATION;
  c1.G.player.level = Math.max(0, c1.FORGE_UNLOCK_LEVEL - 1);
  assert.equal(c1.forgeUnlocked(), false);
  assert.equal(c1.G.forge.unlocked, false);

  // 等級達標、轉生次數不足 → 鎖定
  const c2 = loadContext();
  c2.G = c2.newGameState();
  c2.G.player.level = c2.FORGE_UNLOCK_LEVEL;
  c2.G.player.reincarnations = Math.max(0, c2.FORGE_UNLOCK_REINCARNATION - 1);
  assert.equal(c2.forgeUnlocked(), false);
  assert.equal(c2.G.forge.unlocked, false);
});

test('舊存檔已有開放通知時會遷移為永久開放', () => {
  const context = loadContext();
  context.G = context.newGameState();
  delete context.G.forge.unlocked;
  context.G.forge.unlockNotified = true;
  assert.equal(context.forgeUnlocked(), true);
  assert.equal(context.G.forge.unlocked, true);
});
