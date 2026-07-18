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

function hit(context, dCfg, aCfg = {}) {
  const defender = { hp: 100000, shield: 0, effects: {}, dots: [] };
  const result = context.resolveHit({}, defender, {
    atk: 0,
    dmgType: 'magic',
    level: 1,
    hit: 100,
    elemAtk: { fire: 100 },
    ...aCfg
  }, Object.assign({ dodge: 0, mdef: 0, mRes: 0, resist: {} }, dCfg));
  return result.dmg;
}

test('元素抗性會減免對應的元素附傷', () => {
  const context = loadFormulaContext();
  assert.equal(hit(context, {}), 100);
  const expected = 100 * (1 - context.elementalResistanceReduction(50, 1));
  assert.equal(hit(context, { resist: { fire: 50 } }), Math.round(expected));
});

test('魔法抗性不會重複減免元素附傷', () => {
  const context = loadFormulaContext();
  assert.equal(hit(context, { mRes: 60 }), 100);
  assert.ok(context.magicResistanceReduction(60, 1) > 0);
});

test('物理、魔法與元素抗性均不再套用上限，且各自使用獨立曲線參數', () => {
  const context = loadFormulaContext();
  const highResistance = 1000;
  const expected = Math.max(1, Math.round(100 * (1 - context.physicalResistanceReduction(highResistance, 1))));
  assert.equal(hit(context, { pRes: highResistance }, { dmgType: 'phys', atk: 100, elemAtk: {} }), expected);
  assert.equal(context.physicalResistanceReduction(1000, 1), context.magicResistanceReduction(1000, 1));
  assert.equal(context.elementalResistanceReduction(1000, 1), context.physicalResistanceReduction(1000, 1));
  context.PHYSICAL_RESISTANCE_BASE = 0;
  context.MAGIC_RESISTANCE_BASE = 100;
  assert.notEqual(context.physicalResistanceReduction(60, 1), context.magicResistanceReduction(60, 1));
});
