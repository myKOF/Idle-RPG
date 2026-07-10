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

test('全局減傷詞綴為史詩以上且不限制裝備部位', () => {
  const context = loadFormulaContext();
  const def = context.AFFIX_POOL.globalDmgRed;
  assert.ok(def);
  assert.equal(def.name, '全局減傷');
  assert.equal(def.pct, false);
  assert.equal(def.minR, 4);
  assert.equal(def.slots, undefined);
  assert.equal(context.SLOT_LIST.every((slot) => !def.slots || def.slots.includes(slot)), true);
});

test('全局減傷在最終傷害階段套用指定公式，無詞綴時維持原傷害', () => {
  const context = loadFormulaContext();
  const baseCfg = { atk: 100000, dmgType: 'phys', level: 1, hit: 100, critRate: 0 };
  const baseDef = { def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {} };
  const plainTarget = { hp: 100000, shield: 0 };
  const reducedTarget = { hp: 100000, shield: 0 };

  const plain = context.resolveHit({}, plainTarget, baseCfg, baseDef);
  const reduced = context.resolveHit({}, reducedTarget, baseCfg, { ...baseDef, globalDmgRed: 10000 });
  assert.equal(plain.dmg, 100000);
  assert.equal(reduced.dmg, 2500);
  assert.equal(reducedTarget.hp, 97500);
});
