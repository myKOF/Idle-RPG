const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGameContext() {
  const root = path.resolve(__dirname, '..');
  const context = {
    console,
    setTimeout() {},
    clearTimeout() {},
    document: { addEventListener() {} },
    UI: { dirty: {} },
    GT: 0,
    RUN_STATS: { skills: {} },
    blog() {},
    floatText() {},
    trackDps() {},
    recordRunDamage() {}
  };
  context.window = context;
  vm.createContext(context);

  ['js/util.js', 'js/data.js', 'js/formula.js', 'js/combat.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });

  context.G = {
    player: {
      level: 1,
      skills: { timeWarp: 1, treasureSense: 1 },
      loadout: ['timeWarp', 'treasureSense'],
      fusions: []
    }
  };
  context.getStats = () => ({
    cdr: 60,
    castSpeed: 50,
    hp: 1000,
    mp: 1000,
    atk: 100,
    matk: 100,
    aoeDmg: 0
  });

  return context;
}

function playerEntity() {
  return {
    hp: 1000,
    mp: 1000,
    shield: 0,
    atkCd: 0,
    skillCds: {},
    buffs: {},
    dots: [],
    effects: {}
  };
}

test('skill global cooldown prevents casting another skill for a fixed 0.4 seconds', () => {
  const context = loadGameContext();
  const player = playerEntity();

  const first = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(first && typeof first, 'object');
  assert.equal(player.skillGcd, 0.4);
  assert.equal(player.skillCds.timeWarp, 8);

  const blocked = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(blocked, null);
  assert.equal(player.skillCds.treasureSense || 0, 0);

  context.tickSkillCds(player, 0.39);
  assert.ok(player.skillGcd > 0);
  assert.equal(context.pickAndCastSkill(player, null, 'float-layer'), null);

  context.tickSkillCds(player, 0.01);
  assert.equal(player.skillGcd, 0);
  const second = context.pickAndCastSkill(player, null, 'float-layer');
  assert.equal(second && typeof second, 'object');
  assert.equal(player.skillGcd, 0.4);
  assert.equal(player.skillCds.treasureSense, 12);
});
