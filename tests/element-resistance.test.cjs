const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFormulaContext() {
  const root = path.resolve(__dirname, '..');
  const context = { console, UI: { dirty: {} } };
  context.window = context;
  vm.createContext(context);
  ['js/util.js', 'js/data.js', 'js/formula.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  });
  context.chance = () => true;
  context.rnd = () => 1;
  return context;
}

function hit(context, dCfg) {
  const defender = { hp: 100000, shield: 0, effects: {}, dots: [] };
  const result = context.resolveHit({}, defender, {
    atk: 0,
    dmgType: 'magic',
    level: 1,
    hit: 100,
    elemAtk: { fire: 100 }
  }, Object.assign({ dodge: 0, mdef: 0, mRes: 0, resist: {} }, dCfg));
  return result.dmg;
}

test('元素抗性會減免對應的元素附傷', () => {
  const context = loadFormulaContext();
  assert.equal(hit(context, {}), 100);
  assert.equal(hit(context, { resist: { fire: 50 } }), 50);
});

test('魔法抗性不會重複減免元素附傷', () => {
  const context = loadFormulaContext();
  assert.equal(hit(context, { mRes: 60 }), 100);
});
