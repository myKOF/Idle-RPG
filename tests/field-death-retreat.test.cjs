const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadCombatContext() {
  const logs = [];
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog(message) { logs.push(message); },
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.logs = logs;
  return context;
}

function prepareDeathState(context, stage) {
  context.G = {
    player: { gold: 0 },
    stage: { current: stage, best: 80, kills: 7, autoAdvance: true },
    tower: { active: false }
  };
  context.FIELD.monster = { name: '測試怪' };
  context.FIELD.monsters = [{ name: '測試怪' }];
  context.FIELD.reviveCd = 0;
  context.RUN_STATS.maxStage = stage;
}

test('野外死亡後退 10 關繼續，歷史最高階段不重置', () => {
  const context = loadCombatContext();
  prepareDeathState(context, 35);

  context.onPlayerFieldDeath();

  assert.equal(context.G.stage.current, 25);
  assert.equal(context.G.stage.best, 80);
  assert.equal(context.G.stage.kills, 0);
  assert.equal(context.FIELD.monster, null);
  assert.equal(context.FIELD.monsters.length, 0);
  assert.equal(context.FIELD.reviveCd, context.REVIVE_DELAY);
  assert.equal(context.RUN_STATS.maxStage, 25);
  assert.match(context.logs.join('\n'), /退回第 25 階段/);
});

test('野外死亡回退最低只到第 1 關', () => {
  const context = loadCombatContext();
  prepareDeathState(context, 8);

  context.onPlayerFieldDeath();

  assert.equal(context.G.stage.current, 1);
  assert.equal(context.G.stage.best, 80);
  assert.equal(context.RUN_STATS.maxStage, 1);
  assert.match(context.logs.join('\n'), /退回第 1 階段/);
});
