const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math, Date };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/util.js', 'js/data.js', 'js/formula.js', 'js/player.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return context;
}

test('新遊戲預設資源為 5 萬金幣、500 裝備碎片、100 附魔精華', () => {
  const state = loadContext().newGameState();

  assert.equal(state.player.gold, 50000);
  assert.equal(state.player.scrap, 500);
  assert.equal(state.player.essence, 100);
});

test('初始資源已登錄於遊戲參數表', () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'config/CSV/game_parameters.csv'), 'utf8');
  assert.match(csv, /355,0,0-遊戲預設,開場金幣,a,[^\n]*,50000,/);
  assert.match(csv, /356,0,0-遊戲預設,開場裝備碎片,a,[^\n]*,500,/);
  assert.match(csv, /357,0,0-遊戲預設,開場附魔精華,a,[^\n]*,100,/);
});
