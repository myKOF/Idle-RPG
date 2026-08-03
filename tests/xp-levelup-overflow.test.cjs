const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadPlayerContext() {
  const context = {
    console,
    Math,
    UI: { dirty: {} },
    FIELD: { player: null },
    blog() {}
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/player.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.computeStats = () => ({ hp: 100, mp: 50 });
  context.markStatsDirty = () => {};
  return context;
}

function loadSaveContext() {
  const context = {
    console,
    Math,
    Date,
    UI: { dirty: {} },
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
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/battlefield.js', 'js/item.js',
    'js/skills.js', 'js/player.js', 'js/save.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('一次獲得大量經驗會完整消化溢出，不會停在升級門檻以上', () => {
  const context = loadPlayerContext();
  context.G = {
    player: { level: 878, xp: 1.11e12, reincarnations: 0, reincarnationTalentPoints: 0 }
  };

  const gained = context.gainXp(1);

  assert.equal(gained, 72);
  assert.equal(context.G.player.level, 950);
  assert.ok(context.G.player.xp < context.xpForLevel(context.G.player.level));
});
test('達到最高等級時，所有剩餘經驗歸零', () => {
  const context = loadPlayerContext();
  context.G = {
    player: { level: 878, xp: 1e15, reincarnations: 0, reincarnationTalentPoints: 0 }
  };

  context.gainXp(0);

  assert.equal(context.G.player.level, context.MAX_LEVEL);
  assert.equal(context.G.player.xp, 0);
});

test('讀檔會將非數字經驗正規化，並保留合法溢出供 Worker 接管後結算', () => {
  const context = loadSaveContext();
  const state = context.newGameState();
  state.player.level = 878;
  state.player.xp = '1110000000000';

  const migrated = context.migrateSave(state);
  assert.equal(migrated.player.xp, 1.11e12);

  migrated.player.xp = 'not-a-number';
  const repaired = context.migrateSave(migrated);
  assert.equal(repaired.player.xp, 0);
});
