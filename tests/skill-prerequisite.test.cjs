const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadContext() {
  const context = {
    console,
    Math: Object.create(Math),
    UI: { dirty: {} },
    blog() {},
    fmt(value) { return String(value); }
  };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/status.js', 'js/formula.js', 'js/battlefield.js', 'js/skills.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.G = {
    player: {
      level: 1,
      reincarnations: 0,
      skillPointBudget: 100,
      skillPoints: 100,
      gold: 1e12,
      skills: {},
      skillUnlocks: {},
      fusions: [],
      loadout: []
    }
  };
  return context;
}

test('所有技能取消前置投入點數限制', () => {
  const c = loadContext();
  const ids = Object.keys(c.SKILLS);
  assert.ok(ids.length > 0);

  for (const id of ids) {
    assert.equal(c.tierLockReason(id), null, `${id} 不應有前置點數鎖定`);
  }

  const laterSkill = ids.find((id) => c.skillTier(id) > 0);
  assert.ok(laterSkill, '應存在可驗證的後段技能');
  c.G.player.level = Math.max(...ids.map((id) => c.skillUnlockLevel(id)));
  assert.equal(c.learnOrUpgradeSkill(laterSkill), null, '未投入同系前段點數也應可學習後段技能');
  assert.equal(c.skillLevel(laterSkill), 1);
});

test('技能樹不再顯示前置投入點數門檻', () => {
  const ui = fs.readFileSync(path.join(root, 'js', 'ui.js'), 'utf8');
  const applyParams = fs.readFileSync(path.join(root, 'tools', 'apply_params.cjs'), 'utf8');
  const paramsCsv = fs.readFileSync(path.join(root, 'config', 'CSV', 'game_parameters.csv'), 'utf8');
  assert.doesNotMatch(ui, /需投入 .*TIER_GATE_POINTS/);
  assert.doesNotMatch(applyParams, /TIER_GATE_POINTS/);
  assert.doesNotMatch(paramsCsv, /技能樹門檻/);
});
