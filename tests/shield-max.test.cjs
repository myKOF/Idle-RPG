const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, Math: Object.create(Math) };
  context.Math.random = () => 0.5;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  return context;
}

test('shield max is cleared when shield is fully depleted', () => {
  const context = loadFormulaContext();
  const defender = { hp: 1000, shield: 100, shieldMax: 500 };

  context.resolveHit({}, defender, {
    atk: 200,
    dmgType: 'phys',
    level: 1,
    hit: 100,
    critRate: 0
  }, {
    def: 0,
    mdef: 0,
    dodge: 0,
    pRes: 0,
    mRes: 0,
    resist: {}
  });

  assert.equal(defender.shield, 0);
  assert.equal(defender.shieldMax, 0);
  assert.equal(defender.shieldMaxVersion, context.SHIELD_MAX_VERSION);
  assert.equal(defender.shieldSkillBase, 0);
  assert.equal(defender.shieldSkillPct, 0);
});

test('overheal shield refreshes max from the current shield without lowering high shields', () => {
  const context = loadFormulaContext();
  const stats = { hp: 1000, shieldEff: 0 };
  const freshShield = { hp: 1000, shield: 0, shieldMax: 500 };

  context.healPlayer(freshShield, 20000, stats);

  assert.equal(freshShield.shield, 100);
  assert.equal(freshShield.shieldMax, 100);
  assert.equal(freshShield.shieldMaxVersion, context.SHIELD_MAX_VERSION);

  const highShield = { hp: 1000, shield: 1000, shieldMax: 1000 };
  context.healPlayer(highShield, 20000, stats);

  assert.equal(highShield.shield, 1000);
  assert.equal(highShield.shieldMax, 1000);
});
