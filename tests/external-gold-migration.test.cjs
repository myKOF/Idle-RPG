const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadSaveContext() {
  const context = {
    console, Math, Date,
    window: {},
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {},
      key() { return null; },
      length: 0
    }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('既有帳號首次刷新時依 sqrt(gold) * 10000 回收金幣', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.externalGoldRecoveryV1;
  state.player.gold = 2e16;

  context.migrateSave(state);

  assert.equal(state.player.gold, Math.sqrt(2e16) * 10000);
  assert.equal(state.externalGoldRecoveryV1, true);
});

test('金幣回收旗標使刷新後不會重複處理', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.externalGoldRecoveryV1;
  state.player.gold = 2e16;

  context.migrateSave(state);
  const first = state.player.gold;
  context.migrateSave(state);

  assert.equal(state.player.gold, first);
});

test('金幣未超過 10^16 時不回收，但仍標記為已處理', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  delete state.externalGoldRecoveryV1;
  state.player.gold = 1e16;

  context.migrateSave(state);

  assert.equal(state.player.gold, 1e16);
  assert.equal(state.externalGoldRecoveryV1, true);
  context.migrateSave(state);
  assert.equal(state.player.gold, 1e16);
});

test('新建立帳號預設帶有完成旗標，不套用既有帳號回收', () => {
  const context = loadSaveContext();
  const state = context.newGameState();

  context.migrateSave(state);

  assert.equal(state.externalGoldRecoveryV1, true);
  assert.equal(state.player.gold, 50);
});
