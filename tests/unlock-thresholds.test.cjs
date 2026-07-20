const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/player.js', 'js/forge.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.reincarnationCount = () => Number(context.G.player.reincarnations || 0);
  return context;
}

const saveSource = fs.readFileSync(path.join(__dirname, '..', 'js', 'save.js'), 'utf8');

test('裝備套裝依序在 Lv.1、Lv.500、Lv.2000 開放', () => {
  const context = loadContext();
  context.G = { player: { level: 499, reincarnations: 0 } };
  assert.equal(context.equipmentSetUnlocked(0), true);
  assert.equal(context.equipmentSetUnlocked(1), false);
  assert.equal(context.equipmentSetUnlocked(2), false);

  context.G.player.level = 500;
  assert.equal(context.equipmentSetUnlocked(1), true);
  assert.equal(context.equipmentSetUnlocked(2), false);

  context.G.player.level = 2000;
  assert.equal(context.equipmentSetUnlocked(2), true);
  assert.equal(context.equipmentSetUnlockedAtLevel(1, 500), true);
  assert.equal(context.equipmentSetUnlockedAtLevel(2, 500), false);
  assert.match(saveSource, /equipmentSetUnlockedAtLevel/);
  assert.doesNotMatch(saveSource, /data\.player\.level\s*<\s*2000/);
});

test('神鑄需達 Lv.2000 且 1 轉，開放後永久保留', () => {
  const context = loadContext();
  context.G = { player: { level: 1, reincarnations: 1 }, forge: { unlocked: false } };
  assert.equal(context.forgeUnlocked(), false);

  context.G.player.level = 2000;
  assert.equal(context.forgeUnlocked(), true);

  context.G.player.level = 1;
  context.G.player.reincarnations = 0;
  assert.equal(context.forgeUnlocked(), true);
});
