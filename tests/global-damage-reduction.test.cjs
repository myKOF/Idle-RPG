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
  context.GLOBAL_DMG_RED_DENOMINATOR = 20000;
  const baseCfg = { atk: 100000, dmgType: 'phys', level: 1, hit: 100, critRate: 0 };
  const baseDef = { def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {} };
  const plainTarget = { hp: 100000, shield: 0 };
  const reducedTarget = { hp: 100000, shield: 0 };

  const plain = context.resolveHit({}, plainTarget, baseCfg, baseDef);
  const reduced = context.resolveHit({}, reducedTarget, baseCfg, { ...baseDef, globalDmgRed: 10000 });
  assert.equal(plain.dmg, 100000);
  // 減傷率 = 10000/(10000+20000) = 33.33%，剩餘傷害 = 傷害 × (1 − 0.3333) ≈ 66667
  assert.equal(reduced.dmg, 66667);
  assert.equal(reducedTarget.hp, 33333);
});

test('全局減傷分母常數會影響實際減傷率', () => {
  const context = loadFormulaContext();

  context.GLOBAL_DMG_RED_DENOMINATOR = 30000;

  assert.equal(context.globalDamageReduction(10000), 0.25);
});

test('全局減傷減傷率上限由 GLOBAL_DMG_RED_CAP 控制', () => {
  const context = loadFormulaContext();
  context.GLOBAL_DMG_RED_CAP = 85;
  // 公式值 200000/(200000+20000) ≈ 90.9%，應被夾在 85%
  assert.equal(context.globalDamageReduction(200000), 0.85);
  assert.equal(context.globalDamageReduction(0), 0);

  const cfg = { atk: 100000, dmgType: 'phys', level: 1, hit: 100, critRate: 0 };
  const def = { def: 0, mdef: 0, dodge: 0, pRes: 0, mRes: 0, resist: {}, globalDmgRed: 200000 };
  const target = { hp: 100000, shield: 0 };
  const res = context.resolveHit({}, target, cfg, def);
  // 剩餘傷害倍率 = 1 − 0.85 = 0.15
  assert.equal(res.dmg, 15000);
  assert.equal(target.hp, 85000);
});

test('全局減傷黃色數值顯示格式化規則 (小數點四位，無條件捨去，不可能等於 100%)', () => {
  const context = loadFormulaContext();
  const pctStrFloor4GlobalDmgRed = context.pctStrFloor4GlobalDmgRed;

  // 1. 正常小數無條件捨去
  assert.equal(pctStrFloor4GlobalDmgRed(99.99999), '99.9999%');
  assert.equal(pctStrFloor4GlobalDmgRed(99.99994), '99.9999%');
  assert.equal(pctStrFloor4GlobalDmgRed(50.12345), '50.1234%');
  
  // 2. 剛好 100% 或是大於 100% 的情況，必須顯示 99.9999%
  assert.equal(pctStrFloor4GlobalDmgRed(100), '99.9999%');
  assert.equal(pctStrFloor4GlobalDmgRed(100.0001), '99.9999%');
  assert.equal(pctStrFloor4GlobalDmgRed(105), '99.9999%');

  // 3. 0% 與一般數值
  assert.equal(pctStrFloor4GlobalDmgRed(0), '0.0000%');
  assert.equal(pctStrFloor4GlobalDmgRed(0.00009), '0.0000%');
  assert.equal(pctStrFloor4GlobalDmgRed(0.0001), '0.0001%');
});
