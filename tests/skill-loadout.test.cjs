const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = { player: { level: 1 } };
  return context;
}

test('未轉生玩家技能裝載欄依等級成長與上限計算', () => {
  const context = loadFormulaContext();
  context.G.player.level = 1;
  assert.equal(context.loadoutSize(), 4);
  context.G.player.level = 49;
  assert.equal(context.loadoutSize(), 4);
  context.G.player.level = 50;
  assert.equal(context.loadoutSize(), 5);
  context.G.player.level = 99;
  assert.equal(context.loadoutSize(), 5);
  context.G.player.level = 100;
  assert.equal(context.loadoutSize(), 6);
  context.G.player.level = 200;
  assert.equal(context.loadoutSize(), 8);
  context.G.player.level = 250;
  assert.equal(context.loadoutSize(), 9);
  context.G.player.level = 9999;
  assert.equal(context.loadoutSize(), 20);
});

test('1 轉以上玩家不論等級皆解鎖全數 20 格裝載欄位', () => {
  const context = loadFormulaContext();
  context.reincarnationCount = () => 1;
  context.G.player.level = 1;
  assert.equal(context.loadoutSize(), 20);
});
