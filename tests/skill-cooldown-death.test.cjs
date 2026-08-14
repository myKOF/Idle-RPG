const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function assertClose(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be close to ${expected}`);
}

function loadCombatContext() {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    document: { getElementById() { return null; } }
  };
  context.window = context;
  vm.createContext(context);
  [
    'js/util.js',
    'js/data.js',
    'js/status.js',
    'js/formula.js',
    'js/battlefield.js',
    'js/skills.js',
    'js/combat.js'
  ].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('角色死亡期間技能冷卻持續遞減，復活時不回到死亡瞬間的舊值', () => {
  const context = loadCombatContext();
  context.G = {
    player: { loadout: [] },
    stage: { current: 10, best: 10, kills: 0, autoAdvance: true },
    tower: { active: false }
  };
  context.getStats = () => ({ hp: 100, mp: 100, aspd: 1 });
  context.FIELD.player = context.newPlayerEntity({ hp: 0, mp: 0, aspd: 1 });
  context.FIELD.player.skillCds = { 'sg:thrust': 4.4, 'potential:chronoPilfer': 2.2 };
  context.FIELD.reviveCd = 5;
  context.FIELD.despawnCd = 0;

  context.fieldTick(1);
  assertClose(context.FIELD.player.skillCds['sg:thrust'], 3.4);
  assertClose(context.FIELD.player.skillCds['potential:chronoPilfer'], 1.2);
  assert.equal(context.FIELD.reviveCd, 4);

  context.fieldTick(3);
  assertClose(context.FIELD.player.skillCds['sg:thrust'], 0.4);
  assert.equal(context.FIELD.player.skillCds['potential:chronoPilfer'], 0);
  assert.equal(context.FIELD.reviveCd, 1);

  context.fieldTick(1);
  assert.equal(context.FIELD.reviveCd, 0);
  assert.equal(context.FIELD.player.skillCds['sg:thrust'], 0);
  assert.equal(context.FIELD.player.skillCds['potential:chronoPilfer'], 0);
  assert.equal(context.FIELD.player.hp, 100);
});
